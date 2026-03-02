import type { DualPosition } from '../types';
import { dailyEarnings as calculateDailyEarnings } from './calculator';

const STABLE_ASSETS = new Set(['USD', 'USDT', 'USDC', 'FDUSD', 'BUSD']);
const priceCache = new Map<string, { value: number; ts: number }>();
const CACHE_TTL_MS = 60_000;
const STALE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PRICE_CACHE_MAX_ENTRIES = 256;
const BINANCE_FETCH_TIMEOUT_MS = 6000;
const DEFAULT_RATE_LIMIT_BLOCK_MS = 60_000;
const DEFAULT_BINANCE_TICKER_ENDPOINTS = [
  'https://api.binance.com/api/v3/ticker/price',
  'https://api.binance.us/api/v3/ticker/price',
] as const;
const TICKER_SYMBOL_PATTERN = /^[A-Z0-9_-]{3,20}$/;

function resolveTickerEndpoints(): string[] {
  const raw = import.meta.env.VITE_BINANCE_ENDPOINTS;
  if (typeof raw !== 'string') {
    return [...DEFAULT_BINANCE_TICKER_ENDPOINTS];
  }

  const endpoints = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((url) => /^https?:\/\//i.test(url));

  if (endpoints.length === 0) {
    return [...DEFAULT_BINANCE_TICKER_ENDPOINTS];
  }

  return Array.from(new Set(endpoints));
}

const BINANCE_TICKER_ENDPOINTS = resolveTickerEndpoints();
const endpointBlockedUntilByUrl = new Map<string, number>();
let preferredEndpointIndex = 0;
const tickerInFlight = new Map<string, Promise<number | null>>();
const tickerBatchInFlight = new Map<string, Promise<Map<string, number>>>();

export type PriceSource = 'stable' | 'cache-fresh' | 'live' | 'cache-stale' | 'unavailable';

interface ResolvedAssetPrice {
  value: number;
  ts: number | null;
  source: PriceSource;
}

interface ResolveAssetsOptions {
  forceRefresh?: boolean;
}

export interface AssetPriceSnapshot {
  priceByAsset: Record<string, number>;
  sourceByAsset: Record<string, PriceSource>;
  marketLastUpdatedAt: number | null;
  hasStalePrices: boolean;
  hasUnavailablePrices: boolean;
}

export interface PositionMetrics {
  totalUsd: number;
  weightedApr: number;
  dailyEarningsUsd: number;
  usdByPositionId: Record<string, number>;
  priceByAsset: Record<string, number>;
  marketLastUpdatedAt: number | null;
  hasStalePrices: boolean;
  hasUnavailablePrices: boolean;
  priceSourceByAsset: Record<string, PriceSource>;
}

export interface PositionMetricsOptions {
  forceRefresh?: boolean;
}

function isStable(asset: string): boolean {
  return STABLE_ASSETS.has(asset.toUpperCase());
}

export function normalizeAsset(asset: string): string {
  return asset.toUpperCase().trim();
}

function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseTickerSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toUpperCase().trim();
  return TICKER_SYMBOL_PATTERN.test(normalized) ? normalized : null;
}

function parseTickerPrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return isValidPrice(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return isValidPrice(parsed) ? parsed : null;
  }
  return null;
}

function parseTickerRows(payload: unknown): Map<string, number> {
  const rows = Array.isArray(payload) ? payload : [payload];
  const result = new Map<string, number>();

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const symbol = parseTickerSymbol(row.symbol);
    const price = parseTickerPrice(row.price);
    if (!symbol || price === null) continue;
    result.set(symbol, price);
  }

  return result;
}

function parseRetryAfterMs(response: Response, now: number): number {
  const rawValue = response.headers?.get?.('Retry-After') ?? null;
  if (!rawValue) return DEFAULT_RATE_LIMIT_BLOCK_MS;

  const seconds = Number(rawValue);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(1, Math.round(seconds * 1000));
  }

  const dateMs = Date.parse(rawValue);
  if (Number.isFinite(dateMs) && dateMs > now) {
    return dateMs - now;
  }

  return DEFAULT_RATE_LIMIT_BLOCK_MS;
}

function isRateLimited(response: Response): boolean {
  return response.status === 429 || response.status === 418;
}

function endpointOrder(now: number): number[] {
  const preferred = preferredEndpointIndex >= 0 && preferredEndpointIndex < BINANCE_TICKER_ENDPOINTS.length
    ? preferredEndpointIndex
    : 0;
  const ordered = [
    preferred,
    ...BINANCE_TICKER_ENDPOINTS.map((_, index) => index).filter((index) => index !== preferred),
  ];

  return ordered.filter((index) => {
    const baseUrl = BINANCE_TICKER_ENDPOINTS[index];
    const blockedUntil = endpointBlockedUntilByUrl.get(baseUrl) ?? 0;
    return blockedUntil <= now;
  });
}

function blockEndpoint(baseUrl: string, response: Response): void {
  const now = Date.now();
  const blockMs = parseRetryAfterMs(response, now);
  endpointBlockedUntilByUrl.set(baseUrl, now + blockMs);
}

function markEndpointHealthy(index: number): void {
  preferredEndpointIndex = index;
  endpointBlockedUntilByUrl.delete(BINANCE_TICKER_ENDPOINTS[index]);
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BINANCE_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[market] fetch failed', { url, err });
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchTickerRowsWithFallback(query: string): Promise<Map<string, number>> {
  const now = Date.now();
  const order = endpointOrder(now);
  if (order.length === 0) return new Map();

  for (const index of order) {
    const baseUrl = BINANCE_TICKER_ENDPOINTS[index];
    const response = await fetchWithTimeout(`${baseUrl}?${query}`);
    if (!response) continue;

    if (!response.ok) {
      if (isRateLimited(response)) {
        blockEndpoint(baseUrl, response);
      }
      continue;
    }

    try {
      const rows = parseTickerRows(await response.json());
      markEndpointHealthy(index);
      return rows;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[market] invalid ticker payload', { baseUrl, err });
      }
      continue;
    }
  }

  return new Map();
}

async function fetchTicker(symbol: string): Promise<number | null> {
  const normalized = symbol.toUpperCase().trim();
  if (!normalized) return null;

  const inflight = tickerInFlight.get(normalized);
  if (inflight) return inflight;

  const request = (async (): Promise<number | null> => {
    const query = `symbol=${encodeURIComponent(normalized)}`;
    const rows = await fetchTickerRowsWithFallback(query);
    return rows.get(normalized) ?? null;
  })();

  tickerInFlight.set(normalized, request);
  try {
    return await request;
  } finally {
    tickerInFlight.delete(normalized);
  }
}

async function fetchTickersBatch(symbols: string[]): Promise<Map<string, number>> {
  const normalized = Array.from(new Set(symbols.map((symbol) => symbol.toUpperCase().trim()).filter(Boolean))).sort();
  if (normalized.length === 0) return new Map();

  const batchKey = normalized.join('|');
  const inflight = tickerBatchInFlight.get(batchKey);
  if (inflight) return inflight;

  const request = (async (): Promise<Map<string, number>> => {
    const query = normalized.length === 1
      ? `symbol=${encodeURIComponent(normalized[0])}`
      : `symbols=${encodeURIComponent(JSON.stringify(normalized))}`;
    return fetchTickerRowsWithFallback(query);
  })();

  tickerBatchInFlight.set(batchKey, request);
  try {
    return await request;
  } finally {
    tickerBatchInFlight.delete(batchKey);
  }
}

function rememberPrice(asset: string, value: number): ResolvedAssetPrice {
  const ts = Date.now();
  priceCache.set(asset, { value, ts });
  prunePriceCache(ts);
  return { value, ts, source: 'live' };
}

function prunePriceCache(now = Date.now()): void {
  for (const [asset, entry] of priceCache.entries()) {
    if (now - entry.ts > STALE_CACHE_MAX_AGE_MS) {
      priceCache.delete(asset);
    }
  }

  const overflow = priceCache.size - PRICE_CACHE_MAX_ENTRIES;
  if (overflow <= 0) return;

  // Evict the oldest timestamp entries first to keep cache bounded.
  const oldestFirst = [...priceCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  for (let i = 0; i < overflow; i += 1) {
    const key = oldestFirst[i]?.[0];
    if (!key) break;
    priceCache.delete(key);
  }
}

function staleOrUnavailable(asset: string): ResolvedAssetPrice {
  const stale = priceCache.get(asset);
  if (stale) {
    return { value: stale.value, ts: stale.ts, source: 'cache-stale' };
  }
  return { value: 0, ts: null, source: 'unavailable' };
}

async function resolveAssetsUSD(
  assets: string[],
  options: ResolveAssetsOptions = {},
): Promise<Record<string, ResolvedAssetPrice>> {
  prunePriceCache();

  const unique = Array.from(new Set(assets.map(normalizeAsset).filter(Boolean)));
  const resolved: Record<string, ResolvedAssetPrice> = {};
  const missing: string[] = [];
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true;

  for (const asset of unique) {
    if (isStable(asset)) {
      resolved[asset] = { value: 1, ts: null, source: 'stable' };
      continue;
    }

    const cached = priceCache.get(asset);
    if (!forceRefresh && cached && now - cached.ts < CACHE_TTL_MS) {
      resolved[asset] = { value: cached.value, ts: cached.ts, source: 'cache-fresh' };
      continue;
    }

    missing.push(asset);
  }

  if (missing.length === 0) return resolved;

  const directPairs = missing.map((asset) => `${asset}USDT`);
  const directPrices = await fetchTickersBatch(directPairs);
  const unresolvedForBtc: string[] = [];

  for (const asset of missing) {
    const direct = directPrices.get(`${asset}USDT`);
    if (isValidPrice(direct)) {
      resolved[asset] = rememberPrice(asset, direct);
      continue;
    }
    unresolvedForBtc.push(asset);
  }

  if (unresolvedForBtc.length === 0) return resolved;

  const btcPairs = unresolvedForBtc.map((asset) => `${asset}BTC`);
  const viaBtcBatch = await fetchTickersBatch([...btcPairs, 'BTCUSDT']);
  const btcUsdt = viaBtcBatch.get('BTCUSDT') ?? await fetchTicker('BTCUSDT');
  const stillUnresolved: string[] = [];

  for (const asset of unresolvedForBtc) {
    const inBtc = viaBtcBatch.get(`${asset}BTC`);
    if (isValidPrice(inBtc) && isValidPrice(btcUsdt)) {
      resolved[asset] = rememberPrice(asset, inBtc * btcUsdt);
      continue;
    }
    stillUnresolved.push(asset);
  }

  if (stillUnresolved.length === 0) return resolved;

  const btcUsdtFallback = isValidPrice(btcUsdt) ? btcUsdt : await fetchTicker('BTCUSDT');
  for (const asset of stillUnresolved) {
    const direct = await fetchTicker(`${asset}USDT`);
    if (isValidPrice(direct)) {
      resolved[asset] = rememberPrice(asset, direct);
      continue;
    }

    const inBtc = await fetchTicker(`${asset}BTC`);
    if (isValidPrice(inBtc) && isValidPrice(btcUsdtFallback)) {
      resolved[asset] = rememberPrice(asset, inBtc * btcUsdtFallback);
      continue;
    }

    resolved[asset] = staleOrUnavailable(asset);
  }

  return resolved;
}

export async function getAssetPriceSnapshot(
  assets: string[],
  options: ResolveAssetsOptions = {},
): Promise<AssetPriceSnapshot> {
  const resolvedByAsset = await resolveAssetsUSD(assets, options);
  const priceByAsset = Object.fromEntries(
    Object.entries(resolvedByAsset).map(([asset, info]) => [asset, info.value] as const),
  );
  const sourceByAsset = Object.fromEntries(
    Object.entries(resolvedByAsset).map(([asset, info]) => [asset, info.source] as const),
  );
  const marketTimestamps = Object.values(resolvedByAsset)
    .map((entry) => entry.ts)
    .filter((ts): ts is number => typeof ts === 'number');

  return {
    priceByAsset,
    sourceByAsset,
    marketLastUpdatedAt: marketTimestamps.length > 0 ? Math.max(...marketTimestamps) : null,
    hasStalePrices: Object.values(resolvedByAsset).some((entry) => entry.source === 'cache-stale'),
    hasUnavailablePrices: Object.values(resolvedByAsset).some((entry) => entry.source === 'unavailable'),
  };
}

export function calculatePositionMetricsFromSnapshot(
  positions: DualPosition[],
  snapshot: AssetPriceSnapshot,
): PositionMetrics {
  const usdByPositionId: Record<string, number> = {};
  const subscriptionAssets = new Set<string>();

  let totalUsd = 0;
  let weightedAprNumerator = 0;
  let dailyEarningsUsd = 0;

  for (const position of positions) {
    const subscriptionAsset = normalizeAsset(position.subscriptionAsset);
    subscriptionAssets.add(subscriptionAsset);

    const unitPrice = snapshot.priceByAsset[subscriptionAsset] ?? 0;
    const usdValue = position.amount * unitPrice;
    usdByPositionId[position.id] = usdValue;

    totalUsd += usdValue;
    weightedAprNumerator += position.apr * usdValue;
    dailyEarningsUsd += calculateDailyEarnings(usdValue, position.apr);
  }

  const priceByAsset: Record<string, number> = {};
  const priceSourceByAsset: Record<string, PriceSource> = {};
  subscriptionAssets.forEach((asset) => {
    priceByAsset[asset] = snapshot.priceByAsset[asset] ?? 0;
    priceSourceByAsset[asset] = snapshot.sourceByAsset[asset] ?? 'unavailable';
  });

  const sources = Object.values(priceSourceByAsset);
  return {
    totalUsd,
    weightedApr: totalUsd > 0 ? weightedAprNumerator / totalUsd : 0,
    dailyEarningsUsd,
    usdByPositionId,
    priceByAsset,
    marketLastUpdatedAt: snapshot.marketLastUpdatedAt,
    hasStalePrices: sources.some((source) => source === 'cache-stale'),
    hasUnavailablePrices: sources.some((source) => source === 'unavailable'),
    priceSourceByAsset,
  };
}

export async function calculatePositionMetrics(
  positions: DualPosition[],
  options: PositionMetricsOptions = {},
): Promise<PositionMetrics> {
  const snapshot = await getAssetPriceSnapshot(
    positions.map((position) => position.subscriptionAsset),
    options,
  );
  return calculatePositionMetricsFromSnapshot(positions, snapshot);
}
