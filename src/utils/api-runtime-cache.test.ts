import { describe, expect, it } from '#test';
import type { DualPosition } from '../types';
import { getPositionsCacheKey } from './api-runtime-cache';

function makePosition(overrides: Partial<DualPosition> = {}): DualPosition {
  return {
    id: overrides.id ?? 'p1',
    asset: overrides.asset ?? 'ETH',
    direction: overrides.direction ?? 'sell-high',
    subscriptionAsset: overrides.subscriptionAsset ?? 'ETH',
    quoteAsset: overrides.quoteAsset ?? 'USDT',
    amount: overrides.amount ?? 1,
    targetPrice: overrides.targetPrice ?? 2000,
    entryDate: overrides.entryDate ?? '2026-05-14',
    settlementDate: overrides.settlementDate ?? '2026-05-15',
    apr: overrides.apr ?? 120,
    projectedProfit: overrides.projectedProfit,
    expectedSettlementAsset: overrides.expectedSettlementAsset,
    expectedSettlementAmount: overrides.expectedSettlementAmount,
  };
}

describe('api runtime cache keys', () => {
  it('changes when projected profit or exact settlement changes', () => {
    const base = makePosition({
      projectedProfit: 0.01,
      expectedSettlementAsset: 'USDT',
      expectedSettlementAmount: 2020,
    });

    expect(getPositionsCacheKey([base])).not.toBe(
      getPositionsCacheKey([{ ...base, projectedProfit: 0.02 }]),
    );
    expect(getPositionsCacheKey([base])).not.toBe(
      getPositionsCacheKey([{ ...base, expectedSettlementAmount: 2040 }]),
    );
    expect(getPositionsCacheKey([base])).not.toBe(
      getPositionsCacheKey([{ ...base, expectedSettlementAsset: 'ETH' }]),
    );
  });
});
