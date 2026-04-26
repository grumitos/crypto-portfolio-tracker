import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DualPosition } from '../types';
import {
  formatTimeHHMM,
  renderPositionGroup,
  updateRemainingTimesInPlace,
} from './positions.table';

function makePosition(overrides: Partial<DualPosition>): DualPosition {
  return {
    id: overrides.id ?? 'p1',
    asset: overrides.asset ?? 'ETH',
    direction: overrides.direction ?? 'buy-low',
    subscriptionAsset: overrides.subscriptionAsset ?? 'USDT',
    amount: overrides.amount ?? 100,
    targetPrice: overrides.targetPrice ?? 1900,
    entryDate: overrides.entryDate ?? '2026-02-21',
    entryTime: overrides.entryTime,
    entryTimeSource: overrides.entryTimeSource,
    settlementDate: overrides.settlementDate ?? '2026-02-22',
    settlementTime: overrides.settlementTime,
    settlementTimeSource: overrides.settlementTimeSource,
    apr: overrides.apr ?? 50,
    components: overrides.components,
  };
}

describe('positions table rendering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders rows for both tracking groups', () => {
    const buyGroup = renderPositionGroup('Buy Low', [
      makePosition({ id: 'buy1', direction: 'buy-low', asset: 'ETH', subscriptionAsset: 'USDT' }),
    ]);
    const sellGroup = renderPositionGroup('Sell High', [
      makePosition({ id: 'sell1', direction: 'sell-high', subscriptionAsset: 'SOL' }),
    ]);

    expect(buyGroup).toContain('ETH/USDT');
    expect(sellGroup).toContain('SOL/USDT');
    expect(buyGroup).toContain('Ganancia');
    expect(buyGroup).not.toContain('Ganancia (Venc.)');
    expect(buyGroup).not.toContain('Valor USD');
    expect(sellGroup).toContain('Valor USD');
    expect(buyGroup).toContain('Resultado');
    expect(buyGroup).not.toContain('Ejecuta');
    expect(buyGroup).not.toContain('No ejec.');
    expect(buyGroup).not.toContain('Spot (USD)');
    expect(buyGroup).not.toContain('position-spot-buy1');
    expect(buyGroup).not.toContain('btn-del-pos');
  });

  it('adds time provenance hints for Binance-synced rows', () => {
    const group = renderPositionGroup('Buy Low', [
      makePosition({
        id: 'binance_1',
        entryTime: '08:45',
        entryTimeSource: 'binance_purchase_time',
        settlementTime: '03:00',
        settlementTimeSource: 'binance_settle_date_rule',
      }),
    ]);

    expect(group).toContain('Hora de suscripción reportada por Binance.');
    expect(group).toContain(
      'Hora de liquidación calculada desde settleDate con la ventana estándar de Binance.',
    );
  });

  it('renders a dropdown with component rows for grouped weighted positions', () => {
    const grouped = renderPositionGroup('Sell High', [
      makePosition({
        id: 'agg1',
        direction: 'sell-high',
        asset: 'SOL',
        subscriptionAsset: 'SOL',
        amount: 371.0251611,
        apr: 349.3803,
        components: [
          {
            id: 'c1',
            amount: 186.14819636,
            targetPrice: 82,
            entryDate: '2026-02-27',
            entryTime: '22:59',
            settlementDate: '2026-02-28',
            settlementTime: '07:59',
            apr: 347.65,
          },
          {
            id: 'c2',
            amount: 96,
            targetPrice: 82,
            entryDate: '2026-02-27',
            entryTime: '22:59',
            settlementDate: '2026-02-28',
            settlementTime: '07:59',
            apr: 397.8,
          },
        ],
      }),
    ]);

    expect(grouped).toContain('pos-components-summary');
    expect(grouped).toContain('▸');
    expect(grouped).toContain('Ver desglose (2)');
    expect(grouped).toContain('pos-sub-row');
    expect(grouped).toContain('186.148196 SOL');
    expect(grouped).toContain('397.80%');
  });

  it('formats remaining time as seconds, hours/minutes, day countdown and settled state', () => {
    vi.setSystemTime(new Date(2026, 1, 21, 12, 0, 30));

    const secondsHtml = renderPositionGroup('Buy Low', [
      makePosition({
        id: 'sec',
        entryDate: '2026-02-21',
        entryTime: '11:00',
        settlementDate: '2026-02-21',
        settlementTime: '12:01',
      }),
    ]);
    expect(secondsHtml).toContain('30s');

    vi.setSystemTime(new Date(2026, 1, 21, 10, 0, 0));
    const hoursHtml = renderPositionGroup('Buy Low', [
      makePosition({
        id: 'hr',
        entryDate: '2026-02-21',
        entryTime: '08:00',
        settlementDate: '2026-02-21',
        settlementTime: '12:45',
      }),
    ]);
    expect(hoursHtml).toContain('2h 45m');

    vi.setSystemTime(new Date(2026, 1, 21, 10, 0, 0));
    const daysHtml = renderPositionGroup('Buy Low', [
      makePosition({
        id: 'day',
        entryDate: '2026-02-20',
        entryTime: '10:00',
        settlementDate: '2026-02-24',
        settlementTime: '10:00',
      }),
    ]);
    expect(daysHtml).toContain('3d');
    expect(daysHtml).not.toContain('/ ');

    // Extended format: shows days + hours when not exact
    vi.setSystemTime(new Date(2026, 1, 21, 11, 0, 0));
    const extendedHtml = renderPositionGroup('Buy Low', [
      makePosition({
        id: 'ext',
        entryDate: '2026-02-20',
        entryTime: '10:00',
        settlementDate: '2026-02-24',
        settlementTime: '10:00',
      }),
    ]);
    expect(extendedHtml).toContain('2d 23h');

    vi.setSystemTime(new Date(2026, 1, 22, 12, 0, 0));
    const settledHtml = renderPositionGroup('Buy Low', [
      makePosition({
        id: 'done',
        entryDate: '2026-02-20',
        settlementDate: '2026-02-21',
        settlementTime: '11:00',
      }),
    ]);
    expect(settledHtml).toContain('Liquidada');
  });

  it('updates remaining labels in-place and reports sub-minute countdowns', () => {
    vi.setSystemTime(new Date(2026, 1, 21, 12, 0, 30));
    const position = makePosition({
      id: 'p-count',
      entryDate: '2026-02-21',
      entryTime: '11:00',
      settlementDate: '2026-02-21',
      settlementTime: '12:01',
    });
    const container = document.createElement('div');
    container.innerHTML = renderPositionGroup('Buy Low', [position]);

    const hasSubMinute = updateRemainingTimesInPlace(container, [position]);
    const remaining = container.querySelector('#position-remaining-p-count') as HTMLElement;

    expect(hasSubMinute).toBe(true);
    expect(remaining.textContent).toContain('30s');
  });

  it('formats Date values as HH:mm', () => {
    const value = new Date(2026, 1, 21, 4, 7, 30);
    expect(formatTimeHHMM(value)).toBe('04:07');
  });
});
