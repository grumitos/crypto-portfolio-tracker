import type { BinanceDualPosition, BinanceAccountBalance, DualPosition, Direction } from '../types';
import { fetchDualPositions, fetchAccountBalances } from './binance-client';
import { replaceAutoPositions } from './storage';
import { getAssetPriceSnapshot } from './market';
import {
  parseBinanceDualSettlementUTC,
  resolveBinanceDualSettlementLocal,
  toLocalDateTimeParts,
} from './date';

const DAY_MS = 24 * 60 * 60 * 1000;

function isValidTimestamp(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function resolveEntryTimestamp(bp: BinanceDualPosition): number {
  if (isValidTimestamp(bp.purchaseTime)) {
    return bp.purchaseTime;
  }

  // purchaseEndTime is the product cutoff, not the actual subscription time.
  const settlementAt = parseBinanceDualSettlementUTC(bp.settleDate);
  if (settlementAt) {
    return settlementAt.getTime() - bp.duration * DAY_MS;
  }

  if (isValidTimestamp(bp.purchaseEndTime)) {
    return bp.purchaseEndTime;
  }

  return Date.now();
}

function resolveEntryTimeSource(bp: BinanceDualPosition): DualPosition['entryTimeSource'] {
  if (isValidTimestamp(bp.purchaseTime)) {
    return 'binance_purchase_time';
  }

  const settlementAt = parseBinanceDualSettlementUTC(bp.settleDate);
  if (settlementAt) {
    return 'derived_settle_minus_duration';
  }

  if (isValidTimestamp(bp.purchaseEndTime)) {
    return 'derived_purchase_end_time';
  }

  return 'derived_now';
}

// ── Map Binance position → local DualPosition ──

function mapBinancePosition(bp: BinanceDualPosition): DualPosition {
  const direction: Direction = bp.optionType === 'CALL' ? 'sell-high' : 'buy-low';
  const asset = bp.optionType === 'CALL' ? bp.investCoin : bp.exercisedCoin;
  const subscriptionAsset = bp.investCoin;

  const entryTimestamp = resolveEntryTimestamp(bp);
  const entryAt = new Date(entryTimestamp);
  const entry = toLocalDateTimeParts(entryAt);
  const settlement = resolveBinanceDualSettlementLocal(bp.settleDate);

  return {
    id: `binance_${bp.id}`,
    asset,
    direction,
    subscriptionAsset,
    amount: bp.amount,
    targetPrice: bp.strikePrice,
    entryDate: entry.date,
    entryTime: entry.time,
    entryTimeSource: resolveEntryTimeSource(bp),
    settlementDate: settlement?.date ?? bp.settleDate,
    settlementTime: settlement?.time,
    settlementTimeSource: settlement?.time ? 'binance_settle_date_rule' : undefined,
    apr: bp.apr,
  };
}

// ── Sync positions from Binance ──

export async function syncPositionsFromBinance(
  forceRefresh = false,
): Promise<BinancePortfolioSnapshot> {
  const snapshot = await fetchBinancePortfolioSnapshot(forceRefresh);
  replaceAutoPositions(snapshot.positions);
  return snapshot;
}

// ── Balance summary ──

export interface BalanceSummary {
  balances: BinanceAccountBalance[];
  totalUsdEstimate: number;
}

export interface BinancePortfolioSnapshot extends BalanceSummary {
  positions: DualPosition[];
  count: number;
}

const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD']);
const AUTO_BINANCE_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  ts: number;
}

let balanceSummaryCache: CacheEntry<BalanceSummary> | null = null;
let portfolioSnapshotCache: CacheEntry<BinancePortfolioSnapshot> | null = null;
let balanceSummaryInFlight: Promise<BalanceSummary> | null = null;
let portfolioSnapshotInFlight: Promise<BinancePortfolioSnapshot> | null = null;

export async function fetchBalanceSummary(forceRefresh = false): Promise<BalanceSummary> {
  if (
    !forceRefresh &&
    balanceSummaryCache &&
    Date.now() - balanceSummaryCache.ts < AUTO_BINANCE_CACHE_TTL_MS
  ) {
    return balanceSummaryCache.value;
  }

  if (!forceRefresh && balanceSummaryInFlight) {
    return balanceSummaryInFlight;
  }

  const request = (async (): Promise<BalanceSummary> => {
    const balances = await fetchAccountBalances(forceRefresh);

    // Price all assets: stablecoins at face value, others via market prices
    const nonStableAssets = balances.filter((b) => !STABLECOINS.has(b.asset)).map((b) => b.asset);

    let priceByAsset: Record<string, number> = {};
    if (nonStableAssets.length > 0) {
      try {
        const snapshot = await getAssetPriceSnapshot(nonStableAssets, { forceRefresh });
        priceByAsset = snapshot.priceByAsset;
      } catch {
        // If prices fail, non-stablecoin balances will be counted as 0
      }
    }

    let totalUsdEstimate = 0;
    for (const b of balances) {
      const amount = b.free + b.locked;
      if (STABLECOINS.has(b.asset)) {
        totalUsdEstimate += amount;
      } else {
        const price = priceByAsset[b.asset] ?? 0;
        totalUsdEstimate += amount * price;
      }
    }

    const summary = { balances, totalUsdEstimate };
    balanceSummaryCache = { value: summary, ts: Date.now() };
    return summary;
  })();

  balanceSummaryInFlight = request;
  try {
    return await request;
  } finally {
    if (balanceSummaryInFlight === request) {
      balanceSummaryInFlight = null;
    }
  }
}

export async function fetchBinancePortfolioSnapshot(
  forceRefresh = false,
): Promise<BinancePortfolioSnapshot> {
  if (
    !forceRefresh &&
    portfolioSnapshotCache &&
    Date.now() - portfolioSnapshotCache.ts < AUTO_BINANCE_CACHE_TTL_MS
  ) {
    return portfolioSnapshotCache.value;
  }

  if (!forceRefresh && portfolioSnapshotInFlight) {
    return portfolioSnapshotInFlight;
  }

  const request = (async (): Promise<BinancePortfolioSnapshot> => {
    const [binancePositions, { balances, totalUsdEstimate }] = await Promise.all([
      fetchDualPositions(forceRefresh),
      fetchBalanceSummary(forceRefresh),
    ]);
    const positions = binancePositions.map(mapBinancePosition);

    const snapshot = {
      positions,
      count: positions.length,
      balances,
      totalUsdEstimate,
    };

    portfolioSnapshotCache = { value: snapshot, ts: Date.now() };
    return snapshot;
  })();

  portfolioSnapshotInFlight = request;
  try {
    return await request;
  } finally {
    if (portfolioSnapshotInFlight === request) {
      portfolioSnapshotInFlight = null;
    }
  }
}

// ── Check if positions are from Binance sync ──

export function isBinanceSyncedPosition(pos: DualPosition): boolean {
  return pos.id.startsWith('binance_');
}

export function clearBinanceSyncCaches(): void {
  balanceSummaryCache = null;
  portfolioSnapshotCache = null;
  balanceSummaryInFlight = null;
  portfolioSnapshotInFlight = null;
}
