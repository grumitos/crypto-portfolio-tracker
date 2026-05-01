import type { DualPosition } from '../types';
import { dailyEarnings as calculateDailyEarnings } from './calculator';
import { calculateDualProjectedBilledDays } from './dual-yield';

const STABLE_ASSETS = new Set(['USD', 'USDT', 'USDC', 'FDUSD', 'BUSD']);
const priceCache = new Map<string, { value: number; ts: number }>();
const changePercent24hCache = new Map<string, { value: number; ts: number }>();
const CACHE_TTL_MS = 60_000;
const STALE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PRICE_CACHE_MAX_ENTRIES = 256;
const CHANGE_CACHE_MAX_ENTRIES = 256;
const POSITION_METRICS_CACHE_MAX_ENTRIES = 32;
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

function toTicker24hEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return trimmed;
  return trimmed.replace(/\/ticker\/price\/?$/i, '/ticker/24hr');
}

const BINANCE_TICKER_ENDPOINTS = resolveTickerEndpoints();
const BINANCE_TICKER_24H_ENDPOINTS = BINANCE_TICKER_ENDPOINTS.map(toTicker24hEndpoint);
const endpointBlockedUntilByUrl = new Map<string, number>();
let preferredEndpointIndex = 0;
let preferred24hEndpointIndex = 0;
const tickerInFlight = new Map<string, Promise<number | null>>();
const tickerBatchInFlight = new Map<string, Promise<Map<string, number>>>();
const ticker24hBatchInFlight = new Map<string, Promise<Map<string, number>>>();

export type PriceSource = 'stable' | 'cache-fresh' | 'live' | 'cache-stale' | 'unavailable';

interface ResolvedAssetPrice {
  value: number;
  ts: number | null;
  source: PriceSource;
}

interface ResolveAssetsOptions {
  forceRefresh?: boolean;
  includeChangePercent24h?: boolean;
}

export interface AssetPriceSnapshot {
  priceByAsset: Record<string, number>;
  sourceByAsset: Record<string, PriceSource>;
  marketLastUpdatedAt: number | null;
  hasStalePrices: boolean;
  hasUnavailablePrices: boolean;
  changePercent24hByAsset?: Record<string, number | null>;
}

export interface PositionMetrics {
  totalUsd: number;
  weightedApr: number;
  dailyEarningsUsd: number;
  usdByPositionId: Record<string, number>;
  aprByPositionId: Record<string, number>;
  priceByAsset: Record<string, number>;
  marketLastUpdatedAt: number | null;
  hasStalePrices: boolean;
  hasUnavailablePrices: boolean;
  priceSourceByAsset: Record<string, PriceSource>;
}

export interface PositionMetricsOptions {
  forceRefresh?: boolean;
}

interface PositionMetricsCacheEntry {
  value: PositionMetrics;
  ts: number;
}

const positionMetricsCache = new Map<string, PositionMetricsCacheEntry>();
const positionMetricsInFlight = new Map<string, Promise<PositionMetrics>>();

function isStable(asset: string): boolean {
  return STABLE_ASSETS.has(asset.toUpperCase());
}

export function normalizeAsset(asset: string): string {
  return asset.toUpperCase().trim();
}

export function calculateDiscountBuyNoKnockoutProfit(
  position: Pick<DualPosition, 'asset' | 'amount' | 'targetPrice'>,
  snapshot: AssetPriceSnapshot,
): number | null {
  const asset = normalizeAsset(position.asset);
  const spotPrice = asset ? (snapshot.priceByAsset[asset] ?? 0) : 0;
  if (!Number.isFinite(spotPrice) || spotPrice <= 0) return null;
  if (!Number.isFinite(position.amount) || position.amount <= 0) return null;
  if (!Number.isFinite(position.targetPrice) || position.targetPrice <= 0) return null;

  const purchasedAmount = position.amount / position.targetPrice;
  return (spotPrice - position.targetPrice) * purchasedAmount;
}

export function calculateDiscountBuyEffectiveApr(
  position: Pick<
    DualPosition,
    | 'asset'
    | 'subscriptionAsset'
    | 'amount'
    | 'targetPrice'
    | 'entryDate'
    | 'entryTime'
    | 'settlementDate'
    | 'settlementTime'
  >,
  snapshot: AssetPriceSnapshot,
): number | null {
  const profit = calculateDiscountBuyNoKnockoutProfit(position, snapshot);
  if (profit === null) return null;

  const subscriptionAsset = normalizeAsset(position.subscriptionAsset);
  const subscriptionPrice = snapshot.priceByAsset[subscriptionAsset] ?? 0;
  const capitalUsd = position.amount * subscriptionPrice;
  const billedDays = calculateDualProjectedBilledDays(position);
  if (!Number.isFinite(capitalUsd) || capitalUsd <= 0 || billedDays <= 0) return null;

  return (profit / capitalUsd) * (365 / billedDays) * 100;
}

function resolveMetricsApr(position: DualPosition, snapshot: AssetPriceSnapshot): number {
  if (position.positionKind === 'discount-buy') {
    return calculateDiscountBuyEffectiveApr(position, snapshot) ?? 0;
  }
  return position.apr;
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

function parseTickerChangePercent(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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

function parseTicker24hRows(payload: unknown): Map<string, number> {
  const rows = Array.isArray(payload) ? payload : [payload];
  const result = new Map<string, number>();

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const symbol = parseTickerSymbol(row.symbol);
    const changePercent = parseTickerChangePercent(row.priceChangePercent);
    if (!symbol || changePercent === null) continue;
    result.set(symbol, changePercent);
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
  const preferred =
    preferredEndpointIndex >= 0 && preferredEndpointIndex < BINANCE_TICKER_ENDPOINTS.length
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

function endpoint24hOrder(now: number): number[] {
  const preferred =
    preferred24hEndpointIndex >= 0 &&
    preferred24hEndpointIndex < BINANCE_TICKER_24H_ENDPOINTS.length
      ? preferred24hEndpointIndex
      : 0;
  const ordered = [
    preferred,
    ...BINANCE_TICKER_24H_ENDPOINTS.map((_, index) => index).filter((index) => index !== preferred),
  ];

  return ordered.filter((index) => {
    const baseUrl = BINANCE_TICKER_24H_ENDPOINTS[index];
    const blockedUntil = endpointBlockedUntilByUrl.get(baseUrl) ?? 0;
    return blockedUntil <= now;
  });
}

function mark24hEndpointHealthy(index: number): void {
  preferred24hEndpointIndex = index;
  endpointBlockedUntilByUrl.delete(BINANCE_TICKER_24H_ENDPOINTS[index]);
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BINANCE_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
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

async function fetchTicker24hRowsWithFallback(query: string): Promise<Map<string, number>> {
  const now = Date.now();
  const order = endpoint24hOrder(now);
  if (order.length === 0) return new Map();

  for (const index of order) {
    const baseUrl = BINANCE_TICKER_24H_ENDPOINTS[index];
    const response = await fetchWithTimeout(`${baseUrl}?${query}`);
    if (!response) continue;

    if (!response.ok) {
      if (isRateLimited(response)) {
        blockEndpoint(baseUrl, response);
      }
      continue;
    }

    try {
      const rows = parseTicker24hRows(await response.json());
      mark24hEndpointHealthy(index);
      return rows;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[market] invalid ticker 24h payload', { baseUrl, err });
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
  const normalized = Array.from(
    new Set(symbols.map((symbol) => symbol.toUpperCase().trim()).filter(Boolean)),
  ).sort();
  if (normalized.length === 0) return new Map();

  const batchKey = normalized.join('|');
  const inflight = tickerBatchInFlight.get(batchKey);
  if (inflight) return inflight;

  const request = (async (): Promise<Map<string, number>> => {
    const query =
      normalized.length === 1
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

async function fetchTickers24hBatch(symbols: string[]): Promise<Map<string, number>> {
  const normalized = Array.from(
    new Set(symbols.map((symbol) => symbol.toUpperCase().trim()).filter(Boolean)),
  ).sort();
  if (normalized.length === 0) return new Map();

  const batchKey = normalized.join('|');
  const inflight = ticker24hBatchInFlight.get(batchKey);
  if (inflight) return inflight;

  const request = (async (): Promise<Map<string, number>> => {
    const query =
      normalized.length === 1
        ? `symbol=${encodeURIComponent(normalized[0])}`
        : `symbols=${encodeURIComponent(JSON.stringify(normalized))}`;
    return fetchTicker24hRowsWithFallback(query);
  })();

  ticker24hBatchInFlight.set(batchKey, request);
  try {
    return await request;
  } finally {
    ticker24hBatchInFlight.delete(batchKey);
  }
}

function rememberPrice(asset: string, value: number): ResolvedAssetPrice {
  const ts = Date.now();
  // Re-insert to maintain LRU order (most recently used at the end).
  priceCache.delete(asset);
  priceCache.set(asset, { value, ts });
  prunePriceCache(ts);
  return { value, ts, source: 'live' };
}

function rememberChangePercent24h(asset: string, value: number): { value: number; ts: number } {
  const ts = Date.now();
  changePercent24hCache.delete(asset);
  changePercent24hCache.set(asset, { value, ts });
  pruneChangePercent24hCache(ts);
  return { value, ts };
}

/**
 * Prune a cache Map: remove stale entries, then evict oldest by insertion order (LRU).
 * Map.keys().next() gives the oldest key since Map preserves insertion order,
 * and setCacheEntry() re-inserts on update to keep order fresh.
 */
function pruneCache(
  cache: Map<string, { value: number; ts: number }>,
  maxEntries: number,
  now = Date.now(),
): void {
  for (const [key, entry] of cache.entries()) {
    if (now - entry.ts > STALE_CACHE_MAX_AGE_MS) {
      cache.delete(key);
    }
  }

  let overflow = cache.size - maxEntries;
  if (overflow <= 0) return;

  for (const key of cache.keys()) {
    if (overflow <= 0) break;
    cache.delete(key);
    overflow -= 1;
  }
}

function prunePriceCache(now = Date.now()): void {
  pruneCache(priceCache, PRICE_CACHE_MAX_ENTRIES, now);
}

function pruneChangePercent24hCache(now = Date.now()): void {
  pruneCache(changePercent24hCache, CHANGE_CACHE_MAX_ENTRIES, now);
}

function buildPositionMetricsCacheKey(positions: DualPosition[]): string {
  return [...positions]
    .map((position) =>
      [
        position.id,
        normalizeAsset(position.asset),
        normalizeAsset(position.subscriptionAsset),
        position.amount.toFixed(8),
        position.targetPrice.toFixed(8),
        position.apr.toFixed(8),
        position.entryDate,
        position.entryTime ?? '',
        position.settlementDate,
        position.settlementTime ?? '',
        position.positionKind ?? 'dual',
        Number.isFinite(position.notionalUsd) ? String(position.notionalUsd) : '',
      ].join(':'),
    )
    .sort()
    .join('|');
}

function prunePositionMetricsCache(now = Date.now()): void {
  for (const [key, entry] of positionMetricsCache.entries()) {
    if (now - entry.ts > CACHE_TTL_MS) {
      positionMetricsCache.delete(key);
    }
  }

  let overflow = positionMetricsCache.size - POSITION_METRICS_CACHE_MAX_ENTRIES;
  if (overflow <= 0) return;

  for (const key of positionMetricsCache.keys()) {
    if (overflow <= 0) break;
    positionMetricsCache.delete(key);
    overflow -= 1;
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
  const btcUsdt = viaBtcBatch.get('BTCUSDT') ?? (await fetchTicker('BTCUSDT'));
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

async function resolveAssets24hChangePercent(
  assets: string[],
  options: ResolveAssetsOptions = {},
): Promise<Record<string, number | null>> {
  pruneChangePercent24hCache();

  const unique = Array.from(new Set(assets.map(normalizeAsset).filter(Boolean)));
  const resolved: Record<string, number | null> = {};
  const missing: string[] = [];
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true;

  for (const asset of unique) {
    if (isStable(asset)) {
      resolved[asset] = 0;
      continue;
    }

    const cached = changePercent24hCache.get(asset);
    if (!forceRefresh && cached && now - cached.ts < CACHE_TTL_MS) {
      resolved[asset] = cached.value;
      continue;
    }

    missing.push(asset);
  }

  if (missing.length === 0) return resolved;

  const symbols = missing.map((asset) => `${asset}USDT`);
  const fetched = await fetchTickers24hBatch(symbols);

  for (const asset of missing) {
    const value = fetched.get(`${asset}USDT`);
    if (typeof value === 'number' && Number.isFinite(value)) {
      resolved[asset] = rememberChangePercent24h(asset, value).value;
      continue;
    }

    const stale = changePercent24hCache.get(asset);
    resolved[asset] = stale ? stale.value : null;
  }

  return resolved;
}

export async function getAssetPriceSnapshot(
  assets: string[],
  options: ResolveAssetsOptions = {},
): Promise<AssetPriceSnapshot> {
  const resolvedByAsset = await resolveAssetsUSD(assets, options);
  const changePercent24hByAsset =
    options.includeChangePercent24h === true
      ? await resolveAssets24hChangePercent(assets, options)
      : undefined;
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
    hasUnavailablePrices: Object.values(resolvedByAsset).some(
      (entry) => entry.source === 'unavailable',
    ),
    changePercent24hByAsset,
  };
}

export function calculatePositionMetricsFromSnapshot(
  positions: DualPosition[],
  snapshot: AssetPriceSnapshot,
): PositionMetrics {
  const usdByPositionId: Record<string, number> = {};
  const aprByPositionId: Record<string, number> = {};
  const metricAssets = new Set<string>();

  let totalUsd = 0;
  let weightedAprNumerator = 0;
  let dailyEarningsUsd = 0;

  for (const position of positions) {
    const subscriptionAsset = normalizeAsset(position.subscriptionAsset);
    const usdValue =
      position.positionKind === 'derivative' && Number.isFinite(position.notionalUsd)
        ? Math.max(0, position.notionalUsd ?? 0)
        : position.amount * (snapshot.priceByAsset[subscriptionAsset] ?? 0);
    const effectiveApr = resolveMetricsApr(position, snapshot);
    usdByPositionId[position.id] = usdValue;
    aprByPositionId[position.id] = effectiveApr;

    totalUsd += usdValue;
    weightedAprNumerator += effectiveApr * usdValue;
    dailyEarningsUsd += calculateDailyEarnings(usdValue, effectiveApr);

    if (position.positionKind !== 'derivative') {
      metricAssets.add(subscriptionAsset);
    }
    if (position.positionKind === 'discount-buy') {
      const underlyingAsset = normalizeAsset(position.asset);
      if (underlyingAsset) {
        metricAssets.add(underlyingAsset);
      }
    }
  }

  const priceByAsset: Record<string, number> = {};
  const priceSourceByAsset: Record<string, PriceSource> = {};
  metricAssets.forEach((asset) => {
    priceByAsset[asset] = snapshot.priceByAsset[asset] ?? 0;
    priceSourceByAsset[asset] = snapshot.sourceByAsset[asset] ?? 'unavailable';
  });

  const sources = Object.values(priceSourceByAsset);
  return {
    totalUsd,
    weightedApr: totalUsd > 0 ? weightedAprNumerator / totalUsd : 0,
    dailyEarningsUsd,
    usdByPositionId,
    aprByPositionId,
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
  const forceRefresh = options.forceRefresh === true;
  const cacheKey = buildPositionMetricsCacheKey(positions);
  const now = Date.now();

  prunePositionMetricsCache(now);

  if (!forceRefresh) {
    const cached = positionMetricsCache.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      positionMetricsCache.delete(cacheKey);
      positionMetricsCache.set(cacheKey, cached);
      return cached.value;
    }

    const inFlight = positionMetricsInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const request = (async (): Promise<PositionMetrics> => {
    const snapshot = await getAssetPriceSnapshot(
      buildPositionMetricsAssetUniverse(positions),
      options,
    );
    const metrics = calculatePositionMetricsFromSnapshot(positions, snapshot);
    positionMetricsCache.delete(cacheKey);
    positionMetricsCache.set(cacheKey, { value: metrics, ts: Date.now() });
    prunePositionMetricsCache();
    return metrics;
  })();

  positionMetricsInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (positionMetricsInFlight.get(cacheKey) === request) {
      positionMetricsInFlight.delete(cacheKey);
    }
  }
}

function buildPositionMetricsAssetUniverse(positions: DualPosition[]): string[] {
  const assets = new Set<string>();

  positions.forEach((position) => {
    if (position.positionKind === 'derivative') return;

    const subscriptionAsset = normalizeAsset(position.subscriptionAsset);
    if (subscriptionAsset) {
      assets.add(subscriptionAsset);
    }

    if (position.positionKind === 'discount-buy') {
      const underlyingAsset = normalizeAsset(position.asset);
      if (underlyingAsset) {
        assets.add(underlyingAsset);
      }
    }
  });

  return Array.from(assets);
}

export function clearMarketCaches(): void {
  priceCache.clear();
  changePercent24hCache.clear();
  positionMetricsCache.clear();
  positionMetricsInFlight.clear();
  tickerInFlight.clear();
  tickerBatchInFlight.clear();
  ticker24hBatchInFlight.clear();
  endpointBlockedUntilByUrl.clear();
  preferredEndpointIndex = 0;
  preferred24hEndpointIndex = 0;
}
