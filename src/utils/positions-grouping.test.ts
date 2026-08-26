import { describe, expect, it } from '#test';
import { countPositionSubscriptions, groupPositionsByLockWindow } from './positions-grouping';
import type { DualPosition } from '../types';

function makePosition(overrides: Partial<DualPosition> = {}): DualPosition {
  return {
    id: 'binance_1',
    asset: 'ETH',
    direction: 'buy-low',
    subscriptionAsset: 'USDC',
    quoteAsset: 'USDT',
    amount: 1000,
    targetPrice: 2800,
    entryDate: '2026-08-24',
    entryTime: '10:00',
    settlementDate: '2026-08-28',
    settlementTime: '16:00',
    apr: 30,
    source: 'Binance',
    positionKind: 'dual',
    ...overrides,
  };
}

describe('groupPositionsByLockWindow', () => {
  it('merges same pair and window weighting averages by amount', () => {
    const [group] = groupPositionsByLockWindow([
      makePosition({ id: 'binance_1', amount: 1000, apr: 20, targetPrice: 2800 }),
      makePosition({
        id: 'binance_2',
        amount: 3000,
        apr: 40,
        targetPrice: 2900,
        entryTime: '08:30',
      }),
    ]);

    expect(group.amount).toBe(4000);
    // Ponderado: (20*1000 + 40*3000) / 4000. La media simple daria 30.
    expect(group.apr).toBe(35);
    expect(group.targetPrice).toBe(2875);
    // La ventana empieza cuando el capital dejo de estar libre: la entrada mas
    // temprana de todas sus partes.
    expect(group.entryTime).toBe('08:30');
    expect(group.settlementDate).toBe('2026-08-28');
    expect(group.components?.map((component) => component.id)).toEqual(['binance_1', 'binance_2']);
  });

  it('suma las ganancias proyectadas y el importe de liquidacion esperado', () => {
    const [group] = groupPositionsByLockWindow([
      makePosition({ id: 'binance_1', projectedProfit: 4, expectedSettlementAmount: 100 }),
      makePosition({ id: 'binance_2', projectedProfit: 6, expectedSettlementAmount: 250 }),
    ]);

    expect(group.projectedProfit).toBe(10);
    expect(group.expectedSettlementAmount).toBe(350);
  });

  it('keeps positions apart when anything that defines the bet differs', () => {
    const positions = [
      makePosition({ id: 'a' }),
      makePosition({ id: 'b', settlementDate: '2026-08-29' }),
      makePosition({ id: 'c', asset: 'BTC' }),
      makePosition({ id: 'd', direction: 'sell-high' }),
      makePosition({ id: 'e', source: 'Bybit' }),
      makePosition({ id: 'f', subscriptionAsset: 'USDT' }),
    ];

    const grouped = groupPositionsByLockWindow(positions);

    expect(grouped).toHaveLength(6);
    expect(grouped.every((position) => position.components === undefined)).toBe(true);
  });

  it('leaves an ungroupable position untouched and preserves the original order', () => {
    const grouped = groupPositionsByLockWindow([
      // Sin importe no hay nada que sumar, asi que pasa de largo sin fusionarse.
      makePosition({ id: 'empty', amount: 0 }),
      makePosition({ id: 'binance_1' }),
      makePosition({ id: 'binance_2' }),
    ]);

    expect(grouped.map((position) => position.id)).toEqual(['empty', 'binance_1']);
    expect(grouped[0].components).toBeUndefined();
    expect(grouped[1].components).toHaveLength(2);
  });

  it('does not merge positions whose settlement window is unknown', () => {
    const grouped = groupPositionsByLockWindow([
      makePosition({ id: 'undated_1', settlementDate: '', settlementTime: undefined }),
      makePosition({ id: 'undated_2', settlementDate: '', settlementTime: undefined }),
    ]);

    expect(grouped.map((position) => position.id)).toEqual(['undated_1', 'undated_2']);
    expect(grouped.every((position) => position.components === undefined)).toBe(true);
  });

  it('does not attach components to a lone position', () => {
    const [only] = groupPositionsByLockWindow([makePosition()]);
    expect(only.components).toBeUndefined();
  });
});

describe('countPositionSubscriptions', () => {
  it('counts the parts of a group, not the rows', () => {
    const grouped = groupPositionsByLockWindow([
      makePosition({ id: 'binance_1' }),
      makePosition({ id: 'binance_2' }),
      makePosition({ id: 'binance_3', asset: 'BTC' }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(countPositionSubscriptions(grouped)).toBe(3);
  });
});
