import type {
  BinanceDualPosition,
  BinanceAccountBalance,
  BybitDiscountBuyPosition,
  BybitDualAssetPosition,
  DualPosition,
  Direction,
  ExchangeSource,
} from '../types';
import { hasApiCredentials } from './binance-auth';
import { fetchDualPositions, fetchAccountBalances } from './binance-client';
import type {
  BinanceAccountReadReport,
  BinanceAssetAmount,
  BinanceProductReport,
  WalletIssue,
} from './binance-client';
import { hasBybitApiCredentials } from './bybit-auth';
import {
  fetchBybitAssetBalances,
  fetchBybitAssetOverviewBalances,
  fetchBybitDiscountBuyPositions,
  fetchBybitDualAssetPositions,
  fetchBybitWalletBalances,
} from './bybit-client';
import { replaceSyncedPositions } from './storage';
import { countPositionSubscriptions, groupPositionsByLockWindow } from './positions-grouping';
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

/**
 * Devuelve `null` cuando el exchange no da con que fecharla.
 *
 * Antes caia en `Date.now()`, y eso convertia "no se cuando entro" en "entro
 * ahora mismo": una mentira que se renueva en cada sondeo. La posicion parecia
 * cambiar cada 60s aunque no se hubiera tocado, la ventana empezaba de cero
 * continuamente y los dias facturados nunca avanzaban. Sin fecha, la fila lo
 * dice; inventarla no.
 */
function resolveEntryTimestamp(bp: BinanceDualPosition): number | null {
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

  return null;
}

/** Partes de fecha local de una marca de tiempo, o ninguna si no la hay. */
function optionalDateTimeParts(
  timestamp: number | null | undefined,
): { date: string; time: string } | null {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return null;
  return toLocalDateTimeParts(new Date(timestamp));
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

  return undefined;
}

// ── Map Binance position → local DualPosition ──

function mapBinancePosition(bp: BinanceDualPosition): DualPosition {
  const direction: Direction = bp.optionType === 'CALL' ? 'sell-high' : 'buy-low';
  const asset = bp.optionType === 'CALL' ? bp.investCoin : bp.exercisedCoin;
  const subscriptionAsset = bp.investCoin;
  const quoteAsset = bp.optionType === 'CALL' ? bp.exercisedCoin : bp.investCoin;

  const entry = optionalDateTimeParts(resolveEntryTimestamp(bp));
  const settlement = resolveBinanceDualSettlementLocal(bp.settleDate);

  return {
    id: `binance_${bp.id}`,
    asset,
    direction,
    subscriptionAsset,
    quoteAsset,
    amount: bp.amount,
    targetPrice: bp.strikePrice,
    entryDate: entry?.date ?? '',
    entryTime: entry?.time,
    entryTimeSource: resolveEntryTimeSource(bp),
    settlementDate: settlement?.date ?? bp.settleDate,
    settlementTime: settlement?.time,
    settlementTimeSource: settlement?.time ? 'binance_settle_date_rule' : undefined,
    apr: bp.apr,
    source: 'Binance',
    positionKind: 'dual',
  };
}

function mapBybitDualAssetPosition(position: BybitDualAssetPosition): DualPosition {
  const entry = optionalDateTimeParts(position.yieldStartAt);
  const settlement = optionalDateTimeParts(position.settlementTime);
  return {
    id: position.id,
    asset: position.baseCoin,
    direction: position.direction === 'SellHigh' ? 'sell-high' : 'buy-low',
    subscriptionAsset: position.investCoin,
    quoteAsset: position.quoteCoin,
    amount: position.amount,
    targetPrice: position.targetPrice,
    entryDate: entry?.date ?? '',
    entryTime: entry?.time,
    settlementDate: settlement?.date ?? '',
    settlementTime: settlement?.time,
    apr: position.apr,
    source: 'Bybit',
    positionKind: 'dual',
    projectedProfit: position.projectedProfit,
    expectedSettlementAsset: position.expectedSettlementAsset,
    expectedSettlementAmount: position.expectedSettlementAmount,
  };
}

function mapBybitDiscountBuyPosition(position: BybitDiscountBuyPosition): DualPosition {
  const entry = optionalDateTimeParts(position.yieldStartAt);
  const settlement = optionalDateTimeParts(position.settlementTime);
  return {
    id: position.id,
    asset: position.underlyingAsset,
    direction: 'buy-low',
    subscriptionAsset: position.coin,
    quoteAsset: position.coin,
    amount: position.amount,
    targetPrice: position.purchasePrice,
    entryDate: entry?.date ?? '',
    entryTime: entry?.time,
    settlementDate: settlement?.date ?? '',
    settlementTime: settlement?.time,
    apr: position.apr,
    source: 'Bybit',
    positionKind: 'discount-buy',
    projectedProfit: position.projectedProfit,
  };
}

// ── Sync positions from Binance ──

export async function syncPositionsFromBinance(
  forceRefresh = false,
): Promise<BinancePortfolioSnapshot> {
  const snapshot = await fetchBinancePortfolioSnapshot(forceRefresh);
  replaceSyncedPositions(snapshot.positions);
  return snapshot;
}

// ── Balance summary ──

export interface BalanceSummary {
  balances: BinanceAccountBalance[];
  totalUsdEstimate: number;
  /**
   * Monederos que no se pudieron leer. Sin esto un permiso ausente se muestra
   * como saldo cero, que es indistinguible de no tener nada. Opcional porque los
   * resumenes cacheados de versiones anteriores no lo traen: ausente es "ninguno".
   */
  walletIssues?: WalletIssue[];
  /** Reporte de todos los productos de la cuenta Binance, si está conectada. */
  accountReport?: BinanceAccountReadReport;
}

export interface BinancePortfolioSnapshot extends BalanceSummary {
  positions: DualPosition[];
  count: number;
}

const STABLECOINS = new Set(['USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'BFUSD', 'RWUSD']);
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

function valueAssetAmount(
  amount: BinanceAssetAmount,
  priceByAsset: Record<string, number>,
): number {
  if (!Number.isFinite(amount.amount)) return 0;
  if (STABLECOINS.has(amount.asset)) return amount.amount;
  return amount.amount * (priceByAsset[amount.asset] ?? 0);
}

function valueProductBalance(
  product: BinanceProductReport,
  priceByAsset: Record<string, number>,
): number {
  if (!product.includedInTotal) return 0;
  if (product.balanceUsd !== null && Number.isFinite(product.balanceUsd)) {
    return product.balanceUsd;
  }
  return product.balanceAmounts.reduce(
    (total, row) => total + valueAssetAmount(row, priceByAsset),
    0,
  );
}

function valueAmountList(rows: BinanceAssetAmount[], priceByAsset: Record<string, number>): number {
  return rows.reduce((total, row) => total + valueAssetAmount(row, priceByAsset), 0);
}

function valueAccountReport(
  report: BinanceAccountReadReport,
  priceByAsset: Record<string, number>,
): BinanceAccountReadReport {
  return {
    ...report,
    products: report.products.map((product) => ({
      ...product,
      balanceUsdEstimate:
        product.balanceUsd !== null && Number.isFinite(product.balanceUsd)
          ? product.balanceUsd
          : valueAmountList(product.balanceAmounts, priceByAsset),
      dailyPnlUsdEstimate: valueAmountList(product.dailyPnl, priceByAsset),
      dailyRewardsUsdEstimate: valueAmountList(product.dailyRewards, priceByAsset),
      unrealizedPnlUsdEstimate: valueAmountList(product.unrealizedPnl, priceByAsset),
    })),
  };
}

export function hasAnyExchangeApiCredentials(): boolean {
  return hasApiCredentials() || hasBybitApiCredentials();
}

/**
 * Exchanges que hoy alimentan la app, en orden estable. La interfaz nombra la
 * fuente de los datos; cuando no hay ninguna, no hay nada que nombrar.
 */
export function listConnectedExchanges(): ExchangeSource[] {
  const connected: ExchangeSource[] = [];
  if (hasApiCredentials()) connected.push('Binance');
  if (hasBybitApiCredentials()) connected.push('Bybit');
  return connected;
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

  if (!walletBalances.fulfilled && !fundingBalances.fulfilled && !supplementalBalances.fulfilled) {
    throw new Error('Bybit balances unavailable');
  }

  return mergeBybitBalanceRows([
    ...walletBalances.balances,
    ...fundingBalances.balances,
    ...supplementalBalances.balances,
  ]);
}

interface ExchangeBalancesResult {
  balances: BinanceAccountBalance[];
  knownUsdByAsset: Record<string, number>;
  walletIssues: WalletIssue[];
  accountReport?: BinanceAccountReadReport;
}

async function fetchExchangeBalances(forceRefresh: boolean): Promise<ExchangeBalancesResult> {
  const requests: Promise<ExchangeBalancesResult>[] = [];

  if (hasApiCredentials()) {
    requests.push(
      withExchangeTimeout(fetchAccountBalances(forceRefresh), 'Binance balances').then(
        ({ balances, issues, report }) => ({
          balances: balances.map((balance) => ({ ...balance, source: 'Binance' as const })),
          knownUsdByAsset: {},
          walletIssues: issues,
          accountReport: report,
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
        walletIssues: [],
      })),
    );
  }

  const settled = await Promise.allSettled(requests);
  const balances: BinanceAccountBalance[] = [];
  const knownUsdByAsset: Record<string, number> = {};
  const walletIssues: WalletIssue[] = [];
  let accountReport: BinanceAccountReadReport | undefined;

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    balances.push(...result.value.balances);
    Object.assign(knownUsdByAsset, result.value.knownUsdByAsset);
    walletIssues.push(...result.value.walletIssues);
    if (result.value.accountReport) accountReport = result.value.accountReport;
  }

  if (
    balances.length === 0 &&
    !accountReport &&
    settled.some((result) => result.status === 'rejected')
  ) {
    throw new Error('No se pudieron leer saldos de exchanges configurados.');
  }

  return { balances, knownUsdByAsset, walletIssues, accountReport };
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
    const {
      balances,
      knownUsdByAsset,
      walletIssues,
      accountReport: rawAccountReport,
    } = await fetchExchangeBalances(forceRefresh);

    const reportAssets = rawAccountReport
      ? rawAccountReport.products
          .flatMap((product) => [
            ...product.balanceAmounts,
            ...product.dailyPnl,
            ...product.dailyRewards,
          ])
          .concat(rawAccountReport.externalFlows)
      : [];
    // Price all assets: stablecoins at face value, others via market prices
    const nonStableAssets = new Set(
      balances
        .filter(
          (b) =>
            !STABLECOINS.has(b.asset) &&
            knownUsdByAsset[`${b.source ?? 'Binance'}:${b.asset}`] === undefined,
        )
        .map((b) => b.asset),
    );
    reportAssets.forEach((row) => {
      if (!STABLECOINS.has(row.asset)) nonStableAssets.add(row.asset);
    });

    let priceByAsset: Record<string, number> = {};
    if (nonStableAssets.size > 0) {
      try {
        const snapshot = await getAssetPriceSnapshot([...nonStableAssets], { forceRefresh });
        priceByAsset = snapshot.priceByAsset;
      } catch {
        // If prices fail, non-stablecoin balances will be counted as 0
      }
    }

    // Binance products with their own equity (Futures, Options, Margin, PM and
    // structured holdings) are added exactly once here. Spot/Funding/Earn are
    // already represented by `balances` and explicitly opt out above.
    const directProductBalanceUsd = rawAccountReport
      ? rawAccountReport.products.reduce(
          (total, product) => total + valueProductBalance(product, priceByAsset),
          0,
        )
      : 0;

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

    totalUsdEstimate += directProductBalanceUsd;

    let accountReport = rawAccountReport
      ? valueAccountReport(rawAccountReport, priceByAsset)
      : undefined;
    if (accountReport) {
      const explicitDailyPnlUsd = [...accountReport.dailyPnl, ...accountReport.dailyRewards].reduce(
        (total, row) => total + valueAssetAmount(row, priceByAsset),
        0,
      );
      accountReport = {
        ...accountReport,
        explicitDailyPnlUsd: Math.round(explicitDailyPnlUsd * 100) / 100,
        dailyBalanceChangeUsd: Math.round(explicitDailyPnlUsd * 100) / 100,
      };
    }

    const summary = { balances, totalUsdEstimate, walletIssues, accountReport };
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
        withExchangeTimeout(fetchBybitDualAssetPositions(), 'Bybit Dual Asset positions').then(
          (positions) => positions.map(mapBybitDualAssetPosition),
        ),
        withExchangeTimeout(fetchBybitDiscountBuyPositions(), 'Bybit Discount Buy positions').then(
          (positions) => positions.map(mapBybitDiscountBuyPosition),
        ),
      );
    }

    const [positionSettled, { balances, totalUsdEstimate, walletIssues, accountReport }] =
      await Promise.all([Promise.allSettled(positionRequests), fetchBalanceSummary(forceRefresh)]);
    // El exchange devuelve una fila por suscripcion: se consolidan aqui, antes
    // de persistir, para que toda la app vea el mismo modelo agrupado.
    const positions = groupPositionsByLockWindow(
      positionSettled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
    );

    const snapshot = {
      positions,
      count: countPositionSubscriptions(positions),
      balances,
      totalUsdEstimate,
      walletIssues,
      accountReport,
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

export function clearBinanceSyncCaches(): void {
  balanceSummaryCache = null;
  portfolioSnapshotCache = null;
  balanceSummaryInFlight = null;
  portfolioSnapshotInFlight = null;
}
