import { beforeEach, describe, expect, it, vi } from '#test';
import {
  DEFAULT_CALC_REBUY_PCT,
  DEFAULT_CALC_SELL_PCT,
  getDefaultCalcState,
  loadCalcState,
  loadState,
  replaceSyncedPositions,
  updateBalance,
  saveCalcState,
  saveState,
} from './storage';
import { createMemoryStorage } from '../test/test-utils';

describe('storage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it('infers sell sync source and sanitizes purchases when loading calculadora state', () => {
    localStorage.setItem(
      'crypto-calculadora',
      JSON.stringify({
        sellPrice: '615.50',
        sellPct: '0.98',
        sellSyncSource: null,
        purchases: [{ id: 'bad', qty: '1.25<script>', price: '600.45"' }],
      }),
    );

    const state = loadCalcState();

    expect(state.sellSyncSource).toBe('price');
    expect(state.purchases[0]).toEqual({ id: 1, qty: '1.25', price: '600.45' });
  });

  it('sanitizes malformed position values from persisted app state', () => {
    localStorage.setItem(
      'crypto-portfolio-tracker',
      JSON.stringify({
        portfolio: {
          totalInvested: 'bad',
          currentBalance: '-100',
          goalAmount: 0,
          lastUpdated: 'not-a-date',
          balanceHistory: [{ date: 'not-a-date', balance: 'oops' }],
        },
        positions: [
          {
            id: '<bad-id>',
            asset: '<script>alert(1)</script>',
            direction: 'invalid',
            subscriptionAsset: 'usdt',
            amount: '-10',
            targetPrice: '-20',
            entryDate: '2026-02-20',
            entryTime: '25:99',
            settlementDate: '2026-02-18',
            settlementTime: '03:70',
            apr: '-5',
          },
        ],
      }),
    );

    const state = loadState();
    const position = state.positions[0];

    expect(state.portfolio.currentBalance).toBe(0);
    expect(state.portfolio.goalAmount).toBe(0);
    expect(position.id).toBe('bad-id');
    expect(position.asset).toBe('SCRIPTALERT1SCRIPT');
    expect(position.direction).toBe('buy-low');
    expect(position.amount).toBe(0);
    expect(position.targetPrice).toBe(0);
    expect(position.apr).toBe(0);
    expect(position.entryTime).toBeUndefined();
    expect(position.settlementTime).toBeUndefined();
    expect(position.settlementDate).toBe(position.entryDate);
  });

  // Fechar con "hoy" lo que no tiene fecha la vuelve a fechar en cada carga, y
  // deja de poder distinguirse de una posicion que si empezo hoy.
  it('keeps an unknown date empty instead of defaulting it to today', () => {
    replaceSyncedPositions([
      {
        id: 'bybit_dual_undated',
        asset: 'ETH',
        direction: 'buy-low',
        subscriptionAsset: 'USDT',
        amount: 20,
        targetPrice: 2325,
        entryDate: '',
        settlementDate: '',
        apr: 900,
        source: 'Bybit',
        positionKind: 'dual',
      },
    ]);

    const position = loadState().positions[0];
    expect(position.entryDate).toBe('');
    expect(position.settlementDate).toBe('');
  });

  // Sin entrada no hay con que comparar la liquidacion, asi que la correccion
  // de orden no debe inventarse una igualandolas.
  it('does not clamp a known settlement date against an unknown entry date', () => {
    replaceSyncedPositions([
      {
        id: 'bybit_dual_half_dated',
        asset: 'ETH',
        direction: 'buy-low',
        subscriptionAsset: 'USDT',
        amount: 20,
        targetPrice: 2325,
        entryDate: '',
        settlementDate: '2026-05-15',
        apr: 900,
        source: 'Bybit',
        positionKind: 'dual',
      },
    ]);

    const position = loadState().positions[0];
    expect(position.entryDate).toBe('');
    expect(position.settlementDate).toBe('2026-05-15');
  });

  it('replaces stored positions with the synced list', () => {
    const original = loadState();
    expect(original.positions).toHaveLength(0);

    replaceSyncedPositions([
      {
        id: 'binance_1',
        asset: 'ETH',
        direction: 'buy-low',
        subscriptionAsset: 'USDT',
        amount: 10,
        targetPrice: 1900,
        entryDate: '2026-02-19',
        entryTime: '08:05',
        settlementDate: '2026-02-20',
        settlementTime: '03:00',
        apr: 100.5,
      },
    ]);

    const next = loadState();
    expect(next.positions).toHaveLength(1);
    expect(next.positions[0].id).toBe('binance_1');
    expect(next.positions[0].entryTime).toBe('08:05');
    expect(next.positions[0].settlementTime).toBe('03:00');
  });

  it('keeps only exchange positions when migrating state saved with the old manual mode', () => {
    localStorage.setItem(
      'crypto-portfolio-tracker',
      JSON.stringify({
        portfolio: {
          totalInvested: 1000,
          currentBalance: 900,
          savings: 400,
          goalAmount: 1500,
          lastUpdated: '2026-02-21',
          balanceHistory: [{ date: '2026-02-21', balance: 900 }],
        },
        positions: [
          {
            id: 'manual_1',
            asset: 'ETH',
            direction: 'buy-low',
            subscriptionAsset: 'USDT',
            amount: 10,
            targetPrice: 1900,
            entryDate: '2026-02-19',
            settlementDate: '2026-02-20',
            apr: 80,
          },
        ],
        manualPositions: [
          {
            id: 'manual_1',
            asset: 'ETH',
            direction: 'buy-low',
            subscriptionAsset: 'USDT',
            amount: 10,
            targetPrice: 1900,
            entryDate: '2026-02-19',
            settlementDate: '2026-02-20',
            apr: 80,
          },
        ],
        autoPositions: [
          {
            id: 'binance_1',
            asset: 'BTC',
            direction: 'sell-high',
            subscriptionAsset: 'BTC',
            amount: 0.25,
            targetPrice: 75000,
            entryDate: '2026-02-20',
            settlementDate: '2026-02-21',
            apr: 45,
          },
        ],
        positionsConfig: { mode: 'manual' },
      }),
    );

    const state = loadState();
    expect(state.positions.map((position) => position.id)).toEqual(['binance_1']);
    expect(state.portfolio.currentBalance).toBe(900);

    saveState(state);
    const persisted = JSON.parse(
      localStorage.getItem('crypto-portfolio-tracker') ?? '{}',
    ) as Record<string, unknown>;
    expect(persisted.manualPositions).toBeUndefined();
    expect(persisted.autoPositions).toBeUndefined();
    expect(persisted.positionsConfig).toBeUndefined();
    expect((persisted.portfolio as Record<string, unknown>).savings).toBeUndefined();
  });

  it('drops manual-only positions when the old state had no synced bucket', () => {
    localStorage.setItem(
      'crypto-portfolio-tracker',
      JSON.stringify({
        positionsConfig: { mode: 'manual' },
        autoPositions: [],
        positions: [
          {
            id: 'manual_1',
            asset: 'ETH',
            direction: 'buy-low',
            subscriptionAsset: 'USDT',
            amount: 10,
            targetPrice: 1900,
            entryDate: '2026-02-19',
            settlementDate: '2026-02-20',
            apr: 80,
          },
          {
            id: 'bybit_dual_1',
            asset: 'ETH',
            direction: 'sell-high',
            subscriptionAsset: 'ETH',
            amount: 1,
            targetPrice: 2400,
            entryDate: '2026-02-19',
            settlementDate: '2026-02-20',
            apr: 90,
          },
        ],
      }),
    );

    expect(loadState().positions.map((position) => position.id)).toEqual(['bybit_dual_1']);
  });

  it('preserves Bybit Discount Buy positions in synced data', () => {
    replaceSyncedPositions([
      {
        id: 'bybit_discount_buy_11959',
        asset: 'BTC',
        direction: 'buy-low',
        subscriptionAsset: 'USDT',
        amount: 200,
        targetPrice: 74019,
        entryDate: '2026-04-14',
        settlementDate: '2026-04-15',
        apr: 1,
        source: 'Bybit',
        positionKind: 'discount-buy',
        projectedProfit: 0.005479452054794521,
      },
    ]);

    const position = loadState().positions[0];
    expect(position.positionKind).toBe('discount-buy');
    expect(position.source).toBe('Bybit');
    expect(position.projectedProfit).toBeCloseTo(0.005479452054794521, 12);
  });

  it('preserves quote asset for crypto-cross synced positions', () => {
    replaceSyncedPositions([
      {
        id: 'bybit_dual_eth_btc',
        asset: 'ETH',
        direction: 'sell-high',
        subscriptionAsset: 'ETH',
        quoteAsset: 'BTC',
        amount: 1,
        targetPrice: 0.055,
        entryDate: '2026-05-09',
        settlementDate: '2026-05-10',
        apr: 120,
        source: 'Bybit',
        positionKind: 'dual',
      },
    ]);

    const position = loadState().positions[0];
    expect(position.quoteAsset).toBe('BTC');
  });

  it('preserves exact expected settlement fields for synced positions', () => {
    replaceSyncedPositions([
      {
        id: 'bybit_dual_eth_usdt',
        asset: 'ETH',
        direction: 'sell-high',
        subscriptionAsset: 'ETH',
        quoteAsset: 'USDT',
        amount: 4.535577,
        targetPrice: 2242.5,
        entryDate: '2026-05-14',
        settlementDate: '2026-05-15',
        apr: 120,
        source: 'Bybit',
        positionKind: 'dual',
        projectedProfit: 0.002,
        expectedSettlementAsset: 'USDT',
        expectedSettlementAmount: 10174.53,
      },
    ]);

    const position = loadState().positions[0];
    expect(position.expectedSettlementAsset).toBe('USDT');
    expect(position.expectedSettlementAmount).toBe(10174.53);
  });

  it('preserves grouped components when syncing aggregated positions', () => {
    replaceSyncedPositions([
      {
        id: 'binance_agg_1',
        asset: 'SOL',
        direction: 'sell-high',
        subscriptionAsset: 'SOL',
        amount: 227.02692984,
        targetPrice: 82,
        entryDate: '2026-02-27',
        entryTime: '22:59',
        settlementDate: '2026-02-28',
        settlementTime: '07:59',
        apr: 321.12,
        components: [
          {
            id: 'leg_1',
            amount: 40.87873348,
            targetPrice: 82,
            entryDate: '2026-02-27',
            entryTime: '23:00',
            settlementDate: '2026-02-28',
            settlementTime: '07:59',
            apr: 200.33,
          },
          {
            id: 'leg_2',
            amount: 186.14819636,
            targetPrice: 82,
            entryDate: '2026-02-27',
            entryTime: '22:59',
            settlementDate: '2026-02-28',
            settlementTime: '07:59',
            apr: 347.65,
          },
        ],
      },
    ]);

    const next = loadState();
    expect(next.positions).toHaveLength(1);
    expect(next.positions[0].components).toHaveLength(2);
    expect(next.positions[0].components?.[0].id).toBe('leg_1');
  });

  it('updates existing day snapshot instead of duplicating balance history', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T09:00:00.000Z'));

    updateBalance(1000);
    updateBalance(2000);

    const state = loadState();
    const todayEntries = state.portfolio.balanceHistory.filter(
      (entry) => entry.date === '2026-02-21',
    );
    expect(todayEntries).toHaveLength(1);
    expect(todayEntries[0].balance).toBe(2000);

    vi.useRealTimers();
  });

  it('falls back to defaults on malformed persisted JSON', () => {
    localStorage.setItem('crypto-portfolio-tracker', '{bad-json');
    localStorage.setItem('crypto-calculadora', '{bad-json');

    const appState = loadState();
    const calcState = loadCalcState();

    expect(appState.positions).toHaveLength(0);
    expect(appState.portfolio.goalAmount).toBe(0);
    expect(calcState.sellPct).toBe(DEFAULT_CALC_SELL_PCT);
    expect(calcState.rebuyPct).toBe(DEFAULT_CALC_REBUY_PCT);
  });

  it('deduplicates and sorts balance history during sanitization', () => {
    localStorage.setItem(
      'crypto-portfolio-tracker',
      JSON.stringify({
        portfolio: {
          totalInvested: 1000,
          currentBalance: 500,
          goalAmount: 1500,
          lastUpdated: '2026-02-21',
          balanceHistory: [
            { date: '2026-02-20', balance: 400 },
            { date: '2026-02-19', balance: 300 },
            { date: '2026-02-20', balance: 450 },
          ],
        },
        positions: [],
      }),
    );

    const state = loadState();
    expect(state.portfolio.balanceHistory.map((entry) => entry.date)).toEqual([
      '2026-02-19',
      '2026-02-20',
      '2026-02-21',
    ]);
    expect(state.portfolio.balanceHistory[1].balance).toBe(450);
  });

  it('does not throw when localStorage writes fail', () => {
    const storage = createMemoryStorage();
    const setItem = vi.fn(() => {
      throw new Error('quota exceeded');
    });
    Object.defineProperty(storage, 'setItem', {
      value: setItem,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => saveState(loadState())).not.toThrow();
    expect(() => saveCalcState(getDefaultCalcState())).not.toThrow();

    warnSpy.mockRestore();
  });
});
