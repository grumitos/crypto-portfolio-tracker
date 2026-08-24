import { beforeEach, describe, expect, it, vi } from '#test';
import type { DualPosition } from '../types';
import { renderPositionGroup, updateRemainingTimesInPlace } from './positions.table';

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
    source: overrides.source,
    positionKind: overrides.positionKind,
    displaySymbol: overrides.displaySymbol,
    projectedProfit: overrides.projectedProfit,
    expectedSettlementAsset: overrides.expectedSettlementAsset,
    expectedSettlementAmount: overrides.expectedSettlementAmount,
    quoteAsset: overrides.quoteAsset,
    side: overrides.side,
  };
}

/**
 * El markup nuevo parte los valores en varios spans (par base/quote, unidad en
 * .muted), asi que las aserciones de contenido se hacen sobre el texto visible.
 */
function textOf(html: string): string {
  const host = document.createElement('div');
  host.innerHTML = html;
  return (host.textContent ?? '').replace(/\s+/g, ' ');
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

    expect(textOf(buyGroup)).toContain('ETH/USDT');
    expect(textOf(sellGroup)).toContain('SOL/USDT');
    expect(buyGroup).toContain('Ganancia');
    expect(buyGroup).not.toContain('Ganancia (Venc.)');
    expect(buyGroup).not.toContain('Valor USD');
    expect(sellGroup).toContain('Valor USD');
    expect(buyGroup).toContain('Resultado');
    expect(buyGroup).toContain('Ejec.');
    expect(buyGroup).toContain('No ej.');
    expect(buyGroup).not.toContain('Spot (USD)');
    expect(buyGroup).not.toContain('position-spot-buy1');
    expect(buyGroup).not.toContain('btn-del-pos');
  });

  it('renders both outcomes as peers and keeps the date/time hierarchy in the window cell', () => {
    const host = document.createElement('div');
    host.innerHTML = renderPositionGroup('Buy Low', [
      makePosition({
        id: 'outcome_pair',
        direction: 'buy-low',
        asset: 'ETH',
        subscriptionAsset: 'USDC',
        amount: 33000,
        targetPrice: 2400,
        entryTime: '08:45',
      }),
    ]);

    const outcomeCell = host.querySelector('td[data-field="outcome"]') as HTMLElement;
    const outcomeRows = Array.from(outcomeCell.querySelectorAll('.pos-outcome-row'));

    expect(outcomeRows).toHaveLength(2);
    // Ninguna de las dos filas puede caer en el estilo de marca de tiempo.
    expect(outcomeCell.querySelector('.cell-sub')).toBeNull();
    expect(
      outcomeRows.every((row) =>
        row.querySelector('.pos-outcome-amount')?.classList.contains('num'),
      ),
    ).toBe(true);
    // La unica diferencia entre desenlaces es el enfasis de color.
    expect(outcomeRows.filter((row) => row.classList.contains('is-converted'))).toHaveLength(1);

    const windowCell = host.querySelector('td[data-field="window"]') as HTMLElement;
    expect(windowCell.querySelector('.cell-sub')?.textContent).toContain('08:45');
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

  it('renders Discount Buy rows compactly without showing knockout APR as earnings', () => {
    const group = renderPositionGroup('Buy Low', [
      makePosition({
        id: 'bybit_discount_buy_1',
        asset: 'ETH',
        subscriptionAsset: 'USDT',
        amount: 1000,
        targetPrice: 2275,
        apr: 10,
        positionKind: 'discount-buy',
        projectedProfit: 0.27,
      }),
    ]);

    expect(textOf(group)).toContain('ETH/USDT');
    expect(group).not.toContain('Discount');
    expect(group).not.toContain('10.00%');
    expect(group).toContain('Compra');
    // Comparte el patron de la celda de resultado dual.
    expect(group).toContain('pos-outcome-row is-converted');
    expect(textOf(group)).not.toContain('+0.27 USDT');
    expect(group).not.toContain('Sin KO');
    expect(textOf(group)).not.toContain('1,000.27 USDT');
  });

  it('keeps both Sell High outcomes when Bybit reports an exact expected return', () => {
    const group = renderPositionGroup('Sell High', [
      makePosition({
        id: 'bybit_dual_sell_1',
        direction: 'sell-high',
        asset: 'ETH',
        subscriptionAsset: 'ETH',
        amount: 8.741083,
        targetPrice: 2300,
        apr: 98.43,
        projectedProfit: 0.023572,
        expectedSettlementAsset: 'ETH',
        expectedSettlementAmount: 8.764656,
      }),
    ]);

    expect(textOf(group)).toContain('20,158.71 USDT');
    expect(textOf(group)).toContain('8.764656 ETH');
    expect(textOf(group)).toContain('+54.22 USDT');
  });

  it('renders sell-high USDT executed profit in USDT without mixing ETH units', () => {
    const group = renderPositionGroup('Sell High', [
      makePosition({
        id: 'sell_usdt_profit',
        direction: 'sell-high',
        asset: 'ETH',
        subscriptionAsset: 'ETH',
        quoteAsset: 'USDT',
        amount: 1,
        targetPrice: 2000,
        projectedProfit: 0.01,
      }),
    ]);

    const buyText = textOf(group);
    expect(buyText).toContain('ETH/USDT');
    expect(buyText).toContain('2,020 USDT');
    expect(buyText).toContain('1.01 ETH');
    expect(buyText).toContain('+20 USDT');
    expect(buyText).not.toContain('2,000.01 USDT');
    expect(buyText).not.toContain('+0.01 ETH');
  });

  it('includes projected yield in buy-low executed crypto outcome', () => {
    const group = renderPositionGroup('Buy Low', [
      makePosition({
        id: 'buy_low_with_yield',
        direction: 'buy-low',
        asset: 'ETH',
        subscriptionAsset: 'USDT',
        amount: 1000,
        targetPrice: 2000,
        projectedProfit: 10,
      }),
    ]);

    expect(textOf(group)).toContain('0.505 ETH');
    expect(textOf(group)).toContain('1,010 USDT');
    expect(textOf(group)).not.toContain('0.5 ETH');
  });

  it('renders sell-high outcomes with the actual quote asset for non-stable pairs', () => {
    const group = renderPositionGroup('Sell High', [
      makePosition({
        id: 'eth-btc',
        direction: 'sell-high',
        asset: 'ETH',
        subscriptionAsset: 'ETH',
        quoteAsset: 'BTC',
        amount: 1.25,
        targetPrice: 0.055,
        apr: 120,
      }),
    ]);

    expect(textOf(group)).toContain('ETH/BTC');
    expect(textOf(group)).toContain('BTC');
    expect(textOf(group)).not.toContain('ETH/USDT');
  });

  it('escapes imported asset symbols before rendering amount HTML', () => {
    const group = renderPositionGroup('Buy Low', [
      makePosition({
        id: 'escaped_asset',
        asset: 'ETH<svg/onload=alert(1)>',
        subscriptionAsset: 'USDT&X',
      }),
    ]);

    expect(textOf(group)).toContain('ETH<svg/onload=alert(1)>/USDT&X');
    expect(textOf(group)).toContain('100 USDT&X');
    expect(group).not.toContain('<svg/onload');
    expect(group).not.toContain('USDT&X');
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
    expect(grouped).toContain('Desglose (2)');
    expect(grouped).toContain('aria-label="Ver desglose de la posicion"');
    expect(grouped).toContain('pos-sub-row');
    expect(textOf(grouped)).toContain('186.148196 SOL');
    expect(grouped).toContain('397.80%');
    expect(grouped.match(/position-apr-/g)).toHaveLength(1);
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

  it('updates remaining labels for ids that are not valid CSS selectors', () => {
    vi.setSystemTime(new Date(2026, 1, 21, 12, 0, 30));
    const position = makePosition({
      id: 'p.count/1:live',
      entryDate: '2026-02-21',
      entryTime: '11:00',
      settlementDate: '2026-02-21',
      settlementTime: '12:01',
    });
    const container = document.createElement('div');
    container.innerHTML = renderPositionGroup('Buy Low', [position]);

    const hasSubMinute = updateRemainingTimesInPlace(container, [position]);
    const remaining = Array.from(container.querySelectorAll<HTMLElement>('[id]')).find(
      (element) => element.id === 'position-remaining-p.count/1:live',
    );

    expect(hasSubMinute).toBe(true);
    expect(remaining?.textContent).toContain('30s');
  });
});
