import type {
  BinanceAccountBalance,
  BinanceDualPosition,
  DualProduct,
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

const PRODUCT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const POSITIONS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
const BALANCE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min
const DUAL_MARKET_ASSETS = ['BTC', 'ETH', 'BNB', 'SOL'] as const;
const DUAL_MARKET_STABLES = ['USDT', 'USDC'] as const;
const CLOSED_DUAL_POSITION_STATUSES = new Set(['SETTLED', 'PURCHASE_FAIL', 'REFUND_SUCCESS']);

let productCache: CacheEntry<DualProduct[]> | null = null;
let positionsCache: CacheEntry<BinanceDualPosition[]> | null = null;
let balanceCache: CacheEntry<BinanceAccountBalance[]> | null = null;

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
  method: 'GET' | 'POST' = 'GET',
): Promise<T> {
  const creds = loadApiCredentials();
  if (!creds) throw new Error('API credentials not configured');

  const qs = await signedParams(params, creds.apiSecret);
  const url = method === 'GET' ? `${baseUrl}${path}?${qs}` : `${baseUrl}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': creds.apiKey,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(method === 'POST' ? { body: qs } : {}),
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
  const balances: BinanceAccountBalance[] = raw.balances
    .map((b) => ({
      asset: b.asset,
      free: parseFloat(b.free),
      locked: parseFloat(b.locked),
    }))
    .filter((b) => b.free > 0 || b.locked > 0);

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
      investCoin: p.investCoin,
      exercisedCoin: p.exercisedCoin,
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

// ── Dual Investment products (READ) ──

interface RawDualProductsResponse {
  total: number;
  list: Array<{
    id: string;
    investCoin: string;
    exercisedCoin: string;
    orderId?: string | number;
    strikePrice: string;
    duration: number;
    settleDate: number;
    apr: string;
    minAmount: string;
    maxAmount: string;
    optionType: string;
    purchaseDecimal: number;
    perValue?: string;
    purchaseEndTime: number;
    canPurchase?: boolean;
  }>;
}

export async function fetchDualProducts(forceRefresh = false): Promise<DualProduct[]> {
  if (!forceRefresh && productCache && Date.now() - productCache.ts < PRODUCT_CACHE_TTL_MS) {
    return productCache.data;
  }

  const requests: Array<Promise<DualProduct[]>> = [];

  for (const asset of DUAL_MARKET_ASSETS) {
    for (const stable of DUAL_MARKET_STABLES) {
      requests.push(fetchDualProductsForPair('CALL', asset, stable));
      requests.push(fetchDualProductsForPair('PUT', stable, asset));
    }
  }

  const responses = await Promise.all(requests);
  const deduped = new Map<string, DualProduct>();
  responses.flat().forEach((product) => {
    if (!product.canPurchase) return;
    const key = `${product.id}:${product.orderId ?? ''}`;
    deduped.set(key, product);
  });

  productCache = { data: [...deduped.values()], ts: Date.now() };
  return productCache.data;
}

async function fetchDualProductsForPair(
  optionType: DualOptionType,
  investCoin: string,
  exercisedCoin: string,
): Promise<DualProduct[]> {
  try {
    const raw = await fetchSigned<RawDualProductsResponse>(SAPI_PROXY_BASE, '/dci/product/list', {
      optionType,
      investCoin,
      exercisedCoin,
      pageSize: 100,
      pageIndex: 1,
    });

    return (raw.list ?? []).map((p) => ({
      id: p.id,
      investCoin: p.investCoin,
      exercisedCoin: p.exercisedCoin,
      orderId: p.orderId !== undefined ? String(p.orderId) : undefined,
      strikePrice: parseFloat(p.strikePrice),
      duration: p.duration,
      settleDate: new Date(p.settleDate).toISOString().split('T')[0],
      apr: parseFloat(p.apr) * 100,
      minAmount: parseFloat(p.minAmount),
      maxAmount: parseFloat(p.maxAmount),
      optionType: (p.optionType || optionType) as DualOptionType,
      purchaseDecimal: p.purchaseDecimal,
      perValue: parseFloat(p.perValue ?? '0'),
      purchaseEndTime: p.purchaseEndTime,
      canPurchase: p.canPurchase !== false,
    }));
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(
        `[binance-client] Failed to fetch ${optionType} ${investCoin}/${exercisedCoin}:`,
        err,
      );
    }
    return [];
  }
}

// ── Subscribe to Dual Investment (TRADE — Level 2) ──

interface RawSubscribeResponse {
  positionId: string;
  investCoin: string;
  exercisedCoin: string;
  subscriptionAmount: string;
}

export async function subscribeDualProduct(
  productId: string,
  orderId: string,
  amount: number,
): Promise<RawSubscribeResponse> {
  return fetchSigned<RawSubscribeResponse>(
    SAPI_PROXY_BASE,
    '/dci/product/subscribe',
    {
      id: productId,
      orderId,
      depositAmount: amount.toString(),
      autoCompoundPlan: 'NONE',
    },
    'POST',
  );
}

// ── Test API connection ──

export async function testApiConnection(): Promise<{
  success: boolean;
  permissions: string[];
  error?: string;
}> {
  try {
    const creds = loadApiCredentials();
    if (!creds) return { success: false, permissions: [], error: 'No API credentials' };

    const raw = await fetchSigned<{ permissions: string[] }>(API_PROXY_BASE, '/account');
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
  productCache = null;
  positionsCache = null;
  balanceCache = null;
}
