import type {
  BinanceDualPosition,
  BinanceAccountBalance,
  BybitDiscountBuyPosition,
  BybitDualAssetPosition,
  BybitPosition,
  DualPosition,
  Direction,
} from '../types';
import { hasApiCredentials } from './binance-auth';
import { fetchDualPositions, fetchAccountBalances } from './binance-client';
import { hasBybitApiCredentials } from './bybit-auth';
import {
  fetchBybitAssetBalances,
  fetchBybitAssetOverviewBalances,
  fetchBybitDiscountBuyPositions,
  fetchBybitDualAssetPositions,
  fetchBybitOpenPositions,
  fetchBybitWalletBalances,
} from './bybit-client';
import { replaceAutoPositions } from './storage';
import { getAssetPriceSnapshot } from './market';
import {
  parseBinanceDualSettlementUTC,
  resolveBinanceDualSettlementLocal,
  todayISODateLocal,
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
  const quoteAsset = bp.optionType === 'CALL' ? bp.exercisedCoin : bp.investCoin;

  const entryTimestamp = resolveEntryTimestamp(bp);
  const entryAt = new Date(entryTimestamp);
  const entry = toLocalDateTimeParts(entryAt);
  const settlement = resolveBinanceDualSettlementLocal(bp.settleDate);

  return {
    id: `binance_${bp.id}`,
    asset,
    direction,
    subscriptionAsset,
    quoteAsset,
    amount: bp.amount,
    targetPrice: bp.strikePrice,
    entryDate: entry.date,
    entryTime: entry.time,
    entryTimeSource: resolveEntryTimeSource(bp),
    settlementDate: settlement?.date ?? bp.settleDate,
    settlementTime: settlement?.time,
    settlementTimeSource: settlement?.time ? 'binance_settle_date_rule' : undefined,
    apr: bp.apr,
    source: 'Binance',
    positionKind: 'dual',
  };
}

function mapBybitPosition(position: BybitPosition): DualPosition {
  const timestamp = position.updatedTime ?? position.createdTime;
  const entry = timestamp ? toLocalDateTimeParts(new Date(timestamp)) : null;
  const today = todayISODateLocal();
  return {
    id: position.id,
    asset: position.baseAsset,
    direction: position.side === 'Sell' ? 'sell-high' : 'buy-low',
    subscriptionAsset: position.baseAsset,
    quoteAsset: position.quoteAsset,
    amount: position.size,
    targetPrice: position.markPrice || position.avgPrice,
    entryDate: entry?.date ?? today,
    entryTime: entry?.time,
    settlementDate: today,
    apr: 0,
    source: 'Bybit',
    positionKind: 'derivative',
    displaySymbol: position.symbol,
    notionalUsd: position.positionValue,
    unrealizedPnlUsd: position.unrealizedPnl,
    side: position.side === 'Sell' ? 'short' : 'long',
  };
}

function mapBybitDualAssetPosition(position: BybitDualAssetPosition): DualPosition {
  const entryTimestamp = position.yieldStartAt ?? Date.now();
  const entry = toLocalDateTimeParts(new Date(entryTimestamp));
  const settlement = toLocalDateTimeParts(new Date(position.settlementTime));
  return {
    id: position.id,
    asset: position.baseCoin,
    direction: position.direction === 'SellHigh' ? 'sell-high' : 'buy-low',
    subscriptionAsset: position.investCoin,
    quoteAsset: position.quoteCoin,
    amount: position.amount,
    targetPrice: position.targetPrice,
    entryDate: entry.date,
    entryTime: entry.time,
    settlementDate: settlement.date,
    settlementTime: settlement.time,
    apr: position.apr,
    source: 'Bybit',
    positionKind: 'dual',
    displaySymbol: `${position.baseCoin}${position.quoteCoin}`,
    projectedProfit: position.projectedProfit,
    expectedSettlementAsset: position.expectedSettlementAsset,
    expectedSettlementAmount: position.expectedSettlementAmount,
  };
}

function mapBybitDiscountBuyPosition(position: BybitDiscountBuyPosition): DualPosition {
  const entryTimestamp = position.yieldStartAt ?? Date.now();
  const entry = toLocalDateTimeParts(new Date(entryTimestamp));
  const settlement = toLocalDateTimeParts(new Date(position.settlementTime));
  return {
    id: position.id,
    asset: position.underlyingAsset,
    direction: 'buy-low',
    subscriptionAsset: position.coin,
    quoteAsset: position.coin,
    amount: position.amount,
    targetPrice: position.purchasePrice,
    entryDate: entry.date,
    entryTime: entry.time,
    settlementDate: settlement.date,
    settlementTime: settlement.time,
    apr: position.apr,
    source: 'Bybit',
    positionKind: 'discount-buy',
    displaySymbol: `${position.underlyingAsset}${position.coin}`,
    projectedProfit: position.projectedProfit,
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
const AUTO_EXCHANGE_REQUEST_TIMEOUT_MS = 12_000;

interface CacheEntry<T> {
  value: T;
  ts: number;
}

let balanceSummaryCache: CacheEntry<BalanceSummary> | null = null;
let portfolioSnapshotCache: CacheEntry<BinancePortfolioSnapshot> | null = null;
let balanceSummaryInFlight: Promise<BalanceSummary> | null = null;
let portfolioSnapshotInFlight: Promise<BinancePortfolioSnapshot> | null = null;

function withExchangeTimeout<T>(request: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, AUTO_EXCHANGE_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([request, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function hasAnyExchangeApiCredentials(): boolean {
  return hasApiCredentials() || hasBybitApiCredentials();
}

function mapBybitBalance(
  row: Awaited<ReturnType<typeof fetchBybitWalletBalances>>[number],
): BinanceAccountBalance {
  const locked = Number.isFinite(row.locked) ? row.locked : 0;
  return {
    asset: row.asset,
    free: Math.max(row.walletBalance - locked, 0),
    locked,
    source: 'Bybit',
  };
}

type BybitBalanceRow = Awaited<ReturnType<typeof fetchBybitWalletBalances>>[number];

function mergeBybitBalanceRows(rows: BybitBalanceRow[]): BybitBalanceRow[] {
  const merged = new Map<string, BybitBalanceRow & { hasUnpricedBalance: boolean }>();

  rows.forEach((row) => {
    const asset = row.asset.trim().toUpperCase();
    if (!asset) return;

    const hasUnpricedBalance =
      row.walletBalance > 0 && (!Number.isFinite(row.usdValue) || row.usdValue <= 0);
    const current = merged.get(asset);
    if (current) {
      current.walletBalance += row.walletBalance;
      current.locked += row.locked;
      current.hasUnpricedBalance = current.hasUnpricedBalance || hasUnpricedBalance;
      current.usdValue = current.hasUnpricedBalance ? 0 : current.usdValue + row.usdValue;
      return;
    }

    merged.set(asset, {
      ...row,
      asset,
      usdValue: hasUnpricedBalance ? 0 : row.usdValue,
      hasUnpricedBalance,
    });
  });

  return [...merged.values()]
    .map(({ hasUnpricedBalance: _hasUnpricedBalance, ...row }) => row)
    .filter((row) => row.walletBalance > 0 || row.locked > 0 || row.usdValue > 0);
}

async function fetchOptionalBybitBalanceRows(request: Promise<BybitBalanceRow[]>): Promise<{
  balances: BybitBalanceRow[];
  fulfilled: boolean;
}> {
  try {
    return { balances: await request, fulfilled: true };
  } catch {
    return { balances: [], fulfilled: false };
  }
}

async function fetchBybitBalanceRows(): Promise<BybitBalanceRow[]> {
  const [walletBalances, fundingBalances, supplementalBalances] = await Promise.all([
    fetchOptionalBybitBalanceRows(fetchBybitWalletBalances()),
    fetchOptionalBybitBalanceRows(fetchBybitAssetBalances()),
    fetchOptionalBybitBalanceRows(fetchBybitAssetOverviewBalances()),
  ]);

  if (
    !walletBalances.fulfilled &&
    !fundingBalances.fulfilled &&
    !supplementalBalances.fulfilled
  ) {
    throw new Error('Bybit balances unavailable');
  }

  return mergeBybitBalanceRows([
    ...walletBalances.balances,
    ...fundingBalances.balances,
    ...supplementalBalances.balances,
  ]);
}

async function fetchExchangeBalances(forceRefresh: boolean): Promise<{
  balances: BinanceAccountBalance[];
  knownUsdByAsset: Record<string, number>;
}> {
  const requests: Promise<{
    balances: BinanceAccountBalance[];
    knownUsdByAsset: Record<string, number>;
  }>[] = [];

  if (hasApiCredentials()) {
    requests.push(
      withExchangeTimeout(fetchAccountBalances(forceRefresh), 'Binance balances').then(
        (balances) => ({
          balances: balances.map((balance) => ({ ...balance, source: 'Binance' as const })),
          knownUsdByAsset: {},
        }),
      ),
    );
  }

  if (hasBybitApiCredentials()) {
    requests.push(
      withExchangeTimeout(fetchBybitBalanceRows(), 'Bybit balances').then((balances) => ({
        balances: balances.map(mapBybitBalance),
        knownUsdByAsset: Object.fromEntries(
          balances
            .filter((balance) => Number.isFinite(balance.usdValue) && balance.usdValue > 0)
            .map((balance) => [`Bybit:${balance.asset}`, balance.usdValue]),
        ),
      })),
    );
  }

  const settled = await Promise.allSettled(requests);
  const balances: BinanceAccountBalance[] = [];
  const knownUsdByAsset: Record<string, number> = {};

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    balances.push(...result.value.balances);
    Object.assign(knownUsdByAsset, result.value.knownUsdByAsset);
  }

  if (balances.length === 0 && settled.some((result) => result.status === 'rejected')) {
    throw new Error('No se pudieron leer saldos de exchanges configurados.');
  }

  return { balances, knownUsdByAsset };
}

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
    const { balances, knownUsdByAsset } = await fetchExchangeBalances(forceRefresh);

    // Price all assets: stablecoins at face value, others via market prices
    const nonStableAssets = balances
      .filter(
        (b) =>
          !STABLECOINS.has(b.asset) &&
          knownUsdByAsset[`${b.source ?? 'Binance'}:${b.asset}`] === undefined,
      )
      .map((b) => b.asset);

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
      const knownUsd = knownUsdByAsset[`${b.source ?? 'Binance'}:${b.asset}`];
      if (knownUsd !== undefined) {
        totalUsdEstimate += knownUsd;
        continue;
      }
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
    const positionRequests: Promise<DualPosition[]>[] = [];
    if (hasApiCredentials()) {
      positionRequests.push(
        withExchangeTimeout(fetchDualPositions(forceRefresh), 'Binance positions').then(
          (positions) => positions.map(mapBinancePosition),
        ),
      );
    }
    if (hasBybitApiCredentials()) {
      positionRequests.push(
        withExchangeTimeout(fetchBybitOpenPositions(), 'Bybit derivative positions').then(
          (positions) => positions.map(mapBybitPosition),
        ),
        withExchangeTimeout(fetchBybitDualAssetPositions(), 'Bybit Dual Asset positions').then(
          (positions) => positions.map(mapBybitDualAssetPosition),
        ),
        withExchangeTimeout(fetchBybitDiscountBuyPositions(), 'Bybit Discount Buy positions').then(
          (positions) => positions.map(mapBybitDiscountBuyPosition),
        ),
      );
    }

    const [positionSettled, { balances, totalUsdEstimate }] = await Promise.all([
      Promise.allSettled(positionRequests),
      fetchBalanceSummary(forceRefresh),
    ]);
    const positions = positionSettled.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );

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
