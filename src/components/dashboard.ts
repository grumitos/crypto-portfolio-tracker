import { loadState, updateBalance, SIMULATOR_VIEW_KEY } from '../utils/storage';
import { formatUSD, formatPct, formatDateLatin } from '../utils/calculator';
import { registerApiFailure, registerApiLastUpdatedAt } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { isAutoMode, hasApiCredentials } from '../utils/binance-auth';
import { fetchBalanceSummary } from '../utils/binance-sync';
import {
  getCachedBalanceSummary,
  getSharedMarketData,
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
  renderBalanceDetailCards,
  renderBalanceEmptyState,
  renderDashboardTemplate,
} from './dashboard.template';
import type {
  AppState,
  BinanceAccountBalance,
  CompoundFrequency,
  DashboardGoalMode,
  DashboardLegendState,
} from '../types';

let lastAutoBalanceSyncAt = 0;
let dashboardLegendState: DashboardLegendState = sanitizeDashboardLegendState(undefined);

const valueAnimationByElement = new WeakMap<HTMLElement, number>();
const daysAnimationByElement = new WeakMap<HTMLElement, number>();
const textAnimationByElement = new WeakMap<HTMLElement, number>();

export function resetDashboardLegendStateForTests(): void {
  clearDashboardLegendState();
  dashboardLegendState = sanitizeDashboardLegendState(undefined);
}

interface DashboardUiState {
  balance: number;
  invested: number;
  goal: number;
  apr: number | null;
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
  durationMs = 800,
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
  durationMs = 800,
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
    durationMs: 260,
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
    if (import.meta.env.DEV) {
      console.warn('[dashboard] failed to read simulator frequency', err);
    }
    return fallback;
  }
}

function estimateDaysToTargetWithProjectionSnapshot(
  capital: number,
  apr: number,
  target: number,
  invested: number,
  frequency: CompoundFrequency,
): number | null {
  if (
    !Number.isFinite(capital) ||
    !Number.isFinite(apr) ||
    !Number.isFinite(target) ||
    !Number.isFinite(invested)
  ) {
    return null;
  }
  if (capital <= 0 || apr <= 0 || target <= 0) return null;

  const snapshot = buildProjectionSnapshot({ capital, apr, frequency, goal: target, invested });
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

  const pct = details.targetAmount > 0 ? clampProgress(progressPct(balance, details.targetAmount)) : 0;
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
  goalDays.style.color = highlight ? 'var(--text-primary)' : 'var(--text-muted)';
  goalDaysSeparator.style.display = value ? 'inline' : 'none';
}

function setDaysDurationLabel(
  container: HTMLElement,
  totalDays: number,
  highlight: boolean,
  animate = false,
): void {
  const { goalDays, goalDaysSeparator } = getDashboardElements(container);
  if (!goalDays || !goalDaysSeparator) return;

  goalDays.style.color = highlight ? 'var(--text-primary)' : 'var(--text-muted)';
  goalDaysSeparator.style.display = 'inline';
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

  elements.goalMutedFirst.style.width = `${firstMilestonePct}%`;
  elements.goalMutedSecond.style.left = `${firstMilestonePct}%`;
  elements.goalMutedSecond.style.width = `${Math.max(0, secondMilestonePct - firstMilestonePct)}%`;
  elements.goalSolidFirst.style.width = `${firstSolidPct}%`;
  elements.goalSolidSecond.style.left = `${firstMilestonePct}%`;
  elements.goalSolidSecond.style.width = `${secondSolidPct}%`;

  setCurrencyOutput(elements.goalCurrent, uiState.balance, animateNumbers, GOAL_NUMBER_ANIM_MS);
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
  } else if (uiState.apr && uiState.apr > 0) {
    const daysRemaining = estimateDaysToTargetWithProjectionSnapshot(
      uiState.balance,
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
    elements.pnl.className = `big-number ${loss >= 0 ? 'gain' : 'loss'}`;
    setCurrencyOutput(elements.pnl, loss, animate);
  }

  if (elements.pnlPct) {
    elements.pnlPct.className = `mono sub-text ${loss >= 0 ? 'text-gain' : 'text-loss'}`;
    setPercentOutput(elements.pnlPct, lossPct, animate, true);
  }
}

function renderBalanceDetail(
  container: HTMLElement,
  balances: BinanceAccountBalance[] | null,
  positions: AppState['positions'] = [],
): void {
  const { balanceStrip, balanceStripItems } = getDashboardElements(container);
  if (!balanceStrip || !balanceStripItems) return;

  const mergedByAsset = new Map<string, BinanceAccountBalance>();

  (balances ?? []).forEach((balance) => {
    const asset = balance.asset.trim().toUpperCase();
    if (!asset) return;

    const current = mergedByAsset.get(asset);
    if (current) {
      current.free += balance.free;
      current.locked += balance.locked;
      return;
    }

    mergedByAsset.set(asset, {
      asset,
      free: balance.free,
      locked: balance.locked,
    });
  });

  positions.forEach((position) => {
    const asset = position.subscriptionAsset.trim().toUpperCase();
    const amount = position.amount;
    if (!asset || !Number.isFinite(amount) || amount <= 0) return;

    const current = mergedByAsset.get(asset);
    if (current) {
      current.locked += amount;
      return;
    }

    mergedByAsset.set(asset, {
      asset,
      free: 0,
      locked: amount,
    });
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

  renderBalanceDetailCards(balanceStripItems, relevant);
}

function createInitialUiState(state: AppState): DashboardUiState {
  const displayBalance =
    state.positions.length === 0 ? state.portfolio.savings : state.portfolio.currentBalance;
  return {
    balance: displayBalance,
    invested: state.portfolio.totalInvested,
    goal: state.portfolio.goalAmount,
    apr: null,
    frequency: readSimulatorFrequency('daily'),
  };
}

function renderInitialDashboard(container: HTMLElement, state: AppState): DashboardUiState {
  const uiState = createInitialUiState(state);
  const progressScale = progressScaleTarget(uiState.invested, uiState.goal);
  const progressFill = clampProgress(progressPct(uiState.balance, progressScale));
  const firstMilestonePct = progressMarkerPct(uiState.invested, progressScale);
  const secondMilestonePct = progressMarkerPct(uiState.goal, progressScale);
  const autoModeEnabled = isAutoMode();

  container.innerHTML = renderDashboardTemplate({
    balance: uiState.balance,
    goalAmount: uiState.goal,
    invested: uiState.invested,
    lastUpdatedIso: state.portfolio.lastUpdated,
    positionsCount: state.positions.length,
    autoModeEnabled,
    hasApiCredentials: hasApiCredentials(),
    firstMilestonePct,
    secondMilestonePct,
    progressFill,
  });

  return uiState;
}

export function renderDashboard(container: HTMLElement): () => void {
  const state = loadState();
  dashboardLegendState = loadDashboardLegendState(sanitizeDashboardLegendState(undefined));

  const uiState = renderInitialDashboard(container, state);
  const unsubConfig = onApiConfigChange(() => {
    const updatedState = loadState();
    uiState.balance = updatedState.portfolio.currentBalance;
    uiState.invested = updatedState.portfolio.totalInvested;
    uiState.goal = updatedState.portfolio.goalAmount;
    uiState.frequency = readSimulatorFrequency(uiState.frequency);
    updateDashboardSummaryVisual(container, uiState, updatedState.portfolio.lastUpdated, true);
    updateGoalProgressVisual(container, uiState, { animateNumbers: true, animateText: true });
  });

  bindGoalLegendEvents(container, uiState);
  updateGoalProgressVisual(container, uiState, { animateNumbers: false, animateText: false });

  requestAnimationFrame(() => {
    updateDashboardSummaryVisual(container, uiState, state.portfolio.lastUpdated, true);
  });

  let disposed = false;
  let hasFirstMarketHydrationCompleted = false;

  void hydrateDashboardMarketStats(container, loadState().positions, uiState, false, false).finally(
    () => {
      hasFirstMarketHydrationCompleted = true;
    },
  );

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
  newBalance: number,
  uiState: DashboardUiState,
  portfolio: AppState['portfolio'],
  animateGoalSection = true,
): void {
  uiState.balance = newBalance;
  uiState.invested = portfolio.totalInvested;
  uiState.goal = portfolio.goalAmount;
  uiState.frequency = readSimulatorFrequency(uiState.frequency);
  updateDashboardSummaryVisual(container, uiState, portfolio.lastUpdated, animateGoalSection);
}

async function hydrateDashboardMarketStats(
  container: HTMLElement,
  positions: AppState['positions'],
  uiState: DashboardUiState,
  forceRefresh = false,
  animateGoalSection = true,
): Promise<void> {
  const { apr, capital, daily } = getDashboardElements(container);
  if (!apr || !capital || !daily) return;

  const currentState = loadState();
  uiState.balance = currentState.portfolio.currentBalance;
  uiState.invested = currentState.portfolio.totalInvested;
  uiState.goal = currentState.portfolio.goalAmount;
  uiState.frequency = readSimulatorFrequency(uiState.frequency);

  const shouldHydrateBinanceBalance = isAutoMode() && hasApiCredentials();
  let autoBalanceSummary: Awaited<ReturnType<typeof fetchBalanceSummary>> | null = null;

  if (shouldHydrateBinanceBalance) {
    try {
      autoBalanceSummary = !forceRefresh ? getCachedBalanceSummary() : null;
      if (!autoBalanceSummary) {
        autoBalanceSummary = await fetchBalanceSummary(forceRefresh);
        rememberBalanceSummary(autoBalanceSummary);
      }
      renderBalanceDetail(container, autoBalanceSummary.balances, currentState.positions);
    } catch {
      renderBalanceDetail(container, null);
    }
  } else {
    renderBalanceDetail(container, null);
  }

  if (positions.length === 0) {
    const savingsOnlyBalance =
      Math.round((autoBalanceSummary?.totalUsdEstimate ?? currentState.portfolio.savings) * 100) /
      100;
    const storedBalance = Math.round(currentState.portfolio.currentBalance * 100) / 100;

    if (Math.abs(savingsOnlyBalance - storedBalance) >= 0.01) {
      const updatedState = updateBalance(savingsOnlyBalance);
      updateBalanceInPlace(container, savingsOnlyBalance, uiState, updatedState.portfolio, false);
    }

    setTextResult(apr, '---', true);
    setTextResult(capital, '---', true);
    setTextResult(daily, '---', true);
    uiState.apr = null;
    updateGoalProgressVisual(container, uiState, {
      animateNumbers: animateGoalSection,
      animateText: animateGoalSection,
    });
    return;
  }

  try {
    const { snapshot, metrics } = await getSharedMarketData(positions, forceRefresh);
    registerApiLastUpdatedAt(snapshot.marketLastUpdatedAt);

    const savings = autoBalanceSummary?.totalUsdEstimate ?? currentState.portfolio.savings;
    const totalBalance = Math.round((metrics.totalUsd + savings) * 100) / 100;
    const storedBalance = Math.round(currentState.portfolio.currentBalance * 100) / 100;
    const now = Date.now();

    const shouldSyncBalance =
      metrics.totalUsd > 0 &&
      Math.abs(totalBalance - storedBalance) >= 0.01 &&
      now - lastAutoBalanceSyncAt > AUTO_BALANCE_SYNC_COOLDOWN_MS;

    if (shouldSyncBalance) {
      lastAutoBalanceSyncAt = now;
      const updatedState = updateBalance(totalBalance);
      updateBalanceInPlace(container, totalBalance, uiState, updatedState.portfolio, false);
    }

    apr.style.color = metrics.weightedApr > 0 ? 'var(--text-primary)' : 'var(--text-muted)';
    if (metrics.weightedApr > 0) {
      setPercentOutput(apr, metrics.weightedApr, true, false);
    } else {
      setTextResult(apr, '---', true);
    }

    if (metrics.totalUsd > 0) {
      setCurrencyOutput(capital, metrics.totalUsd, true);
    } else {
      setTextResult(capital, '---', true);
    }

    daily.style.color =
      metrics.dailyEarningsUsd > 0 ? 'var(--color-gain)' : 'var(--text-muted)';
    if (metrics.dailyEarningsUsd > 0) {
      setCurrencyOutput(daily, metrics.dailyEarningsUsd, true);
    } else {
      setTextResult(daily, '---', true);
    }

    if (metrics.hasStalePrices || metrics.hasUnavailablePrices) {
      registerApiFailure();
      showApiErrorBanner('No se pudo actualizar precios de mercado.');
    }

    uiState.balance = shouldSyncBalance ? totalBalance : currentState.portfolio.currentBalance;
    uiState.invested = currentState.portfolio.totalInvested;
    uiState.goal = currentState.portfolio.goalAmount;
    uiState.apr = metrics.weightedApr > 0 ? metrics.weightedApr : null;
    uiState.frequency = readSimulatorFrequency(uiState.frequency);

    updateGoalProgressVisual(container, uiState, {
      animateNumbers: animateGoalSection,
      animateText: animateGoalSection,
    });
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[Dashboard] market hydration failed:', err);
    registerApiFailure();
    showApiErrorBanner('No se pudo actualizar precios de mercado.');
    uiState.apr = null;
    updateGoalProgressVisual(container, uiState, {
      animateNumbers: false,
      animateText: animateGoalSection,
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
