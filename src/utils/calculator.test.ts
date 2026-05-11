import { describe, it, expect } from '#test';
import {
  compoundedRateMetrics,
  dailyEarnings,
  estimateDaysToGoal,
  estimateDaysToGoalFromProjection,
  formatDateLatin,
  formatPct,
  generateProjection,
  monthlyEarnings,
  weightedAverageAPR,
} from './calculator';

describe('calculator utils', () => {
  it('computes weighted APR by USD amount', () => {
    const positions = [
      {
        id: 'a',
        asset: 'ETH',
        direction: 'buy-low' as const,
        subscriptionAsset: 'USDT',
        amount: 100,
        targetPrice: 2000,
        entryDate: '2026-02-18',
        settlementDate: '2026-02-19',
        apr: 10,
      },
      {
        id: 'b',
        asset: 'BTC',
        direction: 'buy-low' as const,
        subscriptionAsset: 'USDT',
        amount: 300,
        targetPrice: 50000,
        entryDate: '2026-02-18',
        settlementDate: '2026-02-19',
        apr: 30,
      },
    ];

    expect(weightedAverageAPR(positions)).toBe(25);
  });

  it('estimates days to goal with daily compounding', () => {
    const days = estimateDaysToGoal(1000, 36.5, 2000);
    expect(days).not.toBeNull();
    expect(days!).toBeGreaterThan(600);
    expect(days!).toBeLessThan(800);
  });

  it('handles estimateDaysToGoal edge cases and invalid values', () => {
    expect(estimateDaysToGoal(1000, 10, 1000)).toBe(0);
    expect(estimateDaysToGoal(0, 10, 1000)).toBeNull();
    expect(estimateDaysToGoal(1000, 0, 2000)).toBeNull();
    expect(estimateDaysToGoal(1000, 10, 500)).toBe(0);
  });

  it('generates projection rows and detects goal date', () => {
    const { rows, goalDate } = generateProjection({
      capital: 1000,
      apr: 100,
      frequency: 'daily',
      goal: 1200,
      invested: 1000,
    });

    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].month).toBe(0);
    expect(rows[0].balance).toBe(1000);
    expect(goalDate).not.toBeNull();
  });

  it('calculates breakeven against invested capital, independent from goal', () => {
    const { breakevenDate, goalDate } = generateProjection({
      capital: 1000,
      apr: 20,
      frequency: 'daily',
      goal: 5000,
      invested: 1100,
    });

    expect(breakevenDate).not.toBeNull();
    expect(goalDate).not.toBeNull();
    expect(breakevenDate! < goalDate!).toBe(true);
  });

  it('marks breakeven immediately when capital already covers invested', () => {
    const { rows, breakevenDate } = generateProjection({
      capital: 1200,
      apr: 15,
      frequency: 'daily',
      goal: 2000,
      invested: 1000,
    });

    expect(breakevenDate).toBe(rows[0].date);
  });

  it('matches compounded balance formula for first month (daily frequency)', () => {
    const { rows } = generateProjection({
      capital: 1000,
      apr: 100,
      frequency: 'daily',
      goal: 1000000,
      invested: 1000,
    });

    const monthOne = rows.find((r) => r.month === 1);
    expect(monthOne).toBeDefined();
    expect(monthOne!.balance).toBeCloseTo(1085.54, 2);
  });

  it('always includes at least 12 projected months', () => {
    const { rows } = generateProjection({
      capital: 1000,
      apr: 500,
      frequency: 'daily',
      goal: 1050,
      invested: 1000,
    });

    expect(rows.some((r) => r.month === 12)).toBe(true);
  });

  it('computes compounded daily rate and APY consistently', () => {
    const daily = compoundedRateMetrics(36.5, 'daily');
    expect(daily.dailyCompoundedPct).toBeCloseTo(0.1, 6);
    expect(daily.apyPct).toBeCloseTo(44.025131, 6);

    const weekly = compoundedRateMetrics(12, 'weekly');
    expect(weekly.dailyCompoundedPct).toBeCloseTo(0.032844, 6);
    expect(weekly.apyPct).toBeCloseTo(12.734099, 6);
  });

  it('keeps daily and monthly nominal run-rate formulas aligned', () => {
    expect(dailyEarnings(1000, 36.5)).toBeCloseTo(1, 8);
    expect(monthlyEarnings(1200, 120)).toBeCloseTo(120, 8);
  });

  it('estimates days to goal from projection rows consistently', () => {
    const { rows } = generateProjection({
      capital: 1000,
      apr: 100,
      frequency: 'weekly',
      goal: 1200,
      invested: 1000,
    });

    const days = estimateDaysToGoalFromProjection(rows, 1200);
    expect(days).not.toBeNull();
    expect(days!).toBeGreaterThan(60);
    expect(days!).toBeLessThan(90);
  });

  it('returns null for invalid projection interpolation inputs', () => {
    expect(estimateDaysToGoalFromProjection([], 1200)).toBeNull();
    expect(
      estimateDaysToGoalFromProjection(
        [{ month: 0, date: '2026-02-21', balance: 1000, earned: 0 }],
        -1,
      ),
    ).toBeNull();
    expect(
      estimateDaysToGoalFromProjection(
        [{ month: 0, date: '2026-02-21', balance: 1000, earned: 0 }],
        1200,
        0,
      ),
    ).toBeNull();
  });

  it('formats latin dates and percentage strings', () => {
    expect(formatDateLatin('2026-02-21')).toBe('21/02/2026');
    expect(formatDateLatin('bad-date')).toBe('bad-date');
    expect(formatPct(12.3456)).toBe('+12.35%');
    expect(formatPct(-1.234, 3)).toBe('-1.234%');
  });
});
