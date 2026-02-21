import type { DashboardGoalDetails, DashboardGoalMode, DashboardLegendState } from '../types';

const DEFAULT_LEGEND_STATE: DashboardLegendState = {
  be: true,
  goal: true,
};

export function sanitizeDashboardLegendState(
  state: Partial<DashboardLegendState> | null | undefined,
): DashboardLegendState {
  const next: DashboardLegendState = {
    be: state?.be !== false,
    goal: state?.goal !== false,
  };

  if (!next.be && !next.goal) {
    return { ...DEFAULT_LEGEND_STATE };
  }

  return next;
}

export function resolveDashboardGoalMode(state: DashboardLegendState): DashboardGoalMode {
  if (state.be && state.goal) return 'both';
  if (state.be) return 'be';
  return 'goal';
}

export function toggleDashboardLegend(
  state: DashboardLegendState,
  key: keyof DashboardLegendState,
): DashboardLegendState {
  const next: DashboardLegendState = {
    ...state,
    [key]: !state[key],
  };

  if (!next.be && !next.goal) {
    return state;
  }

  return next;
}

export function resolveDashboardGoalDetails(
  balance: number,
  invested: number,
  goal: number,
  legendState: DashboardLegendState,
): DashboardGoalDetails {
  const mode = resolveDashboardGoalMode(legendState);
  const target = mode === 'be' ? 'be' : 'goal';
  const targetAmount = target === 'be' ? invested : goal;
  const isReached = Number.isFinite(balance) && Number.isFinite(targetAmount) && balance >= targetAmount;
  const remainingAmount = Number.isFinite(balance) && Number.isFinite(targetAmount)
    ? Math.max(0, targetAmount - balance)
    : 0;

  return {
    mode,
    target,
    targetAmount,
    remainingAmount,
    isReached,
    targetLabelShort: target === 'be' ? 'BE' : 'Meta',
    targetLabelLong: target === 'be' ? 'breakeven' : 'meta',
  };
}

export function formatDashboardDurationLabel(totalDays: number): string {
  const roundedDays = Math.max(0, Math.round(totalDays));
  const years = Math.floor(roundedDays / 365);
  const remainderAfterYears = roundedDays % 365;
  const months = Math.floor(remainderAfterYears / 30);
  const days = remainderAfterYears % 30;

  let label = '';
  if (years > 0) label += `${years}a `;
  if (months > 0 || years > 0) label += `${months}m `;
  label += `${days}d`;
  return `~${label}`;
}
