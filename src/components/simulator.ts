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
import { registerApiFailure, registerApiLastUpdatedAt } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { getSharedMarketData } from '../utils/api-runtime-cache';
import {
  getDefaultViewState,
  loadSimulatorViewState,
  persistSimulatorViewState,
  type AutoState,
} from './simulator.state';
import type { CompoundFrequency, DualPosition, ProjectionRow } from '../types';
import { subscribeToMarketTicks } from '../utils/market-poller';
import {
  setAnimatedNumber,
  setAnimatedText,
  stopValueAnimation as stopAnimationFrame,
} from '../utils/animation';
import { getSimulatorElements } from './simulator.dom';
import { PROJECTION_MAX_MONTH, RESULT_NUMBER_ANIM_MS, SIMULATOR_COPY } from './simulator.constants';
import {
  formatAutoAprHint,
  projectionTableSkeletonHtml,
  renderProjectionMilestone,
  renderProjectionTable,
  renderSimulatorTemplate,
} from './simulator.template';

const valueAnimationByElement = new WeakMap<HTMLElement, number>();
const textAnimationByElement = new WeakMap<HTMLElement, number>();

interface TriggerSimulationOptions {
  persist?: boolean;
  animate?: boolean;
}

interface RunSimulationOptions {
  animate?: boolean;
}

type ProjectionDisplayRow = ProjectionRow & { rowClass: string };

function renderProjectionLoadingState(container: HTMLElement): void {
  const elements = getSimulatorElements(container);

  if (elements.tableContainer) {
    elements.tableContainer.hidden = false;
    elements.tableContainer.style.display = 'block';
  }
  if (elements.table) elements.table.innerHTML = projectionTableSkeletonHtml();
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
  setAnimatedNumber(valueAnimationByElement, el, end, (next) => formatter(next), {
    enabled: animate,
    durationMs: RESULT_NUMBER_ANIM_MS,
    allowRememberedStart: false,
  });
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

function setProjectionNumberOutput(el: HTMLElement | null, value: number, animate: boolean): void {
  if (!el) return;
  stopTextAnimation(el);
  setAnimatedNumber(valueAnimationByElement, el, value, (next) => formatUSD(next), {
    enabled: animate,
    durationMs: RESULT_NUMBER_ANIM_MS,
    allowRememberedStart: false,
  });
}

function setProjectionTextOutput(el: HTMLElement | null, value: string, animate: boolean): void {
  setTextOutput(el, value, animate, 'fade');
}

function getReachedLabel(key: MilestoneKey): string {
  return key === 'be' ? SIMULATOR_COPY.reachedBreakEven : SIMULATOR_COPY.reachedGoal;
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

  setTextOutput(
    dateEl,
    milestone.date ? formatDateLatin(milestone.date) : '---',
    animate,
    'scramble',
  );
  setDurationOutput(timeEl, milestone.days, animate);
}

function setInvalidSimulationOutputs(container: HTMLElement): void {
  const elements = getSimulatorElements(container);

  setStaticOutput(elements.beDate, '---');
  setStaticOutput(elements.beTime, '---');
  setStaticOutput(elements.goalDate, '---');
  setStaticOutput(elements.goalTime, '---');
  setStaticOutput(elements.daily, '---');
  setStaticOutput(elements.monthly, '---');
  setStaticOutput(elements.rate, '---');
  setStaticOutput(elements.final, '---');

  if (elements.tableContainer) {
    elements.tableContainer.hidden = true;
    elements.tableContainer.style.display = 'none';
  }
}

function resolveProjectionRowClasses(
  month: number,
  beCrossMonth: number | null,
  goalCrossMonth: number | null,
): string {
  const classes: string[] = [];

  if (month === beCrossMonth) classes.push('sim-row-cross-be');
  if (month === goalCrossMonth) classes.push('sim-row-cross-goal');

  return classes.join(' ');
}

function hasReusableProjectionTable(table: HTMLElement, rows: ProjectionDisplayRow[]): boolean {
  const existingRows = [
    ...table.querySelectorAll<HTMLTableRowElement>('tbody tr[data-projection-row]'),
  ];
  if (existingRows.length !== rows.length) return false;

  return existingRows.every((row, index) => {
    return row.dataset.projectionRow === String(rows[index]?.month ?? '');
  });
}

function updateProjectionTableInPlace(
  table: HTMLElement,
  rows: ProjectionDisplayRow[],
  animate: boolean,
): boolean {
  if (!hasReusableProjectionTable(table, rows)) return false;

  rows.forEach((row) => {
    const rowEl = table.querySelector<HTMLTableRowElement>(
      `tbody tr[data-projection-row="${row.month}"]`,
    );
    if (!rowEl) return;

    rowEl.className = row.rowClass;

    const monthEl = rowEl.querySelector<HTMLElement>('[data-projection-cell="month"]');
    const dateEl = rowEl.querySelector<HTMLElement>('[data-projection-cell="date"]');
    const balanceEl = rowEl.querySelector<HTMLElement>('[data-projection-cell="balance"]');
    const earnedEl = rowEl.querySelector<HTMLElement>('[data-projection-cell="earned"]');
    const milestoneEl = rowEl.querySelector<HTMLElement>('[data-projection-cell="milestone"]');

    setProjectionTextOutput(monthEl, String(row.month), animate);
    setProjectionTextOutput(dateEl, formatDateLatin(row.date), animate);

    balanceEl?.classList.toggle('sim-projection-value-positive', row.balance > 0);
    setProjectionNumberOutput(balanceEl, row.balance, animate);

    earnedEl?.classList.toggle('text-gain', row.earned > 0);
    setProjectionNumberOutput(earnedEl, row.earned, animate);

    const nextMilestone = renderProjectionMilestone(row.rowClass);
    if (milestoneEl && milestoneEl.innerHTML !== nextMilestone) {
      milestoneEl.innerHTML = nextMilestone;
      if (animate) {
        milestoneEl.classList.remove('text-swap');
        void milestoneEl.offsetWidth;
        milestoneEl.classList.add('text-swap');
      }
    }
  });

  return true;
}

function updateProjectionTable(
  table: HTMLElement,
  rows: ProjectionDisplayRow[],
  animate: boolean,
): void {
  if (updateProjectionTableInPlace(table, rows, animate)) return;

  table.innerHTML = renderProjectionTable(rows, formatDateLatin, formatUSD);
  if (animate) {
    table.classList.remove('text-swap');
    void table.offsetWidth;
    table.classList.add('text-swap');
  }
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

  container.innerHTML = renderSimulatorTemplate(viewState, autoState, state.portfolio.goalAmount);

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

  const syncAutoGoal = (state: ReturnType<typeof loadState> = loadState()): boolean => {
    if (!autoState.goal) return false;
    const { goalInput, goalHint } = getSimulatorElements(container);
    if (!goalInput) return false;

    const nextGoal = state.portfolio.goalAmount.toFixed(2);
    let changed = false;
    if (goalInput.value !== nextGoal) {
      goalInput.value = nextGoal;
      changed = true;
    }
    if (goalHint) goalHint.textContent = SIMULATOR_COPY.autoGoalHint;
    return changed;
  };

  const syncAutoValues = async (
    forceRefresh = false,
    state: ReturnType<typeof loadState> = loadState(),
  ): Promise<boolean> => {
    if (disposed || isHydrating || !container.isConnected) return false;
    isHydrating = true;
    try {
      const { positions } = state;
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
    const state = loadState();
    const changed = await syncAutoValues(forceRefresh, state);
    const goalChanged = syncAutoGoal(state);
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
  const { capitalInput, aprInput, capitalHint, aprHint } = getSimulatorElements(container);
  if (!capitalInput || !aprInput || !capitalHint || !aprHint) return false;

  let changed = false;

  if (positions.length === 0) {
    if (autoState.capital) {
      capitalInput.value = '0.00';
      capitalHint.textContent = SIMULATOR_COPY.autoCapitalHint;
    }
    if (autoState.apr) aprHint.textContent = formatAutoAprHint(null);
    return false;
  }

  try {
    const { snapshot, metrics } = await getSharedMarketData(positions, forceRefresh);
    registerApiLastUpdatedAt(snapshot.marketLastUpdatedAt);
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
      capitalHint.textContent = SIMULATOR_COPY.autoCapitalHint;
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
  const {
    capitalInput,
    aprInput,
    frequencyInput,
    goalInput,
    capitalTag,
    aprTag,
    goalTag,
    capitalHint,
    aprHint,
    goalHint,
  } = getSimulatorElements(container);
  if (
    !capitalInput ||
    !aprInput ||
    !frequencyInput ||
    !goalInput ||
    !capitalTag ||
    !aprTag ||
    !goalTag ||
    !capitalHint ||
    !aprHint ||
    !goalHint
  ) {
    return;
  }

  capitalInput.addEventListener('input', () => {
    autoState.capital = false;
    setTagMode(capitalTag, false);
    capitalHint.textContent = SIMULATOR_COPY.manualHint;
    persistSimulatorViewState(container, autoState);
  });

  aprInput.addEventListener('input', () => {
    autoState.apr = false;
    setTagMode(aprTag, false);
    aprHint.textContent = SIMULATOR_COPY.manualHint;
    persistSimulatorViewState(container, autoState);
  });

  goalInput.addEventListener('input', () => {
    autoState.goal = false;
    setTagMode(goalTag, false);
    goalHint.textContent = SIMULATOR_COPY.manualHint;
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
    capitalHint.textContent = SIMULATOR_COPY.autoCapitalHint;

    aprInput.value = '';
    aprHint.textContent = formatAutoAprHint(null);

    goalInput.value = state.portfolio.goalAmount.toFixed(2);
    goalHint.textContent = SIMULATOR_COPY.autoGoalHint;

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
  const elements = getSimulatorElements(container);
  const capital = parseFloat(elements.capitalInput?.value ?? '');
  const apr = parseFloat(elements.aprInput?.value ?? '');
  const frequency = (elements.frequencyInput?.value ?? 'daily') as CompoundFrequency;
  const state = loadState();
  const { goalInput, goalHint } = elements;

  if (goalInput && autoState.goal) {
    goalInput.value = state.portfolio.goalAmount.toFixed(2);
  }
  if (goalHint) {
    goalHint.textContent = autoState.goal ? SIMULATOR_COPY.autoGoalHint : SIMULATOR_COPY.manualHint;
  }

  const rawGoal = autoState.goal ? state.portfolio.goalAmount : parseFloat(goalInput?.value ?? '');
  const goalIsValid = Number.isFinite(rawGoal) && rawGoal > 0;
  const goal = goalIsValid ? rawGoal : 0;
  const invested = state.portfolio.totalInvested;

  const hasInvalidCore =
    !Number.isFinite(capital) || !Number.isFinite(apr) || capital <= 0 || apr <= 0;
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
  const milestones = resolveSimulationMilestones(snapshot);
  setMilestoneOutputs(
    elements.beDate,
    elements.beTime,
    'be',
    milestones.byMilestone.be,
    animate,
    true,
  );
  setMilestoneOutputs(
    elements.goalDate,
    elements.goalTime,
    'goal',
    milestones.byMilestone.goal,
    animate,
    goalIsValid,
  );

  const dailyRunRate = calcDailyEarnings(capital, apr);
  const monthlyRunRate = calcMonthlyEarnings(capital, apr);
  const { dailyCompoundedPct, apyPct } = compoundedRateMetrics(apr, frequency);

  setCurrencyOutput(elements.daily, dailyRunRate, animate, ' /dia');
  setCurrencyOutput(elements.monthly, monthlyRunRate, animate, ' /mes');
  setTextOutput(
    elements.rate,
    `${dailyCompoundedPct.toFixed(4)}% / ${apyPct.toFixed(2)}%`,
    animate,
    'scramble',
  );
  setCurrencyOutput(elements.final, snapshot.lastRow?.balance ?? null, animate);

  const projectedRows = snapshot.rows.filter(
    (row) => row.month >= 1 && row.month <= PROJECTION_MAX_MONTH,
  );
  if (!elements.tableContainer || !elements.table || projectedRows.length === 0) {
    if (elements.tableContainer) {
      elements.tableContainer.hidden = true;
      elements.tableContainer.style.display = 'none';
    }
    return;
  }

  const beCrossMonth = milestones.byMilestone.be.row?.month ?? null;
  const goalCrossMonth = milestones.byMilestone.goal.row?.month ?? null;

  elements.tableContainer.hidden = false;
  elements.tableContainer.style.display = 'block';
  updateProjectionTable(
    elements.table,
    projectedRows.map((row) => ({
      ...row,
      rowClass: resolveProjectionRowClasses(row.month, beCrossMonth, goalCrossMonth),
    })),
    animate,
  );
}
