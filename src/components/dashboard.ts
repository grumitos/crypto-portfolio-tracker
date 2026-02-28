import { loadState, updateBalance, updatePortfolio, SIMULATOR_VIEW_KEY } from '../utils/storage';
import { formatUSD, formatPct, formatDateLatin } from '../utils/calculator';
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
import { subscribeToMarketTicks } from '../utils/market-poller';
import {
  setAnimatedNumber,
  setAnimatedText,
  stopValueAnimation,
} from '../utils/animation';
import { skeletonSpan } from '../utils/ui-helpers';
import { sanitizeFrequency } from './simulator.state';
import {
  clearDashboardLegendState,
  loadDashboardLegendState,
  saveDashboardLegendState,
} from './dashboard.state';
import type { AppState, CompoundFrequency, DashboardGoalMode, DashboardLegendState } from '../types';

const AUTO_BALANCE_SYNC_COOLDOWN_MS = 5000;
const GOAL_NUMBER_ANIM_MS = 560;
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

function setCurrencyOutput(el: HTMLElement | null, value: number, animate: boolean, durationMs = 800): void {
  if (!el) return;
  stopValueAnimation(textAnimationByElement, el);
  setAnimatedNumber(
    valueAnimationByElement,
    el,
    value,
    (next) => formatUSD(next),
    { enabled: animate, durationMs, allowRememberedStart: false },
  );
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
  setAnimatedText(
    textAnimationByElement,
    el,
    text,
    { enabled, mode: 'fade', className: 'text-swap' },
  );
}

function animateTextScramble(el: HTMLElement | null, text: string, enabled: boolean): void {
  if (!el) return;
  setAnimatedText(
    textAnimationByElement,
    el,
    text,
    { enabled, mode: 'scramble', className: 'text-swap', durationMs: 260 },
  );
}

function setStaticTextOutput(el: HTMLElement | null, text: string): void {
  if (!el) return;
  stopValueAnimation(valueAnimationByElement, el);
  stopValueAnimation(textAnimationByElement, el);
  delete el.dataset.numericValue;
  el.textContent = text;
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
  delete daysEl.dataset.numericValue;
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
  setAnimatedNumber(
    daysAnimationByElement,
    daysEl,
    end,
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
  const targetLabelEl = container.querySelector('#dash-prog-target-label') as HTMLElement | null;
  const targetAmountEl = container.querySelector('#dash-prog-target-amount') as HTMLElement | null;
  const remainingTextEl = container.querySelector('#dash-prog-remaining-text') as HTMLElement | null;
  const remainingAmountEl = container.querySelector('#dash-prog-remaining-amount') as HTMLElement | null;
  const remainingPrefixEl = container.querySelector('#dash-prog-remaining-prefix') as HTMLElement | null;
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

  setCurrencyOutput(currentEl, uiState.balance, animateNumbers, GOAL_NUMBER_ANIM_MS);
  setCurrencyOutput(targetAmountEl, details.targetAmount, animateNumbers, GOAL_NUMBER_ANIM_MS);
  animateTextScramble(targetLabelEl, details.targetLabelShort, animateText);

  if (details.isReached) {
    animateTextSwap(remainingTextEl, `${details.targetLabelShort} alcanzado`, animateText);
    if (remainingAmountEl) remainingAmountEl.style.display = 'none';
    if (remainingPrefixEl) remainingPrefixEl.style.display = 'none';
    if (remainingTargetEl) remainingTargetEl.style.display = 'none';
  } else {
    animateTextSwap(remainingTextEl, 'Faltan', animateText);
    if (remainingAmountEl) {
      remainingAmountEl.style.display = 'inline';
      setCurrencyOutput(remainingAmountEl, details.remainingAmount, animateNumbers, GOAL_NUMBER_ANIM_MS);
    }
    if (remainingPrefixEl) remainingPrefixEl.style.display = 'inline';
    if (remainingTargetEl) {
      remainingTargetEl.style.display = 'inline';
      animateTextScramble(
        remainingTargetEl,
        details.target === 'be' ? 'breakeven' : 'la meta',
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
      setDaysDurationLabel(container, daysRemaining, true, animateNumbers);
    } else {
      setDaysLabel(container, '', false, animateText);
    }
  } else {
    setDaysLabel(container, '', false, animateText);
  }

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
  const balanceDate = formatDateLatin(lastUpdatedIso);

  const investedEl = container.querySelector('#dash-invested') as HTMLElement | null;
  const balanceEl = container.querySelector('#dash-balance') as HTMLElement | null;
  const balanceDateEl = container.querySelector('#dash-balance-date') as HTMLElement | null;
  const pnlEl = container.querySelector('#dash-pnl') as HTMLElement | null;
  const pnlPctEl = container.querySelector('#dash-pnl-pct') as HTMLElement | null;

  setCurrencyOutput(investedEl, uiState.invested, animate);
  setCurrencyOutput(balanceEl, uiState.balance, animate);
  setStaticTextOutput(balanceDateEl, balanceDate);

  if (pnlEl) {
    pnlEl.className = `big-number ${loss >= 0 ? 'gain' : 'loss'}`;
    setCurrencyOutput(pnlEl, loss, animate);
  }

  if (pnlPctEl) {
    pnlPctEl.className = `mono ${loss >= 0 ? 'text-gain' : 'text-loss'}`;
    setPercentOutput(pnlPctEl, lossPct, animate, true);
  }
}

function setTextResult(el: HTMLElement | null, text: string, animate: boolean): void {
  if (!el) return;
  stopValueAnimation(valueAnimationByElement, el);
  delete el.dataset.numericValue;
  animateTextSwap(el, text, animate);
}

export function renderDashboard(container: HTMLElement): () => void {
  const state = loadState();
  const { portfolio, positions } = state;
  dashboardLegendState = loadDashboardLegendState(sanitizeDashboardLegendState(undefined));

  const displayBalance = positions.length === 0 ? portfolio.savings : portfolio.currentBalance;
  const loss = displayBalance - portfolio.totalInvested;
  const lossPct = (loss / portfolio.totalInvested) * 100;
  const progressScale = progressScaleTarget(portfolio.totalInvested, portfolio.goalAmount);
  const progressFill = clampProgress(progressPct(displayBalance, progressScale));
  const firstMilestonePct = progressMarkerPct(portfolio.totalInvested, progressScale);
  const secondMilestonePct = progressMarkerPct(portfolio.goalAmount, progressScale);

  const uiState: DashboardUiState = {
    balance: displayBalance,
    invested: portfolio.totalInvested,
    goal: portfolio.goalAmount,
    apr: null,
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
          <span class="mono text-secondary goal-progress-value goal-progress-target" id="dash-prog-target">
            <span class="goal-progress-target-label" id="dash-prog-target-label">Meta</span>
            <span id="dash-prog-target-amount">${formatUSD(portfolio.goalAmount)}</span>
          </span>
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
            <span id="dash-prog-remaining-prefix">para</span>
            <span id="dash-prog-remaining-target">la meta</span>
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

  bindDashboardEvents(container, {
    onSaveBalance: (savings) => {
      const before = loadState();
      const basePositionsValue = before.positions.length > 0
        ? before.portfolio.currentBalance - before.portfolio.savings
        : 0;
      const nextBalance = Math.max(0, Math.round((basePositionsValue + savings) * 100) / 100);
      updatePortfolio({ savings });
      const updatedState = updateBalance(nextBalance);

      uiState.balance = updatedState.portfolio.currentBalance;
      uiState.invested = updatedState.portfolio.totalInvested;
      uiState.goal = updatedState.portfolio.goalAmount;
      uiState.frequency = readSimulatorFrequency(uiState.frequency);

      updateDashboardSummaryVisual(container, uiState, updatedState.portfolio.lastUpdated, true);
      updateGoalProgressVisual(container, uiState, { animateNumbers: true, animateText: true });
    },
    onSaveSettings: (invested, goal) => {
      const updatedState = updatePortfolio({ totalInvested: invested, goalAmount: goal });

      uiState.balance = updatedState.portfolio.currentBalance;
      uiState.invested = updatedState.portfolio.totalInvested;
      uiState.goal = updatedState.portfolio.goalAmount;
      uiState.frequency = readSimulatorFrequency(uiState.frequency);

      updateDashboardSummaryVisual(container, uiState, updatedState.portfolio.lastUpdated, true);
      updateGoalProgressVisual(container, uiState, { animateNumbers: true, animateText: true });
    },
  }, parseFlexibleNumber);
  bindGoalLegendEvents(container, uiState);
  updateGoalProgressVisual(container, uiState, { animateNumbers: false, animateText: false });

  requestAnimationFrame(() => {
    updateDashboardSummaryVisual(container, uiState, portfolio.lastUpdated, true);
  });

  let disposed = false;
  let hasFirstMarketHydrationCompleted = false;

  const unsubscribeMarket = subscribeToMarketTicks(async (forceRefresh) => {
    if (disposed || !container.isConnected) return;
    const { positions: latestPositions } = loadState();
    const animateGoalSection = hasFirstMarketHydrationCompleted;
    await hydrateDashboardMarketStats(container, latestPositions, uiState, forceRefresh, animateGoalSection);
    hasFirstMarketHydrationCompleted = true;
  });

  return () => {
    disposed = true;
    unsubscribeMarket();
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
  updateDashboardSummaryVisual(container, uiState, portfolio.lastUpdated, animateGoalSection);
}

async function hydrateDashboardMarketStats(
  container: HTMLElement,
  positions: AppState['positions'],
  uiState: DashboardUiState,
  forceRefresh = false,
  animateGoalSection = true,
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
    const savingsOnlyBalance = Math.round(currentState.portfolio.savings * 100) / 100;
    const storedBalance = Math.round(currentState.portfolio.currentBalance * 100) / 100;
    if (Math.abs(savingsOnlyBalance - storedBalance) >= 0.01) {
      updateBalance(savingsOnlyBalance);
      updateBalanceInPlace(container, savingsOnlyBalance, uiState, false);
    }

    setTextResult(aprEl, '---', true);
    setTextResult(capitalEl, '---', true);
    setTextResult(dailyEl, '---', true);
    uiState.apr = null;
    updateGoalProgressVisual(container, uiState, {
      animateNumbers: animateGoalSection,
      animateText: animateGoalSection,
    });
    return;
  }

  try {
    const metrics = await calculatePositionMetrics(positions, { forceRefresh });
    registerApiLastUpdatedAt(metrics.marketLastUpdatedAt);

    const savings = currentState.portfolio.savings;
    const totalBalance = Math.round((metrics.totalUsd + savings) * 100) / 100;
    const storedBalance = Math.round(currentState.portfolio.currentBalance * 100) / 100;
    const now = Date.now();

    const shouldSyncBalance = metrics.totalUsd > 0
      && Math.abs(totalBalance - storedBalance) >= 0.01
      && now - lastAutoBalanceSyncAt > AUTO_BALANCE_SYNC_COOLDOWN_MS;

    if (shouldSyncBalance) {
      lastAutoBalanceSyncAt = now;
      updateBalance(totalBalance);
      updateBalanceInPlace(container, totalBalance, uiState, false);
    }

    aprEl.style.color = metrics.weightedApr > 0 ? 'var(--text-primary)' : 'var(--text-muted)';
    if (metrics.weightedApr > 0) {
      setPercentOutput(aprEl, metrics.weightedApr, true, false);
    } else {
      setTextResult(aprEl, '---', true);
    }

    if (metrics.totalUsd > 0) {
      setCurrencyOutput(capitalEl, metrics.totalUsd, true);
    } else {
      setTextResult(capitalEl, '---', true);
    }

    dailyEl.style.color = metrics.dailyEarningsUsd > 0 ? 'var(--color-gain)' : 'var(--text-muted)';
    if (metrics.dailyEarningsUsd > 0) {
      setCurrencyOutput(dailyEl, metrics.dailyEarningsUsd, true);
    } else {
      setTextResult(dailyEl, '---', true);
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
      saveDashboardLegendState(dashboardLegendState);
      updateGoalProgressVisual(container, uiState, { animateNumbers: true, animateText: true });
    });
  });
}
