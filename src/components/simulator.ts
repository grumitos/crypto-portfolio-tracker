import { loadState } from '../utils/storage';
import {
  formatDateLatin,
  formatUSD,
  compoundedRateMetrics,
  dailyEarnings as calcDailyEarnings,
  monthlyEarnings as calcMonthlyEarnings,
} from '../utils/calculator';
import { formatDashboardDurationLabel } from '../utils/dashboard-goal';
import {
  buildProjectionSnapshot,
  resolveSimulationMilestones,
  type MilestoneKey,
  type MilestoneResolution,
} from '../utils/projection-milestones';
import { calculatePositionMetrics } from '../utils/market';
import { registerApiFailure, registerApiLastUpdatedAt } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { iconRefreshCw, iconTarget } from '../utils/icons';
import { getChartColors } from '../utils/theme';
import {
  getDefaultViewState,
  loadSimulatorViewState,
  persistSimulatorViewState,
  type AutoState,
} from './simulator.state';
import type { CompoundFrequency, DualPosition } from '../types';
import type { ChartDataset } from 'chart.js';
import { subscribeToMarketTicks } from '../utils/market-poller';
import {
  setAnimatedNumber,
  setAnimatedText,
  stopValueAnimation as stopAnimationFrame,
} from '../utils/animation';

const PROJECTION_MAX_MONTH = 12;
const RESULT_NUMBER_ANIM_MS = 560;
const AUTO_CAPITAL_HINT = 'Capital en posiciones';
const AUTO_APR_HINT_PREFIX = 'Promedio ponderado (USD):';
const valueAnimationByElement = new WeakMap<HTMLElement, number>();
const textAnimationByElement = new WeakMap<HTMLElement, number>();

interface TriggerSimulationOptions {
  persist?: boolean;
  animate?: boolean;
}

interface RunSimulationOptions {
  animate?: boolean;
}

function formatAutoAprHint(apr: number | null): string {
  if (Number.isFinite(apr) && (apr as number) > 0) {
    return `${AUTO_APR_HINT_PREFIX} ${(apr as number).toFixed(2)}%`;
  }
  return `${AUTO_APR_HINT_PREFIX} N/D`;
}

function projectionTableSkeletonHtml(): string {
  const head = `
    <div class="sim-projection-table-head">
      <span class="skeleton" style="width:36px;height:0.78rem"></span>
      <span class="skeleton" style="width:72px;height:0.78rem"></span>
      <span class="skeleton" style="width:74px;height:0.78rem"></span>
      <span class="skeleton" style="width:116px;height:0.78rem"></span>
    </div>
  `;
  const row = `
    <div class="sim-projection-table-row">
      <span class="skeleton" style="width:22px;height:0.95rem"></span>
      <span class="skeleton" style="width:84px;height:0.95rem"></span>
      <span class="skeleton" style="width:94px;height:0.95rem"></span>
      <span class="skeleton" style="width:108px;height:0.95rem"></span>
    </div>
  `;

  return `
    <div class="sim-projection-table-skeleton">
      ${head}
      ${row}
      ${row}
      ${row}
      ${row}
    </div>
  `;
}

function renderProjectionLoadingState(container: HTMLElement): void {
  const tableContainer = container.querySelector('#sim-table-container') as HTMLElement | null;
  const tableEl = container.querySelector('#sim-table') as HTMLElement | null;
  const canvas = container.querySelector('#projection-chart') as HTMLCanvasElement | null;
  const chartSkeleton = container.querySelector('#sim-projection-chart-skeleton') as HTMLElement | null;

  if (tableContainer) tableContainer.style.display = 'block';
  if (canvas) canvas.style.display = 'none';
  if (chartSkeleton) chartSkeleton.style.display = 'flex';
  if (tableEl) tableEl.innerHTML = projectionTableSkeletonHtml();
}

function setTagMode(tag: HTMLElement, isAuto: boolean): void {
  tag.textContent = isAuto ? 'AUTO' : 'MANUAL';
  tag.className = `auto-tag ${isAuto ? 'is-auto' : 'is-manual'}`;
}

function stopValueAnimation(el: HTMLElement | null): void {
  stopAnimationFrame(valueAnimationByElement, el);
}

function stopTextAnimation(el: HTMLElement | null): void {
  stopAnimationFrame(textAnimationByElement, el);
}

function setTextOutput(
  el: HTMLElement | null,
  value: string,
  animate: boolean,
  mode: 'fade' | 'scramble' = 'scramble',
): void {
  if (!el) return;
  stopValueAnimation(el);
  stopTextAnimation(el);
  delete el.dataset.numericValue;
  setAnimatedText(textAnimationByElement, el, value, {
    enabled: animate,
    mode,
    className: 'text-swap',
    durationMs: 260,
  });
}

function setStaticOutput(el: HTMLElement | null, value: string): void {
  setTextOutput(el, value, false, 'fade');
}

function setNumberOutput(
  el: HTMLElement | null,
  value: number | null,
  formatter: (next: number) => string,
  animate: boolean,
): void {
  if (!el) return;
  stopTextAnimation(el);
  if (!Number.isFinite(value)) {
    setTextOutput(el, '---', animate, 'fade');
    return;
  }

  const end = value as number;
  setAnimatedNumber(
    valueAnimationByElement,
    el,
    end,
    (next) => formatter(next),
    { enabled: animate, durationMs: RESULT_NUMBER_ANIM_MS, allowRememberedStart: false },
  );
}

function setCurrencyOutput(
  el: HTMLElement | null,
  value: number | null,
  animate: boolean,
  suffix = '',
): void {
  setNumberOutput(el, value, (next) => `${formatUSD(next)}${suffix}`, animate);
}

function setDurationOutput(
  el: HTMLElement | null,
  totalDays: number | null,
  animate: boolean,
): void {
  setNumberOutput(el, totalDays, (next) => formatDashboardDurationLabel(next), animate);
}

function getReachedLabel(key: MilestoneKey): string {
  return key === 'be' ? 'BE alcanzado' : 'Meta alcanzada';
}

function setMilestoneOutputs(
  dateEl: HTMLElement | null,
  timeEl: HTMLElement | null,
  key: MilestoneKey,
  milestone: MilestoneResolution,
  animate: boolean,
  enabled = true,
): void {
  if (!enabled) {
    setStaticOutput(dateEl, '---');
    setStaticOutput(timeEl, '---');
    return;
  }

  if (milestone.isReached) {
    setTextOutput(dateEl, getReachedLabel(key), animate, 'scramble');
    setTextOutput(timeEl, '---', animate, 'fade');
    return;
  }

  setTextOutput(dateEl, milestone.date ? formatDateLatin(milestone.date) : '---', animate, 'scramble');
  setDurationOutput(timeEl, milestone.days, animate);
}

function setInvalidSimulationOutputs(container: HTMLElement): void {
  const beDateEl = container.querySelector('#sim-out-be-date') as HTMLElement | null;
  const beTimeEl = container.querySelector('#sim-out-be-time') as HTMLElement | null;
  const goalDateEl = container.querySelector('#sim-out-goal-date') as HTMLElement | null;
  const goalTimeEl = container.querySelector('#sim-out-goal-time') as HTMLElement | null;
  const dailyEl = container.querySelector('#sim-out-daily') as HTMLElement | null;
  const monthlyEl = container.querySelector('#sim-out-monthly') as HTMLElement | null;
  const rateEl = container.querySelector('#sim-out-rate') as HTMLElement | null;
  const finalEl = container.querySelector('#sim-out-final') as HTMLElement | null;
  const tableContainer = container.querySelector('#sim-table-container') as HTMLElement | null;

  setStaticOutput(beDateEl, '---');
  setStaticOutput(beTimeEl, '---');
  setStaticOutput(goalDateEl, '---');
  setStaticOutput(goalTimeEl, '---');
  setStaticOutput(dailyEl, '---');
  setStaticOutput(monthlyEl, '---');
  setStaticOutput(rateEl, '---');
  setStaticOutput(finalEl, '---');

  if (tableContainer) tableContainer.style.display = 'none';
}

function resolveProjectionRowClasses(
  month: number,
  primaryKey: MilestoneKey,
  beCrossMonth: number | null,
  goalCrossMonth: number | null,
): string {
  const classes: string[] = [];
  const primaryCrossMonth = primaryKey === 'be' ? beCrossMonth : goalCrossMonth;

  if (month === beCrossMonth) classes.push('sim-row-cross-be');
  if (month === goalCrossMonth) classes.push('sim-row-cross-goal');
  if (month === primaryCrossMonth) classes.push('sim-row-cross-active');

  return classes.join(' ');
}

export function renderSimulator(container: HTMLElement): () => void {
  const state = loadState();
  const defaults = getDefaultViewState();
  const viewState = loadSimulatorViewState(defaults);
  const autoState: AutoState = {
    capital: viewState.autoCapital,
    apr: viewState.autoApr,
    goal: viewState.autoGoal,
  };

  container.innerHTML = `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">Simulador de recuperacion</h2>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-title" style="margin-bottom:var(--space-md)">Parametros</div>
          <div class="form-group">
            <label class="label-with-badge">
              Capital actual (USD)
              <span class="auto-tag ${autoState.capital ? 'is-auto' : 'is-manual'}" id="sim-capital-tag">${autoState.capital ? 'AUTO' : 'MANUAL'}</span>
            </label>
            <input type="number" id="sim-capital" step="1" value="${autoState.capital ? '' : viewState.capital.toFixed(2)}">
            <div class="text-muted" id="sim-capital-hint" style="font-size:0.72rem;margin-top:2px">
              ${autoState.capital ? AUTO_CAPITAL_HINT : 'Valor personalizado'}
            </div>
          </div>
          <div class="form-group">
            <label class="label-with-badge">
              APR esperado (%)
              <span class="auto-tag ${autoState.apr ? 'is-auto' : 'is-manual'}" id="sim-apr-tag">${autoState.apr ? 'AUTO' : 'MANUAL'}</span>
            </label>
            <input type="number" id="sim-apr" step="1" value="${autoState.apr ? '' : viewState.apr.toFixed(2)}">
            <div class="text-muted" id="sim-apr-hint" style="font-size:0.72rem;margin-top:2px">
              ${autoState.apr ? formatAutoAprHint(null) : 'Valor personalizado'}
            </div>
          </div>
          <div class="form-group">
            <label>Capitalizacion</label>
            <select id="sim-frequency">
              <option value="daily" ${viewState.frequency === 'daily' ? 'selected' : ''}>Diaria</option>
              <option value="weekly" ${viewState.frequency === 'weekly' ? 'selected' : ''}>Semanal</option>
              <option value="biweekly" ${viewState.frequency === 'biweekly' ? 'selected' : ''}>Quincenal</option>
            </select>
          </div>
          <div class="form-group">
            <label class="label-with-badge">
              Meta (USD)
              <span class="auto-tag ${autoState.goal ? 'is-auto' : 'is-manual'}" id="sim-goal-tag">${autoState.goal ? 'AUTO' : 'MANUAL'}</span>
            </label>
            <input type="number" id="sim-goal" step="1" value="${(autoState.goal ? state.portfolio.goalAmount : viewState.goal).toFixed(2)}">
            <div class="text-muted" id="sim-goal-hint" style="font-size:0.72rem;margin-top:2px">
              ${autoState.goal ? 'Meta del dashboard' : 'Valor personalizado'}
            </div>
          </div>
          <div style="display:flex;gap:var(--space-sm)">
            <button class="btn btn-sm" id="btn-sim-reset" style="flex:1">${iconRefreshCw(14)} Resetear AUTO</button>
            <button class="btn btn-primary" id="btn-simulate" style="flex:2">${iconTarget(14)} Simular</button>
          </div>
        </div>

        <div class="card" id="sim-results">
          <div class="card-title" style="margin-bottom:var(--space-lg)">Resultados</div>
          <div class="sim-results-container">
            <div class="sim-milestones-grid">
              <div class="sim-milestone-col">
                <div class="sim-result-label">BE</div>
                <div class="sim-result-item">
                  <div class="sim-result-label">Fecha estimada</div>
                  <div class="sim-result-value medium mono text-accent" id="sim-out-be-date">
                    <span class="skeleton" style="width:140px;height:1.1rem"></span>
                  </div>
                </div>
                <div class="sim-result-item">
                  <div class="sim-result-label">Tiempo restante</div>
                  <div class="sim-result-value medium mono" id="sim-out-be-time">
                    <span class="skeleton" style="width:92px;height:1.1rem"></span>
                  </div>
                </div>
              </div>
              <div class="sim-milestone-col">
                <div class="sim-result-label">Meta</div>
                <div class="sim-result-item">
                  <div class="sim-result-label">Fecha estimada</div>
                  <div class="sim-result-value medium mono text-accent" id="sim-out-goal-date">
                    <span class="skeleton" style="width:140px;height:1.1rem"></span>
                  </div>
                </div>
                <div class="sim-result-item">
                  <div class="sim-result-label">Tiempo restante</div>
                  <div class="sim-result-value medium mono" id="sim-out-goal-time">
                    <span class="skeleton" style="width:92px;height:1.1rem"></span>
                  </div>
                </div>
              </div>
            </div>
            <div class="sim-result-item">
              <div class="sim-result-label">Run-rate diario estimado</div>
              <div class="sim-result-value medium text-gain mono" id="sim-out-daily">
                <span class="skeleton" style="width:100px;height:1.1rem"></span>
              </div>
            </div>
            <div class="sim-result-item">
              <div class="sim-result-label">Run-rate mensual estimado</div>
              <div class="sim-result-value medium text-gain mono" id="sim-out-monthly">
                <span class="skeleton" style="width:100px;height:1.1rem"></span>
              </div>
            </div>
            <div class="sim-result-item">
              <div class="sim-result-label">Tasa diaria comp. / APY</div>
              <div class="sim-result-value small mono" id="sim-out-rate">
                <span class="skeleton" style="width:60px;height:1rem"></span>
              </div>
            </div>
            <div class="sim-result-item">
              <div class="sim-result-label">Balance final (ultimo mes proyectado)</div>
              <div class="sim-result-value medium mono" id="sim-out-final">
                <span class="skeleton" style="width:100px;height:1.1rem"></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" id="sim-table-container">
        <div class="card-title" style="margin-bottom:var(--space-md)">Proyeccion mensual</div>
        <div class="chart-container" style="margin-bottom:var(--space-lg)">
          <canvas id="projection-chart" style="display:none"></canvas>
          <div class="sim-projection-chart-skeleton" id="sim-projection-chart-skeleton">
            <span class="skeleton" style="width:100%;height:184px"></span>
          </div>
        </div>
        <div class="table-container" id="sim-table"></div>
      </div>
    </div>
  `;

  renderProjectionLoadingState(container);

  const triggerSimulation = (options: TriggerSimulationOptions = {}): void => {
    const shouldPersist = options.persist !== false;
    const animate = options.animate !== false;
    if (shouldPersist) persistSimulatorViewState(container, autoState);
    runSimulation(container, autoState, { animate });
  };

  bindSimulatorEvents(container, autoState, triggerSimulation);

  let disposed = false;
  let isHydrating = false;

  const syncAutoGoal = (): boolean => {
    if (!autoState.goal) return false;
    const goalInput = container.querySelector('#sim-goal') as HTMLInputElement | null;
    const goalHint = container.querySelector('#sim-goal-hint') as HTMLElement | null;
    if (!goalInput) return false;

    const nextGoal = loadState().portfolio.goalAmount.toFixed(2);
    let changed = false;
    if (goalInput.value !== nextGoal) {
      goalInput.value = nextGoal;
      changed = true;
    }
    if (goalHint) goalHint.textContent = 'Meta del dashboard';
    return changed;
  };

  const syncAutoValues = async (forceRefresh = false): Promise<boolean> => {
    if (disposed || isHydrating || !container.isConnected) return false;
    isHydrating = true;
    try {
      const { positions } = loadState();
      return await hydrateAutoValues(container, positions, autoState, forceRefresh);
    } finally {
      isHydrating = false;
    }
  };

  if (autoState.capital || autoState.apr) {
    void syncAutoValues().finally(() => {
      syncAutoGoal();
      triggerSimulation({ persist: true, animate: false });
    });
  } else {
    syncAutoGoal();
    triggerSimulation({ persist: true, animate: false });
  }

  const unsubscribeMarket = subscribeToMarketTicks(async (forceRefresh) => {
    if (disposed || !container.isConnected) return;
    const changed = await syncAutoValues(forceRefresh);
    const goalChanged = syncAutoGoal();
    if (changed || goalChanged) {
      triggerSimulation({ persist: true, animate: true });
    } else {
      persistSimulatorViewState(container, autoState);
    }
  }, false);

  return () => {
    disposed = true;
    unsubscribeMarket();
  };
}

async function hydrateAutoValues(
  container: HTMLElement,
  positions: DualPosition[],
  autoState: AutoState,
  forceRefresh = false,
): Promise<boolean> {
  const capitalInput = container.querySelector('#sim-capital') as HTMLInputElement | null;
  const aprInput = container.querySelector('#sim-apr') as HTMLInputElement | null;
  const capitalHint = container.querySelector('#sim-capital-hint') as HTMLElement | null;
  const aprHint = container.querySelector('#sim-apr-hint') as HTMLElement | null;
  if (!capitalInput || !aprInput || !capitalHint || !aprHint) return false;

  let changed = false;

  if (positions.length === 0) {
    if (autoState.capital) {
      capitalInput.value = '0.00';
      capitalHint.textContent = AUTO_CAPITAL_HINT;
    }
    if (autoState.apr) aprHint.textContent = formatAutoAprHint(null);
    return false;
  }

  try {
    const metrics = await calculatePositionMetrics(positions, { forceRefresh });
    registerApiLastUpdatedAt(metrics.marketLastUpdatedAt);
    if (metrics.hasStalePrices || metrics.hasUnavailablePrices) {
      registerApiFailure();
      showApiErrorBanner('No se pudo actualizar precios de mercado.');
    }

    if (autoState.capital) {
      if (metrics.totalUsd > 0) {
        const nextCapital = metrics.totalUsd.toFixed(2);
        if (capitalInput.value !== nextCapital) {
          capitalInput.value = nextCapital;
          changed = true;
        }
      }
      capitalHint.textContent = AUTO_CAPITAL_HINT;
    }

    if (autoState.apr) {
      if (metrics.weightedApr > 0) {
        const nextApr = metrics.weightedApr.toFixed(2);
        if (aprInput.value !== nextApr) {
          aprInput.value = nextApr;
          changed = true;
        }
      }
      aprHint.textContent = formatAutoAprHint(metrics.weightedApr > 0 ? metrics.weightedApr : null);
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[Simulator] market hydration failed:', err);
    registerApiFailure();
    showApiErrorBanner('No se pudo actualizar precios de mercado.');
  }

  return changed;
}

function bindSimulatorEvents(
  container: HTMLElement,
  autoState: AutoState,
  triggerSimulation: (options?: TriggerSimulationOptions) => void,
): void {
  const capitalInput = container.querySelector('#sim-capital') as HTMLInputElement;
  const aprInput = container.querySelector('#sim-apr') as HTMLInputElement;
  const frequencyInput = container.querySelector('#sim-frequency') as HTMLSelectElement;
  const goalInput = container.querySelector('#sim-goal') as HTMLInputElement;
  const capitalTag = container.querySelector('#sim-capital-tag') as HTMLElement;
  const aprTag = container.querySelector('#sim-apr-tag') as HTMLElement;
  const goalTag = container.querySelector('#sim-goal-tag') as HTMLElement;
  const capitalHint = container.querySelector('#sim-capital-hint') as HTMLElement;
  const aprHint = container.querySelector('#sim-apr-hint') as HTMLElement;
  const goalHint = container.querySelector('#sim-goal-hint') as HTMLElement;

  capitalInput.addEventListener('input', () => {
    autoState.capital = false;
    setTagMode(capitalTag, false);
    capitalHint.textContent = 'Valor personalizado';
    persistSimulatorViewState(container, autoState);
  });

  aprInput.addEventListener('input', () => {
    autoState.apr = false;
    setTagMode(aprTag, false);
    aprHint.textContent = 'Valor personalizado';
    persistSimulatorViewState(container, autoState);
  });

  goalInput.addEventListener('input', () => {
    autoState.goal = false;
    setTagMode(goalTag, false);
    goalHint.textContent = 'Valor personalizado';
    persistSimulatorViewState(container, autoState);
  });

  frequencyInput.addEventListener('change', () => {
    triggerSimulation({ persist: true, animate: true });
  });

  container.querySelector('#btn-sim-reset')?.addEventListener('click', () => {
    autoState.capital = true;
    autoState.apr = true;
    autoState.goal = true;
    setTagMode(capitalTag, true);
    setTagMode(aprTag, true);
    setTagMode(goalTag, true);

    const state = loadState();
    capitalInput.value = '';
    capitalHint.textContent = AUTO_CAPITAL_HINT;

    aprInput.value = '';
    aprHint.textContent = formatAutoAprHint(null);

    goalInput.value = state.portfolio.goalAmount.toFixed(2);
    goalHint.textContent = 'Meta del dashboard';

    void hydrateAutoValues(container, state.positions, autoState).then(() => {
      triggerSimulation({ persist: true, animate: true });
    });
  });

  container.querySelector('#btn-simulate')?.addEventListener('click', () => {
    triggerSimulation({ persist: true, animate: true });
  });

  container.querySelectorAll('input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        triggerSimulation({ persist: true, animate: true });
      }
    });
  });
}

function runSimulation(
  container: HTMLElement,
  autoState: AutoState,
  options: RunSimulationOptions = {},
): void {
  const animate = options.animate !== false;
  const capital = parseFloat((container.querySelector('#sim-capital') as HTMLInputElement).value);
  const apr = parseFloat((container.querySelector('#sim-apr') as HTMLInputElement).value);
  const frequency = (container.querySelector('#sim-frequency') as HTMLSelectElement).value as CompoundFrequency;
  const state = loadState();
  const goalInput = container.querySelector('#sim-goal') as HTMLInputElement | null;
  const goalHint = container.querySelector('#sim-goal-hint') as HTMLElement | null;

  if (goalInput && autoState.goal) {
    goalInput.value = state.portfolio.goalAmount.toFixed(2);
  }
  if (goalHint) {
    goalHint.textContent = autoState.goal ? 'Meta del dashboard' : 'Valor personalizado';
  }

  const rawGoal = autoState.goal
    ? state.portfolio.goalAmount
    : parseFloat(goalInput?.value ?? '');
  const goalIsValid = Number.isFinite(rawGoal) && rawGoal > 0;
  const goal = goalIsValid ? rawGoal : 0;
  const invested = state.portfolio.totalInvested;

  const hasInvalidCore = !Number.isFinite(capital) || !Number.isFinite(apr) || capital <= 0 || apr <= 0;
  const hasInvalidBreakevenTarget = !Number.isFinite(invested) || invested <= 0;

  if (hasInvalidCore || hasInvalidBreakevenTarget) {
    setInvalidSimulationOutputs(container);
    return;
  }

  const snapshot = buildProjectionSnapshot({
    capital,
    apr,
    frequency,
    goal,
    invested,
  });
  const milestones = resolveSimulationMilestones(snapshot, 'both');
  const beDateEl = container.querySelector('#sim-out-be-date') as HTMLElement | null;
  const beTimeEl = container.querySelector('#sim-out-be-time') as HTMLElement | null;
  const goalDateEl = container.querySelector('#sim-out-goal-date') as HTMLElement | null;
  const goalTimeEl = container.querySelector('#sim-out-goal-time') as HTMLElement | null;
  const dailyEl = container.querySelector('#sim-out-daily') as HTMLElement | null;
  const monthlyEl = container.querySelector('#sim-out-monthly') as HTMLElement | null;
  const rateEl = container.querySelector('#sim-out-rate') as HTMLElement | null;
  const finalEl = container.querySelector('#sim-out-final') as HTMLElement | null;

  setMilestoneOutputs(beDateEl, beTimeEl, 'be', milestones.byMilestone.be, animate, true);
  setMilestoneOutputs(goalDateEl, goalTimeEl, 'goal', milestones.byMilestone.goal, animate, goalIsValid);

  const dailyRunRate = calcDailyEarnings(capital, apr);
  const monthlyRunRate = calcMonthlyEarnings(capital, apr);
  const { dailyCompoundedPct, apyPct } = compoundedRateMetrics(apr, frequency);

  setCurrencyOutput(dailyEl, dailyRunRate, animate, ' /dia');
  setCurrencyOutput(monthlyEl, monthlyRunRate, animate, ' /mes');
  setTextOutput(rateEl, `${dailyCompoundedPct.toFixed(4)}% / ${apyPct.toFixed(2)}%`, animate, 'scramble');
  setCurrencyOutput(finalEl, snapshot.lastRow?.balance ?? null, animate);

  const projectedRows = snapshot.rows.filter((row) => row.month >= 1 && row.month <= PROJECTION_MAX_MONTH);
  const tableContainer = container.querySelector('#sim-table-container') as HTMLElement | null;
  const tableEl = container.querySelector('#sim-table') as HTMLElement | null;
  const canvas = container.querySelector('#projection-chart') as HTMLCanvasElement | null;
  const chartSkeleton = container.querySelector('#sim-projection-chart-skeleton') as HTMLElement | null;
  if (!tableContainer || !tableEl || projectedRows.length === 0) {
    if (tableContainer) tableContainer.style.display = 'none';
    if (canvas) canvas.style.display = 'none';
    if (chartSkeleton) chartSkeleton.style.display = 'none';
    return;
  }

  const beCrossMonth = milestones.byMilestone.be.row?.month ?? null;
  const goalCrossMonth = milestones.byMilestone.goal.row?.month ?? null;

  tableContainer.style.display = 'block';
  if (canvas) canvas.style.display = 'block';
  if (chartSkeleton) chartSkeleton.style.display = 'none';
  tableEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Mes</th>
          <th>Fecha</th>
          <th>Balance</th>
          <th>Ganancia acumulada</th>
        </tr>
      </thead>
      <tbody>
        ${projectedRows.map((row) => {
    const rowClass = resolveProjectionRowClasses(
      row.month,
      milestones.primaryKey,
      beCrossMonth,
      goalCrossMonth,
    );
    return `
            <tr${rowClass ? ` class="${rowClass}"` : ''}>
              <td class="mono">${row.month}</td>
              <td>${formatDateLatin(row.date)}</td>
              <td class="mono">${formatUSD(row.balance)}</td>
              <td class="mono ${row.earned > 0 ? 'text-gain' : ''}">${formatUSD(row.earned)}</td>
            </tr>
          `;
  }).join('')}
      </tbody>
    </table>
  `;

  void renderProjectionChart(container, projectedRows, snapshot.targetByMilestone);
}

async function renderProjectionChart(
  container: HTMLElement,
  rows: { month: number; date: string; balance: number }[],
  targets: { be: number; goal: number },
): Promise<void> {
  const canvas = container.querySelector('#projection-chart') as HTMLCanvasElement | null;
  if (!canvas) return;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return;

  try {
    const context = canvas.getContext('2d');
    if (!context) return;

    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);

    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    const cc = getChartColors();
    const datasets: ChartDataset<'line', number[]>[] = [{
      label: 'Balance proyectado',
      data: rows.map((row) => row.balance),
      borderColor: cc.line,
      backgroundColor: cc.fill,
      fill: true,
      tension: 0.3,
      pointRadius: rows.length > 30 ? 0 : 3,
      pointBackgroundColor: cc.pointBg,
      borderWidth: 1.5,
    }];

    if (targets.be > 0) {
      datasets.push({
        label: 'BE',
        data: rows.map(() => targets.be),
        borderColor: cc.beTarget,
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      });
    }

    if (targets.goal > 0) {
      datasets.push({
        label: 'Meta',
        data: rows.map(() => targets.goal),
        borderColor: cc.goalTarget,
        borderDash: [8, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      });
    }

    new Chart(context, {
      type: 'line',
      data: {
        labels: rows.map((row) => row.month === 0 ? 'Hoy' : `M${row.month}`),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            labels: { color: cc.legend, font: { size: 12 } },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: $${(ctx.parsed?.y ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: cc.tick, font: { size: 11 }, maxTicksLimit: 20 },
            grid: { color: cc.grid },
          },
          y: {
            ticks: {
              color: cc.tick,
              font: { size: 11 },
              callback: (value) => '$' + Number(value).toLocaleString(),
            },
            grid: { color: cc.grid },
          },
        },
      },
    });
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[Simulator] Chart.js error:', err);
    return;
  }
}
