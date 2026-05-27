import type { SimulatorParams, ProjectionRow, CompoundFrequency, DualPosition } from '../types';
import { formatISODateLocal } from './date';

/**
 * Returns the number of compounding periods per year.
 */
function periodsPerYear(freq: CompoundFrequency): number {
  switch (freq) {
    case 'daily':
      return 365;
    case 'weekly':
      return 52;
    case 'biweekly':
      return 26;
  }
}

/**
 * Returns the number of days per compounding period.
 */
function daysPerPeriod(freq: CompoundFrequency): number {
  switch (freq) {
    case 'daily':
      return 1;
    case 'weekly':
      return 7;
    case 'biweekly':
      return 14;
  }
}

/**
 * Generate a month-by-month projection table.
 * Calculates compound interest and returns when goal is reached.
 */
export function generateProjection(params: SimulatorParams): {
  rows: ProjectionRow[];
  breakevenDate: string | null;
  goalDate: string | null;
} {
  const { capital, apr, frequency, goal, invested } = params;
  const n = periodsPerYear(frequency);
  const ratePerPeriod = apr / 100 / n;
  const dpPeriod = daysPerPeriod(frequency);
  const earningCapitalInput = params.earningCapital ?? capital;
  const earningCapital = Math.min(
    Math.max(0, Number.isFinite(earningCapitalInput) ? earningCapitalInput : 0),
    Math.max(0, capital),
  );
  const idleCapital = Math.max(0, capital - earningCapital);
  let activeCapital = earningCapital;

  const startDate = new Date();
  const rows: ProjectionRow[] = [];
  let balance = capital;
  let breakevenDate: string | null = capital >= invested ? formatDate(startDate) : null;
  let goalDate: string | null = null;

  const maxMonths = 120; // 10 years max
  const minProjectionMonths = 12; // Always keep at least one full year for simulator display

  // Add initial row
  rows.push({
    month: 0,
    date: formatDate(startDate),
    balance: capital,
    earned: 0,
  });

  for (let month = 1; month <= maxMonths; month++) {
    // Calculate how many periods in this month (~30 days)
    const periodsInMonth = Math.round(30 / dpPeriod);

    const startBalance = balance;
    for (let p = 0; p < periodsInMonth; p++) {
      activeCapital += activeCapital * ratePerPeriod;
    }
    balance = idleCapital + activeCapital;

    const monthDate = new Date(startDate);
    monthDate.setMonth(monthDate.getMonth() + month);

    rows.push({
      month,
      date: formatDate(monthDate),
      balance: Math.round(balance * 100) / 100,
      earned: Math.max(0, Math.round((balance - invested) * 100) / 100),
    });

    // Check breakeven (using totalInvested as breakeven)
    if (!breakevenDate && balance >= invested) {
      // Interpolate approximate date
      const prevBalance = startBalance;
      const growth = balance - prevBalance;
      const rawFraction = growth > 0 ? (invested - prevBalance) / growth : 1;
      const fraction = Math.max(0, Math.min(1, rawFraction));
      const prevDate = new Date(startDate);
      prevDate.setMonth(prevDate.getMonth() + month - 1);
      const daysInMonth = 30;
      prevDate.setDate(prevDate.getDate() + Math.round(fraction * daysInMonth));
      breakevenDate = formatDate(prevDate);
    }

    if (!goalDate && balance >= goal) {
      goalDate = formatDate(monthDate);
    }

    // Stop early only after preserving at least 12 projected months.
    if (balance > goal * 1.5 && month > minProjectionMonths) break;
  }

  return { rows, breakevenDate, goalDate };
}

/**
 * Calculate weighted average APR from positions.
 */
export function weightedAverageAPR(positions: DualPosition[]): number {
  if (positions.length === 0) return 0;

  const totalAmount = positions.reduce((sum, p) => sum + p.amount, 0);
  const weightedSum = positions.reduce((sum, p) => sum + p.apr * p.amount, 0);

  return totalAmount > 0 ? weightedSum / totalAmount : 0;
}

/**
 * Calculate daily earnings at given APR.
 */
export function dailyEarnings(capital: number, apr: number): number {
  return (capital * (apr / 100)) / 365;
}

/**
 * Calculate monthly earnings at given APR (nominal run-rate).
 */
export function monthlyEarnings(capital: number, apr: number): number {
  return (capital * (apr / 100)) / 12;
}

/**
 * Calculate effective APY and equivalent effective daily compounded rate.
 */
export function compoundedRateMetrics(
  apr: number,
  frequency: CompoundFrequency,
): {
  dailyCompoundedPct: number;
  apyPct: number;
} {
  const periods = periodsPerYear(frequency);
  const nominal = apr / 100;
  const apy = Math.pow(1 + nominal / periods, periods) - 1;
  const dailyCompounded = Math.pow(1 + apy, 1 / 365) - 1;

  return {
    dailyCompoundedPct: dailyCompounded * 100,
    apyPct: apy * 100,
  };
}

/**
 * Format a Date to YYYY-MM-DD.
 */
function formatDate(d: Date): string {
  return formatISODateLocal(d);
}

/**
 * Format ISO date (YYYY-MM-DD) to Latin format (DD/MM/YYYY).
 */
export function formatDateLatin(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/**
 * Format USD currency.
 */
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompactFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatUSD(n: number): string {
  return usdFormatter.format(n);
}

export function formatUSDCompact(n: number): string {
  return usdCompactFormatter.format(n);
}

/**
 * Format percentage.
 */
export function formatPct(n: number, decimals = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

/**
 * Estimate days remaining to reach goal based on current APR.
 * Uses compound interest with daily compounding.
 */
export function estimateDaysToGoal(
  currentBalance: number,
  apr: number,
  goal: number,
): number | null {
  if (currentBalance >= goal) return 0;
  if (currentBalance <= 0 || apr <= 0 || goal <= currentBalance) return null;

  const ratePerDay = apr / 100 / 365;
  const days = Math.log(goal / currentBalance) / Math.log(1 + ratePerDay);
  return Number.isFinite(days) && days <= 365 * 50 ? Math.ceil(days) : null;
}

/**
 * Estimate days to goal by interpolating the month-by-month projection rows.
 * Keeps simulator "months" output aligned with the exact projection engine.
 */
export function estimateDaysToGoalFromProjection(
  rows: ProjectionRow[],
  goal: number,
  daysPerMonth = 30,
): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (!Number.isFinite(goal) || goal <= 0) return null;
  if (!Number.isFinite(daysPerMonth) || daysPerMonth <= 0) return null;

  const start = rows[0];
  if (goal <= start.balance) return 0;

  const goalIndex = rows.findIndex((row, index) => index > 0 && row.balance >= goal);
  if (goalIndex < 0) return null;

  const current = rows[goalIndex];
  const previous = rows[goalIndex - 1];
  const monthSpan = Math.max(1, current.month - previous.month);
  const growth = current.balance - previous.balance;
  const rawFraction = growth > 0 ? (goal - previous.balance) / growth : 1;
  const fraction = Math.max(0, Math.min(1, rawFraction));
  const totalMonths = previous.month + fraction * monthSpan;

  return totalMonths * daysPerMonth;
}
