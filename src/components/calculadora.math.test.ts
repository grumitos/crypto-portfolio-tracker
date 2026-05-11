import { describe, expect, it } from '#test';
import {
  computeAchievedResults,
  computeFeeMultiplier,
  computePurchaseTotals,
  computeStrategyResults,
  parseNum,
  roundTo,
} from './calculadora.math';

describe('calculadora math helpers', () => {
  it('parses noisy numeric strings', () => {
    expect(parseNum(' $ 1,234.56abc ')).toBeCloseTo(1234.56, 8);
    expect(parseNum('-10.5%')).toBeCloseTo(-10.5, 8);
  });

  it('rounds numbers deterministically', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(123.4567, 3)).toBe(123.457);
  });

  it('computes fee multiplier by number of sides', () => {
    const expectedDefault = Math.pow(1 - 0.075 / 100, 2);
    expect(computeFeeMultiplier(0.075)).toBeCloseTo(expectedDefault, 12);
    expect(computeFeeMultiplier(0.1, 1)).toBeCloseTo(0.999, 12);
  });

  it('computes purchase totals only from valid rows', () => {
    const totals = computePurchaseTotals([
      { id: 1, qty: '2', price: '100' },
      { id: 2, qty: '1.5', price: '150.5' },
      { id: 3, qty: '0', price: '10' },
      { id: 4, qty: 'bad', price: '10' },
    ]);

    expect(totals.validCount).toBe(2);
    expect(totals.totalQty).toBeCloseTo(3.5, 8);
    expect(totals.totalUsd).toBeCloseTo(425.75, 8);
    expect(totals.avgPrice).toBeCloseTo(121.64, 8);
  });

  it('computes achieved APR metrics', () => {
    const achieved = computeAchievedResults(110, 10, 1000, 100, 0);

    expect(achieved.achievedR).toBeCloseTo(0.1, 8);
    expect(achieved.achievedMovement).toBeCloseTo(10, 8);
    expect(achieved.achievedProfitPerTrade).toBeCloseTo(100, 8);
    expect(achieved.achievedAnnualProfit).toBeCloseTo(1000, 8);
    expect(achieved.achievedApr).toBeCloseTo(100, 8);
  });

  it('computes strategy net metrics per cycle', () => {
    const strategy = computeStrategyResults(100, 1000, 2, 1, 0);

    expect(strategy.sellPrice).toBeCloseTo(102, 8);
    expect(strategy.rebuyPrice).toBeCloseTo(100.98, 8);
    expect(strategy.netPct).toBeCloseTo(2, 8);
    expect(strategy.netUsd).toBeCloseTo(20, 8);
    expect(strategy.netPctCycle).toBeCloseTo((1 / 0.99 - 1) * 100, 8);
    expect(strategy.netUsdCycle).toBeCloseTo((1 / 0.99 - 1) * 1000, 8);
  });

  it('returns NaN for invalid math inputs', () => {
    const achieved = computeAchievedResults(NaN, 10, 1000, 100, 0.075);
    const strategy = computeStrategyResults(NaN, 1000, NaN, NaN, 0.075);

    expect(Number.isNaN(achieved.achievedR)).toBe(true);
    expect(Number.isNaN(achieved.achievedApr)).toBe(true);
    expect(Number.isNaN(strategy.sellPrice)).toBe(true);
    expect(Number.isNaN(strategy.netPctCycle)).toBe(true);
  });
});
