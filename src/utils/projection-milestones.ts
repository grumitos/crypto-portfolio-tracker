import type { ProjectionRow, SimulatorParams } from '../types';
import { estimateDaysToGoalFromProjection, generateProjection } from './calculator';

export type MilestoneKey = 'be' | 'goal';

export interface MilestoneTargetAmounts {
  be: number;
  goal: number;
}

export interface MilestoneResolution {
  key: MilestoneKey;
  targetAmount: number;
  row: ProjectionRow | null;
  date: string | null;
  days: number | null;
  isReached: boolean;
  isProjected: boolean;
}

export interface ProjectionSnapshot {
  rows: ProjectionRow[];
  breakeven: MilestoneResolution;
  goal: MilestoneResolution;
  lastRow: ProjectionRow | null;
  daysByMilestone: Record<MilestoneKey, number | null>;
  dateByMilestone: Record<MilestoneKey, string | null>;
  targetByMilestone: MilestoneTargetAmounts;
}

export interface SimulationMilestoneSelection {
  primaryKey: MilestoneKey;
  secondaryKey: MilestoneKey | null;
  primary: MilestoneResolution;
  secondary: MilestoneResolution | null;
  byMilestone: Record<MilestoneKey, MilestoneResolution>;
}

function sanitizePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function emptyMilestone(key: MilestoneKey, targetAmount: number): MilestoneResolution {
  return {
    key,
    targetAmount,
    row: null,
    date: null,
    days: null,
    isReached: false,
    isProjected: false,
  };
}

function resolveMilestoneTargetAmounts(invested: number, goal: number): MilestoneTargetAmounts {
  return {
    be: sanitizePositive(invested),
    goal: sanitizePositive(goal),
  };
}

export function resolveMilestoneFromRows(
  rows: ProjectionRow[],
  targetAmount: number,
  key: MilestoneKey,
): MilestoneResolution {
  const safeTarget = sanitizePositive(targetAmount);
  if (!Array.isArray(rows) || rows.length === 0 || safeTarget <= 0) {
    return emptyMilestone(key, safeTarget);
  }

  const first = rows[0];
  const crossingRow = rows.find((row) => row.balance >= safeTarget) ?? null;
  const isReached = first.balance >= safeTarget;
  const days = crossingRow ? estimateDaysToGoalFromProjection(rows, safeTarget) : null;

  return {
    key,
    targetAmount: safeTarget,
    row: crossingRow,
    date: crossingRow?.date ?? null,
    days,
    isReached,
    isProjected: crossingRow !== null,
  };
}

export function buildProjectionSnapshot(params: SimulatorParams): ProjectionSnapshot {
  const targets = resolveMilestoneTargetAmounts(params.invested, params.goal);
  const defaultSnapshot: ProjectionSnapshot = {
    rows: [],
    breakeven: emptyMilestone('be', targets.be),
    goal: emptyMilestone('goal', targets.goal),
    lastRow: null,
    daysByMilestone: { be: null, goal: null },
    dateByMilestone: { be: null, goal: null },
    targetByMilestone: targets,
  };

  if (
    !Number.isFinite(params.capital) ||
    !Number.isFinite(params.apr) ||
    params.capital <= 0 ||
    params.apr <= 0
  ) {
    return defaultSnapshot;
  }

  const projectionGoal = Math.max(targets.be, targets.goal);
  if (projectionGoal <= 0) {
    return defaultSnapshot;
  }

  const { rows } = generateProjection({
    ...params,
    goal: projectionGoal,
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    return defaultSnapshot;
  }

  const breakeven = resolveMilestoneFromRows(rows, targets.be, 'be');
  const goal = resolveMilestoneFromRows(rows, targets.goal, 'goal');

  return {
    rows,
    breakeven,
    goal,
    lastRow: rows[rows.length - 1] ?? null,
    daysByMilestone: {
      be: breakeven.days,
      goal: goal.days,
    },
    dateByMilestone: {
      be: breakeven.date,
      goal: goal.date,
    },
    targetByMilestone: targets,
  };
}

function resolvePrimaryMilestoneKey(
  targets: MilestoneTargetAmounts,
): MilestoneKey {
  return targets.be > targets.goal ? 'be' : 'goal';
}

export function resolveSimulationMilestones(
  snapshot: ProjectionSnapshot,
): SimulationMilestoneSelection {
  const byMilestone: Record<MilestoneKey, MilestoneResolution> = {
    be: snapshot.breakeven,
    goal: snapshot.goal,
  };

  const primaryKey = resolvePrimaryMilestoneKey(snapshot.targetByMilestone);
  const secondaryKey = primaryKey === 'be' ? 'goal' : 'be';

  return {
    primaryKey,
    secondaryKey,
    primary: byMilestone[primaryKey],
    secondary: secondaryKey ? byMilestone[secondaryKey] : null,
    byMilestone,
  };
}
