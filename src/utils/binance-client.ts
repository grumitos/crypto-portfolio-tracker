import type {
  BinanceApiCredentials,
  BinanceAccountBalance,
  BinanceDualPosition,
  DualOptionType,
} from '../types';
import { loadApiCredentials } from './binance-auth';

const API_PROXY_BASE = '/binance-api/v3';
const SAPI_PROXY_BASE = '/binance-sapi/v1';
const FETCH_TIMEOUT_MS = 10_000;
const RECV_WINDOW = 5000;
const READ_ONLY_CACHE_TTL_MS = 5 * 60 * 1000;
const SERVER_TIME_CACHE_TTL_MS = 5 * 60 * 1000;
const ALLOWED_SIGNED_GET_ENDPOINTS = new Set([
  `${API_PROXY_BASE}/account`,
  `${SAPI_PROXY_BASE}/account/apiRestrictions`,
  `${SAPI_PROXY_BASE}/dci/product/positions`,
]);

// ── Cache ──

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const POSITIONS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
const BALANCE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
const CLOSED_DUAL_POSITION_STATUSES = new Set(['SETTLED', 'PURCHASE_FAIL', 'REFUND_SUCCESS']);

let positionsCache: CacheEntry<BinanceDualPosition[]> | null = null;
let balanceCache: CacheEntry<BinanceAccountBalance[]> | null = null;
let readOnlyCheckCache: { apiKey: string; ts: number } | null = null;
let readOnlyCheckInFlight: { apiKey: string; request: Promise<void> } | null = null;
let serverTimeOffsetCache: { offsetMs: number; ts: number } | null = null;
let serverTimeOffsetInFlight: Promise<number> | null = null;

function normalizeBinanceAssetCode(asset: string): string {
  const normalized = asset.toUpperCase().trim();

  // Binance can surface Simple Earn flexible balances with an `LD` prefix
  // (for example `LDUSDC`). Present them as the underlying asset.
  if (/^LD[A-Z0-9]{3,}$/u.test(normalized)) {
    return normalized.slice(2);
  }

  return normalized;
}

function mergeAccountBalances(rows: BinanceAccountBalance[]): BinanceAccountBalance[] {
  const merged = new Map<string, BinanceAccountBalance>();

  rows.forEach((row) => {
    const asset = normalizeBinanceAssetCode(row.asset);
    const current = merged.get(asset);
    if (current) {
      current.free += row.free;
      current.locked += row.locked;
      return;
    }

    merged.set(asset, {
      asset,
      free: row.free,
      locked: row.locked,
    });
  });

  return [...merged.values()].filter((row) => row.free > 0 || row.locked > 0);
}

// ── HMAC-SHA256 Signing ──

async function hmacSign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface BinanceServerTimeResponse {
  serverTime: number;
}

function clearServerTimeOffset(): void {
  serverTimeOffsetCache = null;
  serverTimeOffsetInFlight = null;
}

async function refreshServerTimeOffset(): Promise<number> {
  if (serverTimeOffsetInFlight) return serverTimeOffsetInFlight;

  const request = (async (): Promise<number> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_PROXY_BASE}/time`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Binance time API error ${response.status}: ${errorBody}`);
      }

      const payload = (await response.json()) as BinanceServerTimeResponse;
      const serverTime = Number(payload.serverTime);
      if (!Number.isFinite(serverTime) || serverTime <= 0) {
        throw new Error('Binance time API returned an invalid serverTime.');
      }

      const endedAt = Date.now();
      const localEstimate = startedAt + (endedAt - startedAt) / 2;
      const offsetMs = Math.round(serverTime - localEstimate);
      serverTimeOffsetCache = { offsetMs, ts: endedAt };
      return offsetMs;
    } finally {
      clearTimeout(timeout);
    }
  })();

  serverTimeOffsetInFlight = request;
  try {
    return await request;
  } finally {
    if (serverTimeOffsetInFlight === request) {
      serverTimeOffsetInFlight = null;
    }
  }
}

async function getSignedTimestamp(forceRefresh = false): Promise<number> {
  if (
    !forceRefresh &&
    serverTimeOffsetCache &&
    Date.now() - serverTimeOffsetCache.ts < SERVER_TIME_CACHE_TTL_MS
  ) {
    return Math.round(Date.now() + serverTimeOffsetCache.offsetMs);
  }

  if (!forceRefresh) {
    return Math.round(Date.now());
  }

  try {
    const offsetMs = await refreshServerTimeOffset();
    return Math.round(Date.now() + offsetMs);
  } catch {
    return Math.round(Date.now() + (serverTimeOffsetCache?.offsetMs ?? 0));
  }
}

async function signedParams(
  params: Record<string, string | number>,
  secret: string,
  options: { forceTimeRefresh?: boolean } = {},
): Promise<string> {
  const entries = {
    ...params,
    timestamp: await getSignedTimestamp(options.forceTimeRefresh),
    recvWindow: RECV_WINDOW,
  };
  const qs = Object.entries(entries)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const signature = await hmacSign(secret, qs);
  return `${qs}&signature=${signature}`;
}

function isTimestampOutsideRecvWindowError(status: number, errorBody: string): boolean {
  if (status !== 400) return false;
  try {
    const payload = JSON.parse(errorBody) as { code?: unknown };
    if (payload.code === -1021) return true;
  } catch {
    // Fall through to the text check below.
  }
  return errorBody.includes('-1021') && errorBody.toLowerCase().includes('timestamp');
}

// ── Generic fetch with timeout + auth ──

async function fetchSigned<T>(
  baseUrl: string,
  path: string,
  params: Record<string, string | number> = {},
  credentials?: BinanceApiCredentials,
  options: { skipReadOnlyCheck?: boolean } = {},
): Promise<T> {
  if (!ALLOWED_SIGNED_GET_ENDPOINTS.has(`${baseUrl}${path}`)) {
    throw new Error(`Blocked unsupported Binance signed endpoint: ${path}`);
  }

  const creds = credentials ?? loadApiCredentials();
  if (!creds) throw new Error('API credentials not configured');
  if (!options.skipReadOnlyCheck) {
    await assertBinanceCredentialsReadOnly(creds);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const qs = await signedParams(params, creds.apiSecret, {
      forceTimeRefresh: attempt > 0,
    });
    const url = `${baseUrl}${path}?${qs}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': creds.apiKey,
        },
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        if (attempt === 0 && isTimestampOutsideRecvWindowError(response.status, errorBody)) {
          clearServerTimeOffset();
          continue;
        }
        throw new Error(`Binance API error ${response.status}: ${errorBody}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Binance API request failed after refreshing server time.');
}

async function assertBinanceCredentialsReadOnly(creds: BinanceApiCredentials): Promise<void> {
  if (
    readOnlyCheckCache?.apiKey === creds.apiKey &&
    Date.now() - readOnlyCheckCache.ts < READ_ONLY_CACHE_TTL_MS
  ) {
    return;
  }

  if (readOnlyCheckInFlight?.apiKey === creds.apiKey) {
    return readOnlyCheckInFlight.request;
  }

  const request = (async () => {
    const restrictions = await fetchSigned<BinanceApiRestrictions>(
      SAPI_PROXY_BASE,
      '/account/apiRestrictions',
      {},
      creds,
      { skipReadOnlyCheck: true },
    );
    const warnings = getBinanceWritePermissionWarnings(restrictions);
    if (warnings.length > 0) {
      throw new Error(`Binance API key is not read-only. ${warnings.join('; ')}`);
    }

    readOnlyCheckCache = { apiKey: creds.apiKey, ts: Date.now() };
  })();

  readOnlyCheckInFlight = { apiKey: creds.apiKey, request };
  try {
    await request;
  } finally {
    if (readOnlyCheckInFlight?.request === request) {
      readOnlyCheckInFlight = null;
    }
  }
}

// ── Account balances (READ) ──

interface RawAccountInfo {
  balances: Array<{ asset: string; free: string; locked: string }>;
}

export async function fetchAccountBalances(forceRefresh = false): Promise<BinanceAccountBalance[]> {
  if (!forceRefresh && balanceCache && Date.now() - balanceCache.ts < BALANCE_CACHE_TTL_MS) {
    return balanceCache.data;
  }

  const raw = await fetchSigned<RawAccountInfo>(API_PROXY_BASE, '/account');
  const balances = mergeAccountBalances(
    raw.balances.map((b) => ({
      asset: b.asset,
      free: parseFloat(b.free),
      locked: parseFloat(b.locked),
    })),
  );

  balanceCache = { data: balances, ts: Date.now() };
  return balances;
}

// ── Dual Investment active positions (READ) ──

interface RawDualPositionsResponse {
  total: number;
  list: Array<{
    id: string;
    investCoin: string;
    exercisedCoin: string;
    subscriptionAmount: string;
    strikePrice: string;
    duration: number;
    settleDate: number;
    purchaseStatus?: string;
    apr: string;
    orderId?: string | number;
    purchaseEndTime?: number;
    optionType: string;
    purchaseTime?: number;
    autoCompoundPlan?: string;
  }>;
}

export async function fetchDualPositions(forceRefresh = false): Promise<BinanceDualPosition[]> {
  if (!forceRefresh && positionsCache && Date.now() - positionsCache.ts < POSITIONS_CACHE_TTL_MS) {
    return positionsCache.data;
  }

  const raw = await fetchSigned<RawDualPositionsResponse>(
    SAPI_PROXY_BASE,
    '/dci/product/positions',
    { pageSize: 100, pageIndex: 1 },
  );

  const positions: BinanceDualPosition[] = (raw.list ?? [])
    .map((p) => ({
      id: p.id,
      investCoin: normalizeBinanceAssetCode(p.investCoin),
      exercisedCoin: normalizeBinanceAssetCode(p.exercisedCoin),
      orderId: p.orderId !== undefined ? String(p.orderId) : undefined,
      strikePrice: parseFloat(p.strikePrice),
      amount: parseFloat(p.subscriptionAmount),
      duration: p.duration,
      settleDate: new Date(p.settleDate).toISOString().split('T')[0],
      apr: parseFloat(p.apr) * 100,
      purchaseStatus: p.purchaseStatus,
      purchaseEndTime: p.purchaseEndTime,
      optionType: p.optionType as DualOptionType,
      purchaseTime: p.purchaseTime,
      status: p.purchaseStatus ?? 'UNKNOWN',
    }))
    .filter((position) => !CLOSED_DUAL_POSITION_STATUSES.has(position.status));

  positionsCache = { data: positions, ts: Date.now() };
  return positions;
}

// ── Test API connection ──

export async function testApiConnection(credentials?: BinanceApiCredentials): Promise<{
  success: boolean;
  permissions: string[];
  readOnly: boolean;
  permissionWarnings: string[];
  error?: string;
}> {
  try {
    const creds = credentials ?? loadApiCredentials();
    if (!creds) {
      return {
        success: false,
        permissions: [],
        readOnly: false,
        permissionWarnings: [],
        error: 'No API credentials',
      };
    }

    const [account, restrictions] = await Promise.all([
      fetchSigned<{ permissions: string[] }>(API_PROXY_BASE, '/account', {}, creds, {
        skipReadOnlyCheck: true,
      }),
      fetchSigned<BinanceApiRestrictions>(SAPI_PROXY_BASE, '/account/apiRestrictions', {}, creds, {
        skipReadOnlyCheck: true,
      }),
    ]);
    const permissionWarnings = getBinanceWritePermissionWarnings(restrictions);
    return {
      success: true,
      permissions: account.permissions ?? [],
      readOnly: permissionWarnings.length === 0,
      permissionWarnings,
    };
  } catch (err) {
    return {
      success: false,
      permissions: [],
      readOnly: false,
      permissionWarnings: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

interface BinanceApiRestrictions {
  enableWithdrawals?: boolean;
  enableInternalTransfer?: boolean;
  enableMargin?: boolean;
  enableFutures?: boolean;
  permitsUniversalTransfer?: boolean;
  enableVanillaOptions?: boolean;
  enableFixApiTrade?: boolean;
  enableSpotAndMarginTrading?: boolean;
  enablePortfolioMarginTrading?: boolean;
}

function getBinanceWritePermissionWarnings(restrictions: BinanceApiRestrictions): string[] {
  const enabledWritePermissions = [
    ['WITHDRAW', restrictions.enableWithdrawals],
    ['INTERNAL_TRANSFER', restrictions.enableInternalTransfer],
    ['MARGIN', restrictions.enableMargin],
    ['FUTURES', restrictions.enableFutures],
    ['UNIVERSAL_TRANSFER', restrictions.permitsUniversalTransfer],
    ['VANILLA_OPTIONS', restrictions.enableVanillaOptions],
    ['FIX_TRADE', restrictions.enableFixApiTrade],
    ['SPOT_MARGIN_TRADING', restrictions.enableSpotAndMarginTrading],
    ['PORTFOLIO_MARGIN_TRADING', restrictions.enablePortfolioMarginTrading],
  ]
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name);

  return enabledWritePermissions.map((permission) => `Permiso de escritura activo: ${permission}`);
}

// ── Cache management ──

export function clearAllCaches(): void {
  positionsCache = null;
  balanceCache = null;
  readOnlyCheckCache = null;
  readOnlyCheckInFlight = null;
  clearServerTimeOffset();
}
