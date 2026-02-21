import type { DualPosition } from '../types';
import { dailyEarnings as calculateDailyEarnings } from './calculator';

const STABLE_ASSETS = new Set(['USD', 'USDT', 'USDC', 'FDUSD', 'BUSD']);
const priceCache = new Map<string, { value: number; ts: number }>();
const CACHE_TTL_MS = 60_000;
const BINANCE_TICKER_URL = 'https://api.binance.com/api/v3/ticker/price';
const tickerInFlight = new Map<string, Promise<number | null>>();
const tickerBatchInFlight = new Map<string, Promise<Map<string, number>>>();

type PriceSource = 'stable' | 'cache-fresh' | 'live' | 'cache-stale' | 'unavailable';

interface ResolvedAssetPrice {
  value: number;
  ts: number | null;
  source: PriceSource;
}

interface ResolveAssetsOptions {
  forceRefresh?: boolean;
}

function isStable(asset: string): boolean {
  return STABLE_ASSETS.has(asset.toUpperCase());
}

function normalizeAsset(asset: string): string {
  return asset.toUpperCase().trim();
}

function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseTickerRows(payload: unknown): Map<string, number> {
  const rows = Array.isArray(payload) ? payload : [payload];
  const result = new Map<string, number>();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const symbol = Reflect.get(row, 'symbol');
    const rawPrice = Reflect.get(row, 'price');
    if (typeof symbol !== 'string' || typeof rawPrice !== 'string') continue;

    const price = Number(rawPrice);
    if (!isValidPrice(price)) continue;
    result.set(symbol.toUpperCase(), price);
  }

  return result;
}

async function fetchTicker(symbol: string): Promise<number | null> {
  const normalized = symbol.toUpperCase().trim();
  if (!normalized) return null;

  const inflight = tickerInFlight.get(normalized);
  if (inflight) return inflight;

  const request = (async (): Promise<number | null> => {
    try {
      const url = `${BINANCE_TICKER_URL}?symbol=${encodeURIComponent(normalized)}`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const rows = parseTickerRows(await res.json());
      return rows.get(normalized) ?? null;
    } catch {
      return null;
    }
  })();

  tickerInFlight.set(normalized, request);
  try {
    return await request;
  } finally {
    tickerInFlight.delete(normalized);
  }
}

async function fetchTickersBatch(symbols: string[]): Promise<Map<string, number>> {
  const normalized = Array.from(new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))).sort();
  if (normalized.length === 0) return new Map();

  const batchKey = normalized.join('|');
  const inflight = tickerBatchInFlight.get(batchKey);
  if (inflight) return inflight;

  const request = (async (): Promise<Map<string, number>> => {
    try {
      const query = normalized.length === 1
        ? `symbol=${encodeURIComponent(normalized[0])}`
        : `symbols=${encodeURIComponent(JSON.stringify(normalized))}`;
      const res = await fetch(`${BINANCE_TICKER_URL}?${query}`);
      if (!res.ok) return new Map();

      return parseTickerRows(await res.json());
    } catch {
      return new Map();
    }
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
  return { value, ts, source: 'live' };
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

  // Partial fallback path when batch responses are incomplete.
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

export async function getAssetPriceUSD(asset: string): Promise<number> {
  const normalized = normalizeAsset(asset);
  if (!normalized) return 0;
  const resolved = await resolveAssetsUSD([normalized]);
  return resolved[normalized]?.value ?? 0;
}

export async function getPriceMap(assets: string[]): Promise<Record<string, number>> {
  const resolved = await resolveAssetsUSD(assets);
  const entries = Object.entries(resolved).map(([asset, info]) => [asset, info.value] as const);
  return Object.fromEntries(entries);
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

export async function calculatePositionMetrics(
  positions: DualPosition[],
  options: PositionMetricsOptions = {},
): Promise<PositionMetrics> {
  const resolvedByAsset = await resolveAssetsUSD(positions.map((p) => p.subscriptionAsset), options);
  const priceByAsset = Object.fromEntries(
    Object.entries(resolvedByAsset).map(([asset, info]) => [asset, info.value] as const),
  );
  const priceSourceByAsset = Object.fromEntries(
    Object.entries(resolvedByAsset).map(([asset, info]) => [asset, info.source] as const),
  );
  const marketTimestamps = Object.values(resolvedByAsset)
    .map((entry) => entry.ts)
    .filter((ts): ts is number => typeof ts === 'number');
  const usdByPositionId: Record<string, number> = {};

  let totalUsd = 0;
  let weightedAprNumerator = 0;
  let dailyEarningsUsd = 0;

  for (const position of positions) {
    const unitPrice = priceByAsset[position.subscriptionAsset.toUpperCase()] ?? 0;
    const usdValue = position.amount * unitPrice;
    usdByPositionId[position.id] = usdValue;

    totalUsd += usdValue;
    weightedAprNumerator += position.apr * usdValue;
    dailyEarningsUsd += calculateDailyEarnings(usdValue, position.apr);
  }

  return {
    totalUsd,
    weightedApr: totalUsd > 0 ? weightedAprNumerator / totalUsd : 0,
    dailyEarningsUsd,
    usdByPositionId,
    priceByAsset,
    marketLastUpdatedAt: marketTimestamps.length > 0 ? Math.max(...marketTimestamps) : null,
    hasStalePrices: Object.values(resolvedByAsset).some((entry) => entry.source === 'cache-stale'),
    hasUnavailablePrices: Object.values(resolvedByAsset).some((entry) => entry.source === 'unavailable'),
    priceSourceByAsset,
  };
}
