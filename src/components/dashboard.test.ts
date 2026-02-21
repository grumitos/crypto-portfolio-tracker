import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDashboard, resetDashboardLegendStateForTests } from './dashboard';
import { saveState } from '../utils/storage';
import type { AppState } from '../types';
import * as projectionMilestones from '../utils/projection-milestones';

vi.mock('../utils/market', () => ({
  calculatePositionMetrics: vi.fn(),
}));

vi.mock('../utils/api-status', () => ({
  registerApiFailure: vi.fn(),
  registerApiLastUpdatedAt: vi.fn(),
}));

vi.mock('../utils/notifications', () => ({
  showApiErrorBanner: vi.fn(),
}));

import { calculatePositionMetrics } from '../utils/market';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();

  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function seedState(): void {
  const state: AppState = {
    portfolio: {
      totalInvested: 1000,
      currentBalance: 600,
      savings: 200,
      goalAmount: 1500,
      lastUpdated: '2026-02-21',
      balanceHistory: [{ date: '2026-02-21', balance: 600 }],
    },
    positions: [{
      id: 'p1',
      asset: 'ETH',
      direction: 'buy-low',
      subscriptionAsset: 'USDT',
      amount: 1,
      targetPrice: 2200,
      entryDate: '2026-02-20',
      settlementDate: '2026-02-22',
      apr: 40,
    }],
  };

  saveState(state);
}

describe('dashboard legends', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });

    document.body.innerHTML = '';
    resetDashboardLegendStateForTests();

    vi.mocked(calculatePositionMetrics).mockResolvedValue({
      totalUsd: 400,
      weightedApr: 30,
      dailyEarningsUsd: 0.32,
      usdByPositionId: { p1: 400 },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'stable' },
    });

    seedState();
  });

  it('starts with both legends active and mode-both', async () => {
    const container = document.createElement('div');
    const dispose = renderDashboard(container, () => undefined);
    await flushMicrotasks();

    const bar = container.querySelector('#dash-goal-progress-bar') as HTMLElement;
    const beBtn = container.querySelector('#dashboard-legend-be') as HTMLButtonElement;
    const goalBtn = container.querySelector('#dashboard-legend-goal') as HTMLButtonElement;
    const target = container.querySelector('#dash-prog-target') as HTMLElement;

    expect(bar.classList.contains('mode-both')).toBe(true);
    expect(beBtn.getAttribute('aria-pressed')).toBe('true');
    expect(goalBtn.getAttribute('aria-pressed')).toBe('true');
    expect(target.textContent).toContain('Meta');

    dispose();
  });

  it('switches to meta-only mode when BE is toggled off', async () => {
    const container = document.createElement('div');
    const dispose = renderDashboard(container, () => undefined);
    await flushMicrotasks();

    const bar = container.querySelector('#dash-goal-progress-bar') as HTMLElement;
    const beBtn = container.querySelector('#dashboard-legend-be') as HTMLButtonElement;
    const goalBtn = container.querySelector('#dashboard-legend-goal') as HTMLButtonElement;

    beBtn.click();

    expect(bar.classList.contains('mode-goal')).toBe(true);
    expect(beBtn.getAttribute('aria-pressed')).toBe('false');
    expect(goalBtn.getAttribute('aria-pressed')).toBe('true');
    expect((container.querySelector('#dash-prog-target') as HTMLElement).textContent).toContain('Meta');
    expect((container.querySelector('#dashboard-days') as HTMLElement).textContent?.trim().startsWith('~')).toBe(true);
    expect((container.querySelector('#dashboard-days') as HTMLElement).textContent).not.toContain('Meta');

    dispose();
  });

  it('switches to be-only mode when Meta is toggled off and keeps last legend active', async () => {
    const container = document.createElement('div');
    const dispose = renderDashboard(container, () => undefined);
    await flushMicrotasks();

    const bar = container.querySelector('#dash-goal-progress-bar') as HTMLElement;
    const beBtn = container.querySelector('#dashboard-legend-be') as HTMLButtonElement;
    const goalBtn = container.querySelector('#dashboard-legend-goal') as HTMLButtonElement;

    goalBtn.click();

    expect(bar.classList.contains('mode-be')).toBe(true);
    expect(beBtn.getAttribute('aria-pressed')).toBe('true');
    expect(goalBtn.getAttribute('aria-pressed')).toBe('false');
    expect((container.querySelector('#dash-prog-target') as HTMLElement).textContent).toContain('BE');
    expect((container.querySelector('#dash-prog-solid-first') as HTMLElement).style.width).toBe('60%');

    beBtn.click();

    expect(beBtn.getAttribute('aria-pressed')).toBe('true');
    expect(bar.classList.contains('mode-be')).toBe(true);

    dispose();
  });

  it('calculates ETA from shared projection-milestones utility', async () => {
    const snapshotSpy = vi.spyOn(projectionMilestones, 'buildProjectionSnapshot');
    const container = document.createElement('div');
    const dispose = renderDashboard(container, () => undefined);
    await flushMicrotasks();

    expect(snapshotSpy).toHaveBeenCalled();
    expect((container.querySelector('#dashboard-days') as HTMLElement).textContent?.trim().startsWith('~')).toBe(true);

    dispose();
  });
});
