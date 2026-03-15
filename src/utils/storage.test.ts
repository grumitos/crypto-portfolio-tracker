import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportBackup,
  getDefaultCalcState,
  importBackup,
  loadCalcState,
  loadState,
  replacePositions,
  replaceAutoPositions,
  updateBalance,
  saveStoredPositionsMode,
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

  it('exports and imports backup including calculadora', () => {
    const appState = loadState();
    appState.portfolio.currentBalance = 12345;
    saveState(appState);

    const calcState = getDefaultCalcState();
    calcState.sellPct = '1.11';
    calcState.sellSyncSource = 'percent';
    saveCalcState(calcState);

    const backup = exportBackup();
    localStorage.clear();
    importBackup(backup);

    expect(loadState().portfolio.currentBalance).toBe(12345);
    expect(loadCalcState().sellPct).toBe('1.11');
    expect(loadCalcState().sellSyncSource).toBe('percent');
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

  it('replaces all positions from imported list', () => {
    const original = loadState();
    expect(original.positions).toHaveLength(0);

    replacePositions([
      {
        id: 'bulk_1',
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
    expect(next.positions[0].id).toBe('bulk_1');
    expect(next.positions[0].entryTime).toBe('08:05');
    expect(next.positions[0].settlementTime).toBe('03:00');
  });

  it('preserves manual positions when syncing auto mode data', () => {
    replacePositions([
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
    ]);

    saveStoredPositionsMode('auto');
    replaceAutoPositions([
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
    ]);

    expect(loadState().positions.map((position) => position.id)).toEqual(['binance_1']);

    saveStoredPositionsMode('manual');

    const next = loadState();
    expect(next.positions.map((position) => position.id)).toEqual(['manual_1']);
    expect(next.manualPositions.map((position) => position.id)).toEqual(['manual_1']);
    expect(next.autoPositions.map((position) => position.id)).toEqual(['binance_1']);
  });

  it('preserves grouped components when importing aggregated positions', () => {
    replacePositions([
      {
        id: 'agg_1',
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

  it('imports legacy backup format without wrapper fields', () => {
    const legacy = JSON.stringify({
      portfolio: {
        totalInvested: 2000,
        currentBalance: 1500,
        goalAmount: 2500,
        savings: 300,
        lastUpdated: '2026-02-20',
        balanceHistory: [{ date: '2026-02-20', balance: 1500 }],
      },
      positions: [],
    });

    const imported = importBackup(legacy);
    expect(imported.portfolio.totalInvested).toBe(2000);
    expect(loadState().portfolio.currentBalance).toBe(1500);
  });

  it('rejects unrecognized legacy backup objects without overwriting persisted state', () => {
    const state = loadState();
    state.portfolio.currentBalance = 777;
    saveState(state);

    expect(() => importBackup(JSON.stringify({ foo: 'bar' }))).toThrow(
      'Formato de backup no valido',
    );
    expect(loadState().portfolio.currentBalance).toBe(777);
  });

  it('rejects backups from unsupported future versions', () => {
    const futureBackup = JSON.stringify({
      version: 999,
      app: {
        portfolio: {
          totalInvested: 1000,
          currentBalance: 800,
          goalAmount: 1500,
          savings: 800,
          lastUpdated: '2026-02-21',
          balanceHistory: [{ date: '2026-02-21', balance: 800 }],
        },
        positions: [],
      },
    });

    expect(() => importBackup(futureBackup)).toThrow('Versión de backup no soportada');
  });

  it('falls back to defaults on malformed persisted JSON', () => {
    localStorage.setItem('crypto-portfolio-tracker', '{bad-json');
    localStorage.setItem('crypto-calculadora', '{bad-json');

    const appState = loadState();
    const calcState = loadCalcState();

    expect(appState.positions).toHaveLength(0);
    expect(appState.portfolio.goalAmount).toBe(0);
    expect(calcState.sellPct).toBe('0.98');
  });

  it('deduplicates and sorts balance history during sanitization', () => {
    localStorage.setItem(
      'crypto-portfolio-tracker',
      JSON.stringify({
        portfolio: {
          totalInvested: 1000,
          currentBalance: 500,
          goalAmount: 1500,
          savings: 500,
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
