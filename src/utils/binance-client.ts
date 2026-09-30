import type {
  BinanceApiCredentials,
  BinanceAccountBalance,
  BinanceDualPosition,
  DualOptionType,
} from '../types';
import { loadApiCredentials } from './binance-auth';

const API_PROXY_BASE = '/binance-api/v3';
const SAPI_PROXY_BASE = '/binance-sapi/v1';
const SAPI_V2_PROXY_BASE = '/binance-sapi/v2';
const FAPI_PROXY_BASE = '/binance-fapi/fapi/v3';
const FAPI_INCOME_PROXY_BASE = '/binance-fapi/fapi/v1';
const DAPI_PROXY_BASE = '/binance-dapi/dapi/v1';
const EAPI_PROXY_BASE = '/binance-eapi/eapi/v1';
const PAPI_PROXY_BASE = '/binance-papi/papi/v1';
const FETCH_TIMEOUT_MS = 10_000;
const RECV_WINDOW = 5000;
const READ_ONLY_CACHE_TTL_MS = 5 * 60 * 1000;
const SERVER_TIME_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * La lista es deliberadamente cerrada. El cliente no puede firmar un endpoint
 * que no esté aquí y, además, solo existe la variante GET del fetch firmado.
 * Esto evita que una ruta nueva de Binance termine convirtiéndose por accidente
 * en una operación de trading, transferencia o suscripción.
 */
const ALLOWED_SIGNED_ENDPOINTS = new Set([
  `${API_PROXY_BASE}/account`,
  `${SAPI_PROXY_BASE}/account/apiRestrictions`,
  `${SAPI_PROXY_BASE}/account/info`,
  `${SAPI_PROXY_BASE}/asset/assetDividend`,
  `${SAPI_PROXY_BASE}/asset/wallet/balance`,
  `${SAPI_PROXY_BASE}/capital/deposit/hisrec`,
  `${SAPI_PROXY_BASE}/capital/withdraw/history`,
  `${SAPI_PROXY_BASE}/dci/product/accounts`,
  `${SAPI_PROXY_BASE}/dci/product/positions`,
  `${SAPI_PROXY_BASE}/simple-earn/flexible/position`,
  `${SAPI_PROXY_BASE}/simple-earn/locked/position`,
  `${SAPI_PROXY_BASE}/simple-earn/flexible/history/rewardsRecord`,
  `${SAPI_PROXY_BASE}/simple-earn/locked/history/rewardsRecord`,
  `${SAPI_PROXY_BASE}/simple-earn/account`,
  `${SAPI_PROXY_BASE}/bfusd/account`,
  `${SAPI_PROXY_BASE}/bfusd/history/rewardsHistory`,
  `${SAPI_PROXY_BASE}/rwusd/account`,
  `${SAPI_PROXY_BASE}/rwusd/history/rewardsHistory`,
  `${SAPI_PROXY_BASE}/eth-staking/account`,
  `${SAPI_PROXY_BASE}/eth-staking/eth/history/wbethRewardsHistory`,
  `${SAPI_PROXY_BASE}/sol-staking/account`,
  `${SAPI_PROXY_BASE}/sol-staking/sol/history/bnsolRewardsHistory`,
  `${SAPI_PROXY_BASE}/sol-staking/sol/history/boostRewardsHistory`,
  `${SAPI_PROXY_BASE}/sol-staking/sol/history/unclaimedRewards`,
  `${SAPI_PROXY_BASE}/onchain-yields/locked/position`,
  `${SAPI_PROXY_BASE}/onchain-yields/locked/history/rewardsRecord`,
  `${SAPI_PROXY_BASE}/soft-staking/list`,
  `${SAPI_PROXY_BASE}/soft-staking/history/rewardsRecord`,
  `${SAPI_PROXY_BASE}/accumulator/product/position/list`,
  `${SAPI_PROXY_BASE}/accumulator/product/sum-holding`,
  `${SAPI_PROXY_BASE}/loan/ongoing/orders`,
  `${SAPI_PROXY_BASE}/loan/income`,
  `${SAPI_PROXY_BASE}/loan/vip/ongoing/orders`,
  `${SAPI_PROXY_BASE}/loan/vip/repay/history`,
  `${SAPI_PROXY_BASE}/loan/vip/collateral/account`,
  `${SAPI_V2_PROXY_BASE}/loan/flexible/ongoing/orders`,
  `${SAPI_PROXY_BASE}/margin/account`,
  `${SAPI_PROXY_BASE}/margin/isolated/account`,
  `${SAPI_PROXY_BASE}/margin/interestHistory`,
  `${SAPI_PROXY_BASE}/rebate/taxQuery`,
  `${SAPI_PROXY_BASE}/apiReferral/kickback/recentRecord`,
  `${FAPI_PROXY_BASE}/account`,
  `${FAPI_PROXY_BASE}/balance`,
  `${FAPI_INCOME_PROXY_BASE}/income`,
  `${DAPI_PROXY_BASE}/account`,
  `${DAPI_PROXY_BASE}/balance`,
  `${DAPI_PROXY_BASE}/income`,
  `${EAPI_PROXY_BASE}/marginAccount`,
  `${EAPI_PROXY_BASE}/position`,
  `${EAPI_PROXY_BASE}/userTrades`,
  `${EAPI_PROXY_BASE}/exerciseRecord`,
  `${PAPI_PROXY_BASE}/account`,
  `${PAPI_PROXY_BASE}/balance`,
  `${PAPI_PROXY_BASE}/um/account`,
  `${PAPI_PROXY_BASE}/cm/account`,
  `${PAPI_PROXY_BASE}/um/positionRisk`,
  `${PAPI_PROXY_BASE}/cm/positionRisk`,
  `${PAPI_PROXY_BASE}/um/income`,
  `${PAPI_PROXY_BASE}/cm/income`,
  `${SAPI_V2_PROXY_BASE}/eth-staking/account`,
]);

const SIMPLE_EARN_PAGE_SIZE = 100;
const CLOSED_SIMPLE_EARN_LOCKED_STATUSES = new Set([
  'REDEEMED',
  'REDEEMING',
  'PURCHASE_FAILED',
  'REFUND_SUCCESS',
]);

// ── Cache ──

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const POSITIONS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
const BALANCE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
const OPTIONAL_REPORT_TIMEOUT_MS = 9000;
const CLOSED_DUAL_POSITION_STATUSES = new Set(['SETTLED', 'PURCHASE_FAIL', 'REFUND_SUCCESS']);

let positionsCache: CacheEntry<BinanceDualPosition[]> | null = null;
let balanceCache: CacheEntry<AccountBalancesResult> | null = null;
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

function isBinanceEarnWrapperAsset(asset: string): boolean {
  return /^LD[A-Z0-9]{3,}$/u.test(asset.toUpperCase().trim());
}

function parseFiniteNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
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

/**
 * Error de una llamada firmada, con el estado HTTP y el codigo numerico que
 * devuelve Binance en el cuerpo. Sin ese codigo no hay forma de separar "la API
 * key no tiene este permiso" de "este monedero no aplica a esta cuenta", que es
 * justo lo que el usuario necesita saber cuando falta saldo.
 */
export class BinanceRequestError extends Error {
  readonly status: number;
  readonly code: number | null;

  constructor(status: number, body: string) {
    super(`Binance API error ${status}: ${body}`);
    this.name = 'BinanceRequestError';
    this.status = status;
    this.code = parseBinanceErrorCode(body);
  }
}

function parseBinanceErrorCode(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed.code === 'number' ? parsed.code : null;
  } catch {
    return null;
  }
}

/**
 * Codigos con los que Binance rechaza una llamada por credenciales: clave
 * invalida, IP no autorizada o permiso ausente para ese endpoint.
 * https://developers.binance.com/docs/binance-spot-api-docs/errors
 */
const BINANCE_PERMISSION_ERROR_CODES = new Set([-2015, -2014, -1002, -1099]);

/** Motivo por el que un monedero opcional no pudo leerse. */
export type WalletIssueReason = 'permission' | 'unavailable';

export type WalletScope = 'funding' | 'earn';

export interface WalletIssue {
  wallet: WalletScope;
  reason: WalletIssueReason;
}

/** Productos de cuenta personal que Binance expone con endpoints de lectura. */
export type BinanceAccountProduct =
  | 'spot'
  | 'funding'
  | 'usd-m-futures'
  | 'coin-m-futures'
  | 'options'
  | 'margin'
  | 'portfolio-margin'
  | 'simple-earn'
  | 'bfusd'
  | 'rwusd'
  | 'eth-staking'
  | 'sol-staking'
  | 'onchain-yields'
  | 'soft-staking'
  | 'dual-investment'
  | 'discount-buy'
  | 'crypto-loan'
  | 'vip-loan'
  | 'wallet-rewards'
  | 'rebate';

export interface BinanceAssetAmount {
  asset: string;
  amount: number;
}

export type BinanceProductStatus = 'ok' | 'partial' | 'unavailable' | 'included-in-wallet';

export interface BinanceProductIssue {
  product: BinanceAccountProduct;
  reason: WalletIssueReason;
}

export interface BinanceProductReport {
  product: BinanceAccountProduct;
  label: string;
  status: BinanceProductStatus;
  /** USD directo cuando Binance lo proporciona; si no, se valora por activo. */
  balanceUsd: number | null;
  balanceAmounts: BinanceAssetAmount[];
  unrealizedPnl: BinanceAssetAmount[];
  dailyPnl: BinanceAssetAmount[];
  dailyRewards: BinanceAssetAmount[];
  positionCount: number;
  /** Si es false, el saldo ya está en Wallet o se suma desde Posiciones. */
  includedInTotal: boolean;
  /** Valoraciones calculadas por el cliente con precios de mercado actuales. */
  balanceUsdEstimate?: number | null;
  dailyPnlUsdEstimate?: number | null;
  dailyRewardsUsdEstimate?: number | null;
  unrealizedPnlUsdEstimate?: number | null;
  note?: string;
}

export interface BinanceAccountReadReport {
  fetchedAt: number;
  products: BinanceProductReport[];
  dailyPnl: BinanceAssetAmount[];
  dailyRewards: BinanceAssetAmount[];
  externalFlows: BinanceAssetAmount[];
  issues: BinanceProductIssue[];
  /** Suma de los PnL explícitos, valorada con el precio actual. */
  explicitDailyPnlUsd?: number | null;
  /** Variación del NAV del día, ajustada por depósitos y retiros externos. */
  dailyBalanceChangeUsd?: number | null;
  isPartial: boolean;
}

function classifyWalletFailure(error: unknown): WalletIssueReason {
  if (!(error instanceof BinanceRequestError)) return 'unavailable';
  if (error.status === 401 || error.status === 403) return 'permission';
  return error.code !== null && BINANCE_PERMISSION_ERROR_CODES.has(error.code)
    ? 'permission'
    : 'unavailable';
}

// ── Generic fetch with timeout + auth ──

async function fetchSigned<T>(
  baseUrl: string,
  path: string,
  params: Record<string, string | number> = {},
  credentials?: BinanceApiCredentials,
  options: { skipReadOnlyCheck?: boolean } = {},
): Promise<T> {
  if (!ALLOWED_SIGNED_ENDPOINTS.has(`${baseUrl}${path}`)) {
    throw new Error(`Blocked unsupported Binance signed GET endpoint: ${path}`);
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
        throw new BinanceRequestError(response.status, errorBody);
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

interface RawFundingBalance {
  asset: string;
  free: string;
  locked: string;
  freeze?: string;
  withdrawing?: string;
}

interface RawWalletAssetBalance extends RawFundingBalance {
  btcValuation?: string;
}

interface RawWalletBalance {
  walletName?: string;
  balance?: string;
  assetBalances?: RawWalletAssetBalance[];
}

interface RawSimpleEarnFlexiblePosition {
  asset: string;
  totalAmount: string;
}

interface RawSimpleEarnLockedPosition {
  asset: string;
  amount: string;
  status?: string;
}

interface RawSimpleEarnFlexibleResponse {
  rows?: RawSimpleEarnFlexiblePosition[];
  total?: number;
}

interface RawSimpleEarnLockedResponse {
  rows?: RawSimpleEarnLockedPosition[];
  total?: number;
}

function mapRawAccountBalance(row: {
  asset: string;
  free: string;
  locked: string;
}): BinanceAccountBalance {
  return {
    asset: row.asset,
    free: parseFiniteNumber(row.free),
    locked: parseFiniteNumber(row.locked),
  };
}

function hasPositiveBalance(row: BinanceAccountBalance): boolean {
  return row.free > 0 || row.locked > 0;
}

function filterSpotBalancesAgainstEarn(
  rows: BinanceAccountBalance[],
  earnAssets: Set<string>,
): BinanceAccountBalance[] {
  return rows.filter((row) => {
    if (!isBinanceEarnWrapperAsset(row.asset)) return true;
    return !earnAssets.has(normalizeBinanceAssetCode(row.asset));
  });
}

async function fetchFundingBalances(): Promise<BinanceAccountBalance[]> {
  const raw = await fetchSigned<unknown>(SAPI_PROXY_BASE, '/asset/wallet/balance', {
    needBalanceDetail: 'true',
  });

  // The current Wallet API returns one object per wallet. Keeping array support
  // here makes the parser tolerant of the older response shape used by some
  // regional gateways, while still selecting Funding only.
  const wallets: RawWalletBalance[] = Array.isArray(raw)
    ? (raw as RawWalletBalance[])
    : raw && typeof raw === 'object'
      ? [raw as RawWalletBalance]
      : [];

  const funding = wallets.filter((wallet) => /funding/i.test(wallet.walletName ?? ''));
  return funding
    .flatMap((wallet) => wallet.assetBalances ?? [])
    .map((balance) => ({
      asset: String(balance.asset ?? ''),
      free: parseFiniteNumber(balance.free),
      locked:
        parseFiniteNumber(balance.locked) +
        parseFiniteNumber(balance.freeze) +
        parseFiniteNumber(balance.withdrawing),
    }))
    .filter((row) => row.asset && hasPositiveBalance(row));
}

async function fetchSimpleEarnFlexibleBalancePage(
  current: number,
): Promise<RawSimpleEarnFlexibleResponse> {
  return fetchSigned<RawSimpleEarnFlexibleResponse>(
    SAPI_PROXY_BASE,
    '/simple-earn/flexible/position',
    {
      current,
      size: SIMPLE_EARN_PAGE_SIZE,
    },
  );
}

async function fetchSimpleEarnLockedBalancePage(
  current: number,
): Promise<RawSimpleEarnLockedResponse> {
  return fetchSigned<RawSimpleEarnLockedResponse>(SAPI_PROXY_BASE, '/simple-earn/locked/position', {
    current,
    size: SIMPLE_EARN_PAGE_SIZE,
  });
}

async function fetchSimpleEarnFlexibleBalances(): Promise<BinanceAccountBalance[]> {
  const balances: BinanceAccountBalance[] = [];
  for (let current = 1; ; current += 1) {
    const page = await fetchSimpleEarnFlexibleBalancePage(current);
    const rows = Array.isArray(page.rows) ? page.rows : [];
    balances.push(
      ...rows
        .map((row) => ({
          asset: row.asset,
          // Flexible admite redencion inmediata: es saldo disponible, no
          // bloqueado. Contarlo como bloqueado dejaba la columna "Libre" en cero
          // y escondia todo el margen de una cuenta que tiene su saldo en Earn.
          free: parseFiniteNumber(row.totalAmount),
          locked: 0,
        }))
        .filter((row) => row.asset && hasPositiveBalance(row)),
    );

    if (!Number.isFinite(page.total) || current * SIMPLE_EARN_PAGE_SIZE >= (page.total ?? 0)) {
      break;
    }
  }
  return balances;
}

async function fetchSimpleEarnLockedBalances(): Promise<BinanceAccountBalance[]> {
  const balances: BinanceAccountBalance[] = [];
  for (let current = 1; ; current += 1) {
    const page = await fetchSimpleEarnLockedBalancePage(current);
    const rows = Array.isArray(page.rows) ? page.rows : [];
    balances.push(
      ...rows
        .filter((row) => !CLOSED_SIMPLE_EARN_LOCKED_STATUSES.has(row.status ?? ''))
        .map((row) => ({
          asset: row.asset,
          free: 0,
          locked: parseFiniteNumber(row.amount),
        }))
        .filter((row) => row.asset && hasPositiveBalance(row)),
    );

    if (!Number.isFinite(page.total) || current * SIMPLE_EARN_PAGE_SIZE >= (page.total ?? 0)) {
      break;
    }
  }
  return balances;
}

async function fetchSimpleEarnBalances(): Promise<BinanceAccountBalance[]> {
  const [flexible, locked] = await Promise.all([
    fetchSimpleEarnFlexibleBalances(),
    fetchSimpleEarnLockedBalances(),
  ]);
  return [...flexible, ...locked];
}

/**
 * Un monedero opcional que falla no debe tumbar la lectura de saldos, pero
 * tampoco desaparecer en silencio: devolver [] sin mas hace que un permiso que
 * falta se lea como "no tienes saldo".
 */
async function fetchOptionalAccountBalances(
  request: Promise<BinanceAccountBalance[]>,
  wallet: WalletScope,
): Promise<{ balances: BinanceAccountBalance[]; issue: WalletIssue | null }> {
  try {
    return { balances: await request, issue: null };
  } catch (error) {
    return { balances: [], issue: { wallet, reason: classifyWalletFailure(error) } };
  }
}

export interface AccountBalancesResult {
  balances: BinanceAccountBalance[];
  /** Monederos que no se pudieron leer, con el motivo. Vacio si todo respondio. */
  issues: WalletIssue[];
  /** Lectura agregada de derivados, Earn y demás productos de cuenta. */
  report?: BinanceAccountReadReport;
}

export async function fetchAccountBalances(forceRefresh = false): Promise<AccountBalancesResult> {
  if (!forceRefresh && balanceCache && Date.now() - balanceCache.ts < BALANCE_CACHE_TTL_MS) {
    return balanceCache.data;
  }

  const raw = await fetchSigned<RawAccountInfo>(API_PROXY_BASE, '/account');
  const spotBalances = (raw.balances ?? []).map(mapRawAccountBalance);
  const [funding, earn] = await Promise.all([
    fetchOptionalAccountBalances(fetchFundingBalances(), 'funding'),
    fetchOptionalAccountBalances(fetchSimpleEarnBalances(), 'earn'),
  ]);
  const earnAssets = new Set(earn.balances.map((row) => normalizeBinanceAssetCode(row.asset)));
  const balances = mergeAccountBalances([
    ...filterSpotBalancesAgainstEarn(spotBalances, earnAssets),
    ...funding.balances,
    ...earn.balances,
  ]);
  const issues = [funding.issue, earn.issue].filter(
    (issue): issue is WalletIssue => issue !== null,
  );
  let report: BinanceAccountReadReport | undefined;
  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('Binance account report timed out.')),
        OPTIONAL_REPORT_TIMEOUT_MS,
      );
    });
    try {
      report = await Promise.race([fetchBinanceAccountReadReport(balances, issues), timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch {
    // The base wallet remains usable even if the optional product report fails
    // before it can classify its own individual endpoints.
  }
  const result: AccountBalancesResult = {
    balances,
    issues,
    report,
  };

  balanceCache = { data: result, ts: Date.now() };
  return result;
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

// ── Unified account read report ──

const REPORT_STABLE_ASSETS = new Set([
  'USD',
  'USDT',
  'USDC',
  'BUSD',
  'DAI',
  'FDUSD',
  'BFUSD',
  'RWUSD',
]);
const PNL_INCOME_TYPES = new Set([
  'REALIZED_PNL',
  'FUNDING_FEE',
  'COMMISSION',
  'INSURANCE_CLEAR',
  'ADJUSTMENT',
]);
const REWARD_INCOME_TYPES = new Set([
  'WELCOME_BONUS',
  'REFERRAL_KICKBACK',
  'COMMISSION_REBATE',
  'API_REBATE',
]);
// Simple Earn and several investment endpoints cap `size` at 100.
const REPORT_PAGE_SIZE = 100;
const REBATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const PRODUCT_LABELS: Record<BinanceAccountProduct, string> = {
  spot: 'Spot',
  funding: 'Funding',
  'usd-m-futures': 'Futuros USDⓈ-M',
  'coin-m-futures': 'Futuros COIN-M',
  options: 'Opciones',
  margin: 'Margin',
  'portfolio-margin': 'Portfolio Margin',
  'simple-earn': 'Simple Earn',
  bfusd: 'BFUSD',
  rwusd: 'RWUSD',
  'eth-staking': 'ETH Staking',
  'sol-staking': 'SOL Staking',
  'onchain-yields': 'On-chain Yields',
  'soft-staking': 'Soft Staking',
  'dual-investment': 'Dual Investment',
  'discount-buy': 'Discount Buy',
  'crypto-loan': 'Crypto Loan',
  'vip-loan': 'VIP Loan',
  'wallet-rewards': 'Dividendos y recompensas Wallet',
  rebate: 'Rebates',
};

let rebateCache: (CacheEntry<BinanceAssetAmount[]> & { dayStart: number }) | null = null;

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null ? (value as RecordValue) : null;
}

function asRecordArray(value: unknown): RecordValue[] {
  return Array.isArray(value)
    ? value.filter((row): row is RecordValue => asRecord(row) !== null)
    : [];
}

/** Normaliza las variantes `{rows}`, `{data: {data}}` y arrays de Binance. */
function rowsFromPayload(payload: unknown): RecordValue[] {
  if (Array.isArray(payload)) return asRecordArray(payload);
  const record = asRecord(payload);
  if (!record) return [];

  for (const key of ['rows', 'assets', 'list', 'positions']) {
    if (Array.isArray(record[key])) return asRecordArray(record[key]);
  }
  if (Array.isArray(record.data)) return asRecordArray(record.data);
  const nestedData = asRecord(record.data);
  if (nestedData) {
    if (Array.isArray(nestedData.rows)) return asRecordArray(nestedData.rows);
    if (Array.isArray(nestedData.data)) return asRecordArray(nestedData.data);
  }

  return [];
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(record: RecordValue, ...keys: string[]): number | null {
  for (const key of keys) {
    const number = optionalNumber(record[key]);
    if (number !== null) return number;
  }
  return null;
}

function firstText(record: RecordValue, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function amount(asset: unknown, value: unknown): BinanceAssetAmount | null {
  const normalizedAsset = typeof asset === 'string' ? normalizeBinanceAssetCode(asset) : '';
  const number = optionalNumber(value);
  if (!normalizedAsset || number === null || number === 0) return null;
  return { asset: normalizedAsset, amount: number };
}

function mergeAssetAmounts(rows: BinanceAssetAmount[]): BinanceAssetAmount[] {
  const merged = new Map<string, number>();
  rows.forEach((row) => {
    if (!row.asset || !Number.isFinite(row.amount) || row.amount === 0) return;
    merged.set(row.asset, (merged.get(row.asset) ?? 0) + row.amount);
  });
  return [...merged.entries()]
    .filter(([, value]) => value !== 0 && Number.isFinite(value))
    .map(([asset, value]) => ({ asset, amount: value }));
}

function currentUtcDayRange(now = Date.now()): { startTime: number; endTime: number } {
  const date = new Date(now);
  const startTime = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { startTime, endTime: now };
}

function stableUsdValue(rows: BinanceAssetAmount[]): number | null {
  if (rows.length === 0) return null;
  if (!rows.every((row) => REPORT_STABLE_ASSETS.has(row.asset))) return null;
  return rows.reduce((total, row) => total + row.amount, 0);
}

function productReport(
  product: BinanceAccountProduct,
  values: Partial<Omit<BinanceProductReport, 'product' | 'label'>> = {},
): BinanceProductReport {
  return {
    product,
    label: PRODUCT_LABELS[product],
    status: 'ok',
    balanceUsd: null,
    balanceAmounts: [],
    unrealizedPnl: [],
    dailyPnl: [],
    dailyRewards: [],
    positionCount: 0,
    includedInTotal: false,
    ...values,
  };
}

function unavailableProductReport(
  product: BinanceAccountProduct,
  reason: WalletIssueReason,
): BinanceProductReport {
  return productReport(product, {
    status: 'unavailable',
    note:
      reason === 'permission'
        ? 'No se leyó: la API key no tiene permiso para este producto.'
        : 'No se leyó: el endpoint no respondió o el producto no aplica a esta cuenta.',
  });
}

function classifyReportFailure(error: unknown): WalletIssueReason {
  return classifyWalletFailure(error);
}

async function tryReadProduct(
  product: BinanceAccountProduct,
  request: () => Promise<BinanceProductReport>,
): Promise<{ report: BinanceProductReport; issue: BinanceProductIssue | null }> {
  try {
    return { report: await request(), issue: null };
  } catch (error) {
    const reason = classifyReportFailure(error);
    return {
      report: unavailableProductReport(product, reason),
      issue: { product, reason },
    };
  }
}

async function fetchProductPage(
  baseUrl: string,
  path: string,
  params: Record<string, string | number>,
): Promise<RecordValue[]> {
  const rows: RecordValue[] = [];
  for (let current = 1; current <= 100; current += 1) {
    const page = await fetchSigned<unknown>(baseUrl, path, {
      ...params,
      current,
      size: REPORT_PAGE_SIZE,
    });
    const pageRows = rowsFromPayload(page);
    rows.push(...pageRows);
    const pageRecord = asRecord(page);
    const total = optionalNumber(pageRecord?.total);
    if (pageRows.length === 0 || total === null || current * REPORT_PAGE_SIZE >= total) break;
  }
  return rows;
}

function parseIncomePayload(payload: unknown): {
  dailyPnl: BinanceAssetAmount[];
  dailyRewards: BinanceAssetAmount[];
} {
  const dailyPnl: BinanceAssetAmount[] = [];
  const dailyRewards: BinanceAssetAmount[] = [];
  rowsFromPayload(payload).forEach((row) => {
    const type = (firstText(row, 'incomeType', 'type') ?? '').toUpperCase();
    const assetName = firstText(row, 'asset', 'incomeAsset', 'marginAsset') ?? 'USDT';
    const value = firstNumber(row, 'income', 'amount', 'profit', 'realizedPnl');
    const parsed = amount(assetName, value);
    if (!parsed) return;
    if (PNL_INCOME_TYPES.has(type)) dailyPnl.push(parsed);
    if (REWARD_INCOME_TYPES.has(type)) dailyRewards.push(parsed);
  });
  return {
    dailyPnl: mergeAssetAmounts(dailyPnl),
    dailyRewards: mergeAssetAmounts(dailyRewards),
  };
}

function assetRowsFromAccount(record: RecordValue): RecordValue[] {
  for (const key of ['assets', 'balances', 'userAssets']) {
    const rows = asRecordArray(record[key]);
    if (rows.length > 0) return rows;
  }
  return typeof record.asset === 'string' ? [record] : [];
}

function futureBalanceAmounts(record: RecordValue): BinanceAssetAmount[] {
  return assetRowsFromAccount(record)
    .map((row) =>
      amount(
        firstText(row, 'asset', 'marginAsset', 'walletAsset'),
        firstNumber(row, 'marginBalance', 'balance', 'walletBalance', 'equity'),
      ),
    )
    .filter((row): row is BinanceAssetAmount => row !== null);
}

function futureUnrealizedPnl(record: RecordValue): BinanceAssetAmount[] {
  const rows = assetRowsFromAccount(record)
    .map((row) =>
      amount(
        firstText(row, 'asset', 'marginAsset', 'walletAsset'),
        firstNumber(row, 'unrealizedProfit', 'unRealizedProfit', 'unrealizedPNL'),
      ),
    )
    .filter((row): row is BinanceAssetAmount => row !== null);
  if (rows.length > 0) return mergeAssetAmounts(rows);

  const total = firstNumber(record, 'totalUnrealizedProfit', 'totalUnrealizedPNL');
  return total === null ? [] : [{ asset: 'USDT', amount: total }];
}

function futurePositionCount(record: RecordValue): number {
  return rowsFromPayload(record.positions).filter((row) => {
    const size = firstNumber(row, 'positionAmt', 'positionAmount', 'qty');
    return size === null || size !== 0;
  }).length;
}

async function readUsdMFuturesReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const [accountResult, balanceResult, incomeResult] = await Promise.allSettled([
    fetchSigned<unknown>(FAPI_PROXY_BASE, '/account'),
    fetchSigned<unknown>(FAPI_PROXY_BASE, '/balance'),
    fetchSigned<unknown>(FAPI_INCOME_PROXY_BASE, '/income', {
      startTime: range.startTime,
      endTime: range.endTime,
      limit: REPORT_PAGE_SIZE,
    }),
  ]);
  if (accountResult.status === 'rejected' && balanceResult.status === 'rejected') {
    throw accountResult.reason;
  }

  const account = accountResult.status === 'fulfilled' ? (asRecord(accountResult.value) ?? {}) : {};
  const accountBalanceAmounts = futureBalanceAmounts(account);
  const fallbackBalanceAmounts =
    balanceResult.status === 'fulfilled'
      ? mergeAssetAmounts(
          rowsFromPayload(balanceResult.value)
            .map((row) => amount(firstText(row, 'asset') ?? '', firstNumber(row, 'balance')))
            .filter((row): row is BinanceAssetAmount => row !== null),
        )
      : [];
  const balanceAmounts = mergeAssetAmounts(
    accountBalanceAmounts.length > 0 ? accountBalanceAmounts : fallbackBalanceAmounts,
  );
  const income =
    incomeResult.status === 'fulfilled' ? parseIncomePayload(incomeResult.value) : null;
  const reportedBalance = firstNumber(account, 'totalMarginBalance', 'totalWalletBalance');
  const fallbackBalance = stableUsdValue(balanceAmounts);
  // In multi-asset mode Binance can expose the aggregate field as zero while
  // the asset rows contain the real USDC/USDT equity. Prefer that fallback in
  // this specific case; otherwise the whole USD-M wallet disappears from the
  // account total.
  const directBalance =
    reportedBalance !== null && (reportedBalance !== 0 || fallbackBalance === null)
      ? reportedBalance
      : fallbackBalance;
  return productReport('usd-m-futures', {
    status:
      incomeResult.status === 'fulfilled' && accountResult.status === 'fulfilled'
        ? 'ok'
        : 'partial',
    balanceUsd: directBalance,
    balanceAmounts,
    unrealizedPnl: futureUnrealizedPnl(account),
    dailyPnl: income?.dailyPnl ?? [],
    dailyRewards: income?.dailyRewards ?? [],
    positionCount: futurePositionCount(account),
    includedInTotal: true,
    note:
      incomeResult.status === 'fulfilled' && accountResult.status === 'fulfilled'
        ? 'Equity de USDⓈ-M; el PnL diario explícito no se suma otra vez al saldo.'
        : 'Saldo leído parcialmente; revisa el historial o el endpoint de balance.',
  });
}

async function readCoinMFuturesReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const [accountResult, balanceResult, incomeResult] = await Promise.allSettled([
    fetchSigned<unknown>(DAPI_PROXY_BASE, '/account'),
    fetchSigned<unknown>(DAPI_PROXY_BASE, '/balance'),
    fetchSigned<unknown>(DAPI_PROXY_BASE, '/income', {
      startTime: range.startTime,
      endTime: range.endTime,
      limit: REPORT_PAGE_SIZE,
    }),
  ]);
  if (accountResult.status === 'rejected' && balanceResult.status === 'rejected') {
    throw accountResult.reason;
  }

  const account = accountResult.status === 'fulfilled' ? (asRecord(accountResult.value) ?? {}) : {};
  const accountBalanceAmounts = futureBalanceAmounts(account);
  const fallbackBalanceAmounts =
    balanceResult.status === 'fulfilled'
      ? mergeAssetAmounts(
          rowsFromPayload(balanceResult.value)
            .map((row) => amount(firstText(row, 'asset') ?? '', firstNumber(row, 'balance')))
            .filter((row): row is BinanceAssetAmount => row !== null),
        )
      : [];
  const balanceAmounts = mergeAssetAmounts(
    accountBalanceAmounts.length > 0 ? accountBalanceAmounts : fallbackBalanceAmounts,
  );
  const income =
    incomeResult.status === 'fulfilled' ? parseIncomePayload(incomeResult.value) : null;
  return productReport('coin-m-futures', {
    status:
      incomeResult.status === 'fulfilled' && accountResult.status === 'fulfilled'
        ? 'ok'
        : 'partial',
    balanceUsd: stableUsdValue(balanceAmounts),
    balanceAmounts,
    unrealizedPnl: futureUnrealizedPnl(account),
    dailyPnl: income?.dailyPnl ?? [],
    dailyRewards: income?.dailyRewards ?? [],
    positionCount: futurePositionCount(account),
    includedInTotal: true,
    note:
      incomeResult.status === 'fulfilled' && accountResult.status === 'fulfilled'
        ? 'Se valora por el margen de cada activo COIN-M.'
        : 'Saldo leído; el historial de PnL diario no respondió.',
  });
}

function parseOptionTradePnl(payload: unknown): BinanceAssetAmount[] {
  const result: BinanceAssetAmount[] = [];
  rowsFromPayload(payload).forEach((row) => {
    const assetName =
      firstText(row, 'realizedProfitAsset', 'feeAsset', 'asset', 'marginAsset') ?? 'USDT';
    const realized = firstNumber(row, 'realizedProfit', 'realizedPNL', 'profit');
    const fee = firstNumber(row, 'fee', 'commission');
    const realizedAmount = amount(assetName, realized);
    if (realizedAmount) result.push(realizedAmount);
    if (fee !== null && fee !== 0) {
      const feeAsset = firstText(row, 'feeAsset', 'commissionAsset') ?? assetName;
      result.push({ asset: normalizeBinanceAssetCode(feeAsset), amount: -Math.abs(fee) });
    }
  });
  return mergeAssetAmounts(result);
}

async function readOptionsReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const [accountResult, positionsResult, tradesResult, exerciseResult] = await Promise.allSettled([
    fetchSigned<unknown>(EAPI_PROXY_BASE, '/marginAccount'),
    fetchSigned<unknown>(EAPI_PROXY_BASE, '/position'),
    fetchSigned<unknown>(EAPI_PROXY_BASE, '/userTrades', {
      startTime: range.startTime,
      endTime: range.endTime,
      limit: REPORT_PAGE_SIZE,
    }),
    fetchSigned<unknown>(EAPI_PROXY_BASE, '/exerciseRecord', {
      startTime: range.startTime,
      endTime: range.endTime,
      limit: REPORT_PAGE_SIZE,
    }),
  ]);
  if (accountResult.status === 'rejected') throw accountResult.reason;

  const account = asRecord(accountResult.value) ?? {};
  const balanceAmounts = mergeAssetAmounts(
    assetRowsFromAccount(account)
      .map((row) =>
        amount(
          firstText(row, 'asset', 'marginAsset'),
          firstNumber(row, 'equity', 'marginBalance', 'balance', 'available'),
        ),
      )
      .filter((row): row is BinanceAssetAmount => row !== null),
  );
  const totalEquity = firstNumber(account, 'totalEquity', 'equity');
  const positionRows =
    positionsResult.status === 'fulfilled' ? rowsFromPayload(positionsResult.value) : [];
  const tradePnl =
    tradesResult.status === 'fulfilled' ? parseOptionTradePnl(tradesResult.value) : [];
  // `userTrades` and `exerciseRecord` can describe the same exercised contract.
  // Prefer the trade ledger and use the exercise ledger only when no trade PnL
  // was returned, preventing a duplicated Options result.
  const dailyPnl =
    tradePnl.length > 0
      ? tradePnl
      : exerciseResult.status === 'fulfilled'
        ? parseOptionTradePnl(exerciseResult.value)
        : [];
  const incomplete = [positionsResult, tradesResult, exerciseResult].some(
    (result) => result.status === 'rejected',
  );
  return productReport('options', {
    status: incomplete ? 'partial' : 'ok',
    balanceUsd: totalEquity ?? stableUsdValue(balanceAmounts),
    balanceAmounts,
    unrealizedPnl: mergeAssetAmounts(
      assetRowsFromAccount(account)
        .map((row) =>
          amount(
            firstText(row, 'asset', 'marginAsset'),
            firstNumber(row, 'unrealizedPNL', 'unrealizedProfit'),
          ),
        )
        .filter((row): row is BinanceAssetAmount => row !== null),
    ),
    dailyPnl: mergeAssetAmounts(dailyPnl),
    positionCount: positionRows.length,
    includedInTotal: true,
    note: incomplete
      ? 'Equity leída; uno o más historiales de Opciones no respondieron.'
      : 'Equity, PnL realizado, comisiones y ejercicios leídos sin duplicarlos.',
  });
}

function parseMarginIsolatedBalances(payload: unknown): BinanceAssetAmount[] {
  const result: BinanceAssetAmount[] = [];
  rowsFromPayload(payload).forEach((row) => {
    const nestedBase = asRecord(row.baseAsset);
    const nestedQuote = asRecord(row.quoteAsset);
    const candidates = [
      nestedBase
        ? amount(
            firstText(nestedBase, 'asset', 'coin'),
            firstNumber(nestedBase, 'netAsset', 'marginBalance', 'balance'),
          )
        : null,
      nestedQuote
        ? amount(
            firstText(nestedQuote, 'asset', 'coin'),
            firstNumber(nestedQuote, 'netAsset', 'marginBalance', 'balance'),
          )
        : null,
      amount(
        firstText(row, 'asset', 'coin'),
        firstNumber(row, 'netAsset', 'marginBalance', 'balance'),
      ),
    ];
    result.push(...candidates.filter((item): item is BinanceAssetAmount => item !== null));
  });
  return mergeAssetAmounts(result);
}

function parseMarginInterest(payload: unknown): BinanceAssetAmount[] {
  return mergeAssetAmounts(
    rowsFromPayload(payload)
      .map((row) => {
        const interest = firstNumber(row, 'interest', 'interestAmount');
        if (interest === null || interest === 0) return null;
        return amount(firstText(row, 'asset', 'interestAsset') ?? 'USDT', -Math.abs(interest));
      })
      .filter((row): row is BinanceAssetAmount => row !== null),
  );
}

async function readMarginReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const [crossResult, isolatedResult, interestResult] = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/margin/account'),
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/margin/isolated/account'),
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/margin/interestHistory', {
      startTime: range.startTime,
      endTime: range.endTime,
      size: REPORT_PAGE_SIZE,
    }),
  ]);
  if (crossResult.status === 'rejected' && isolatedResult.status === 'rejected') {
    throw crossResult.reason;
  }

  const balanceAmounts: BinanceAssetAmount[] = [];
  let positionCount = 0;
  if (crossResult.status === 'fulfilled') {
    const cross = asRecord(crossResult.value) ?? {};
    const totalNetAssetOfBtc = firstNumber(cross, 'totalNetAssetOfBtc');
    if (totalNetAssetOfBtc !== null && totalNetAssetOfBtc !== 0) {
      balanceAmounts.push({ asset: 'BTC', amount: totalNetAssetOfBtc });
    } else {
      balanceAmounts.push(
        ...assetRowsFromAccount(cross)
          .map((row) =>
            amount(
              firstText(row, 'asset', 'coin'),
              firstNumber(row, 'netAsset', 'free', 'balance'),
            ),
          )
          .filter((row): row is BinanceAssetAmount => row !== null),
      );
    }
    positionCount += rowsFromPayload(cross.positions).length;
  }
  if (isolatedResult.status === 'fulfilled') {
    balanceAmounts.push(...parseMarginIsolatedBalances(isolatedResult.value));
    positionCount += rowsFromPayload(isolatedResult.value).length;
  }

  const incomplete =
    crossResult.status === 'rejected' ||
    isolatedResult.status === 'rejected' ||
    interestResult.status === 'rejected';
  return productReport('margin', {
    status: incomplete ? 'partial' : 'ok',
    balanceUsd: stableUsdValue(mergeAssetAmounts(balanceAmounts)),
    balanceAmounts: mergeAssetAmounts(balanceAmounts),
    dailyPnl:
      interestResult.status === 'fulfilled' ? parseMarginInterest(interestResult.value) : [],
    positionCount,
    includedInTotal: true,
    note: incomplete
      ? 'Saldo de Margin parcialmente leído; revisa los permisos o la disponibilidad del producto.'
      : 'Se cuenta el net asset y el interés del día; las compras/ventas no se tratan como PnL.',
  });
}

function parsePapiPositionCount(payload: unknown): number {
  const record = asRecord(payload);
  const nested = record ? rowsFromPayload(record.positions) : [];
  return nested.length > 0
    ? nested.length
    : rowsFromPayload(payload).filter((row) => {
        const quantity = firstNumber(row, 'positionAmt', 'positionAmount', 'qty');
        return quantity === null || quantity !== 0;
      }).length;
}

async function readPortfolioMarginReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const [
    accountResult,
    balanceResult,
    umAccountResult,
    cmAccountResult,
    umIncomeResult,
    cmIncomeResult,
  ] = await Promise.allSettled([
    fetchSigned<unknown>(PAPI_PROXY_BASE, '/account'),
    fetchSigned<unknown>(PAPI_PROXY_BASE, '/balance'),
    fetchSigned<unknown>(PAPI_PROXY_BASE, '/um/account'),
    fetchSigned<unknown>(PAPI_PROXY_BASE, '/cm/account'),
    fetchSigned<unknown>(PAPI_PROXY_BASE, '/um/income', {
      startTime: range.startTime,
      endTime: range.endTime,
      limit: REPORT_PAGE_SIZE,
    }),
    fetchSigned<unknown>(PAPI_PROXY_BASE, '/cm/income', {
      startTime: range.startTime,
      endTime: range.endTime,
      limit: REPORT_PAGE_SIZE,
    }),
  ]);
  if (accountResult.status === 'rejected') throw accountResult.reason;

  const account = asRecord(accountResult.value) ?? {};
  const balanceRows =
    balanceResult.status === 'fulfilled' ? rowsFromPayload(balanceResult.value) : [];
  const balanceAmounts = mergeAssetAmounts(
    balanceRows
      .map((row) =>
        amount(
          firstText(row, 'asset', 'marginAsset'),
          firstNumber(
            row,
            'totalWalletBalance',
            'crossMarginAsset',
            'umWalletBalance',
            'cmWalletBalance',
          ),
        ),
      )
      .filter((row): row is BinanceAssetAmount => row !== null),
  );
  const unrealizedPnl = mergeAssetAmounts(
    balanceRows
      .flatMap((row) => [
        amount(
          firstText(row, 'asset', 'marginAsset') ?? 'USDT',
          firstNumber(row, 'umUnrealizedPNL'),
        ),
        amount(
          firstText(row, 'asset', 'marginAsset') ?? 'USDT',
          firstNumber(row, 'cmUnrealizedPNL'),
        ),
      ])
      .filter((row): row is BinanceAssetAmount => row !== null),
  );
  const umIncome =
    umIncomeResult.status === 'fulfilled' ? parseIncomePayload(umIncomeResult.value) : null;
  const cmIncome =
    cmIncomeResult.status === 'fulfilled' ? parseIncomePayload(cmIncomeResult.value) : null;
  const dailyPnl = [...(umIncome?.dailyPnl ?? []), ...(cmIncome?.dailyPnl ?? [])];
  const dailyRewards = [...(umIncome?.dailyRewards ?? []), ...(cmIncome?.dailyRewards ?? [])];
  const incomplete = [
    balanceResult,
    umAccountResult,
    cmAccountResult,
    umIncomeResult,
    cmIncomeResult,
  ].some((result) => result.status === 'rejected');
  const accountEquity = firstNumber(
    account,
    'actualEquity',
    'accountEquity',
    'totalEquity',
    'totalAccountValue',
  );
  return productReport('portfolio-margin', {
    status: incomplete ? 'partial' : 'ok',
    balanceUsd: accountEquity ?? stableUsdValue(balanceAmounts),
    balanceAmounts,
    unrealizedPnl,
    dailyPnl: mergeAssetAmounts(dailyPnl),
    dailyRewards: mergeAssetAmounts(dailyRewards),
    positionCount:
      parsePapiPositionCount(umAccountResult.status === 'fulfilled' ? umAccountResult.value : {}) +
      parsePapiPositionCount(cmAccountResult.status === 'fulfilled' ? cmAccountResult.value : {}),
    includedInTotal: true,
    note: incomplete
      ? 'Portfolio Margin leído parcialmente; no se consultan FAPI/DAPI para evitar duplicar su equity.'
      : 'Equity agregada de Portfolio Margin; UM y CM no se vuelven a sumar aparte.',
  });
}

async function readSimpleEarnReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const [accountResult, flexibleResult, lockedResult] = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/simple-earn/account'),
    fetchProductPage(SAPI_PROXY_BASE, '/simple-earn/flexible/history/rewardsRecord', {
      startTime: range.startTime,
      endTime: range.endTime,
    }),
    fetchProductPage(SAPI_PROXY_BASE, '/simple-earn/locked/history/rewardsRecord', {
      startTime: range.startTime,
      endTime: range.endTime,
    }),
  ]);
  if (
    accountResult.status === 'rejected' &&
    flexibleResult.status === 'rejected' &&
    lockedResult.status === 'rejected'
  ) {
    throw accountResult.reason;
  }

  const rewards: BinanceAssetAmount[] = [];
  for (const result of [flexibleResult, lockedResult]) {
    if (result.status !== 'fulfilled') continue;
    result.value.forEach((row) => {
      const rewardAsset = firstText(row, 'rewardAsset', 'asset', 'coin') ?? 'USDT';
      const reward = firstNumber(row, 'rewards', 'rewardAmt', 'rewardAmount', 'amount');
      const parsed = amount(rewardAsset, reward);
      if (parsed) rewards.push(parsed);
    });
  }
  const incomplete = [accountResult, flexibleResult, lockedResult].some(
    (result) => result.status === 'rejected',
  );
  const account = accountResult.status === 'fulfilled' ? asRecord(accountResult.value) : null;
  const accountTotal = account
    ? firstNumber(account, 'totalAmountInUSDT', 'totalAmountInUsdt')
    : null;
  return productReport('simple-earn', {
    status: incomplete ? 'partial' : 'included-in-wallet',
    balanceUsd: accountTotal,
    dailyRewards: mergeAssetAmounts(rewards),
    includedInTotal: false,
    note: incomplete
      ? 'Las posiciones quedan en Wallet; el historial de recompensas respondió parcialmente.'
      : 'Las posiciones flexibles y bloqueadas ya están incluidas en Wallet; solo se agrega el reward del día.',
  });
}

async function readBfusdReport(
  range: { startTime: number; endTime: number },
  baseAssets: Set<string>,
): Promise<BinanceProductReport> {
  const [accountResult, rewardsResult] = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/bfusd/account'),
    fetchProductPage(SAPI_PROXY_BASE, '/bfusd/history/rewardsHistory', {
      startTime: range.startTime,
      endTime: range.endTime,
    }),
  ]);
  if (accountResult.status === 'rejected') throw accountResult.reason;
  const account = asRecord(accountResult.value) ?? {};
  const bfusdAmount = firstNumber(account, 'bfusdAmount', 'amount');
  const dailyRewards =
    rewardsResult.status === 'fulfilled'
      ? mergeAssetAmounts(
          rewardsResult.value
            .map((row) =>
              amount(
                firstText(row, 'rewardAsset', 'asset') ?? 'USDT',
                firstNumber(row, 'rewardsAmount', 'rewards'),
              ),
            )
            .filter((row): row is BinanceAssetAmount => row !== null),
        )
      : [];
  const representedByWallet = baseAssets.has('BFUSD');
  return productReport('bfusd', {
    status:
      rewardsResult.status === 'fulfilled'
        ? representedByWallet
          ? 'included-in-wallet'
          : 'ok'
        : 'partial',
    balanceAmounts: bfusdAmount === null ? [] : [{ asset: 'BFUSD', amount: bfusdAmount }],
    balanceUsd: bfusdAmount,
    dailyRewards,
    includedInTotal: !representedByWallet,
    note: representedByWallet
      ? 'BFUSD ya está en el saldo Spot; se evita sumarlo otra vez.'
      : 'BFUSD no apareció en Spot; se incorpora como producto separado.',
  });
}

async function readRwusdReport(
  range: { startTime: number; endTime: number },
  baseAssets: Set<string>,
): Promise<BinanceProductReport> {
  const [accountResult, rewardsResult] = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/rwusd/account'),
    fetchProductPage(SAPI_PROXY_BASE, '/rwusd/history/rewardsHistory', {
      startTime: range.startTime,
      endTime: range.endTime,
    }),
  ]);
  if (accountResult.status === 'rejected') throw accountResult.reason;
  const account = asRecord(accountResult.value) ?? {};
  const rwusdAmount = firstNumber(account, 'rwusdAmount', 'amount');
  const dailyRewards =
    rewardsResult.status === 'fulfilled'
      ? mergeAssetAmounts(
          rewardsResult.value
            .map((row) => amount('RWUSD', firstNumber(row, 'rewardsAmount', 'rewards')))
            .filter((row): row is BinanceAssetAmount => row !== null),
        )
      : [];
  const representedByWallet = baseAssets.has('RWUSD');
  return productReport('rwusd', {
    status:
      rewardsResult.status === 'fulfilled'
        ? representedByWallet
          ? 'included-in-wallet'
          : 'ok'
        : 'partial',
    balanceAmounts: rwusdAmount === null ? [] : [{ asset: 'RWUSD', amount: rwusdAmount }],
    balanceUsd: rwusdAmount,
    dailyRewards,
    includedInTotal: !representedByWallet,
    note: representedByWallet
      ? 'RWUSD ya está en el saldo Spot; se evita sumarlo otra vez.'
      : 'RWUSD no apareció en Spot; se incorpora como producto separado.',
  });
}

function parseStakingRewardRows(rows: RecordValue[], assetFallback: string): BinanceAssetAmount[] {
  return mergeAssetAmounts(
    rows
      .map((row) =>
        amount(
          firstText(row, 'rewardAsset', 'asset', 'coin') ?? assetFallback,
          firstNumber(row, 'amountInETH', 'amountInSOL', 'rewardsAmount', 'rewards', 'amount'),
        ),
      )
      .filter((row): row is BinanceAssetAmount => row !== null),
  );
}

async function readEthStakingReport(
  range: { startTime: number; endTime: number },
  baseAssets: Set<string>,
): Promise<BinanceProductReport> {
  const [accountResult, rewardsResult] = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_V2_PROXY_BASE, '/eth-staking/account'),
    fetchProductPage(SAPI_PROXY_BASE, '/eth-staking/eth/history/wbethRewardsHistory', {
      startTime: range.startTime,
      endTime: range.endTime,
    }),
  ]);
  if (accountResult.status === 'rejected') throw accountResult.reason;
  const account = asRecord(accountResult.value) ?? {};
  const holdingInEth = firstNumber(account, 'holdingInETH', 'holdingInEth', 'ethAmount');
  const representedByWallet = baseAssets.has('WBETH') || baseAssets.has('BETH');
  return productReport('eth-staking', {
    status:
      rewardsResult.status === 'fulfilled'
        ? representedByWallet
          ? 'included-in-wallet'
          : 'ok'
        : 'partial',
    balanceAmounts: holdingInEth === null ? [] : [{ asset: 'ETH', amount: holdingInEth }],
    dailyRewards:
      rewardsResult.status === 'fulfilled'
        ? parseStakingRewardRows(rewardsResult.value, 'ETH')
        : [],
    includedInTotal: !representedByWallet,
    note: representedByWallet
      ? 'WBETH/BETH ya está en Wallet; la exposición no se duplica.'
      : 'La cuenta de staking no tiene token representativo en Spot; se valora como ETH.',
  });
}

async function readSolStakingReport(
  range: { startTime: number; endTime: number },
  baseAssets: Set<string>,
): Promise<BinanceProductReport> {
  const [accountResult, rewardsResult, boostResult] = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/sol-staking/account'),
    fetchProductPage(SAPI_PROXY_BASE, '/sol-staking/sol/history/bnsolRewardsHistory', {
      startTime: range.startTime,
      endTime: range.endTime,
    }),
    fetchProductPage(SAPI_PROXY_BASE, '/sol-staking/sol/history/boostRewardsHistory', {
      startTime: range.startTime,
      endTime: range.endTime,
    }),
  ]);
  if (accountResult.status === 'rejected') throw accountResult.reason;
  const account = asRecord(accountResult.value) ?? {};
  const holdingInSol = firstNumber(
    account,
    'holdingInSOL',
    'holdingInSol',
    'solAmount',
    'totalAmount',
  );
  const representedByWallet = baseAssets.has('BNSOL');
  const dailyRewards = [
    ...(rewardsResult.status === 'fulfilled'
      ? parseStakingRewardRows(rewardsResult.value, 'SOL')
      : []),
    ...(boostResult.status === 'fulfilled' ? parseStakingRewardRows(boostResult.value, 'SOL') : []),
  ];
  const incomplete = [rewardsResult, boostResult].some((result) => result.status === 'rejected');
  return productReport('sol-staking', {
    status: incomplete ? 'partial' : representedByWallet ? 'included-in-wallet' : 'ok',
    balanceAmounts: holdingInSol === null ? [] : [{ asset: 'SOL', amount: holdingInSol }],
    dailyRewards: mergeAssetAmounts(dailyRewards),
    includedInTotal: !representedByWallet,
    note: representedByWallet
      ? 'BNSOL ya está en Wallet; la exposición no se duplica.'
      : 'La cuenta de staking no tiene BNSOL visible en Spot; se valora como SOL.',
  });
}

async function readOnchainYieldsReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const [positionsResult, rewardsResult] = await Promise.allSettled([
    fetchProductPage(SAPI_PROXY_BASE, '/onchain-yields/locked/position', {}),
    fetchProductPage(SAPI_PROXY_BASE, '/onchain-yields/locked/history/rewardsRecord', {
      startTime: range.startTime,
      endTime: range.endTime,
    }),
  ]);
  if (positionsResult.status === 'rejected' && rewardsResult.status === 'rejected') {
    throw positionsResult.reason;
  }
  const positions = positionsResult.status === 'fulfilled' ? positionsResult.value : [];
  const balanceAmounts = mergeAssetAmounts(
    positions
      .filter(
        (row) =>
          !['REDEEMED', 'REDEEMING', 'CLOSED'].includes(
            (firstText(row, 'status') ?? '').toUpperCase(),
          ),
      )
      .map((row) =>
        amount(
          firstText(row, 'rewardAsset', 'asset', 'coin') ?? 'USDT',
          firstNumber(row, 'amount', 'principalAmount', 'totalAmount'),
        ),
      )
      .filter((row): row is BinanceAssetAmount => row !== null),
  );
  const dailyRewards =
    rewardsResult.status === 'fulfilled'
      ? mergeAssetAmounts(
          rewardsResult.value
            .map((row) =>
              amount(
                firstText(row, 'rewardAsset', 'asset', 'coin') ?? 'USDT',
                firstNumber(row, 'rewards', 'rewardAmt', 'rewardAmount', 'amount'),
              ),
            )
            .filter((row): row is BinanceAssetAmount => row !== null),
        )
      : [];
  return productReport('onchain-yields', {
    status:
      positionsResult.status === 'fulfilled' && rewardsResult.status === 'fulfilled'
        ? 'ok'
        : 'partial',
    balanceAmounts,
    dailyRewards,
    positionCount: positions.length,
    includedInTotal: true,
    note: 'Posiciones y recompensas de On-chain Yields se leen como producto separado.',
  });
}

async function readSoftStakingReport(
  range: { startTime: number; endTime: number },
  baseBalances: BinanceAccountBalance[],
): Promise<BinanceProductReport> {
  const [accountResult, rewardsResult] = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/soft-staking/list'),
    fetchProductPage(SAPI_PROXY_BASE, '/soft-staking/history/rewardsRecord', {
      startTime: range.startTime,
      endTime: range.endTime,
    }),
  ]);
  if (accountResult.status === 'rejected') throw accountResult.reason;
  const accountRows = rowsFromPayload(accountResult.value);
  const baseAssets = new Set(baseBalances.map((row) => normalizeBinanceAssetCode(row.asset)));
  const allBalances = mergeAssetAmounts(
    accountRows
      .map((row) =>
        amount(
          firstText(row, 'asset', 'coin') ?? 'USDT',
          firstNumber(row, 'stakedAmount', 'amount', 'balance'),
        ),
      )
      .filter((row): row is BinanceAssetAmount => row !== null),
  );
  const balanceAmounts = allBalances.filter((row) => !baseAssets.has(row.asset));
  const dailyRewards =
    rewardsResult.status === 'fulfilled'
      ? mergeAssetAmounts(
          rewardsResult.value
            .map((row) =>
              amount(
                firstText(row, 'rewardAsset', 'asset', 'coin') ?? 'USDT',
                firstNumber(row, 'rewards', 'rewardAmt', 'rewardAmount', 'amount'),
              ),
            )
            .filter((row): row is BinanceAssetAmount => row !== null),
        )
      : [];
  return productReport('soft-staking', {
    status: rewardsResult.status === 'fulfilled' ? 'ok' : 'partial',
    balanceAmounts,
    dailyRewards,
    positionCount: accountRows.length,
    includedInTotal: balanceAmounts.length > 0,
    note:
      balanceAmounts.length > 0
        ? 'Solo se agregan activos que no estaban en Wallet; el resto se deduplica.'
        : 'Los activos de Soft Staking ya están representados por Wallet.',
  });
}

async function readDiscountBuyReport(): Promise<BinanceProductReport> {
  const [positionsResult, holdingResult] = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/accumulator/product/position/list', {}),
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/accumulator/product/sum-holding', {}),
  ]);
  if (positionsResult.status === 'rejected' && holdingResult.status === 'rejected') {
    throw positionsResult.reason;
  }
  const rows = positionsResult.status === 'fulfilled' ? rowsFromPayload(positionsResult.value) : [];
  const activeRows = rows.filter((row) => {
    const status = (firstText(row, 'status', 'purchaseStatus') ?? '').toUpperCase();
    return !['SETTLED', 'REDEEMED', 'CLOSED', 'PURCHASE_FAIL', 'REFUND_SUCCESS'].includes(status);
  });
  let balanceAmounts = mergeAssetAmounts(
    activeRows
      .map((row) =>
        amount(
          firstText(row, 'investAsset', 'asset', 'coin') ?? 'USDT',
          firstNumber(row, 'depositAmount', 'amount', 'investAmount'),
        ),
      )
      .filter((row): row is BinanceAssetAmount => row !== null),
  );
  if (balanceAmounts.length === 0 && holdingResult.status === 'fulfilled') {
    const holding = asRecord(holdingResult.value) ?? {};
    balanceAmounts = mergeAssetAmounts(
      [
        amount('BTC', firstNumber(holding, 'totalBTC', 'totalBtc', 'btcAmount')),
        amount('USDT', firstNumber(holding, 'totalUSDT', 'totalUsdt', 'usdtAmount')),
        amount('USDC', firstNumber(holding, 'totalUSDC', 'totalUsdc', 'usdcAmount')),
      ].filter((row): row is BinanceAssetAmount => row !== null),
    );
  }
  return productReport('discount-buy', {
    status:
      positionsResult.status === 'fulfilled' && holdingResult.status === 'fulfilled'
        ? 'ok'
        : 'partial',
    balanceAmounts,
    positionCount: activeRows.length,
    includedInTotal: true,
    note: 'El principal abierto de Discount Buy no se suma desde Spot.',
  });
}

function parseLoanBalanceRows(rows: RecordValue[]): BinanceAssetAmount[] {
  const balances: BinanceAssetAmount[] = [];
  rows.forEach((row) => {
    const loanCoin = firstText(row, 'loanCoin', 'loanAsset', 'asset');
    const collateralCoin = firstText(row, 'collateralCoin', 'collateralAsset');
    const loanAmount = firstNumber(row, 'residualDebt', 'totalDebt', 'loanAmount', 'principal');
    const collateralAmount = firstNumber(
      row,
      'collateralAmount',
      'collateral',
      'collateralBalance',
    );
    const loan = amount(loanCoin ?? '', loanAmount === null ? null : -Math.abs(loanAmount));
    const collateral = amount(collateralCoin ?? '', collateralAmount);
    if (loan) balances.push(loan);
    if (collateral) balances.push(collateral);
  });
  return mergeAssetAmounts(balances);
}

function parseLoanInterestRows(rows: RecordValue[]): BinanceAssetAmount[] {
  return mergeAssetAmounts(
    rows
      .map((row) => {
        const type = (firstText(row, 'type', 'incomeType') ?? '').toLowerCase();
        const interest = firstNumber(row, 'interest', 'interestAmount', 'interestAccrued');
        const income =
          interest ?? (type.includes('interest') ? firstNumber(row, 'amount', 'income') : null);
        if (income === null || income === 0) return null;
        return amount(firstText(row, 'asset', 'loanCoin', 'coin') ?? 'USDT', -Math.abs(income));
      })
      .filter((row): row is BinanceAssetAmount => row !== null),
  );
}

async function readCryptoLoanReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const [stableOngoingResult, flexibleOngoingResult] = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/loan/ongoing/orders', {
      current: 1,
      limit: REPORT_PAGE_SIZE,
    }),
    fetchSigned<unknown>(SAPI_V2_PROXY_BASE, '/loan/flexible/ongoing/orders', {
      current: 1,
      limit: REPORT_PAGE_SIZE,
    }),
  ]);
  if (stableOngoingResult.status === 'rejected' && flexibleOngoingResult.status === 'rejected') {
    throw stableOngoingResult.reason;
  }
  const rows = [
    ...(stableOngoingResult.status === 'fulfilled'
      ? rowsFromPayload(stableOngoingResult.value)
      : []),
    ...(flexibleOngoingResult.status === 'fulfilled'
      ? rowsFromPayload(flexibleOngoingResult.value)
      : []),
  ];
  const loanAssets = [
    ...new Set(rows.map((row) => firstText(row, 'loanCoin', 'loanAsset', 'asset')).filter(Boolean)),
  ] as string[];
  const incomeResults = await Promise.allSettled(
    loanAssets.map((assetName) =>
      fetchSigned<unknown>(SAPI_PROXY_BASE, '/loan/income', {
        asset: assetName,
        startTime: range.startTime,
        endTime: range.endTime,
        limit: REPORT_PAGE_SIZE,
      }),
    ),
  );
  const dailyPnl = incomeResults.flatMap((result) =>
    result.status === 'fulfilled' ? parseLoanInterestRows(rowsFromPayload(result.value)) : [],
  );
  return productReport('crypto-loan', {
    status:
      stableOngoingResult.status === 'fulfilled' &&
      flexibleOngoingResult.status === 'fulfilled' &&
      !incomeResults.some((result) => result.status === 'rejected')
        ? 'ok'
        : 'partial',
    balanceAmounts: parseLoanBalanceRows(rows),
    dailyPnl: mergeAssetAmounts(dailyPnl),
    positionCount: rows.length,
    includedInTotal: true,
    note: 'Se suma el colateral neto menos la deuda; los pagos de principal no son PnL.',
  });
}

async function readVipLoanReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const ongoing = await fetchSigned<unknown>(SAPI_PROXY_BASE, '/loan/vip/ongoing/orders', {
    current: 1,
  });
  const rows = rowsFromPayload(ongoing);
  const repayHistory = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/loan/vip/repay/history', {
      startTime: range.startTime,
      endTime: range.endTime,
      current: 1,
      limit: REPORT_PAGE_SIZE,
    }),
  ]);
  const dailyPnl =
    repayHistory[0].status === 'fulfilled'
      ? parseLoanInterestRows(rowsFromPayload(repayHistory[0].value))
      : [];
  return productReport('vip-loan', {
    status: repayHistory[0].status === 'fulfilled' ? 'ok' : 'partial',
    balanceAmounts: parseLoanBalanceRows(rows),
    dailyPnl,
    positionCount: rows.length,
    includedInTotal: true,
    note: 'Se suma el colateral neto menos la deuda VIP; no se cuentan repagos como rendimiento.',
  });
}

async function readWalletRewardsReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const raw = await fetchSigned<unknown>(SAPI_PROXY_BASE, '/asset/assetDividend', {
    startTime: range.startTime,
    endTime: range.endTime,
    limit: REPORT_PAGE_SIZE,
  });
  const rewards = mergeAssetAmounts(
    rowsFromPayload(raw)
      .map((row) =>
        amount(
          firstText(row, 'asset', 'rewardAsset') ?? 'USDT',
          firstNumber(row, 'amount', 'dividendAmount', 'income'),
        ),
      )
      .filter((row): row is BinanceAssetAmount => row !== null),
  );
  return productReport('wallet-rewards', {
    dailyRewards: rewards,
    includedInTotal: false,
    note: 'Dividendos acreditados en Wallet; se muestran en PnL, no se suman al saldo.',
  });
}

async function readRebateReport(range: {
  startTime: number;
  endTime: number;
}): Promise<BinanceProductReport> {
  const now = Date.now();
  let rewards =
    rebateCache &&
    rebateCache.dayStart === range.startTime &&
    now - rebateCache.ts < REBATE_CACHE_TTL_MS
      ? rebateCache.data
      : null;
  if (!rewards) {
    const [taxResult, kickbackResult] = await Promise.allSettled([
      fetchSigned<unknown>(SAPI_PROXY_BASE, '/rebate/taxQuery', {
        startTime: range.startTime,
        endTime: range.endTime,
        page: 1,
      }),
      fetchSigned<unknown>(SAPI_PROXY_BASE, '/apiReferral/kickback/recentRecord', {
        startTime: range.startTime,
        endTime: range.endTime,
        limit: REPORT_PAGE_SIZE,
      }),
    ]);
    if (taxResult.status === 'rejected' && kickbackResult.status === 'rejected') {
      throw taxResult.reason;
    }
    rewards = mergeAssetAmounts([
      ...(taxResult.status === 'fulfilled'
        ? rowsFromPayload(taxResult.value)
            .map((row) =>
              amount(firstText(row, 'asset') ?? 'USDT', firstNumber(row, 'amount', 'income')),
            )
            .filter((row): row is BinanceAssetAmount => row !== null)
        : []),
      ...(kickbackResult.status === 'fulfilled'
        ? rowsFromPayload(kickbackResult.value)
            .map((row) =>
              amount(firstText(row, 'asset') ?? 'USDT', firstNumber(row, 'income', 'amount')),
            )
            .filter((row): row is BinanceAssetAmount => row !== null)
        : []),
    ]);
    rebateCache = { data: rewards, ts: now, dayStart: range.startTime };
  }
  return productReport('rebate', {
    dailyRewards: rewards,
    includedInTotal: false,
    note: 'Rebates de Spot/Referral acreditados en Wallet; el saldo no se duplica.',
  });
}

async function readExternalFlows(range: {
  startTime: number;
  endTime: number;
}): Promise<{ flows: BinanceAssetAmount[]; incomplete: boolean }> {
  const [depositsResult, withdrawalsResult] = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/capital/deposit/hisrec', {
      startTime: range.startTime,
      endTime: range.endTime,
      limit: REPORT_PAGE_SIZE,
    }),
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/capital/withdraw/history', {
      startTime: range.startTime,
      endTime: range.endTime,
      limit: REPORT_PAGE_SIZE,
    }),
  ]);
  const flows: BinanceAssetAmount[] = [];
  if (depositsResult.status === 'fulfilled') {
    rowsFromPayload(depositsResult.value).forEach((row) => {
      const status = firstText(row, 'status');
      if (status !== null && !['1', 'SUCCESS', 'COMPLETED'].includes(status.toUpperCase())) return;
      const parsed = amount(firstText(row, 'coin', 'asset') ?? '', firstNumber(row, 'amount'));
      if (parsed) flows.push(parsed);
    });
  }
  if (withdrawalsResult.status === 'fulfilled') {
    rowsFromPayload(withdrawalsResult.value).forEach((row) => {
      const status = firstText(row, 'status');
      if (status !== null && !['6', 'SUCCESS', 'COMPLETED'].includes(status.toUpperCase())) return;
      const withdrawal = firstNumber(row, 'amount');
      const fee = firstNumber(row, 'transactionFee', 'fee') ?? 0;
      const parsed = amount(
        firstText(row, 'coin', 'asset') ?? '',
        withdrawal === null ? null : -(withdrawal + fee),
      );
      if (parsed) flows.push(parsed);
    });
  }
  return {
    flows: mergeAssetAmounts(flows),
    incomplete: depositsResult.status === 'rejected' || withdrawalsResult.status === 'rejected',
  };
}

function walletProductReport(
  product: 'spot' | 'funding',
  issue: WalletIssue | undefined,
): BinanceProductReport {
  return issue
    ? unavailableProductReport(product, issue.reason)
    : productReport(product, {
        status: 'included-in-wallet',
        includedInTotal: false,
        note: 'Este saldo ya está incluido en el total Wallet; no se vuelve a sumar.',
      });
}

function addProductResult(
  target: BinanceProductReport[],
  issues: BinanceProductIssue[],
  result: { report: BinanceProductReport; issue: BinanceProductIssue | null },
): void {
  target.push(result.report);
  if (result.issue) issues.push(result.issue);
}

/**
 * Lee los productos con saldo o PnL propio. Los productos que liquidan en
 * Spot/Funding se representan como `included-in-wallet`; así el informe puede
 * enseñar su actividad sin contar el mismo activo dos veces.
 */
export async function fetchBinanceAccountReadReport(
  baseBalances: BinanceAccountBalance[] = [],
  baseIssues: WalletIssue[] = [],
): Promise<BinanceAccountReadReport> {
  const range = currentUtcDayRange();
  const products: BinanceProductReport[] = [
    walletProductReport('spot', undefined),
    walletProductReport(
      'funding',
      baseIssues.find((issue) => issue.wallet === 'funding'),
    ),
  ];
  const issues: BinanceProductIssue[] = baseIssues.map((issue) => ({
    product: issue.wallet === 'funding' ? 'funding' : 'simple-earn',
    reason: issue.reason,
  }));
  const baseAssets = new Set(baseBalances.map((row) => normalizeBinanceAssetCode(row.asset)));
  const accountInfoResult = await Promise.allSettled([
    fetchSigned<unknown>(SAPI_PROXY_BASE, '/account/info'),
  ]);
  const accountInfo =
    accountInfoResult[0].status === 'fulfilled'
      ? (asRecord(accountInfoResult[0].value) ?? {})
      : null;
  const accountFeatureEnabled = (key: string): boolean | null => {
    if (!accountInfo) return null;
    return accountInfo[key] === true ? true : accountInfo[key] === false ? false : null;
  };

  // Portfolio Margin is an aggregate account. If it responds, its equity and
  // UM/CM PnL are authoritative and the standalone FAPI/DAPI accounts are not
  // requested, preventing an exact duplicate of the same collateral.
  let portfolioMargin: BinanceProductReport | null = null;
  if (accountFeatureEnabled('isPortfolioMarginRetailEnabled') !== false) {
    const result = await tryReadProduct('portfolio-margin', () => readPortfolioMarginReport(range));
    if (result.issue === null) portfolioMargin = result.report;
  }

  if (portfolioMargin) {
    products.push(portfolioMargin);
  } else {
    const regularProductReads: Promise<{
      report: BinanceProductReport;
      issue: BinanceProductIssue | null;
    }>[] = [];
    if (accountFeatureEnabled('isFutureEnabled') !== false) {
      regularProductReads.push(
        tryReadProduct('usd-m-futures', () => readUsdMFuturesReport(range)),
        tryReadProduct('coin-m-futures', () => readCoinMFuturesReport(range)),
      );
    }
    if (accountFeatureEnabled('isOptionsEnabled') !== false) {
      regularProductReads.push(tryReadProduct('options', () => readOptionsReport(range)));
    }
    if (accountFeatureEnabled('isMarginEnabled') !== false) {
      regularProductReads.push(tryReadProduct('margin', () => readMarginReport(range)));
    }
    const regularProducts = await Promise.all(regularProductReads);
    regularProducts.forEach((result) => addProductResult(products, issues, result));
  }

  const [
    simpleEarn,
    bfusd,
    rwusd,
    ethStaking,
    solStaking,
    onchain,
    softStaking,
    discountBuy,
    cryptoLoan,
    vipLoan,
    walletRewards,
    rebate,
  ] = await Promise.all([
    tryReadProduct('simple-earn', () => readSimpleEarnReport(range)),
    tryReadProduct('bfusd', () => readBfusdReport(range, baseAssets)),
    tryReadProduct('rwusd', () => readRwusdReport(range, baseAssets)),
    tryReadProduct('eth-staking', () => readEthStakingReport(range, baseAssets)),
    tryReadProduct('sol-staking', () => readSolStakingReport(range, baseAssets)),
    tryReadProduct('onchain-yields', () => readOnchainYieldsReport(range)),
    tryReadProduct('soft-staking', () => readSoftStakingReport(range, baseBalances)),
    tryReadProduct('discount-buy', () => readDiscountBuyReport()),
    tryReadProduct('crypto-loan', () => readCryptoLoanReport(range)),
    tryReadProduct('vip-loan', () => readVipLoanReport(range)),
    tryReadProduct('wallet-rewards', () => readWalletRewardsReport(range)),
    tryReadProduct('rebate', () => readRebateReport(range)),
  ]);
  [
    simpleEarn,
    bfusd,
    rwusd,
    ethStaking,
    solStaking,
    onchain,
    softStaking,
    discountBuy,
    cryptoLoan,
    vipLoan,
    walletRewards,
    rebate,
  ].forEach((result) => addProductResult(products, issues, result));

  // Dual Investment se sigue mostrando y valorando desde Posiciones. El row
  // explicita ese origen para que ningún consumidor sume el principal otra vez.
  products.push(
    productReport('dual-investment', {
      status: 'included-in-wallet',
      includedInTotal: false,
      note: 'El principal activo se agrega desde Posiciones; no se duplica en Wallet.',
    }),
  );

  const externalFlows = await readExternalFlows(range);
  const dailyPnl = mergeAssetAmounts(products.flatMap((product) => product.dailyPnl));
  const dailyRewards = mergeAssetAmounts(products.flatMap((product) => product.dailyRewards));
  const isPartial =
    externalFlows.incomplete ||
    issues.length > 0 ||
    products.some((product) => product.status === 'partial' || product.status === 'unavailable');

  return {
    fetchedAt: Date.now(),
    products,
    dailyPnl,
    dailyRewards,
    externalFlows: externalFlows.flows,
    issues,
    isPartial,
  };
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
  enableReading?: boolean;
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
  // Product capability flags (Futures, Margin, Options and Portfolio Margin)
  // are sometimes required to read those account ledgers. They do not grant
  // this client a write path: every signed request below is GET-only and the
  // server proxy rejects mutating exchange methods.
  const enabledWritePermissions = [
    ['WITHDRAW', restrictions.enableWithdrawals],
    ['INTERNAL_TRANSFER', restrictions.enableInternalTransfer],
    ['UNIVERSAL_TRANSFER', restrictions.permitsUniversalTransfer],
    ['FIX_TRADE', restrictions.enableFixApiTrade],
    ['SPOT_MARGIN_TRADING', restrictions.enableSpotAndMarginTrading],
  ]
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name);

  const warnings = enabledWritePermissions.map(
    (permission) => `Permiso de escritura activo: ${permission}`,
  );
  if (restrictions.enableReading === false) {
    warnings.unshift('Permiso de lectura desactivado: READING');
  }
  return warnings;
}

// ── Cache management ──

export function clearAllCaches(): void {
  positionsCache = null;
  balanceCache = null;
  rebateCache = null;
  readOnlyCheckCache = null;
  readOnlyCheckInFlight = null;
  clearServerTimeOffset();
}
