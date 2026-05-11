import type { DualPosition } from '../types';
import {
  calculatePositionMetricsFromSnapshot,
  getAssetPriceSnapshot,
  normalizeAsset,
  type AssetPriceSnapshot,
  type PositionMetrics,
} from './market';
import type { BalanceSummary, BinancePortfolioSnapshot } from './binance-sync';

const SPOT_STRIP_BASE_ASSETS = ['BTC', 'ETH', 'BNB', 'SOL'];
const SPOT_STRIP_EXCLUDED_ASSETS = new Set<string>(['USDT', 'USDC']);

export interface SharedMarketData {
  positionsKey: string;
  snapshot: AssetPriceSnapshot;
  metrics: PositionMetrics;
}

const marketDataInFlight = new Map<string, Promise<SharedMarketData>>();
let marketDataCache: SharedMarketData | null = null;
let balanceSummaryCache: BalanceSummary | null = null;
let autoPortfolioSnapshotCache: BinancePortfolioSnapshot | null = null;

export function getPositionsCacheKey(positions: DualPosition[]): string {
  return JSON.stringify(
    [...positions]
      .map((position) => ({
        id: position.id,
        asset: position.asset,
        direction: position.direction,
        positionKind: position.positionKind ?? 'dual',
        subscriptionAsset: position.subscriptionAsset,
        quoteAsset: position.quoteAsset ?? '',
        amount: position.amount,
        targetPrice: position.targetPrice,
        entryDate: position.entryDate,
        entryTime: position.entryTime ?? '',
        settlementDate: position.settlementDate,
        settlementTime: position.settlementTime ?? '',
        apr: position.apr,
        components:
          position.components?.map((component) => ({
            id: component.id,
            amount: component.amount,
            entryDate: component.entryDate,
            entryTime: component.entryTime ?? '',
            apr: component.apr,
            targetPrice: component.targetPrice,
          })) ?? [],
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

function buildAssetUniverse(positions: DualPosition[]): string[] {
  const assets = new Set<string>(SPOT_STRIP_BASE_ASSETS);

  positions.forEach((position) => {
    const asset = normalizeAsset(position.asset);
    if (asset && !SPOT_STRIP_EXCLUDED_ASSETS.has(asset)) {
      assets.add(asset);
    }

    const subscriptionAsset = normalizeAsset(position.subscriptionAsset);
    if (subscriptionAsset) {
      assets.add(subscriptionAsset);
    }

    const quoteAsset = normalizeAsset(position.quoteAsset ?? '');
    if (quoteAsset) {
      assets.add(quoteAsset);
    }

    const expectedSettlementAsset = normalizeAsset(position.expectedSettlementAsset ?? '');
    if (expectedSettlementAsset) {
      assets.add(expectedSettlementAsset);
    }
  });

  return Array.from(assets);
}

export function getCachedSharedMarketData(positions: DualPosition[]): SharedMarketData | null {
  if (!marketDataCache) return null;

  const positionsKey = getPositionsCacheKey(positions);
  return {
    positionsKey,
    snapshot: marketDataCache.snapshot,
    metrics: calculatePositionMetricsFromSnapshot(positions, marketDataCache.snapshot),
  };
}

export async function getSharedMarketData(
  positions: DualPosition[],
  forceRefresh = false,
): Promise<SharedMarketData> {
  const positionsKey = getPositionsCacheKey(positions);
  const requestKey = `${positionsKey}:${forceRefresh ? 'force' : 'cached'}`;

  if (!forceRefresh) {
    const cached = getCachedSharedMarketData(positions);
    if (cached) return cached;
  }

  const inFlight = marketDataInFlight.get(requestKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<SharedMarketData> => {
    const snapshot = await getAssetPriceSnapshot(buildAssetUniverse(positions), {
      forceRefresh,
      includeChangePercent24h: true,
    });
    const metrics = calculatePositionMetricsFromSnapshot(positions, snapshot);
    const nextValue = { positionsKey, snapshot, metrics };
    marketDataCache = nextValue;
    return nextValue;
  })();

  marketDataInFlight.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (marketDataInFlight.get(requestKey) === request) {
      marketDataInFlight.delete(requestKey);
    }
  }
}

export function rememberBalanceSummary(summary: BalanceSummary | null): void {
  balanceSummaryCache = summary;
}

export function getCachedBalanceSummary(): BalanceSummary | null {
  return balanceSummaryCache;
}

export function rememberAutoPortfolioSnapshot(snapshot: BinancePortfolioSnapshot | null): void {
  autoPortfolioSnapshotCache = snapshot;
}

export function getCachedAutoPortfolioSnapshot(): BinancePortfolioSnapshot | null {
  return autoPortfolioSnapshotCache;
}

export function clearApiRuntimeCache(): void {
  marketDataCache = null;
  balanceSummaryCache = null;
  autoPortfolioSnapshotCache = null;
  marketDataInFlight.clear();
}
