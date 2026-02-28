import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDashboard, resetDashboardLegendStateForTests } from './dashboard';
import { DASHBOARD_VIEW_KEY, loadState, saveState } from '../utils/storage';
import type { AppState } from '../types';
import * as projectionMilestones from '../utils/projection-milestones';
import * as animation from '../utils/animation';
import { createMemoryStorage, flushMicrotasks, mockMatchMedia, resetDom } from '../test/test-utils';

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
import { registerApiFailure } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { MARKET_POLL_INTERVAL_MS } from '../utils/constants';

interface SeedDashboardOptions {
  positions?: AppState['positions'];
  totalInvested?: number;
  currentBalance?: number;
  savings?: number;
  goalAmount?: number;
}

function seedState(options: SeedDashboardOptions = {}): void {
  const defaultPositions: AppState['positions'] = [{
    id: 'p1',
    asset: 'ETH',
    direction: 'buy-low',
    subscriptionAsset: 'USDT',
    amount: 1,
    targetPrice: 2200,
    entryDate: '2026-02-20',
    settlementDate: '2026-02-22',
    apr: 40,
  }];

  const state: AppState = {
    portfolio: {
      totalInvested: options.totalInvested ?? 1000,
      currentBalance: options.currentBalance ?? 600,
      savings: options.savings ?? 200,
      goalAmount: options.goalAmount ?? 1500,
      lastUpdated: '2026-02-21',
      balanceHistory: [{ date: '2026-02-21', balance: options.currentBalance ?? 600 }],
    },
    positions: options.positions ?? defaultPositions,
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

    resetDom();
    mockMatchMedia(true);
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
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
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
    container.remove();
  });

  it('switches to meta-only mode when BE is toggled off', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
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
    container.remove();
  });

  it('persists legend selection after toggle', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const beBtn = container.querySelector('#dashboard-legend-be') as HTMLButtonElement;
    beBtn.click();

    const raw = localStorage.getItem(DASHBOARD_VIEW_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '{}')).toEqual({ legend: { be: false, goal: true } });

    dispose();
    container.remove();
  });

  it('restores persisted legend selection on remount', async () => {
    localStorage.setItem(DASHBOARD_VIEW_KEY, JSON.stringify({ legend: { be: false, goal: true } }));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const bar = container.querySelector('#dash-goal-progress-bar') as HTMLElement;
    const beBtn = container.querySelector('#dashboard-legend-be') as HTMLButtonElement;
    const goalBtn = container.querySelector('#dashboard-legend-goal') as HTMLButtonElement;

    expect(bar.classList.contains('mode-goal')).toBe(true);
    expect(beBtn.getAttribute('aria-pressed')).toBe('false');
    expect(goalBtn.getAttribute('aria-pressed')).toBe('true');

    dispose();
    container.remove();
  });

  it('falls back to both legends when persisted dashboard view is invalid', async () => {
    localStorage.setItem(DASHBOARD_VIEW_KEY, '{bad');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const bar = container.querySelector('#dash-goal-progress-bar') as HTMLElement;
    const beBtn = container.querySelector('#dashboard-legend-be') as HTMLButtonElement;
    const goalBtn = container.querySelector('#dashboard-legend-goal') as HTMLButtonElement;

    expect(bar.classList.contains('mode-both')).toBe(true);
    expect(beBtn.getAttribute('aria-pressed')).toBe('true');
    expect(goalBtn.getAttribute('aria-pressed')).toBe('true');

    dispose();
    container.remove();
  });

  it('switches to be-only mode when Meta is toggled off and keeps last legend active', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
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
    container.remove();
  });

  it('calculates ETA from shared projection-milestones utility', async () => {
    const snapshotSpy = vi.spyOn(projectionMilestones, 'buildProjectionSnapshot');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(snapshotSpy).toHaveBeenCalled();
    expect((container.querySelector('#dashboard-days') as HTMLElement).textContent?.trim().startsWith('~')).toBe(true);

    dispose();
    container.remove();
  });

  it('avoids provisional ETA before first market hydration', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);

    const days = (container.querySelector('#dashboard-days') as HTMLElement).textContent?.trim() ?? '';
    expect(days).toBe('');

    dispose();
    container.remove();
  });

  it('renders fallback market stats when there are no active positions', async () => {
    seedState({ positions: [] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(container.querySelector('#dashboard-apr')?.textContent?.trim()).toBe('---');
    expect(container.querySelector('#dashboard-capital')?.textContent?.trim()).toBe('---');
    expect(container.querySelector('#dashboard-daily')?.textContent?.trim()).toBe('---');

    dispose();
    container.remove();
  });

  it('shows zero balance when there are no positions and no savings', async () => {
    seedState({ positions: [], currentBalance: 1234, savings: 0 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(container.querySelector('#dash-balance')?.textContent).toContain('$0.00');
    expect(loadState().portfolio.currentBalance).toBe(0);

    dispose();
    container.remove();
  });

  it('syncs dashboard balance from market metrics and surfaces stale API status', async () => {
    vi.mocked(calculatePositionMetrics).mockResolvedValue({
      totalUsd: 800,
      weightedApr: 30,
      dailyEarningsUsd: 0.5,
      usdByPositionId: { p1: 800 },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: true,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'cache-stale' },
    });
    seedState({ currentBalance: 600, savings: 200 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(container.querySelector('#dash-balance')?.textContent).toContain('$1,000.00');
    expect(registerApiFailure).toHaveBeenCalled();
    expect(showApiErrorBanner).toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('keeps dashboard days animation disabled during first market hydration', async () => {
    mockMatchMedia(false);
    const numberSpy = vi.spyOn(animation, 'setAnimatedNumber');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const dayCallsOnInitialHydration = numberSpy.mock.calls.filter((call) => {
      const el = call[1] as HTMLElement | null;
      return el?.id === 'dashboard-days';
    });
    const hasAnimatedDaysOnInitialHydration = dayCallsOnInitialHydration.some((call) => {
      const options = call[4] as { enabled?: boolean } | undefined;
      return options?.enabled === true;
    });

    expect(hasAnimatedDaysOnInitialHydration).toBe(false);

    const goalBtn = container.querySelector('#dashboard-legend-goal') as HTMLButtonElement;
    goalBtn.click();

    const dayCallsAfterInteraction = numberSpy.mock.calls.filter((call) => {
      const el = call[1] as HTMLElement | null;
      return el?.id === 'dashboard-days';
    });
    const hasAnimatedDaysAfterInteraction = dayCallsAfterInteraction.some((call) => {
      const options = call[4] as { enabled?: boolean } | undefined;
      return options?.enabled === true;
    });

    expect(hasAnimatedDaysAfterInteraction).toBe(true);
    numberSpy.mockRestore();

    dispose();
    container.remove();
  });

  it('updates balance date without triggering text animation', async () => {
    const textSpy = vi.spyOn(animation, 'setAnimatedText');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const balanceDateCalls = textSpy.mock.calls.filter((call) => {
      const el = call[1] as HTMLElement | null;
      return el?.id === 'dash-balance-date';
    });

    expect(balanceDateCalls).toHaveLength(0);
    textSpy.mockRestore();

    dispose();
    container.remove();
  });

  it('renders dashboard ETA once per autosync tick with latest APR only', async () => {
    vi.useFakeTimers();
    mockMatchMedia(false);

    let rafTime = 0;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      return setTimeout(() => {
        rafTime += 16;
        cb(rafTime);
      }, 16) as unknown as number;
    });
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      clearTimeout(id);
    });

    try {
      let metricCall = 0;
      vi.mocked(calculatePositionMetrics).mockImplementation(async () => {
        metricCall += 1;
        if (metricCall === 1) {
          return {
            totalUsd: 400,
            weightedApr: 30,
            dailyEarningsUsd: 0.32,
            usdByPositionId: { p1: 400 },
            priceByAsset: { USDT: 1 },
            marketLastUpdatedAt: Date.now(),
            hasStalePrices: false,
            hasUnavailablePrices: false,
            priceSourceByAsset: { USDT: 'stable' },
          };
        }
        return {
          totalUsd: 500,
          weightedApr: 45,
          dailyEarningsUsd: 0.51,
          usdByPositionId: { p1: 500 },
          priceByAsset: { USDT: 1 },
          marketLastUpdatedAt: Date.now(),
          hasStalePrices: false,
          hasUnavailablePrices: false,
          priceSourceByAsset: { USDT: 'stable' },
        };
      });
      seedState({ currentBalance: 600, savings: 200 });

      const numberSpy = vi.spyOn(animation, 'setAnimatedNumber');
      const container = document.createElement('div');
      document.body.appendChild(container);
      const dispose = renderDashboard(container);

      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();

      const dayCallsAfterFirstTick = numberSpy.mock.calls.filter((call) => {
        const el = call[1] as HTMLElement | null;
        return el?.id === 'dashboard-days';
      }).length;

      await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();

      const dayCalls = numberSpy.mock.calls.filter((call) => {
        const el = call[1] as HTMLElement | null;
        return el?.id === 'dashboard-days';
      });
      const secondTickCalls = dayCalls.slice(dayCallsAfterFirstTick);

      expect(secondTickCalls).toHaveLength(1);
      const secondTickOptions = secondTickCalls[0]?.[4] as { enabled?: boolean } | undefined;
      expect(secondTickOptions?.enabled).toBe(true);

      numberSpy.mockRestore();
      rafSpy.mockRestore();
      cafSpy.mockRestore();
      dispose();
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles market fetch errors by flagging API failure', async () => {
    vi.mocked(calculatePositionMetrics).mockRejectedValue(new Error('boom'));
    seedState();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(registerApiFailure).toHaveBeenCalled();
    expect(showApiErrorBanner).toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('applies savings changes immediately without full rerender', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const savingsInput = container.querySelector('#input-balance') as HTMLInputElement;
    savingsInput.value = '300';
    (container.querySelector('#btn-save-balance') as HTMLButtonElement).click();
    await flushMicrotasks();

    const next = loadState();
    expect(next.portfolio.savings).toBe(300);
    expect(next.portfolio.currentBalance).toBe(700);
    expect(container.querySelector('#dash-balance')?.textContent).toContain('$700.00');
    expect(container.querySelector('#dash-pnl')?.textContent).toContain('-$300.00');

    dispose();
    container.remove();
  });

  it('applies invested and goal settings immediately without full rerender', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const investedInput = container.querySelector('#input-invested') as HTMLInputElement;
    const goalInput = container.querySelector('#input-goal') as HTMLInputElement;
    investedInput.value = '900';
    goalInput.value = '1400';
    (container.querySelector('#btn-save-settings') as HTMLButtonElement).click();
    await flushMicrotasks();

    const next = loadState();
    expect(next.portfolio.totalInvested).toBe(900);
    expect(next.portfolio.goalAmount).toBe(1400);
    expect(container.querySelector('#dash-invested')?.textContent).toContain('$900.00');
    expect(container.querySelector('#dash-prog-target')?.textContent).toContain('$1,400.00');

    dispose();
    container.remove();
  });
});
