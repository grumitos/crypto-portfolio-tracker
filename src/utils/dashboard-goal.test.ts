import { describe, expect, it } from 'vitest';
import {
  formatDashboardDurationLabel,
  resolveDashboardGoalDetails,
  resolveDashboardGoalMode,
  sanitizeDashboardLegendState,
  toggleDashboardLegend,
} from './dashboard-goal';

describe('dashboard-goal utils', () => {
  it('defaults to both legends enabled', () => {
    expect(sanitizeDashboardLegendState(undefined)).toEqual({ be: true, goal: true });
    expect(sanitizeDashboardLegendState({ be: false, goal: false })).toEqual({
      be: true,
      goal: true,
    });
  });

  it('resolves mode correctly from legend state', () => {
    expect(resolveDashboardGoalMode({ be: true, goal: false })).toBe('be');
    expect(resolveDashboardGoalMode({ be: false, goal: true })).toBe('goal');
    expect(resolveDashboardGoalMode({ be: true, goal: true })).toBe('both');
  });

  it('prevents disabling the last active legend', () => {
    expect(toggleDashboardLegend({ be: true, goal: false }, 'be')).toEqual({
      be: true,
      goal: false,
    });
    expect(toggleDashboardLegend({ be: false, goal: true }, 'goal')).toEqual({
      be: false,
      goal: true,
    });
  });

  it('uses breakeven target in BE-only mode', () => {
    const details = resolveDashboardGoalDetails(900, 1000, 1200, { be: true, goal: false });
    expect(details.target).toBe('be');
    expect(details.remainingAmount).toBe(100);
    expect(details.isReached).toBe(false);
  });

  it('uses meta target in meta-only mode and both mode', () => {
    const goalOnly = resolveDashboardGoalDetails(900, 1000, 1200, { be: false, goal: true });
    expect(goalOnly.target).toBe('goal');
    expect(goalOnly.remainingAmount).toBe(300);

    const both = resolveDashboardGoalDetails(900, 1000, 1200, { be: true, goal: true });
    expect(both.target).toBe('goal');
    expect(both.remainingAmount).toBe(300);
  });

  it('marks targets as reached when balance covers target amount', () => {
    const beReached = resolveDashboardGoalDetails(1000, 1000, 1300, { be: true, goal: false });
    expect(beReached.isReached).toBe(true);

    const goalReached = resolveDashboardGoalDetails(1300, 1000, 1200, { be: false, goal: true });
    expect(goalReached.isReached).toBe(true);
  });

  it('formats duration labels', () => {
    expect(formatDashboardDurationLabel(9)).toBe('~9d');
    expect(formatDashboardDurationLabel(49)).toBe('~1m 19d');
    expect(formatDashboardDurationLabel(400)).toBe('~1a 1m 5d');
  });
});
