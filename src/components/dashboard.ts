import { loadState, updateBalance, SIMULATOR_VIEW_KEY } from '../utils/storage';
import type { WalletIssue } from '../utils/binance-client';
import { formatUSD, formatPct, formatDateLatin } from '../utils/calculator';
import { registerApiFailure, registerApiLastUpdatedAt } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import {
  fetchBalanceSummary,
  hasAnyExchangeApiCredentials,
  listConnectedExchanges,
  syncPositionsFromBinance,
} from '../utils/binance-sync';
import {
  getCachedAutoPortfolioSnapshot,
  getCachedBalanceSummary,
  getSharedMarketData,
  rememberAutoPortfolioSnapshot,
  rememberBalanceSummary,
} from '../utils/api-runtime-cache';
import { onApiConfigChange } from './positions/api-config-modal';
import {
  formatDashboardDurationLabel,
  resolveDashboardGoalDetails,
  sanitizeDashboardLegendState,
  toggleDashboardLegend,
} from '../utils/dashboard-goal';
import { buildProjectionSnapshot } from '../utils/projection-milestones';
import {
  combinePortfolioYieldMetrics,
  getAggregatedPortfolioMetrics,
  type CombinedPortfolioYieldMetrics,
} from '../utils/portfolio-aggregation';
import { subscribeToMarketTicks } from '../utils/market-poller';
import { setAnimatedNumber, setAnimatedText, stopValueAnimation } from '../utils/animation';
import { sanitizeFrequency } from './simulator.state';
import {
  clearDashboardLegendState,
  loadDashboardLegendState,
  saveDashboardLegendState,
} from './dashboard.state';
import { getDashboardElements } from './dashboard.dom';
import {
  AUTO_BALANCE_SYNC_COOLDOWN_MS,
  DASHBOARD_BALANCE_VISIBLE_ITEMS,
  DASHBOARD_COPY,
  GOAL_NUMBER_ANIM_MS,
} from './dashboard.constants';
import {
  applyProgressTickLayout,
  formatBalanceAmount,
  getDashboardBalanceKey,
  renderBalanceDetailRows,
  formatBalanceNote,
  renderBalanceEmptyState,
  renderDashboardTemplate,
  resolveProgressTickLayout,
} from './dashboard.template';
import type {
  AppState,
  BinanceAccountBalance,
  CompoundFrequency,
  DashboardGoalMode,
  DashboardLegendState,
  ExchangeSource,
} from '../types';

let lastAutoBalanceSyncAt = 0;
let dashboardLegendState: DashboardLegendState = sanitizeDashboardLegendState(undefined);

interface DashboardRenderOptions {
  forceRefreshOnMount?: boolean;
}

const valueAnimationByElement = new WeakMap<HTMLElement, number>();
const daysAnimationByElement = new WeakMap<HTMLElement, number>();
const textAnimationByElement = new WeakMap<HTMLElement, number>();
const balanceDetailAnimationByElement = new WeakMap<HTMLElement, number>();

export function resetDashboardLegendStateForTests(): void {
  clearDashboardLegendState();
  dashboardLegendState = sanitizeDashboardLegendState(undefined);
}

interface DashboardUiState {
  balance: number;
  invested: number;
  goal: number;
  apr: number | null;
  earningCapital: number | null;
  frequency: CompoundFrequency;
}

interface GoalVisualUpdateOptions {
  animateNumbers?: boolean;
  animateText?: boolean;
}

function progressPct(balance: number, target: number): number {
  if (!Number.isFinite(balance) || !Number.isFinite(target) || target <= 0) return 0;
  return (balance / target) * 100;
}

function clampProgress(pct: number): number {
  return Math.max(0, Math.min(pct, 100));
}

function progressScaleTarget(invested: number, goal: number): number {
  const maxTarget = Math.max(invested, goal);
  return Number.isFinite(maxTarget) && maxTarget > 0 ? maxTarget : 1;
}

function progressMarkerPct(target: number, scaleTarget: number): number {
  return clampProgress(progressPct(target, scaleTarget));
}

function setCurrencyOutput(
  el: HTMLElement | null,
  value: number,
  animate: boolean,
  durationMs = 180,
): void {
  if (!el) return;
  stopValueAnimation(textAnimationByElement, el);
  setAnimatedNumber(valueAnimationByElement, el, value, (next) => formatUSD(next), {
    enabled: animate,
    durationMs,
    allowRememberedStart: false,
  });
}

function setPercentOutput(
  el: HTMLElement | null,
  value: number,
  animate: boolean,
  signed = false,
  durationMs = 180,
): void {
  if (!el) return;
  stopValueAnimation(textAnimationByElement, el);
  setAnimatedNumber(
    valueAnimationByElement,
    el,
    value,
    (next) => (signed ? formatPct(next) : `${next.toFixed(2)}%`),
    { enabled: animate, durationMs, allowRememberedStart: false },
  );
}

function animateTextSwap(el: HTMLElement | null, text: string, enabled: boolean): void {
  if (!el) return;
  setAnimatedText(textAnimationByElement, el, text, {
    enabled,
    mode: 'fade',
    className: 'text-swap',
  });
}

function animateTextScramble(el: HTMLElement | null, text: string, enabled: boolean): void {
  if (!el) return;
  setAnimatedText(textAnimationByElement, el, text, {
    enabled,
    mode: 'scramble',
    className: 'text-swap',
    durationMs: 180,
  });
}

function setStaticTextOutput(el: HTMLElement | null, text: string): void {
  if (!el) return;
  stopValueAnimation(valueAnimationByElement, el);
  stopValueAnimation(textAnimationByElement, el);
  delete el.dataset.numericValue;
  el.textContent = text;
}

function setTextResult(el: HTMLElement | null, text: string, animate: boolean): void {
  if (!el) return;
  stopValueAnimation(valueAnimationByElement, el);
  delete el.dataset.numericValue;
  animateTextSwap(el, text, animate);
}

function readSimulatorFrequency(fallback: CompoundFrequency): CompoundFrequency {
  try {
    const raw = localStorage.getItem(SIMULATOR_VIEW_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { frequency?: unknown };
    return sanitizeFrequency(parsed.frequency, fallback);
  } catch (err) {
    if (typeof process !== 'undefined' ? process.env.PUBLIC_APP_ENV !== 'production' : true) {
      console.warn('[dashboard] failed to read simulator frequency', err);
    }
    return fallback;
  }
}

function estimateDaysToTargetWithProjectionSnapshot(
  capital: number,
  earningCapital: number,
  apr: number,
  target: number,
  invested: number,
  frequency: CompoundFrequency,
): number | null {
  if (
    !Number.isFinite(capital) ||
    !Number.isFinite(earningCapital) ||
    !Number.isFinite(apr) ||
    !Number.isFinite(target) ||
    !Number.isFinite(invested)
  ) {
    return null;
  }
  if (capital <= 0 || earningCapital <= 0 || apr <= 0 || target <= 0) return null;

  const snapshot = buildProjectionSnapshot({
    capital,
    earningCapital,
    apr,
    frequency,
    goal: target,
    invested,
  });
  return snapshot.goal.days;
}

function modeToClass(mode: DashboardGoalMode): string {
  if (mode === 'be') return 'mode-be';
  if (mode === 'goal') return 'mode-goal';
  return 'mode-both';
}

function syncGoalProgressAccessibility(
  container: HTMLElement,
  balance: number,
  details: ReturnType<typeof resolveDashboardGoalDetails>,
): void {
  const { goalBar } = getDashboardElements(container);
  if (!goalBar) return;

  const pct =
    details.targetAmount > 0 ? clampProgress(progressPct(balance, details.targetAmount)) : 0;
  goalBar.setAttribute('aria-valuenow', String(Math.round(pct)));
  goalBar.setAttribute(
    'aria-valuetext',
    `${formatUSD(balance)} de ${formatUSD(details.targetAmount)} hacia ${details.targetLabelLong}`,
  );
}

function setDaysLabel(
  container: HTMLElement,
  value: string,
  highlight: boolean,
  animate = false,
): void {
  const { goalDays, goalDaysSeparator } = getDashboardElements(container);
  if (!goalDays || !goalDaysSeparator) return;

  stopValueAnimation(daysAnimationByElement, goalDays);
  delete goalDays.dataset.numericValue;
  animateTextSwap(goalDays, value, animate);
  goalDays.style.color = highlight ? 'var(--ink)' : 'var(--ink-3)';
  goalDaysSeparator.style.display = value ? 'inline-block' : 'none';
}

function setDaysDurationLabel(
  container: HTMLElement,
  totalDays: number,
  highlight: boolean,
  animate = false,
): void {
  const { goalDays, goalDaysSeparator } = getDashboardElements(container);
  if (!goalDays || !goalDaysSeparator) return;

  goalDays.style.color = highlight ? 'var(--ink)' : 'var(--ink-3)';
  goalDaysSeparator.style.display = 'inline-block';
  setAnimatedNumber(
    daysAnimationByElement,
    goalDays,
    Math.max(0, totalDays),
    (next) => formatDashboardDurationLabel(next),
    {
      enabled: animate,
      durationMs: GOAL_NUMBER_ANIM_MS,
      epsilon: 0.01,
      allowRememberedStart: false,
    },
  );
}

function updateLegendButtons(container: HTMLElement): void {
  const { legendBreakEven, legendGoal } = getDashboardElements(container);
  if (!legendBreakEven || !legendGoal) return;

  legendBreakEven.classList.toggle('is-active', dashboardLegendState.be);
  legendBreakEven.classList.toggle('is-inactive', !dashboardLegendState.be);
  legendBreakEven.setAttribute('aria-pressed', dashboardLegendState.be ? 'true' : 'false');

  legendGoal.classList.toggle('is-active', dashboardLegendState.goal);
  legendGoal.classList.toggle('is-inactive', !dashboardLegendState.goal);
  legendGoal.setAttribute('aria-pressed', dashboardLegendState.goal ? 'true' : 'false');
}

function updateGoalProgressVisual(
  container: HTMLElement,
  uiState: DashboardUiState,
  options: GoalVisualUpdateOptions = {},
): void {
  const animateNumbers = options.animateNumbers === true;
  const animateText = options.animateText === true;

  dashboardLegendState = sanitizeDashboardLegendState(dashboardLegendState);
  const details = resolveDashboardGoalDetails(
    uiState.balance,
    uiState.invested,
    uiState.goal,
    dashboardLegendState,
  );
  const elements = getDashboardElements(container);

  let firstMilestonePct: number;
  let secondMilestonePct: number;
  let firstSolidPct: number;
  let secondSolidPct: number;

  if (details.mode === 'both') {
    const progressScale = progressScaleTarget(uiState.invested, uiState.goal);
    const progressFill = clampProgress(progressPct(uiState.balance, progressScale));
    firstMilestonePct = progressMarkerPct(uiState.invested, progressScale);
    secondMilestonePct = progressMarkerPct(uiState.goal, progressScale);
    firstSolidPct = Math.min(progressFill, firstMilestonePct);
    secondSolidPct = Math.max(0, Math.min(progressFill, secondMilestonePct) - firstMilestonePct);
  } else {
    const progressFill = clampProgress(progressPct(uiState.balance, details.targetAmount));
    firstMilestonePct = 100;
    firstSolidPct = progressFill;
    secondSolidPct = 0;
    secondMilestonePct = 0;
  }

  if (
    !elements.goalBar ||
    !elements.goalMutedFirst ||
    !elements.goalMutedSecond ||
    !elements.goalSolidFirst ||
    !elements.goalSolidSecond
  ) {
    return;
  }

  elements.goalBar.classList.remove('mode-be', 'mode-goal', 'mode-both');
  elements.goalBar.classList.add(modeToClass(details.mode));

  applyProgressTickLayout(
    elements.goalHead,
    elements.goalTickBreakEven,
    elements.goalTickGoal,
    resolveProgressTickLayout({
      mode: details.mode,
      invested: uiState.invested,
      goal: uiState.goal,
      bePct: details.mode === 'both' ? firstMilestonePct : 100,
      goalPct: details.mode === 'both' ? secondMilestonePct : 100,
    }),
  );

  elements.goalMutedFirst.style.width = `${firstMilestonePct}%`;
  elements.goalMutedSecond.style.left = `${firstMilestonePct}%`;
  elements.goalMutedSecond.style.width = `${Math.max(0, secondMilestonePct - firstMilestonePct)}%`;
  elements.goalSolidFirst.style.width = `${firstSolidPct}%`;
  elements.goalSolidSecond.style.left = `${firstMilestonePct}%`;
  elements.goalSolidSecond.style.width = `${secondSolidPct}%`;

  setCurrencyOutput(
    elements.goalTargetAmount,
    details.targetAmount,
    animateNumbers,
    GOAL_NUMBER_ANIM_MS,
  );
  animateTextScramble(elements.goalTargetLabel, details.targetLabelShort, animateText);

  if (details.isReached) {
    animateTextSwap(
      elements.goalRemainingText,
      `${details.targetLabelShort} ${DASHBOARD_COPY.reachedSuffix}`,
      animateText,
    );
    if (elements.goalRemainingAmount) elements.goalRemainingAmount.style.display = 'none';
    if (elements.goalRemainingPrefix) elements.goalRemainingPrefix.style.display = 'none';
    if (elements.goalRemainingTarget) elements.goalRemainingTarget.style.display = 'none';
  } else {
    animateTextSwap(elements.goalRemainingText, DASHBOARD_COPY.remainingText, animateText);
    if (elements.goalRemainingAmount) {
      elements.goalRemainingAmount.style.display = 'inline';
      setCurrencyOutput(
        elements.goalRemainingAmount,
        details.remainingAmount,
        animateNumbers,
        GOAL_NUMBER_ANIM_MS,
      );
    }
    if (elements.goalRemainingPrefix) elements.goalRemainingPrefix.style.display = 'inline';
    if (elements.goalRemainingTarget) {
      elements.goalRemainingTarget.style.display = 'inline';
      animateTextScramble(
        elements.goalRemainingTarget,
        details.target === 'be'
          ? DASHBOARD_COPY.breakEvenTargetText
          : DASHBOARD_COPY.goalTargetText,
        animateText,
      );
    }
  }

  if (details.isReached) {
    setDaysLabel(
      container,
      `${details.targetLabelShort} ${DASHBOARD_COPY.reachedSuffix}`,
      true,
      animateText,
    );
  } else if (
    uiState.apr &&
    uiState.apr > 0 &&
    uiState.earningCapital &&
    uiState.earningCapital > 0
  ) {
    const daysRemaining = estimateDaysToTargetWithProjectionSnapshot(
      uiState.balance,
      uiState.earningCapital,
      uiState.apr,
      details.targetAmount,
      uiState.invested,
      uiState.frequency,
    );

    if (daysRemaining !== null) {
      setDaysDurationLabel(container, daysRemaining, true, animateNumbers);
    } else {
      setDaysLabel(container, '', false, animateText);
    }
  } else {
    setDaysLabel(container, '', false, animateText);
  }

  syncGoalProgressAccessibility(container, uiState.balance, details);
  updateLegendButtons(container);
}

function updateDashboardSummaryVisual(
  container: HTMLElement,
  uiState: DashboardUiState,
  lastUpdatedIso: string,
  animate: boolean,
): void {
  const loss = uiState.balance - uiState.invested;
  const lossPct = uiState.invested > 0 ? (loss / uiState.invested) * 100 : 0;
  const elements = getDashboardElements(container);

  setCurrencyOutput(elements.invested, uiState.invested, animate);
  setCurrencyOutput(elements.balance, uiState.balance, animate);
  setStaticTextOutput(elements.balanceDate, formatDateLatin(lastUpdatedIso));

  if (elements.pnl) {
    elements.pnl.className = loss >= 0 ? 'gain' : 'loss';
    setCurrencyOutput(elements.pnl, loss, animate);
  }

  if (elements.pnlPct) {
    elements.pnlPct.className = loss >= 0 ? 'gain' : 'loss';
    setPercentOutput(elements.pnlPct, lossPct, animate, true);
  }
}

function updateDashboardYieldStats(
  apr: HTMLElement,
  capital: HTMLElement,
  daily: HTMLElement,
  yieldMetrics: CombinedPortfolioYieldMetrics,
  animate: boolean,
): void {
  const hasApr =
    yieldMetrics.earningCapital > 0 &&
    Number.isFinite(yieldMetrics.weightedApr) &&
    yieldMetrics.weightedApr !== 0;
  apr.style.color =
    yieldMetrics.weightedApr < 0 ? 'var(--loss)' : hasApr ? 'var(--ink)' : 'var(--ink-3)';
  if (hasApr) {
    setPercentOutput(apr, yieldMetrics.weightedApr, animate, false);
  } else {
    setTextResult(apr, '---', animate);
  }

  if (yieldMetrics.capitalDisplayUsd > 0) {
    setCurrencyOutput(capital, yieldMetrics.capitalDisplayUsd, animate);
  } else {
    setTextResult(capital, '---', animate);
  }

  daily.style.color =
    yieldMetrics.dailyEarningsUsd < 0
      ? 'var(--loss)'
      : yieldMetrics.dailyEarningsUsd > 0
        ? 'var(--gain)'
        : 'var(--ink-3)';
  if (yieldMetrics.dailyEarningsUsd !== 0) {
    setCurrencyOutput(daily, yieldMetrics.dailyEarningsUsd, animate);
  } else {
    setTextResult(daily, '---', animate);
  }
}

/**
 * Un activo puede recibir saldo de varios exchanges a la vez (saldo de uno y
 * posiciones de otro), asi que la fila fusionada acumula todos los origenes en
 * vez de quedarse con el primero.
 */
function rememberBalanceSource(
  target: BinanceAccountBalance,
  source: ExchangeSource | undefined,
): void {
  if (!source) return;
  const sources = target.sources ?? [];
  if (!sources.includes(source)) sources.push(source);
  target.sources = sources;
}

function renderBalanceDetail(
  container: HTMLElement,
  balances: BinanceAccountBalance[] | null,
  positions: AppState['positions'] = [],
  walletIssues: WalletIssue[] = [],
): void {
  const { balanceStrip, balanceStripItems, balanceStripNote } = getDashboardElements(container);
  if (!balanceStrip || !balanceStripItems) return;

  if (balanceStripNote) {
    balanceStripNote.textContent = formatBalanceNote(walletIssues);
    balanceStripNote.classList.toggle('is-warn', walletIssues.length > 0);
  }

  const mergedByAsset = new Map<string, BinanceAccountBalance>();

  const mergeInto = (asset: string, free: number, locked: number, source?: ExchangeSource) => {
    const current = mergedByAsset.get(asset);
    if (current) {
      current.free += free;
      current.locked += locked;
      rememberBalanceSource(current, source);
      return;
    }

    const created: BinanceAccountBalance = { asset, free, locked };
    rememberBalanceSource(created, source);
    mergedByAsset.set(asset, created);
  };

  (balances ?? []).forEach((balance) => {
    const asset = balance.asset.trim().toUpperCase();
    if (!asset) return;
    mergeInto(asset, balance.free, balance.locked, balance.source);
  });

  positions.forEach((position) => {
    const asset = position.subscriptionAsset.trim().toUpperCase();
    const amount = position.amount;
    if (!asset || !Number.isFinite(amount) || amount <= 0) return;
    mergeInto(asset, 0, amount, position.source);
  });

  const relevant = [...mergedByAsset.values()]
    .map((balance) => ({ ...balance, total: balance.free + balance.locked }))
    .sort((left, right) => right.total - left.total)
    .slice(0, DASHBOARD_BALANCE_VISIBLE_ITEMS);

  balanceStrip.hidden = false;

  if (relevant.length === 0) {
    balanceStripItems.innerHTML = renderBalanceEmptyState();
    return;
  }

  updateBalanceDetailCards(balanceStripItems, relevant);
}

function sameBalanceCardStructure(
  container: HTMLElement,
  balances: BinanceAccountBalance[],
): boolean {
  const entries = [...container.querySelectorAll<HTMLElement>('.dashboard-balance-entry')];
  if (entries.length !== balances.length) return false;

  return entries.every((entry, index) => {
    return entry.dataset.balanceKey === getDashboardBalanceKey(balances[index]);
  });
}

function setBalanceDetailNumber(
  el: HTMLElement | null,
  value: number,
  formatter: (next: number) => string,
): void {
  if (!el) return;
  setAnimatedNumber(balanceDetailAnimationByElement, el, value, formatter, {
    enabled: true,
    durationMs: 180,
    allowRememberedStart: false,
  });
}

function updateBalanceDetailCards(container: HTMLElement, balances: BinanceAccountBalance[]): void {
  if (!sameBalanceCardStructure(container, balances)) {
    renderBalanceDetailRows(container, balances);
    return;
  }

  const entries = [...container.querySelectorAll<HTMLElement>('.dashboard-balance-entry')];
  entries.forEach((entry, index) => {
    const balance = balances[index];
    if (!balance) return;

    const totalEl = entry.querySelector<HTMLElement>('.dashboard-balance-total-value');
    const breakdownValues = entry.querySelectorAll<HTMLElement>(
      '.dashboard-balance-breakdown-value',
    );
    const lockedCell = entry.querySelector<HTMLElement>('.dashboard-balance-locked');
    const total = balance.free + balance.locked;

    setBalanceDetailNumber(
      totalEl,
      total,
      (next) => `${formatBalanceAmount(next)} ${balance.asset}`,
    );
    setBalanceDetailNumber(breakdownValues[0] ?? null, balance.free, formatBalanceAmount);
    setBalanceDetailNumber(breakdownValues[1] ?? null, balance.locked, formatBalanceAmount);
    lockedCell?.classList.toggle('is-locked', balance.locked > 0);
  });
}

function createInitialUiState(state: AppState): DashboardUiState {
  const aggregate = getAggregatedPortfolioMetrics(state);
  return {
    balance: aggregate.balance,
    invested: aggregate.invested,
    goal: aggregate.goal,
    apr: null,
    earningCapital: null,
    frequency: readSimulatorFrequency('daily'),
  };
}

function renderInitialDashboard(container: HTMLElement, state: AppState): DashboardUiState {
  const uiState = createInitialUiState(state);

  container.innerHTML = renderDashboardTemplate({
    balance: uiState.balance,
    goalAmount: uiState.goal,
    invested: uiState.invested,
    lastUpdatedIso: state.portfolio.lastUpdated,
    positionsCount: state.positions.length,
    connectedExchanges: listConnectedExchanges(),
    firstMilestonePct: 0,
    secondMilestonePct: 0,
    progressFill: 0,
    isLoading: true,
  });

  return uiState;
}

export function renderDashboard(
  container: HTMLElement,
  options: DashboardRenderOptions = {},
): () => void {
  const state = loadState();
  dashboardLegendState = loadDashboardLegendState(sanitizeDashboardLegendState(undefined));
  const forceRefreshOnMount = options.forceRefreshOnMount === true;

  const uiState = renderInitialDashboard(container, state);
  let disposed = false;
  let hasFirstMarketHydrationCompleted = false;

  const unsubConfig = onApiConfigChange(() => {
    const updatedState = loadState();
    const aggregate = getAggregatedPortfolioMetrics(updatedState);
    uiState.balance = aggregate.balance;
    uiState.invested = aggregate.invested;
    uiState.goal = aggregate.goal;
    uiState.frequency = readSimulatorFrequency(uiState.frequency);
    updateDashboardSummaryVisual(container, uiState, updatedState.portfolio.lastUpdated, true);
    updateGoalProgressVisual(container, uiState, { animateNumbers: true, animateText: true });
    void hydrateDashboardMarketStats(
      container,
      updatedState.positions,
      uiState,
      true,
      true,
    ).finally(() => {
      hasFirstMarketHydrationCompleted = true;
    });
  });

  bindGoalLegendEvents(container, uiState);

  void hydrateDashboardMarketStats(
    container,
    loadState().positions,
    uiState,
    forceRefreshOnMount,
    false,
  ).finally(() => {
    hasFirstMarketHydrationCompleted = true;
  });

  const unsubscribeMarket = subscribeToMarketTicks(async (forceRefresh) => {
    if (disposed || !container.isConnected) return;
    const { positions } = loadState();
    await hydrateDashboardMarketStats(
      container,
      positions,
      uiState,
      forceRefresh,
      hasFirstMarketHydrationCompleted,
    );
    hasFirstMarketHydrationCompleted = true;
  }, false);

  return () => {
    disposed = true;
    unsubscribeMarket();
    unsubConfig();
  };
}

function updateBalanceInPlace(
  container: HTMLElement,
  newBaseBalance: number,
  uiState: DashboardUiState,
  state: AppState,
  animateGoalSection = true,
): void {
  const aggregate = getAggregatedPortfolioMetrics(state, newBaseBalance);
  uiState.balance = aggregate.balance;
  uiState.invested = aggregate.invested;
  uiState.goal = aggregate.goal;
  uiState.frequency = readSimulatorFrequency(uiState.frequency);
  updateDashboardSummaryVisual(container, uiState, state.portfolio.lastUpdated, animateGoalSection);
}

function sumBalanceContributingPositionUsd(
  positions: AppState['positions'],
  usdByPositionId: Record<string, number>,
): number {
  return positions.reduce((total, position) => {
    if (position.positionKind === 'derivative') return total;
    return total + (usdByPositionId[position.id] ?? 0);
  }, 0);
}

async function hydrateDashboardMarketStats(
  container: HTMLElement,
  positions: AppState['positions'],
  uiState: DashboardUiState,
  forceRefresh = false,
  animateDynamicValues = true,
): Promise<void> {
  const { apr, capital, daily } = getDashboardElements(container);
  if (!apr || !capital || !daily) return;

  let currentState = loadState();
  uiState.balance = currentState.portfolio.currentBalance;
  uiState.invested = currentState.portfolio.totalInvested;
  uiState.goal = currentState.portfolio.goalAmount;
  uiState.frequency = readSimulatorFrequency(uiState.frequency);

  const shouldHydrateBinanceBalance = hasAnyExchangeApiCredentials();
  let autoBalanceSummary: Awaited<ReturnType<typeof fetchBalanceSummary>> | null = null;
  let effectivePositions = positions;

  if (shouldHydrateBinanceBalance) {
    try {
      const cachedAutoSnapshot = !forceRefresh ? getCachedAutoPortfolioSnapshot() : null;

      if (cachedAutoSnapshot) {
        effectivePositions = cachedAutoSnapshot.positions;
        autoBalanceSummary = {
          balances: cachedAutoSnapshot.balances,
          totalUsdEstimate: cachedAutoSnapshot.totalUsdEstimate,
        };
      } else {
        const syncedSnapshot = await syncPositionsFromBinance(forceRefresh);
        rememberAutoPortfolioSnapshot(syncedSnapshot);
        effectivePositions = syncedSnapshot.positions;
        autoBalanceSummary = {
          balances: syncedSnapshot.balances,
          totalUsdEstimate: syncedSnapshot.totalUsdEstimate,
        };
        rememberBalanceSummary(autoBalanceSummary);
      }
      currentState = loadState();

      const cachedBalanceSummary = !forceRefresh ? getCachedBalanceSummary() : null;
      if (!autoBalanceSummary && cachedBalanceSummary) {
        autoBalanceSummary = cachedBalanceSummary;
      }
      if (!autoBalanceSummary) {
        autoBalanceSummary = await fetchBalanceSummary(forceRefresh);
        rememberBalanceSummary(autoBalanceSummary);
      }
      renderBalanceDetail(
        container,
        autoBalanceSummary.balances,
        effectivePositions,
        autoBalanceSummary.walletIssues ?? [],
      );
    } catch {
      renderBalanceDetail(container, null);
    }
  } else {
    renderBalanceDetail(container, null);
  }

  setStaticTextOutput(
    getDashboardElements(container).positionsCount,
    String(effectivePositions.length),
  );

  if (effectivePositions.length === 0) {
    // Sin posiciones el saldo es solo el wallet reportado por los exchanges. Si
    // la sincronizacion no lo devolvio, se conserva el ultimo saldo guardado en
    // vez de escribir un cero que borraria el dato bueno.
    const walletOnlyBalance =
      Math.round(
        (autoBalanceSummary?.totalUsdEstimate ?? currentState.portfolio.currentBalance) * 100,
      ) / 100;
    const storedBalance = Math.round(currentState.portfolio.currentBalance * 100) / 100;

    if (Math.abs(walletOnlyBalance - storedBalance) >= 0.01) {
      const updatedState = updateBalance(walletOnlyBalance);
      updateBalanceInPlace(
        container,
        walletOnlyBalance,
        uiState,
        updatedState,
        animateDynamicValues,
      );
    }

    const aggregate = getAggregatedPortfolioMetrics(loadState(), walletOnlyBalance);
    const yieldMetrics = combinePortfolioYieldMetrics(
      { totalUsd: 0, weightedApr: 0, dailyEarningsUsd: 0 },
      aggregate.capital,
    );
    updateDashboardYieldStats(apr, capital, daily, yieldMetrics, true);
    uiState.balance = aggregate.balance;
    uiState.invested = aggregate.invested;
    uiState.goal = aggregate.goal;
    uiState.apr = yieldMetrics.weightedApr !== 0 ? yieldMetrics.weightedApr : null;
    uiState.earningCapital = yieldMetrics.earningCapital > 0 ? yieldMetrics.earningCapital : null;
    updateDashboardSummaryVisual(
      container,
      uiState,
      loadState().portfolio.lastUpdated,
      animateDynamicValues,
    );
    updateGoalProgressVisual(container, uiState, {
      animateNumbers: animateDynamicValues,
      animateText: animateDynamicValues,
    });
    return;
  }

  try {
    const { snapshot, metrics } = await getSharedMarketData(effectivePositions, forceRefresh);
    registerApiLastUpdatedAt(snapshot.marketLastUpdatedAt);

    // Saldo libre en los exchanges; sin resumen de saldos solo cuentan las posiciones.
    const walletBalanceUsd = autoBalanceSummary?.totalUsdEstimate ?? 0;
    const balancePositionUsd = sumBalanceContributingPositionUsd(
      effectivePositions,
      metrics.usdByPositionId,
    );
    const totalBalance = Math.round((balancePositionUsd + walletBalanceUsd) * 100) / 100;
    const storedBalance = Math.round(currentState.portfolio.currentBalance * 100) / 100;
    const now = Date.now();

    const shouldSyncBalance =
      metrics.totalUsd > 0 &&
      Math.abs(totalBalance - storedBalance) >= 0.01 &&
      (forceRefresh || now - lastAutoBalanceSyncAt > AUTO_BALANCE_SYNC_COOLDOWN_MS);

    if (shouldSyncBalance) {
      lastAutoBalanceSyncAt = now;
      const updatedState = updateBalance(totalBalance);
      updateBalanceInPlace(container, totalBalance, uiState, updatedState, animateDynamicValues);
    }

    const aggregate = getAggregatedPortfolioMetrics(
      currentState,
      shouldSyncBalance ? totalBalance : currentState.portfolio.currentBalance,
    );
    const yieldMetrics = combinePortfolioYieldMetrics(metrics, aggregate.capital);
    updateDashboardYieldStats(apr, capital, daily, yieldMetrics, true);

    if (metrics.hasStalePrices || metrics.hasUnavailablePrices) {
      registerApiFailure();
      showApiErrorBanner('No se pudo actualizar precios de mercado.');
    }

    uiState.balance = aggregate.balance;
    uiState.invested = aggregate.invested;
    uiState.goal = aggregate.goal;
    uiState.apr = yieldMetrics.weightedApr !== 0 ? yieldMetrics.weightedApr : null;
    uiState.earningCapital = yieldMetrics.earningCapital > 0 ? yieldMetrics.earningCapital : null;
    uiState.frequency = readSimulatorFrequency(uiState.frequency);
    updateDashboardSummaryVisual(
      container,
      uiState,
      currentState.portfolio.lastUpdated,
      animateDynamicValues,
    );

    updateGoalProgressVisual(container, uiState, {
      animateNumbers: animateDynamicValues,
      animateText: animateDynamicValues,
    });
  } catch (err) {
    if (typeof process !== 'undefined' ? process.env.PUBLIC_APP_ENV !== 'production' : true)
      console.warn('[Dashboard] market hydration failed:', err);
    registerApiFailure();
    showApiErrorBanner('No se pudo actualizar precios de mercado.');
    uiState.apr = null;
    uiState.earningCapital = null;
    updateGoalProgressVisual(container, uiState, {
      animateNumbers: false,
      animateText: animateDynamicValues,
    });
  }
}

function bindGoalLegendEvents(container: HTMLElement, uiState: DashboardUiState): void {
  const legendButtons = container.querySelectorAll<HTMLButtonElement>(
    '.goal-progress-legend[data-legend]',
  );

  legendButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const legend = button.dataset.legend;
      if (legend !== 'be' && legend !== 'goal') return;

      const nextState = toggleDashboardLegend(dashboardLegendState, legend);
      if (nextState === dashboardLegendState) {
        button.classList.remove('is-locked');
        void button.offsetWidth;
        button.classList.add('is-locked');
        return;
      }

      dashboardLegendState = sanitizeDashboardLegendState(nextState);
      saveDashboardLegendState(dashboardLegendState);
      updateGoalProgressVisual(container, uiState, { animateNumbers: true, animateText: true });
    });
  });
}
