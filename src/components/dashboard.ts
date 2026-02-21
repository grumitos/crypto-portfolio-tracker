import { loadState, updateBalance, SIMULATOR_VIEW_KEY } from '../utils/storage';
import { formatUSD, formatPct, formatDateLatin, weightedAverageAPR } from '../utils/calculator';
import { calculatePositionMetrics } from '../utils/market';
import { registerApiFailure, registerApiLastUpdatedAt } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { iconWallet, iconSettings } from '../utils/icons';
import { bindDashboardEvents } from './dashboard.events';
import {
  formatDashboardDurationLabel,
  resolveDashboardGoalDetails,
  sanitizeDashboardLegendState,
  toggleDashboardLegend,
} from '../utils/dashboard-goal';
import { buildProjectionSnapshot } from '../utils/projection-milestones';
import { MARKET_POLL_INTERVAL_MS } from '../utils/constants';
import {
  stopValueAnimation,
  getElementNumericValue,
} from '../utils/animation';
import { skeletonSpan } from '../utils/ui-helpers';
import { sanitizeFrequency } from './simulator.state';
import type { AppState, CompoundFrequency, DashboardGoalMode, DashboardLegendState } from '../types';

const AUTO_BALANCE_SYNC_COOLDOWN_MS = 5000;
const GOAL_NUMBER_ANIM_MS = 560;
let lastAutoBalanceSyncAt = 0;
let dashboardLegendState: DashboardLegendState = sanitizeDashboardLegendState(undefined);
const valueAnimationByElement = new WeakMap<HTMLElement, number>();
const daysAnimationByElement = new WeakMap<HTMLElement, number>();

export function resetDashboardLegendStateForTests(): void {
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

function formatEditableCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseFlexibleNumber(raw: string): number {
  const cleaned = raw.trim().replace(/\s+/g, '').replace(/[^\d.,+-]/g, '');
  if (!cleaned) return NaN;

  const sign = cleaned.startsWith('-') ? -1 : 1;
  const unsigned = cleaned.replace(/^[+-]/, '');
  if (!unsigned) return NaN;

  const commaCount = (unsigned.match(/,/g) || []).length;
  const dotCount = (unsigned.match(/\./g) || []).length;
  if (commaCount === 0 && dotCount === 0) {
    const value = Number(unsigned);
    return Number.isFinite(value) ? sign * value : NaN;
  }

  let decimalSep: ',' | '.' | null = null;
  if (commaCount > 0 && dotCount > 0) {
    decimalSep = unsigned.lastIndexOf(',') > unsigned.lastIndexOf('.') ? ',' : '.';
  } else {
    const sep: ',' | '.' = commaCount > 0 ? ',' : '.';
    const count = sep === ',' ? commaCount : dotCount;
    const lastIndex = unsigned.lastIndexOf(sep);
    const fractionalLength = unsigned.length - lastIndex - 1;
    decimalSep = fractionalLength === 3 && count >= 1 ? null : sep;
  }

  let normalized = '';
  if (!decimalSep) {
    normalized = unsigned.replace(/[.,]/g, '');
  } else {
    const index = unsigned.lastIndexOf(decimalSep);
    const integerPart = unsigned.slice(0, index).replace(/[.,]/g, '');
    const fractionPart = unsigned.slice(index + 1).replace(/[.,]/g, '');
    normalized = `${integerPart}.${fractionPart}`;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? sign * parsed : NaN;
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

function animateValue(el: HTMLElement | null, end: number, isCurrency: boolean, durationMs = 800): void {
  if (!el) return;
  stopValueAnimation(valueAnimationByElement, el);
  let startTimestamp: number | null = null;
  const start = getElementNumericValue(el, end);

  const step = (timestamp: number) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / durationMs, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = start + easeOut * (end - start);

    el.dataset.numericValue = String(current);
    el.textContent = isCurrency ? formatUSD(current) : current.toFixed(2) + '%';

    if (progress < 1) {
      const nextFrame = window.requestAnimationFrame(step);
      valueAnimationByElement.set(el, nextFrame);
    } else {
      el.dataset.numericValue = String(end);
      el.textContent = isCurrency ? formatUSD(end) : end.toFixed(2) + '%';
      valueAnimationByElement.delete(el);
    }
  };

  const animationId = window.requestAnimationFrame(step);
  valueAnimationByElement.set(el, animationId);
}

function animateTextSwap(el: HTMLElement | null, text: string, enabled: boolean): void {
  if (!el) return;
  if (!enabled || el.textContent === text) {
    el.textContent = text;
    return;
  }

  el.textContent = text;
  el.classList.remove('goal-text-swap');
  void el.offsetWidth;
  el.classList.add('goal-text-swap');
}

function readSimulatorFrequency(fallback: CompoundFrequency): CompoundFrequency {
  try {
    const raw = localStorage.getItem(SIMULATOR_VIEW_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { frequency?: unknown };
    return sanitizeFrequency(parsed.frequency, fallback);
  } catch {
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
  if (!Number.isFinite(capital) || !Number.isFinite(apr) || !Number.isFinite(target) || !Number.isFinite(invested)) {
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

function setDaysLabel(container: HTMLElement, value: string, highlight: boolean, animate = false): void {
  const daysEl = container.querySelector('#dashboard-days') as HTMLElement | null;
  const daysSepEl = container.querySelector('#dashboard-days-sep') as HTMLElement | null;
  if (!daysEl || !daysSepEl) return;

  stopValueAnimation(daysAnimationByElement, daysEl);
  delete daysEl.dataset.daysValue;
  animateTextSwap(daysEl, value, animate);
  daysEl.style.color = highlight ? 'var(--text-primary)' : 'var(--text-muted)';
  daysSepEl.style.display = value ? 'inline' : 'none';
}

function setDaysDurationLabel(
  container: HTMLElement,
  totalDays: number,
  highlight: boolean,
  animate = false,
): void {
  const daysEl = container.querySelector('#dashboard-days') as HTMLElement | null;
  const daysSepEl = container.querySelector('#dashboard-days-sep') as HTMLElement | null;
  if (!daysEl || !daysSepEl) return;

  const end = Math.max(0, totalDays);
  daysEl.style.color = highlight ? 'var(--text-primary)' : 'var(--text-muted)';
  daysSepEl.style.display = 'inline';

  if (!animate) {
    stopValueAnimation(daysAnimationByElement, daysEl);
    daysEl.dataset.daysValue = String(end);
    daysEl.textContent = formatDashboardDurationLabel(end);
    return;
  }

  stopValueAnimation(daysAnimationByElement, daysEl);
  const startValue = Number(daysEl.dataset.daysValue);
  const start = Number.isFinite(startValue) ? startValue : end;
  if (Math.abs(start - end) < 0.01) {
    daysEl.dataset.daysValue = String(end);
    daysEl.textContent = formatDashboardDurationLabel(end);
    return;
  }

  let startedAt: number | null = null;
  const step = (timestamp: number) => {
    if (startedAt === null) startedAt = timestamp;
    const progress = Math.min((timestamp - startedAt) / GOAL_NUMBER_ANIM_MS, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = start + easeOut * (end - start);
    daysEl.dataset.daysValue = String(current);
    daysEl.textContent = formatDashboardDurationLabel(current);

    if (progress < 1) {
      const nextFrame = window.requestAnimationFrame(step);
      daysAnimationByElement.set(daysEl, nextFrame);
      return;
    }

    daysEl.dataset.daysValue = String(end);
    daysEl.textContent = formatDashboardDurationLabel(end);
    daysAnimationByElement.delete(daysEl);
  };

  const animationId = window.requestAnimationFrame(step);
  daysAnimationByElement.set(daysEl, animationId);
}

function updateLegendButtons(container: HTMLElement): void {
  const beBtn = container.querySelector('#dashboard-legend-be') as HTMLButtonElement | null;
  const goalBtn = container.querySelector('#dashboard-legend-goal') as HTMLButtonElement | null;
  if (!beBtn || !goalBtn) return;

  beBtn.classList.toggle('is-active', dashboardLegendState.be);
  beBtn.classList.toggle('is-inactive', !dashboardLegendState.be);
  beBtn.setAttribute('aria-pressed', dashboardLegendState.be ? 'true' : 'false');

  goalBtn.classList.toggle('is-active', dashboardLegendState.goal);
  goalBtn.classList.toggle('is-inactive', !dashboardLegendState.goal);
  goalBtn.setAttribute('aria-pressed', dashboardLegendState.goal ? 'true' : 'false');
}

function updateGoalProgressVisual(
  container: HTMLElement,
  uiState: DashboardUiState,
  options: GoalVisualUpdateOptions = {},
): void {
  const animateNumbers = options.animateNumbers === true;
  const animateText = options.animateText === true;

  dashboardLegendState = sanitizeDashboardLegendState(dashboardLegendState);
  const details = resolveDashboardGoalDetails(uiState.balance, uiState.invested, uiState.goal, dashboardLegendState);

  let firstMilestonePct = 100;
  let secondMilestonePct = 100;
  let firstSolidPct = 0;
  let secondSolidPct = 0;

  if (details.mode === 'both') {
    const progressScale = progressScaleTarget(uiState.invested, uiState.goal);
    const progressFill = clampProgress(progressPct(uiState.balance, progressScale));
    firstMilestonePct = progressMarkerPct(uiState.invested, progressScale);
    secondMilestonePct = progressMarkerPct(uiState.goal, progressScale);
    firstSolidPct = Math.min(progressFill, firstMilestonePct);
    secondSolidPct = Math.max(0, Math.min(progressFill, secondMilestonePct) - firstMilestonePct);
  } else {
    const singleTarget = details.targetAmount;
    const progressFill = clampProgress(progressPct(uiState.balance, singleTarget));
    firstSolidPct = progressFill;
    secondSolidPct = 0;
    secondMilestonePct = 0;
  }

  const bar = container.querySelector('#dash-goal-progress-bar') as HTMLElement | null;
  const mutedFirst = container.querySelector('#dash-prog-muted-first') as HTMLElement | null;
  const mutedSecond = container.querySelector('#dash-prog-muted-second') as HTMLElement | null;
  const solidFirst = container.querySelector('#dash-prog-solid-first') as HTMLElement | null;
  const solidSecond = container.querySelector('#dash-prog-solid-second') as HTMLElement | null;
  const currentEl = container.querySelector('#dash-prog-current') as HTMLElement | null;
  const targetEl = container.querySelector('#dash-prog-target') as HTMLElement | null;
  const remainingTextEl = container.querySelector('#dash-prog-remaining-text') as HTMLElement | null;
  const remainingAmountEl = container.querySelector('#dash-prog-remaining-amount') as HTMLElement | null;
  const remainingTargetEl = container.querySelector('#dash-prog-remaining-target') as HTMLElement | null;

  if (!bar || !mutedFirst || !mutedSecond || !solidFirst || !solidSecond) return;

  bar.classList.remove('mode-be', 'mode-goal', 'mode-both');
  bar.classList.add(modeToClass(details.mode));

  mutedFirst.style.width = `${firstMilestonePct}%`;
  mutedSecond.style.left = `${firstMilestonePct}%`;
  mutedSecond.style.width = `${Math.max(0, secondMilestonePct - firstMilestonePct)}%`;

  solidFirst.style.width = `${firstSolidPct}%`;
  solidSecond.style.left = `${firstMilestonePct}%`;
  solidSecond.style.width = `${secondSolidPct}%`;

  if (animateNumbers) {
    animateValue(currentEl, uiState.balance, true, GOAL_NUMBER_ANIM_MS);
  } else if (currentEl) {
    currentEl.dataset.numericValue = String(uiState.balance);
    currentEl.textContent = formatUSD(uiState.balance);
  }

  animateTextSwap(targetEl, `${details.targetLabelShort} ${formatUSD(details.targetAmount)}`, animateText);

  if (details.isReached) {
    animateTextSwap(remainingTextEl, `${details.targetLabelShort} alcanzado`, animateText);
    if (remainingAmountEl) remainingAmountEl.style.display = 'none';
    if (remainingTargetEl) remainingTargetEl.style.display = 'none';
  } else {
    animateTextSwap(remainingTextEl, 'Faltan', animateText);
    if (remainingAmountEl) {
      remainingAmountEl.style.display = 'inline';
      if (animateNumbers) {
        animateValue(remainingAmountEl, details.remainingAmount, true, GOAL_NUMBER_ANIM_MS);
      } else {
        remainingAmountEl.dataset.numericValue = String(details.remainingAmount);
        remainingAmountEl.textContent = formatUSD(details.remainingAmount);
      }
    }
    if (remainingTargetEl) {
      remainingTargetEl.style.display = 'inline';
      animateTextSwap(
        remainingTargetEl,
        details.target === 'be' ? 'para breakeven' : 'para la meta',
        animateText,
      );
    }
  }

  if (details.isReached) {
    setDaysLabel(container, `${details.targetLabelShort} alcanzado`, true, animateText);
  } else if (uiState.apr && uiState.apr > 0) {
    const daysRemaining = estimateDaysToTargetWithProjectionSnapshot(
      uiState.balance,
      uiState.apr,
      details.targetAmount,
      uiState.invested,
      uiState.frequency,
    );

    if (daysRemaining !== null) {
      setDaysDurationLabel(container, daysRemaining, true, animateText);
    } else {
      setDaysLabel(container, '', false, animateText);
    }
  } else {
    setDaysLabel(container, '', false, animateText);
  }

  updateLegendButtons(container);
}

export function renderDashboard(container: HTMLElement, onStateChange: () => void): () => void {
  const state = loadState();
  const { portfolio, positions } = state;

  const displayBalance = portfolio.currentBalance;
  const loss = displayBalance - portfolio.totalInvested;
  const lossPct = (loss / portfolio.totalInvested) * 100;
  const initialApr = weightedAverageAPR(positions);
  const progressScale = progressScaleTarget(portfolio.totalInvested, portfolio.goalAmount);
  const progressFill = clampProgress(progressPct(displayBalance, progressScale));
  const firstMilestonePct = progressMarkerPct(portfolio.totalInvested, progressScale);
  const secondMilestonePct = progressMarkerPct(portfolio.goalAmount, progressScale);

  const uiState: DashboardUiState = {
    balance: displayBalance,
    invested: portfolio.totalInvested,
    goal: portfolio.goalAmount,
    apr: initialApr > 0 ? initialApr : null,
    frequency: readSimulatorFrequency('daily'),
  };

  container.innerHTML = `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">Portfolio</h2>
        <div style="display:flex;gap:var(--space-sm)">
          <button class="btn btn-sm" id="btn-edit-balance">${iconWallet(14)}Ahorros</button>
          <button class="btn btn-sm" id="btn-edit-settings">${iconSettings(14)}Configurar</button>
        </div>
      </div>

      <div class="grid-3">
        <div class="card">
          <div class="card-title">Invertido total</div>
          <div class="big-number" id="dash-invested">${formatUSD(portfolio.totalInvested)}</div>
        </div>
        <div class="card">
          <div class="card-title">Saldo total</div>
          <div class="big-number accent" id="dash-balance">${formatUSD(displayBalance)}</div>
          <div class="text-muted" id="dash-balance-date" style="font-size:0.75rem;margin-top:6px">
            ${formatDateLatin(portfolio.lastUpdated)}
          </div>
        </div>
        <div class="card">
          <div class="card-title">P&L</div>
          <div class="big-number ${loss >= 0 ? 'gain' : 'loss'}" id="dash-pnl">
            ${formatUSD(loss)}
          </div>
          <div id="dash-pnl-pct" class="mono ${loss >= 0 ? 'text-gain' : 'text-loss'}" style="font-size:0.85rem;margin-top:6px">
            ${formatPct(lossPct)}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Progreso: breakeven y meta</div>
        <div class="goal-progress-head">
          <span class="mono goal-progress-value" id="dash-prog-current">${formatUSD(displayBalance)}</span>
          <span class="mono text-secondary goal-progress-value" id="dash-prog-target">Meta ${formatUSD(portfolio.goalAmount)}</span>
        </div>
        <div class="progress-bar goal-progress-bar mode-both" id="dash-goal-progress-bar">
          <div class="goal-progress-zone-muted breakeven zone-first" id="dash-prog-muted-first" style="width:${firstMilestonePct}%"></div>
          <div class="goal-progress-zone-muted goal zone-second" id="dash-prog-muted-second" style="left:${firstMilestonePct}%;width:${Math.max(0, secondMilestonePct - firstMilestonePct)}%"></div>
          <div class="goal-progress-zone breakeven zone-first" id="dash-prog-solid-first" style="width:${Math.min(progressFill, firstMilestonePct)}%"></div>
          <div class="goal-progress-zone goal zone-second" id="dash-prog-solid-second" style="left:${firstMilestonePct}%;width:${Math.max(0, Math.min(progressFill, secondMilestonePct) - firstMilestonePct)}%"></div>
        </div>
        <div class="goal-progress-foot">
          <div class="text-secondary goal-progress-remaining" id="dash-prog-remaining">
            <span id="dash-prog-remaining-text">Faltan</span>
            <span class="mono" id="dash-prog-remaining-amount">${formatUSD(Math.max(0, portfolio.goalAmount - displayBalance))}</span>
            <span id="dash-prog-remaining-target">para la meta</span>
          </div>
          <div class="goal-progress-meta">
            <button type="button" class="goal-progress-legend is-active" id="dashboard-legend-be" data-legend="be" aria-pressed="true">
              <span class="goal-progress-dot breakeven"></span>BE
            </button>
            <button type="button" class="goal-progress-legend is-active" id="dashboard-legend-goal" data-legend="goal" aria-pressed="true">
              <span class="goal-progress-dot goal"></span>Meta
            </button>
            <span class="text-muted goal-progress-sep" id="dashboard-days-sep">/</span>
            <span class="mono" id="dashboard-days">${skeletonSpan('72px')}</span>
          </div>
        </div>
      </div>

      <div class="grid-4">
        <div class="stat-card" data-shared-card="apr">
          <div class="card-title">APR promedio</div>
          <div class="stat-value" id="dashboard-apr">
            ${skeletonSpan('70px')}
          </div>
        </div>
        <div class="stat-card" data-shared-card="capital">
          <div class="card-title">En posiciones</div>
          <div class="stat-value" id="dashboard-capital">
            ${skeletonSpan('90px')}
          </div>
        </div>
        <div class="stat-card" data-shared-card="daily">
          <div class="card-title">Run-rate diario est.</div>
          <div class="stat-value" id="dashboard-daily">
            ${skeletonSpan('70px')}
          </div>
        </div>
        <div class="stat-card" data-shared-card="positions">
          <div class="card-title">Posiciones activas</div>
          <div class="stat-value">
            ${positions.length}
          </div>
        </div>
      </div>

    </div>

    <div id="modal-balance" class="modal-overlay" style="display:none">
      <div class="modal">
        <h3 class="modal-title">Ahorros</h3>
        <div class="form-group">
          <label>Efectivo / stablecoins fuera de posiciones (USD)</label>
          <input type="text" id="input-balance" inputmode="decimal" value="${formatEditableCurrency(portfolio.savings)}">
        </div>
        <div class="modal-actions">
          <button class="btn" id="btn-cancel-balance">Cancelar</button>
          <button class="btn btn-primary" id="btn-save-balance">Guardar</button>
        </div>
      </div>
    </div>

    <div id="modal-settings" class="modal-overlay" style="display:none">
      <div class="modal">
        <h3 class="modal-title">Configuracion</h3>
        <div class="form-group">
          <label>Total invertido (USD)</label>
          <input type="text" id="input-invested" inputmode="decimal" value="${formatEditableCurrency(portfolio.totalInvested)}">
        </div>
        <div class="form-group">
          <label>Meta (USD)</label>
          <input type="text" id="input-goal" inputmode="decimal" value="${formatEditableCurrency(portfolio.goalAmount)}">
        </div>
        <div class="modal-actions">
          <button class="btn" id="btn-cancel-settings">Cancelar</button>
          <button class="btn btn-primary" id="btn-save-settings">Guardar</button>
        </div>
      </div>
    </div>
  `;

  bindDashboardEvents(container, onStateChange, parseFlexibleNumber);
  bindGoalLegendEvents(container, uiState);
  updateGoalProgressVisual(container, uiState, { animateNumbers: false, animateText: false });

  requestAnimationFrame(() => {
    animateValue(container.querySelector('#dash-invested') as HTMLElement, portfolio.totalInvested, true);
    animateValue(container.querySelector('#dash-balance') as HTMLElement, displayBalance, true);
    animateValue(container.querySelector('#dash-pnl') as HTMLElement, loss, true);
  });

  let disposed = false;
  let isHydrating = false;

  const hydrateMarketData = async (forceRefresh = false): Promise<void> => {
    if (disposed || isHydrating || !container.isConnected) return;
    isHydrating = true;
    try {
      const { positions: latestPositions } = loadState();
      await hydrateDashboardMarketStats(container, latestPositions, uiState, forceRefresh);
    } finally {
      isHydrating = false;
    }
  };

  void hydrateMarketData();
  const pollTimer = setInterval(() => {
    void hydrateMarketData(true);
  }, MARKET_POLL_INTERVAL_MS);

  return () => {
    disposed = true;
    clearInterval(pollTimer);
  };
}

function updateBalanceInPlace(
  container: HTMLElement,
  newBalance: number,
  uiState: DashboardUiState,
  animateGoalSection = true,
): void {
  const state = loadState();
  const { portfolio } = state;

  uiState.balance = newBalance;
  uiState.invested = portfolio.totalInvested;
  uiState.goal = portfolio.goalAmount;
  uiState.frequency = readSimulatorFrequency(uiState.frequency);

  const loss = newBalance - portfolio.totalInvested;
  const lossPct = (loss / portfolio.totalInvested) * 100;

  const balanceEl = container.querySelector('#dash-balance') as HTMLElement | null;
  if (balanceEl) balanceEl.textContent = formatUSD(newBalance);

  const balanceDateEl = container.querySelector('#dash-balance-date') as HTMLElement | null;
  if (balanceDateEl) balanceDateEl.textContent = formatDateLatin(portfolio.lastUpdated);

  const pnlEl = container.querySelector('#dash-pnl') as HTMLElement | null;
  if (pnlEl) {
    pnlEl.textContent = formatUSD(loss);
    pnlEl.className = `big-number ${loss >= 0 ? 'gain' : 'loss'}`;
  }

  const pnlPctEl = container.querySelector('#dash-pnl-pct') as HTMLElement | null;
  if (pnlPctEl) {
    pnlPctEl.textContent = formatPct(lossPct);
    pnlPctEl.className = `mono ${loss >= 0 ? 'text-gain' : 'text-loss'}`;
  }

  updateGoalProgressVisual(container, uiState, {
    animateNumbers: animateGoalSection,
    animateText: animateGoalSection,
  });
}

async function hydrateDashboardMarketStats(
  container: HTMLElement,
  positions: AppState['positions'],
  uiState: DashboardUiState,
  forceRefresh = false,
): Promise<void> {
  const aprEl = container.querySelector('#dashboard-apr') as HTMLElement | null;
  const capitalEl = container.querySelector('#dashboard-capital') as HTMLElement | null;
  const dailyEl = container.querySelector('#dashboard-daily') as HTMLElement | null;
  if (!aprEl || !capitalEl || !dailyEl) return;

  const currentState = loadState();
  uiState.balance = currentState.portfolio.currentBalance;
  uiState.invested = currentState.portfolio.totalInvested;
  uiState.goal = currentState.portfolio.goalAmount;
  uiState.frequency = readSimulatorFrequency(uiState.frequency);

  if (positions.length === 0) {
    aprEl.textContent = '---';
    capitalEl.textContent = '---';
    dailyEl.textContent = '---';
    uiState.apr = null;
    updateGoalProgressVisual(container, uiState, { animateNumbers: true, animateText: true });
    return;
  }

  try {
    const metrics = await calculatePositionMetrics(positions, { forceRefresh });
    registerApiLastUpdatedAt(metrics.marketLastUpdatedAt);

    const state = loadState();
    const savings = state.portfolio.savings;
    const totalBalance = Math.round((metrics.totalUsd + savings) * 100) / 100;
    const storedBalance = Math.round(state.portfolio.currentBalance * 100) / 100;
    const now = Date.now();

    const shouldSyncBalance = metrics.totalUsd > 0
      && Math.abs(totalBalance - storedBalance) >= 0.01
      && now - lastAutoBalanceSyncAt > AUTO_BALANCE_SYNC_COOLDOWN_MS;

    if (shouldSyncBalance) {
      lastAutoBalanceSyncAt = now;
      updateBalance(totalBalance);
      updateBalanceInPlace(container, totalBalance, uiState, false);
    }

    aprEl.classList.add('fade-in');
    capitalEl.classList.add('fade-in');
    dailyEl.classList.add('fade-in');

    aprEl.textContent = metrics.weightedApr > 0 ? `${metrics.weightedApr.toFixed(2)}%` : '---';
    aprEl.style.color = metrics.weightedApr > 0 ? 'var(--text-primary)' : 'var(--text-muted)';

    capitalEl.textContent = metrics.totalUsd > 0 ? formatUSD(metrics.totalUsd) : '---';

    dailyEl.textContent = metrics.dailyEarningsUsd > 0 ? formatUSD(metrics.dailyEarningsUsd) : '---';
    dailyEl.style.color = metrics.dailyEarningsUsd > 0 ? 'var(--color-gain)' : 'var(--text-muted)';

    if (metrics.hasStalePrices || metrics.hasUnavailablePrices) {
      registerApiFailure();
      showApiErrorBanner('No se pudo actualizar precios de mercado.');
    }

    uiState.balance = shouldSyncBalance ? totalBalance : state.portfolio.currentBalance;
    uiState.invested = state.portfolio.totalInvested;
    uiState.goal = state.portfolio.goalAmount;
    uiState.apr = metrics.weightedApr > 0 ? metrics.weightedApr : null;
    uiState.frequency = readSimulatorFrequency(uiState.frequency);

    updateGoalProgressVisual(container, uiState, { animateNumbers: true, animateText: true });
  } catch {
    registerApiFailure();
    showApiErrorBanner('No se pudo actualizar precios de mercado.');
    uiState.apr = null;
    updateGoalProgressVisual(container, uiState, { animateNumbers: false, animateText: true });
  }
}

function bindGoalLegendEvents(container: HTMLElement, uiState: DashboardUiState): void {
  const legendButtons = container.querySelectorAll<HTMLButtonElement>('.goal-progress-legend[data-legend]');
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
      updateGoalProgressVisual(container, uiState, { animateNumbers: true, animateText: true });
    });
  });
}
