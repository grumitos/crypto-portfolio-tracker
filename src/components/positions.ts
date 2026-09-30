import { loadState } from '../utils/storage';
import { countPositionSubscriptions } from '../utils/positions-grouping';
import { formatUSD, formatUSDCompact } from '../utils/calculator';
import {
  calculateDiscountBuyEffectiveApr,
  calculateDiscountBuyNoKnockoutProfit,
  normalizeAsset as normalizeAssetSymbol,
} from '../utils/market';
import type { AssetPriceSnapshot, PositionMetrics } from '../utils/market';
import { registerApiFailure, registerApiLastUpdatedAt } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { renderPositionGroup, updateRemainingTimesInPlace } from './positions.table';
import type { DualPosition } from '../types';
import { ONE_SECOND_MS } from '../utils/constants';
import { subscribeToMarketTicks } from '../utils/market-poller';
import { skeletonSpan } from '../utils/ui-helpers';
import { setAnimatedNumber, setAnimatedText, stopValueAnimation } from '../utils/animation';
import {
  bindAssetLogoFallbacks,
  createAssetMonogram,
  resolveAssetLogoSources,
} from '../utils/asset-logos';
import { onApiConfigChange } from './positions/api-config-modal';
import {
  hasAnyExchangeApiCredentials,
  listConnectedExchanges,
  syncPositionsFromBinance,
} from '../utils/binance-sync';
import type { BinancePortfolioSnapshot } from '../utils/binance-sync';
import {
  getCachedAutoPortfolioSnapshot,
  getPositionsCacheKey,
  getSharedMarketData,
  rememberAutoPortfolioSnapshot,
  rememberBalanceSummary,
} from '../utils/api-runtime-cache';
import {
  POSITIONS_COPY,
  RESULT_NUMBER_ANIM_MS,
  SPOT_CHANGE_SKELETON_WIDTH,
  SPOT_STRIP_ASSET_ORDER,
  SPOT_STRIP_EXCLUDED_ASSETS,
  SPOT_VALUE_SKELETON_WIDTH,
} from './positions.constants';
import {
  renderPositionsEmptyState,
  renderPositionsTemplate,
  renderSpotItemTemplate,
} from './positions.template';

const valueAnimationByElement = new WeakMap<HTMLElement, number>();
const textAnimationByElement = new WeakMap<HTMLElement, number>();
const spotStripValueAnimationByElement = new WeakMap<HTMLElement, number>();
const spotStripChangeAnimationByElement = new WeakMap<HTMLElement, number>();
const positionUsdAnimationByElement = new WeakMap<HTMLElement, number>();
const positionEarnAnimationByElement = new WeakMap<HTMLElement, number>();
const positionAprAnimationByElement = new WeakMap<HTMLElement, number>();
const positionsCountAnimationByElement = new WeakMap<HTMLElement, number>();

interface SpotAssetData {
  asset: string;
  spotPrice: number;
  changePercent24h: number | null;
}

// normalizeAssetSymbol is imported from '../utils/market' (aliased normalizeAsset)

function isSpotStripAsset(asset: string): boolean {
  const normalized = normalizeAssetSymbol(asset);
  return Boolean(normalized) && !SPOT_STRIP_EXCLUDED_ASSETS.has(normalized);
}

function getSpotStripAssets(positions: DualPosition[]): string[] {
  const seen = new Set<string>(SPOT_STRIP_ASSET_ORDER);
  const extras: string[] = [];

  // Add any position assets not in the fixed order, alphabetically
  positions.forEach((position) => {
    const asset = normalizeAssetSymbol(position.asset);
    if (!asset || !isSpotStripAsset(asset) || seen.has(asset)) return;
    seen.add(asset);
    extras.push(asset);
  });
  extras.sort((a, b) => a.localeCompare(b));

  return [...SPOT_STRIP_ASSET_ORDER, ...extras];
}

function sortSpotAssets(assets: string[]): string[] {
  return [...assets].sort((a, b) => {
    const ai = SPOT_STRIP_ASSET_ORDER.indexOf(a);
    const bi = SPOT_STRIP_ASSET_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

function setStatText(el: HTMLElement | null, text: string, animate: boolean): void {
  if (!el) return;
  stopValueAnimation(valueAnimationByElement, el);
  delete el.dataset.numericValue;
  setAnimatedText(textAnimationByElement, el, text, {
    enabled: animate,
    mode: 'fade',
    className: 'text-swap',
  });
}

function setStatCurrency(el: HTMLElement | null, value: number, animate: boolean): void {
  if (!el) return;
  stopValueAnimation(textAnimationByElement, el);
  setAnimatedNumber(valueAnimationByElement, el, value, (next) => formatUSD(next), {
    enabled: animate,
    durationMs: RESULT_NUMBER_ANIM_MS,
    allowRememberedStart: false,
  });
}

function setStatPercent(el: HTMLElement | null, value: number, animate: boolean): void {
  if (!el) return;
  stopValueAnimation(textAnimationByElement, el);
  setAnimatedNumber(valueAnimationByElement, el, value, (next) => `${next.toFixed(2)}%`, {
    enabled: animate,
    durationMs: RESULT_NUMBER_ANIM_MS,
    allowRememberedStart: false,
  });
}

function setAnimatedFallbackText(
  el: HTMLElement | null,
  numericMap: WeakMap<HTMLElement, number>,
  text: string,
): void {
  if (!el) return;
  stopValueAnimation(numericMap, el);
  delete el.dataset.numericValue;
  setAnimatedText(textAnimationByElement, el, text, {
    enabled: true,
    mode: 'fade',
    className: 'text-swap',
  });
}

function setPositionsCount(el: HTMLElement | null, count: number, animate: boolean): void {
  if (!el) return;
  stopValueAnimation(textAnimationByElement, el);
  setAnimatedNumber(
    positionsCountAnimationByElement,
    el,
    count,
    (next) => {
      return String(Math.max(0, Math.round(next)));
    },
    {
      enabled: animate,
      durationMs: RESULT_NUMBER_ANIM_MS,
      epsilon: 0.49,
      allowRememberedStart: false,
    },
  );
}

function setPositionUsdValue(el: HTMLElement | null, value: number): void {
  if (!el) return;

  if (!Number.isFinite(value) || value <= 0) {
    setAnimatedFallbackText(el, positionUsdAnimationByElement, POSITIONS_COPY.noData);
    el.classList.add('text-muted');
    return;
  }

  stopValueAnimation(textAnimationByElement, el);
  el.classList.remove('text-muted');
  setAnimatedNumber(positionUsdAnimationByElement, el, value, (next) => formatUSDCompact(next), {
    enabled: true,
    durationMs: RESULT_NUMBER_ANIM_MS,
  });
}

function setSpotValue(el: HTMLElement | null, value: number): void {
  if (!el) return;
  if (!Number.isFinite(value) || value <= 0) {
    setAnimatedFallbackText(el, spotStripValueAnimationByElement, POSITIONS_COPY.noData);
    el.classList.add('text-muted');
    return;
  }

  stopValueAnimation(textAnimationByElement, el);
  el.classList.remove('text-muted');
  setAnimatedNumber(spotStripValueAnimationByElement, el, value, (next) => formatUSD(next), {
    enabled: true,
    durationMs: RESULT_NUMBER_ANIM_MS,
    allowRememberedStart: false,
  });
}

function formatSpotChange(value: number): string {
  const arrow = value > 0 ? '\u25B2' : value < 0 ? '\u25BC' : '';
  const sign = value > 0 ? '+' : '';
  return `${arrow}${sign}${value.toFixed(2)}%`;
}

function formatSignedUsdt(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatUSDCompact(Math.abs(value)).replace('$', '')} USDT`;
}

function formatAprPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function updateDiscountBuyAprs(
  container: HTMLElement,
  positions: DualPosition[],
  snapshot: AssetPriceSnapshot,
): void {
  const doc = container.ownerDocument;
  positions.forEach((position) => {
    if (position.positionKind !== 'discount-buy') return;

    const el = doc.getElementById(`position-apr-${position.id}`) as HTMLElement | null;
    if (!el || !container.contains(el)) return;

    const apr = calculateDiscountBuyEffectiveApr(position, snapshot);
    el.classList.remove('text-loss', 'text-muted');

    if (apr === null) {
      setAnimatedFallbackText(el, positionAprAnimationByElement, POSITIONS_COPY.noData);
      el.classList.add('text-muted');
      return;
    }

    stopValueAnimation(textAnimationByElement, el);
    setAnimatedNumber(positionAprAnimationByElement, el, apr, formatAprPercent, {
      enabled: true,
      durationMs: RESULT_NUMBER_ANIM_MS,
    });

    if (apr < 0) {
      el.classList.add('text-loss');
    } else if (apr === 0) {
      el.classList.add('text-muted');
    }
  });
}

function updateDualPositionAprs(
  container: HTMLElement,
  positions: DualPosition[],
  metrics: PositionMetrics,
): void {
  const doc = container.ownerDocument;
  positions.forEach((position) => {
    if ((position.positionKind ?? 'dual') !== 'dual') return;

    const el = doc.getElementById(`position-apr-${position.id}`) as HTMLElement | null;
    if (!el || !container.contains(el)) return;

    const apr = metrics.aprByPositionId[position.id] ?? position.apr;
    el.classList.remove('text-loss', 'text-muted');
    stopValueAnimation(textAnimationByElement, el);
    stopValueAnimation(positionAprAnimationByElement, el);
    el.textContent = formatAprPercent(apr);
    el.dataset.numericValue = String(apr);

    if (apr < 0) {
      el.classList.add('text-loss');
    } else if (apr === 0) {
      el.classList.add('text-muted');
    }
  });
}

function updateDiscountBuyEarnings(
  container: HTMLElement,
  positions: DualPosition[],
  snapshot: AssetPriceSnapshot,
): void {
  const doc = container.ownerDocument;
  positions.forEach((position) => {
    if (position.positionKind !== 'discount-buy') return;

    const el = doc.getElementById(`position-earn-${position.id}`) as HTMLElement | null;
    if (!el || !container.contains(el)) return;

    const profit = calculateDiscountBuyNoKnockoutProfit(position, snapshot);
    el.classList.remove('text-gain', 'text-loss', 'text-muted');

    if (profit === null) {
      setAnimatedFallbackText(el, positionEarnAnimationByElement, POSITIONS_COPY.noData);
      el.classList.add('text-muted');
      return;
    }

    stopValueAnimation(textAnimationByElement, el);
    setAnimatedNumber(positionEarnAnimationByElement, el, profit, formatSignedUsdt, {
      enabled: true,
      durationMs: RESULT_NUMBER_ANIM_MS,
    });
    if (profit > 0) {
      el.classList.add('text-gain');
    } else if (profit < 0) {
      el.classList.add('text-loss');
    } else {
      el.classList.add('text-muted');
    }
  });
}

function setSpotChange(el: HTMLElement | null, value: number | null): void {
  if (!el) return;

  const isValid = typeof value === 'number' && Number.isFinite(value);
  if (!isValid) {
    setAnimatedFallbackText(el, spotStripChangeAnimationByElement, POSITIONS_COPY.noData);
    el.classList.remove('text-gain', 'text-loss');
    el.classList.add('text-muted');
    return;
  }

  const next = value as number;
  el.classList.remove('text-gain', 'text-loss', 'text-muted');
  if (next > 0) {
    el.classList.add('text-gain');
  } else if (next < 0) {
    el.classList.add('text-loss');
  } else {
    el.classList.add('text-muted');
  }

  stopValueAnimation(textAnimationByElement, el);
  setAnimatedNumber(
    spotStripChangeAnimationByElement,
    el,
    next,
    (current) => formatSpotChange(current),
    { enabled: true, durationMs: RESULT_NUMBER_ANIM_MS, allowRememberedStart: false },
  );
}

function setSpotLoading(el: HTMLElement | null): void {
  if (!el) return;
  stopValueAnimation(spotStripValueAnimationByElement, el);
  delete el.dataset.numericValue;
  el.classList.remove('text-muted');
  el.innerHTML = skeletonSpan(SPOT_VALUE_SKELETON_WIDTH);
}

function setSpotChangeLoading(el: HTMLElement | null): void {
  if (!el) return;
  stopValueAnimation(spotStripChangeAnimationByElement, el);
  delete el.dataset.numericValue;
  el.classList.remove('text-gain', 'text-loss', 'text-muted');
  el.innerHTML = skeletonSpan(SPOT_CHANGE_SKELETON_WIDTH);
}

function buildSpotAssetData(spotAssets: string[], snapshot: AssetPriceSnapshot): SpotAssetData[] {
  return sortSpotAssets(spotAssets).map((asset) => ({
    asset,
    spotPrice: snapshot.priceByAsset[asset] ?? 0,
    changePercent24h: snapshot.changePercent24hByAsset?.[asset] ?? null,
  }));
}

function bindSpotItemLogo(cardEl: HTMLElement, asset: string): void {
  const logoEl = cardEl.querySelector('.positions-spot-logo') as HTMLImageElement | null;
  const fallbackEl = cardEl.querySelector('.positions-spot-fallback') as HTMLElement | null;
  if (!logoEl || !fallbackEl) return;

  const sources = resolveAssetLogoSources(asset);
  const monogram = createAssetMonogram(asset);
  fallbackEl.textContent = monogram;
  fallbackEl.style.display = 'none';
  logoEl.style.display = '';
  logoEl.alt = sources.alt;

  let fallbackIndex = 0;
  logoEl.onerror = () => {
    const fallbackSrc = sources.fallbackSrcs[fallbackIndex];
    if (fallbackSrc) {
      fallbackIndex += 1;
      logoEl.src = fallbackSrc;
      return;
    }
    logoEl.style.display = 'none';
    fallbackEl.style.display = 'inline-flex';
  };
  logoEl.onload = () => {
    logoEl.style.display = '';
    fallbackEl.style.display = 'none';
  };
  if (sources.primarySrc) {
    logoEl.src = sources.primarySrc;
  } else {
    logoEl.style.display = 'none';
    fallbackEl.style.display = 'inline-flex';
  }
}

function createSpotItem(asset: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'spot-item';
  item.id = `positions-spot-${asset}`;
  item.innerHTML = renderSpotItemTemplate(asset);
  bindSpotItemLogo(item, asset);
  return item;
}

function renderPositionTablesMarkup(positions: DualPosition[]): string {
  const buyLow = positions.filter((p) => p.direction === 'buy-low');
  const sellHigh = positions.filter((p) => p.direction === 'sell-high');

  return `
    ${buyLow.length > 0 ? renderPositionGroup(POSITIONS_COPY.buyLowTitle, buyLow) : ''}
    ${sellHigh.length > 0 ? renderPositionGroup(POSITIONS_COPY.sellHighTitle, sellHigh) : ''}
  `;
}

interface ExchangeSyncEventDetail {
  snapshot: BinancePortfolioSnapshot;
  previousPositionsKey?: string;
}

function readExchangeSyncEventDetail(event: Event): ExchangeSyncEventDetail | null {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== 'object') return null;
  const candidate = detail as Partial<ExchangeSyncEventDetail>;
  const snapshot = candidate.snapshot;
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (!Array.isArray(snapshot.positions) || !Array.isArray(snapshot.balances)) return null;
  return candidate as ExchangeSyncEventDetail;
}

function shouldRenderPositionTables(
  tablesContainer: Element,
  positions: DualPosition[],
  forceRender: boolean,
): boolean {
  if (forceRender) return true;
  const hasRows = tablesContainer.querySelector('[data-id]') !== null;
  const hasEmptyState = tablesContainer.querySelector('.positions-empty-state') !== null;
  if (positions.length > 0) return !hasRows;
  return !hasEmptyState;
}

function updatePositionTables(
  container: HTMLElement,
  positions: DualPosition[],
  options: { forceRender: boolean; hasApi: boolean },
): void {
  const tablesContainer = container.querySelector('#positions-tables-container');
  if (!tablesContainer) return;
  if (!shouldRenderPositionTables(tablesContainer, positions, options.forceRender)) return;

  if (positions.length > 0) {
    tablesContainer.innerHTML = renderPositionTablesMarkup(positions);
    bindAssetLogoFallbacks(tablesContainer);
    return;
  }

  tablesContainer.innerHTML = renderPositionsEmptyState(options.hasApi);
}

function updateSpotStrip(
  container: HTMLElement,
  positions: DualPosition[],
  snapshot: AssetPriceSnapshot | null,
): void {
  const stripEl = container.querySelector('#positions-spot-strip') as HTMLElement | null;
  if (!stripEl) return;

  if (positions.length === 0) {
    stripEl.replaceChildren();
    stripEl.hidden = true;
    return;
  }

  const stripAssets = getSpotStripAssets(positions);
  const orderedAssets = sortSpotAssets(stripAssets);

  const hydratedAssets = snapshot ? buildSpotAssetData(orderedAssets, snapshot) : [];
  if (snapshot && hydratedAssets.length === 0) {
    stripEl.replaceChildren();
    stripEl.hidden = true;
    return;
  }

  stripEl.hidden = false;
  const cards: HTMLElement[] = [];

  if (snapshot) {
    hydratedAssets.forEach(({ asset, spotPrice, changePercent24h }) => {
      const existing = stripEl.querySelector(`#positions-spot-${asset}`) as HTMLElement | null;
      const card = existing ?? createSpotItem(asset);
      const valueEl = card.querySelector(`#positions-spot-value-${asset}`) as HTMLElement | null;
      const changeEl = card.querySelector(`#positions-spot-change-${asset}`) as HTMLElement | null;
      setSpotValue(valueEl, spotPrice);
      setSpotChange(changeEl, changePercent24h);
      cards.push(card);
    });
  } else {
    orderedAssets.forEach((asset) => {
      const existing = stripEl.querySelector(`#positions-spot-${asset}`) as HTMLElement | null;
      const card = existing ?? createSpotItem(asset);
      const valueEl = card.querySelector(`#positions-spot-value-${asset}`) as HTMLElement | null;
      const changeEl = card.querySelector(`#positions-spot-change-${asset}`) as HTMLElement | null;
      setSpotLoading(valueEl);
      setSpotChangeLoading(changeEl);
      cards.push(card);
    });
  }

  // Reinsertar una tarjeta que ya esta donde toca la saca y la vuelve a meter
  // en el DOM, y eso reinicia sus transiciones justo cuando su cifra acaba de
  // animarse. Solo se toca el riel cuando la lista cambia de verdad.
  const current = [...stripEl.children];
  const isUnchanged =
    current.length === cards.length && cards.every((card, index) => current[index] === card);
  if (!isUnchanged) stripEl.replaceChildren(...cards);
}

function createUnavailableSpotSnapshot(positions: DualPosition[]): AssetPriceSnapshot {
  const assets = getSpotStripAssets(positions);
  const priceByAsset: Record<string, number> = {};
  const sourceByAsset: Record<string, 'unavailable'> = {};
  const changePercent24hByAsset: Record<string, number | null> = {};
  assets.forEach((asset) => {
    priceByAsset[asset] = 0;
    sourceByAsset[asset] = 'unavailable';
    changePercent24hByAsset[asset] = null;
  });

  return {
    priceByAsset,
    sourceByAsset,
    marketLastUpdatedAt: null,
    hasStalePrices: false,
    hasUnavailablePrices: assets.length > 0,
    changePercent24hByAsset,
  };
}

// ── Auto mode helpers ──

function applyPositionMarketData(
  container: HTMLElement,
  positions: DualPosition[],
  snapshot: AssetPriceSnapshot,
  metrics: PositionMetrics,
): boolean {
  const aprEl = container.querySelector('#positions-apr') as HTMLElement | null;
  const capitalEl = container.querySelector('#positions-capital') as HTMLElement | null;
  const dailyEl = container.querySelector('#positions-daily') as HTMLElement | null;
  if (!aprEl || !capitalEl || !dailyEl) return false;

  const hasSubMinuteCountdown = updateRemainingTimesInPlace(container, positions);
  registerApiLastUpdatedAt(snapshot.marketLastUpdatedAt);

  aprEl.style.color =
    metrics.weightedApr > 0
      ? 'var(--ink)'
      : metrics.weightedApr < 0
        ? 'var(--loss)'
        : 'var(--ink-3)';
  if (Number.isFinite(metrics.weightedApr) && metrics.weightedApr !== 0) {
    setStatPercent(aprEl, metrics.weightedApr, true);
  } else {
    setStatText(aprEl, '---', true);
  }

  if (metrics.totalUsd > 0) {
    setStatCurrency(capitalEl, metrics.totalUsd, true);
  } else {
    setStatText(capitalEl, '---', true);
  }

  dailyEl.style.color =
    metrics.dailyEarningsUsd > 0
      ? 'var(--gain)'
      : metrics.dailyEarningsUsd < 0
        ? 'var(--loss)'
        : 'var(--ink-3)';
  if (Number.isFinite(metrics.dailyEarningsUsd) && metrics.dailyEarningsUsd !== 0) {
    setStatCurrency(dailyEl, metrics.dailyEarningsUsd, true);
  } else {
    setStatText(dailyEl, '---', true);
  }

  if (snapshot.hasStalePrices || snapshot.hasUnavailablePrices) {
    registerApiFailure();
    showApiErrorBanner(POSITIONS_COPY.marketError);
  }

  updateSpotStrip(container, positions, snapshot);
  updateDualPositionAprs(container, positions, metrics);
  updateDiscountBuyAprs(container, positions, snapshot);
  updateDiscountBuyEarnings(container, positions, snapshot);

  positions.forEach((position) => {
    const rowEl = container.querySelector(`#position-usd-${position.id}`) as HTMLElement | null;
    const usdValue = metrics.usdByPositionId[position.id] ?? 0;
    setPositionUsdValue(rowEl, usdValue);

    if (position.components && position.amount > 0) {
      position.components.forEach((component) => {
        const componentRowEl = container.querySelector(
          `#position-usd-${position.id}-comp-${component.id}`,
        ) as HTMLElement | null;
        if (!componentRowEl) return;
        const ratio = component.amount / position.amount;
        const componentUsdValue = usdValue * ratio;
        setPositionUsdValue(componentRowEl, componentUsdValue);
      });
    }
  });

  return hasSubMinuteCountdown;
}

async function applySyncedPositionSnapshot(
  container: HTMLElement,
  snapshot: BinancePortfolioSnapshot,
  previousPositionsKey: string,
  forceRefresh: boolean,
): Promise<void> {
  const { positions: synced, count } = snapshot;
  const nextPositionsKey = getPositionsCacheKey(synced);
  setPositionsCount(container.querySelector('#positions-count'), count, true);
  updatePositionTables(container, synced, {
    forceRender: previousPositionsKey !== nextPositionsKey,
    hasApi: hasAnyExchangeApiCredentials(),
  });
  await hydratePositionMarketData(container, synced, forceRefresh);
}

async function performAutoSync(container: HTMLElement, forceRefresh = false): Promise<void> {
  const syncBtn = document.getElementById('btn-sync-positions') as HTMLButtonElement | null;
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.classList.add('syncing');
  }

  try {
    const previousPositionsKey = getPositionsCacheKey(loadState().positions);
    const snapshot = await syncPositionsFromBinance(forceRefresh);
    rememberAutoPortfolioSnapshot(snapshot);
    rememberBalanceSummary({
      balances: snapshot.balances,
      totalUsdEstimate: snapshot.totalUsdEstimate,
      accountReport: snapshot.accountReport,
    });

    await applySyncedPositionSnapshot(container, snapshot, previousPositionsKey, forceRefresh);
  } catch (err) {
    if (typeof process !== 'undefined' ? process.env.PUBLIC_APP_ENV !== 'production' : true)
      console.warn('[positions] Auto-sync failed:', err);
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    showApiErrorBanner(`No se pudieron sincronizar las posiciones desde Binance: ${msg}`);
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.classList.remove('syncing');
    }
  }
}

export function renderPositions(container: HTMLElement, onStateChange: () => void): () => void {
  const state = loadState();
  const { positions } = state;
  const activeCount = countPositionSubscriptions(positions);

  // Separate by direction
  const buyLow = positions.filter((p) => p.direction === 'buy-low');
  const sellHigh = positions.filter((p) => p.direction === 'sell-high');

  container.innerHTML = renderPositionsTemplate({
    connectedExchanges: listConnectedExchanges(),
    activeCount,
    buyLowMarkup: buyLow.length > 0 ? renderPositionGroup(POSITIONS_COPY.buyLowTitle, buyLow) : '',
    sellHighMarkup:
      sellHigh.length > 0 ? renderPositionGroup(POSITIONS_COPY.sellHighTitle, sellHigh) : '',
    hasPositions: positions.length > 0,
  });

  bindAssetLogoFallbacks(container);
  bindPositionEvents(container);
  updateSpotStrip(container, positions, null);

  // Listen for config changes (credentials added or removed)
  const unsubConfig = onApiConfigChange(() => {
    onStateChange();
  });

  let disposed = false;
  let latestKnownPositions = positions;
  let remainingTicker: ReturnType<typeof setInterval> | null = null;
  const syncRemainingTicker = (hasSubMinuteCountdown: boolean): void => {
    if (hasSubMinuteCountdown) {
      if (remainingTicker) return;
      remainingTicker = setInterval(() => {
        if (disposed || !container.isConnected) return;
        const stillHasSubMinute = updateRemainingTimesInPlace(container, latestKnownPositions, {
          subMinuteOnly: true,
        });
        if (!stillHasSubMinute && remainingTicker) {
          clearInterval(remainingTicker);
          remainingTicker = null;
        }
      }, ONE_SECOND_MS);
      return;
    }

    if (!remainingTicker) return;
    clearInterval(remainingTicker);
    remainingTicker = null;
  };

  const handleExchangeSyncComplete = (event: Event): void => {
    const detail = readExchangeSyncEventDetail(event);
    if (!detail || disposed) return;
    const previousKey = detail.previousPositionsKey ?? getPositionsCacheKey(latestKnownPositions);
    void applySyncedPositionSnapshot(container, detail.snapshot, previousKey, false).then(() => {
      latestKnownPositions = detail.snapshot.positions;
      syncRemainingTicker(updateRemainingTimesInPlace(container, latestKnownPositions));
    });
  };

  const handlePortfolioStateUpdated = (): void => {
    if (disposed) return;
    const latestPositions = loadState().positions;
    const previousKey = getPositionsCacheKey(latestKnownPositions);
    const nextKey = getPositionsCacheKey(latestPositions);
    setPositionsCount(
      container.querySelector('#positions-count'),
      countPositionSubscriptions(latestPositions),
      true,
    );
    updatePositionTables(container, latestPositions, {
      forceRender: previousKey !== nextKey,
      hasApi: hasAnyExchangeApiCredentials(),
    });
    latestKnownPositions = latestPositions;
    void hydratePositionMarketData(container, latestPositions, false).then((hasSubMinute) => {
      syncRemainingTicker(hasSubMinute);
    });
  };

  const handlePortfolioTabVisible = (): void => {
    if (disposed) return;
    if (!hasAnyExchangeApiCredentials()) {
      handlePortfolioStateUpdated();
      return;
    }
    void performAutoSync(container, true).then(() => {
      latestKnownPositions = loadState().positions;
      syncRemainingTicker(updateRemainingTimesInPlace(container, latestKnownPositions));
    });
  };

  window.addEventListener('exchange-sync-complete', handleExchangeSyncComplete);
  window.addEventListener('portfolio-state-updated', handlePortfolioStateUpdated);
  window.addEventListener('portfolio-tab-visible', handlePortfolioTabVisible);

  const runInitialHydration = async (): Promise<void> => {
    if (disposed || !container.isConnected) return;

    if (hasAnyExchangeApiCredentials() && !getCachedAutoPortfolioSnapshot()) {
      await performAutoSync(container, false);
      latestKnownPositions = loadState().positions;
      syncRemainingTicker(updateRemainingTimesInPlace(container, latestKnownPositions));
      return;
    }

    latestKnownPositions = loadState().positions;
    syncRemainingTicker(await hydratePositionMarketData(container, latestKnownPositions, false));
  };

  void runInitialHydration();

  const unsubscribeMarket = subscribeToMarketTicks(async (forceRefresh) => {
    if (disposed || !container.isConnected) return;

    if (hasAnyExchangeApiCredentials()) {
      await performAutoSync(container, forceRefresh);
      const { positions: syncedPositions } = loadState();
      latestKnownPositions = syncedPositions;
      syncRemainingTicker(updateRemainingTimesInPlace(container, latestKnownPositions));
      return;
    }

    const { positions: latestPositions } = loadState();
    latestKnownPositions = latestPositions;
    syncRemainingTicker(await hydratePositionMarketData(container, latestPositions, forceRefresh));
  }, false);

  return () => {
    disposed = true;
    unsubscribeMarket();
    unsubConfig();
    window.removeEventListener('exchange-sync-complete', handleExchangeSyncComplete);
    window.removeEventListener('portfolio-state-updated', handlePortfolioStateUpdated);
    window.removeEventListener('portfolio-tab-visible', handlePortfolioTabVisible);
    if (remainingTicker) clearInterval(remainingTicker);
  };
}

async function hydratePositionMarketData(
  container: HTMLElement,
  positions: DualPosition[],
  forceRefresh = false,
): Promise<boolean> {
  const aprEl = container.querySelector('#positions-apr') as HTMLElement | null;
  const capitalEl = container.querySelector('#positions-capital') as HTMLElement | null;
  const dailyEl = container.querySelector('#positions-daily') as HTMLElement | null;
  if (!aprEl || !capitalEl || !dailyEl) return false;

  if (positions.length === 0) {
    setStatText(aprEl, '---', true);
    setStatText(capitalEl, '---', true);
    setStatText(dailyEl, '---', true);
    updateSpotStrip(container, positions, null);
    return false;
  }

  const hasSubMinuteCountdown = updateRemainingTimesInPlace(container, positions);

  try {
    const { snapshot, metrics } = await getSharedMarketData(positions, forceRefresh);
    return applyPositionMarketData(container, positions, snapshot, metrics);
  } catch (err) {
    if (typeof process !== 'undefined' ? process.env.PUBLIC_APP_ENV !== 'production' : true)
      console.warn('[Positions] market hydration failed:', err);
    registerApiFailure();
    showApiErrorBanner(POSITIONS_COPY.marketError);
    updateSpotStrip(container, positions, createUnavailableSpotSnapshot(positions));
  }

  return hasSubMinuteCountdown;
}

function bindPositionEvents(container: HTMLElement): void {
  // ── Component sub-row toggle ──
  container.querySelectorAll<HTMLElement>('[data-toggle-components]').forEach((toggle) => {
    const toggleRow = toggle.closest('tr');
    if (!toggleRow) return;

    const handleToggle = (e: Event) => {
      e.stopPropagation();
      let sibling = toggleRow.nextElementSibling;
      const isExpanding =
        sibling?.classList.contains('pos-sub-row') && (sibling as HTMLElement).hidden;
      while (sibling && sibling.classList.contains('pos-sub-row')) {
        (sibling as HTMLElement).hidden = !isExpanding;
        sibling = sibling.nextElementSibling;
      }
      toggle.setAttribute('aria-expanded', String(isExpanding));
      toggleRow.classList.toggle('pos-toggle-expanded', isExpanding);
    };
    toggle.addEventListener('click', handleToggle);

    // El par de monedas comparte el area pulsable con el canalon: lo que se
    // despliega es la posicion, y esa es la parte de la fila que la nombra. El
    // control accesible sigue siendo uno solo, el del canalon, que es quien
    // lleva el aria-expanded.
    const assetCell = toggleRow.querySelector<HTMLElement>('td[data-field="asset"]');
    if (!assetCell) return;
    assetCell.classList.add('is-toggle-target');
    assetCell.addEventListener('click', handleToggle);
  });
}
