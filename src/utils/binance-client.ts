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

async function signedParams(
  params: Record<string, string | number>,
  secret: string,
): Promise<string> {
  const entries = { ...params, timestamp: Date.now(), recvWindow: RECV_WINDOW };
  const qs = Object.entries(entries)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const signature = await hmacSign(secret, qs);
  return `${qs}&signature=${signature}`;
}

// ── Generic fetch with timeout + auth ──

async function fetchSigned<T>(
  baseUrl: string,
  path: string,
  params: Record<string, string | number> = {},
  credentials?: BinanceApiCredentials,
): Promise<T> {
  const creds = credentials ?? loadApiCredentials();
  if (!creds) throw new Error('API credentials not configured');

  const qs = await signedParams(params, creds.apiSecret);
  const url = `${baseUrl}${path}?${qs}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': creds.apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Binance API error ${response.status}: ${errorBody}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
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
  error?: string;
}> {
  try {
    const creds = credentials ?? loadApiCredentials();
    if (!creds) return { success: false, permissions: [], error: 'No API credentials' };

    const raw = await fetchSigned<{ permissions: string[] }>(API_PROXY_BASE, '/account', {}, creds);
    return { success: true, permissions: raw.permissions ?? [] };
  } catch (err) {
    return {
      success: false,
      permissions: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ── Cache management ──

export function clearAllCaches(): void {
  positionsCache = null;
  balanceCache = null;
}
