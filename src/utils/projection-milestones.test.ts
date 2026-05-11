import { describe, expect, it, vi } from '#test';
import * as calculator from './calculator';
import {
  buildProjectionSnapshot,
  resolveMilestoneFromRows,
  resolveSimulationMilestones,
} from './projection-milestones';

describe('projection-milestones', () => {
  it('builds BE and Meta milestones from a single projection run', () => {
    const projectionSpy = vi.spyOn(calculator, 'generateProjection');

    const snapshot = buildProjectionSnapshot({
      capital: 1000,
      apr: 80,
      frequency: 'daily',
      goal: 1400,
      invested: 1100,
    });

    expect(projectionSpy).toHaveBeenCalledTimes(1);
    expect(snapshot.breakeven.date).not.toBeNull();
    expect(snapshot.goal.date).not.toBeNull();
    expect(snapshot.daysByMilestone.be).not.toBeNull();
    expect(snapshot.daysByMilestone.goal).not.toBeNull();
    expect(snapshot.daysByMilestone.be!).toBeLessThan(snapshot.daysByMilestone.goal!);
  });

  it('resolves reached and non-reached milestone states', () => {
    const rows = [
      { month: 0, date: '2026-02-21', balance: 1200, earned: 0 },
      { month: 1, date: '2026-03-21', balance: 1260, earned: 60 },
    ];

    const reached = resolveMilestoneFromRows(rows, 1000, 'be');
    const missing = resolveMilestoneFromRows(rows, 1800, 'goal');

    expect(reached.isReached).toBe(true);
    expect(reached.days).toBe(0);
    expect(reached.date).toBe('2026-02-21');

    expect(missing.isReached).toBe(false);
    expect(missing.isProjected).toBe(false);
    expect(missing.days).toBeNull();
    expect(missing.date).toBeNull();
  });

  it('keeps date/day milestone maps aligned with resolved milestones', () => {
    const snapshot = buildProjectionSnapshot({
      capital: 1000,
      apr: 100,
      frequency: 'weekly',
      goal: 1300,
      invested: 1100,
    });

    expect(snapshot.dateByMilestone.be).toBe(snapshot.breakeven.date);
    expect(snapshot.dateByMilestone.goal).toBe(snapshot.goal.date);
    expect(snapshot.daysByMilestone.be).toBe(snapshot.breakeven.days);
    expect(snapshot.daysByMilestone.goal).toBe(snapshot.goal.days);
  });

  it('uses the farthest milestone as primary', () => {
    const snapshot = buildProjectionSnapshot({
      capital: 1000,
      apr: 60,
      frequency: 'daily',
      goal: 900,
      invested: 1200,
    });

    const selection = resolveSimulationMilestones(snapshot);

    expect(selection.primaryKey).toBe('be');
    expect(selection.secondaryKey).toBe('goal');
  });
});
