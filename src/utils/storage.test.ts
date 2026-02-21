import { beforeEach, describe, expect, it } from 'vitest';
import {
  exportBackup,
  getDefaultCalcState,
  importBackup,
  loadCalcState,
  loadState,
  replacePositions,
  saveCalcState,
  saveState,
} from './storage';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();

  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe('storage', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it('infers sell sync source and sanitizes purchases when loading calculadora state', () => {
    localStorage.setItem('crypto-calculadora', JSON.stringify({
      sellPrice: '615.50',
      sellPct: '0.98',
      sellSyncSource: null,
      purchases: [{ id: 'bad', qty: '1.25<script>', price: '600.45\"' }],
    }));

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
    localStorage.setItem('crypto-portfolio-tracker', JSON.stringify({
      portfolio: {
        totalInvested: 'bad',
        currentBalance: '-100',
        goalAmount: 0,
        lastUpdated: 'not-a-date',
        balanceHistory: [{ date: 'not-a-date', balance: 'oops' }],
      },
      positions: [{
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
      }],
    }));

    const state = loadState();
    const position = state.positions[0];

    expect(state.portfolio.currentBalance).toBe(0);
    expect(state.portfolio.goalAmount).toBeGreaterThan(0);
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
    expect(original.positions.length).toBeGreaterThan(0);

    replacePositions([{
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
    }]);

    const next = loadState();
    expect(next.positions).toHaveLength(1);
    expect(next.positions[0].id).toBe('bulk_1');
    expect(next.positions[0].entryTime).toBe('08:05');
    expect(next.positions[0].settlementTime).toBe('03:00');
  });
});
