import { describe, it, expect } from 'vitest';
import {
  calculateDualBilledDays,
  calculateDualProjectedBilledDays,
  calculateDualProfitFromBilledDays,
  calculateDualYield,
  resolveDualSettlementAt,
} from './dual-yield';

describe('dual-yield utils', () => {
  it('uses Binance default settlement time (08:00 UTC) when no settlement time is provided', () => {
    const settlement = resolveDualSettlementAt({ settlementDate: '2026-02-20' });
    expect(settlement?.toISOString()).toBe('2026-02-20T08:00:00.000Z');
  });

  it('counts billed days by Binance cutoff windows and enforces at least 1 day', () => {
    const billed = calculateDualBilledDays(
      new Date('2026-02-13T17:02:00.000Z'),
      new Date('2026-02-20T08:00:00.000Z'),
    );
    expect(billed).toBe(7);

    const minOneDay = calculateDualBilledDays(
      new Date('2026-02-19T07:00:00.000Z'),
      new Date('2026-02-19T07:30:00.000Z'),
    );
    expect(minOneDay).toBe(1);
  });

  it('uses Binance billed-day windows even when entry/settlement include explicit times', () => {
    const billed = calculateDualProjectedBilledDays({
      entryDate: '2026-02-27',
      entryTime: '15:00',
      settlementDate: '2026-02-27',
      settlementTime: '23:59',
    });
    expect(billed).toBe(1);
  });

  it('truncates yield to 4 decimals (floor), never rounds up', () => {
    expect(calculateDualYield(60.89, 7)).toBe(0.0116);
    expect(calculateDualYield(136.95, 4)).toBe(0.015);
  });

  it('matches Binance profits for the provided reference positions', () => {
    const solUsdt = calculateDualProfitFromBilledDays(359.105, 60.89, 7);
    const ethUsdt = calculateDualProfitFromBilledDays(6826.6, 209.45, 1);
    const ethUsdc = calculateDualProfitFromBilledDays(100, 136.95, 4);

    expect(solUsdt).toBeCloseTo(4.165618, 6);
    expect(ethUsdt).toBeCloseTo(38.91162, 5);
    expect(ethUsdc).toBeCloseTo(1.5, 8);
  });

  it('matches Binance reference: before 15:59 UTC cutoff settles at 08:00 UTC and bills 1 day', () => {
    const billed = calculateDualProjectedBilledDays({
      entryDate: '2026-03-02',
      entryTime: '10:30',
      settlementDate: '2026-03-03',
      settlementTime: '03:00',
    });
    const reward = calculateDualProfitFromBilledDays(30336.4, 116.82, billed);

    expect(billed).toBe(1);
    expect(reward).toBeCloseTo(97.07648, 8);
  });
});
