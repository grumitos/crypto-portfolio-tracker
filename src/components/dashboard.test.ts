import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDashboard, resetDashboardLegendStateForTests } from './dashboard';
import { DASHBOARD_VIEW_KEY, loadState, saveState } from '../utils/storage';
import type { AppState } from '../types';
import * as projectionMilestones from '../utils/projection-milestones';
import * as animation from '../utils/animation';
import { createMemoryStorage, flushMicrotasks, mockMatchMedia, resetDom } from '../test/test-utils';

vi.mock('../utils/api-runtime-cache', () => ({
  getSharedMarketData: vi.fn(),
  getCachedAutoPortfolioSnapshot: vi.fn(() => null),
  getCachedBalanceSummary: vi.fn(() => null),
  rememberAutoPortfolioSnapshot: vi.fn(),
  rememberBalanceSummary: vi.fn(),
  clearApiRuntimeCache: vi.fn(),
}));

vi.mock('../utils/binance-sync', () => ({
  fetchBalanceSummary: vi.fn(),
  syncPositionsFromBinance: vi.fn(),
  hasAnyExchangeApiCredentials: () =>
    localStorage.getItem('crypto-binance-api') !== null ||
    localStorage.getItem('crypto-bybit-api') !== null,
  clearBinanceSyncCaches: vi.fn(),
}));

vi.mock('../utils/api-status', () => ({
  registerApiFailure: vi.fn(),
  registerApiLastUpdatedAt: vi.fn(),
}));

vi.mock('../utils/notifications', () => ({
  showApiErrorBanner: vi.fn(),
}));

import { getSharedMarketData, rememberAutoPortfolioSnapshot } from '../utils/api-runtime-cache';
import { fetchBalanceSummary, syncPositionsFromBinance } from '../utils/binance-sync';
import { registerApiFailure } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { MARKET_POLL_INTERVAL_MS } from '../utils/constants';
import { saveApiCredentials } from '../utils/binance-auth';
import { resetMarketPollerForTests } from '../utils/market-poller';

interface SeedDashboardOptions {
  positions?: AppState['positions'];
  totalInvested?: number;
  currentBalance?: number;
  savings?: number;
  goalAmount?: number;
  mode?: 'manual' | 'auto';
}

function seedState(options: SeedDashboardOptions = {}): void {
  const defaultPositions: AppState['positions'] = [
    {
      id: 'p1',
      asset: 'ETH',
      direction: 'buy-low',
      subscriptionAsset: 'USDT',
      amount: 1,
      targetPrice: 2200,
      entryDate: '2026-02-20',
      settlementDate: '2026-02-22',
      apr: 40,
    },
  ];

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
    manualPositions: options.positions ?? defaultPositions,
    autoPositions: [],
    positionsConfig: { mode: options.mode ?? 'manual' },
  };

  saveState(state);
}

describe('dashboard legends', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });

    resetDom();
    mockMatchMedia(true);
    resetDashboardLegendStateForTests();
    resetMarketPollerForTests();

    vi.mocked(getSharedMarketData).mockResolvedValue({
      positionsKey: 'p1',
      snapshot: {
        priceByAsset: { BTC: 50000, ETH: 2000, BNB: 500, SOL: 150, USDT: 1, USDC: 1 },
        sourceByAsset: {
          BTC: 'live',
          ETH: 'live',
          BNB: 'live',
          SOL: 'live',
          USDT: 'stable',
          USDC: 'stable',
        },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        changePercent24hByAsset: { BTC: 0, ETH: 0, BNB: 0, SOL: 0, USDT: 0, USDC: 0 },
      },
      metrics: {
        totalUsd: 400,
        weightedApr: 30,
        dailyEarningsUsd: 0.32,
        usdByPositionId: { p1: 400 },
        priceByAsset: { USDT: 1 },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        priceSourceByAsset: { USDT: 'stable' },
      },
    });
    vi.mocked(fetchBalanceSummary).mockResolvedValue({
      balances: [],
      totalUsdEstimate: 0,
    });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: [],
      count: 0,
      balances: [],
      totalUsdEstimate: 0,
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
    expect((container.querySelector('#dash-prog-target') as HTMLElement).textContent).toContain(
      'Meta',
    );
    expect(
      (container.querySelector('#dashboard-days') as HTMLElement).textContent
        ?.trim()
        .startsWith('~'),
    ).toBe(true);
    expect((container.querySelector('#dashboard-days') as HTMLElement).textContent).not.toContain(
      'Meta',
    );

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
    expect((container.querySelector('#dash-prog-target') as HTMLElement).textContent).toContain(
      'BE',
    );
    expect((container.querySelector('#dash-prog-solid-first') as HTMLElement).style.width).toBe(
      '60%',
    );

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
    expect(
      (container.querySelector('#dashboard-days') as HTMLElement).textContent
        ?.trim()
        .startsWith('~'),
    ).toBe(true);

    dispose();
    container.remove();
  });

  it('avoids provisional ETA before first market hydration', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);

    const days =
      (container.querySelector('#dashboard-days') as HTMLElement).textContent?.trim() ?? '';
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
    vi.mocked(getSharedMarketData).mockResolvedValue({
      positionsKey: 'p1',
      snapshot: {
        priceByAsset: { BTC: 50000, ETH: 2000, BNB: 500, SOL: 150, USDT: 1, USDC: 1 },
        sourceByAsset: {
          BTC: 'live',
          ETH: 'live',
          BNB: 'live',
          SOL: 'live',
          USDT: 'cache-stale',
          USDC: 'stable',
        },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: true,
        hasUnavailablePrices: false,
        changePercent24hByAsset: { BTC: 0, ETH: 0, BNB: 0, SOL: 0, USDT: 0, USDC: 0 },
      },
      metrics: {
        totalUsd: 800,
        weightedApr: 30,
        dailyEarningsUsd: 0.5,
        usdByPositionId: { p1: 800 },
        priceByAsset: { USDT: 1 },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: true,
        hasUnavailablePrices: false,
        priceSourceByAsset: { USDT: 'cache-stale' },
      },
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

  it('force refreshes auto data on mount and updates goal progress from the new balance', async () => {
    const autoPositions: AppState['positions'] = [
      {
        id: 'auto-1',
        asset: 'ETH',
        direction: 'buy-low',
        subscriptionAsset: 'USDT',
        amount: 1000,
        targetPrice: 2200,
        entryDate: '2026-02-20',
        settlementDate: '2026-02-22',
        apr: 40,
      },
    ];
    seedState({
      mode: 'auto',
      positions: autoPositions,
      currentBalance: 600,
      savings: 200,
      totalInvested: 1000,
      goalAmount: 2000,
    });
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: autoPositions,
      count: autoPositions.length,
      totalUsdEstimate: 200,
      balances: [{ asset: 'USDT', free: 200, locked: 0 }],
    });
    vi.mocked(getSharedMarketData).mockResolvedValue({
      positionsKey: 'auto-1',
      snapshot: {
        priceByAsset: { USDT: 1 },
        sourceByAsset: { USDT: 'stable' },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        changePercent24hByAsset: { USDT: 0 },
      },
      metrics: {
        totalUsd: 1000,
        weightedApr: 40,
        dailyEarningsUsd: 1.1,
        usdByPositionId: { 'auto-1': 1000 },
        priceByAsset: { USDT: 1 },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        priceSourceByAsset: { USDT: 'stable' },
      },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container, { forceRefreshOnMount: true });
    await flushMicrotasks();

    expect(syncPositionsFromBinance).toHaveBeenCalledWith(true);
    expect(getSharedMarketData).toHaveBeenCalledWith(autoPositions, true);
    expect(loadState().portfolio.currentBalance).toBe(1200);
    expect(container.querySelector('#dash-balance')?.textContent).toContain('$1,200.00');
    expect(container.querySelector('#dash-goal-progress-bar')?.getAttribute('aria-valuenow')).toBe(
      '60',
    );
    expect((container.querySelector('#dash-prog-solid-first') as HTMLElement).style.width).toBe(
      '50%',
    );
    expect((container.querySelector('#dash-prog-solid-second') as HTMLElement).style.width).toBe(
      '10%',
    );

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
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
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
      vi.mocked(getSharedMarketData).mockImplementation(async () => {
        metricCall += 1;
        if (metricCall === 1) {
          return {
            positionsKey: 'p1',
            snapshot: {
              priceByAsset: { BTC: 50000, ETH: 2000, BNB: 500, SOL: 150, USDT: 1, USDC: 1 },
              sourceByAsset: {
                BTC: 'live',
                ETH: 'live',
                BNB: 'live',
                SOL: 'live',
                USDT: 'stable',
                USDC: 'stable',
              },
              marketLastUpdatedAt: Date.now(),
              hasStalePrices: false,
              hasUnavailablePrices: false,
              changePercent24hByAsset: { BTC: 0, ETH: 0, BNB: 0, SOL: 0, USDT: 0, USDC: 0 },
            },
            metrics: {
              totalUsd: 400,
              weightedApr: 30,
              dailyEarningsUsd: 0.32,
              usdByPositionId: { p1: 400 },
              priceByAsset: { USDT: 1 },
              marketLastUpdatedAt: Date.now(),
              hasStalePrices: false,
              hasUnavailablePrices: false,
              priceSourceByAsset: { USDT: 'stable' },
            },
          };
        }
        return {
          positionsKey: 'p1',
          snapshot: {
            priceByAsset: { BTC: 50000, ETH: 2200, BNB: 500, SOL: 150, USDT: 1, USDC: 1 },
            sourceByAsset: {
              BTC: 'live',
              ETH: 'live',
              BNB: 'live',
              SOL: 'live',
              USDT: 'stable',
              USDC: 'stable',
            },
            marketLastUpdatedAt: Date.now(),
            hasStalePrices: false,
            hasUnavailablePrices: false,
            changePercent24hByAsset: { BTC: 0, ETH: 0, BNB: 0, SOL: 0, USDT: 0, USDC: 0 },
          },
          metrics: {
            totalUsd: 500,
            weightedApr: 45,
            dailyEarningsUsd: 0.51,
            usdByPositionId: { p1: 500 },
            priceByAsset: { USDT: 1 },
            marketLastUpdatedAt: Date.now(),
            hasStalePrices: false,
            hasUnavailablePrices: false,
            priceSourceByAsset: { USDT: 'stable' },
          },
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
    vi.mocked(getSharedMarketData).mockRejectedValue(new Error('boom'));
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

    // Update state directly and dispatch config change event (simulating unified config modal save)
    const before = loadState();
    const basePositionsValue =
      before.positions.length > 0 ? before.portfolio.currentBalance - before.portfolio.savings : 0;
    const nextBalance = Math.max(0, Math.round((basePositionsValue + 300) * 100) / 100);
    saveState({
      ...before,
      portfolio: { ...before.portfolio, savings: 300, currentBalance: nextBalance },
    });
    window.dispatchEvent(new CustomEvent('binance-config-change'));
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

    // Update state directly and dispatch config change event (simulating unified config modal save)
    const before = loadState();
    saveState({
      ...before,
      portfolio: { ...before.portfolio, totalInvested: 900, goalAmount: 1400 },
    });
    window.dispatchEvent(new CustomEvent('binance-config-change'));
    await flushMicrotasks();

    const next = loadState();
    expect(next.portfolio.totalInvested).toBe(900);
    expect(next.portfolio.goalAmount).toBe(1400);
    expect(container.querySelector('#dash-invested')?.textContent).toContain('$900.00');
    expect(container.querySelector('#dash-prog-target')?.textContent).toContain('$1,400.00');

    dispose();
    container.remove();
  });

  it('renders account balance detail in dashboard when Binance auto mode is active', async () => {
    seedState({ mode: 'auto', positions: [] });
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: [],
      count: 0,
      totalUsdEstimate: 260,
      balances: [
        { asset: 'USDT', free: 250, locked: 10 },
        { asset: 'ETH', free: 0.25, locked: 0 },
      ],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(syncPositionsFromBinance).toHaveBeenCalled();
    expect(rememberAutoPortfolioSnapshot).toHaveBeenCalled();
    expect(container.querySelector('#dashboard-balance-strip')).not.toBeNull();
    expect(container.querySelector('#dashboard-balance-strip')?.textContent).toContain(
      'Saldo en cuenta',
    );
    expect(container.querySelector('#dashboard-balance-strip-items')?.textContent).toContain(
      'USDT',
    );
    expect(container.querySelector('#dashboard-balance-strip-items')?.textContent).toContain(
      '260.00',
    );

    dispose();
    container.remove();
  });

  it('adds active auto positions to the locked amount in the account balance detail', async () => {
    const autoPositions: AppState['positions'] = [
      {
        id: 'eth-1',
        asset: 'ETH',
        direction: 'sell-high',
        subscriptionAsset: 'ETH',
        amount: 9.93127984,
        targetPrice: 2400,
        entryDate: '2026-02-20',
        settlementDate: '2026-02-22',
        apr: 40,
      },
      {
        id: 'sol-1',
        asset: 'SOL',
        direction: 'sell-high',
        subscriptionAsset: 'SOL',
        amount: 234.41857548,
        targetPrice: 180,
        entryDate: '2026-02-20',
        settlementDate: '2026-02-22',
        apr: 28,
      },
    ];
    seedState({
      mode: 'auto',
      positions: autoPositions,
    });
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: autoPositions,
      count: autoPositions.length,
      totalUsdEstimate: 25,
      balances: [
        { asset: 'USDC', free: 22.80919709, locked: 0 },
        { asset: 'USDT', free: 0.08945718, locked: 0 },
        { asset: 'SOL', free: 0.000575, locked: 0 },
        { asset: 'ETH', free: 0.00008, locked: 0 },
      ],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const stripText = container.querySelector('#dashboard-balance-strip-items')?.textContent ?? '';

    expect(stripText).toContain('ETH');
    expect(stripText).toContain('9.9314');
    expect(stripText).toContain('SOL');
    expect(stripText).toContain('234.42');

    dispose();
    container.remove();
  });
});
