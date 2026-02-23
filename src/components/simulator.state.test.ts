import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDefaultViewState,
  loadSimulatorViewState,
  parsePositiveNumber,
  persistSimulatorViewState,
  sanitizeFrequency,
} from './simulator.state';
import { createMemoryStorage, resetDom } from '../test/test-utils';
import { SIMULATOR_VIEW_KEY, saveState } from '../utils/storage';

describe('simulator view state', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    resetDom();
  });

  it('parses positive numbers with fallback', () => {
    expect(parsePositiveNumber('10.5', 7)).toBe(10.5);
    expect(parsePositiveNumber(0, 7)).toBe(7);
    expect(parsePositiveNumber('bad', 7)).toBe(7);
  });

  it('sanitizes compounding frequency values', () => {
    expect(sanitizeFrequency('daily', 'weekly')).toBe('daily');
    expect(sanitizeFrequency('weekly', 'daily')).toBe('weekly');
    expect(sanitizeFrequency('biweekly', 'daily')).toBe('biweekly');
    expect(sanitizeFrequency('monthly', 'daily')).toBe('daily');
  });

  it('builds defaults from persisted app state', () => {
    saveState({
      portfolio: {
        totalInvested: 1000,
        currentBalance: 500,
        savings: 500,
        goalAmount: 900,
        lastUpdated: '2026-02-21',
        balanceHistory: [{ date: '2026-02-21', balance: 500 }],
      },
      positions: [
        {
          id: 'a',
          asset: 'ETH',
          direction: 'buy-low',
          subscriptionAsset: 'USDT',
          amount: 1,
          targetPrice: 2000,
          entryDate: '2026-02-20',
          settlementDate: '2026-02-21',
          apr: 10,
        },
        {
          id: 'b',
          asset: 'BTC',
          direction: 'buy-low',
          subscriptionAsset: 'USDT',
          amount: 3,
          targetPrice: 50000,
          entryDate: '2026-02-20',
          settlementDate: '2026-02-21',
          apr: 40,
        },
      ],
    });

    const defaults = getDefaultViewState();
    expect(defaults.capital).toBe(500);
    expect(defaults.goal).toBe(900);
    expect(defaults.apr).toBeCloseTo(32.5, 8);
    expect(defaults.frequency).toBe('daily');
    expect(defaults.targetMode).toBe('both');
    expect(defaults.autoCapital).toBe(true);
    expect(defaults.autoApr).toBe(true);
    expect(defaults.autoGoal).toBe(true);
  });

  it('falls back to defaults when saved view JSON is corrupted', () => {
    const defaults = getDefaultViewState();
    localStorage.setItem(SIMULATOR_VIEW_KEY, '{bad');

    const loaded = loadSimulatorViewState(defaults);
    expect(loaded).toEqual(defaults);
  });

  it('persists sanitized view values and auto flags from DOM inputs', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <input id="sim-capital" value="1234.5" />
      <input id="sim-apr" value="37.2" />
      <select id="sim-frequency">
        <option value="daily">daily</option>
        <option value="weekly" selected>weekly</option>
      </select>
      <input id="sim-goal" value="4567.8" />
    `;

    persistSimulatorViewState(container, { capital: false, apr: true, goal: false });
    const raw = localStorage.getItem(SIMULATOR_VIEW_KEY);
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw ?? '{}') as {
      capital: number;
      apr: number;
      frequency: string;
      goal: number;
      targetMode: string;
      autoCapital: boolean;
      autoApr: boolean;
      autoGoal: boolean;
    };

    expect(parsed.capital).toBe(1234.5);
    expect(parsed.apr).toBe(37.2);
    expect(parsed.frequency).toBe('weekly');
    expect(parsed.goal).toBe(4567.8);
    expect(parsed.targetMode).toBe('both');
    expect(parsed.autoCapital).toBe(false);
    expect(parsed.autoApr).toBe(true);
    expect(parsed.autoGoal).toBe(false);
  });
});
