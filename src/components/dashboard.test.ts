import { beforeEach, describe, expect, it, vi } from '#test';
import { renderDashboard, resetDashboardLegendStateForTests } from './dashboard';
import { renderBalanceDetailRows } from './dashboard.template';
import {
  DASHBOARD_VIEW_KEY,
  getDefaultCapitalLedgerState,
  loadState,
  saveState,
} from '../utils/storage';
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
  goalAmount?: number;
  capitalLedger?: AppState['capitalLedger'];
}

const DEFAULT_POSITIONS: AppState['positions'] = [
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

function seedState(options: SeedDashboardOptions = {}): void {
  const state: AppState = {
    portfolio: {
      totalInvested: options.totalInvested ?? 1000,
      currentBalance: options.currentBalance ?? 400,
      goalAmount: options.goalAmount ?? 1500,
      lastUpdated: '2026-02-21',
      balanceHistory: [{ date: '2026-02-21', balance: options.currentBalance ?? 400 }],
    },
    positions: options.positions ?? DEFAULT_POSITIONS,
    capitalLedger: options.capitalLedger ?? getDefaultCapitalLedgerState(),
  };

  saveState(state);
}

/**
 * Saldo libre en los exchanges: sin modo manual es la unica via para que el
 * portfolio valga mas que las posiciones abiertas.
 */
function connectExchangeWallet(
  totalUsdEstimate: number,
  positions: AppState['positions'] = DEFAULT_POSITIONS,
): void {
  saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
  vi.mocked(syncPositionsFromBinance).mockResolvedValue({
    positions,
    count: positions.length,
    totalUsdEstimate,
    balances: [{ asset: 'USDT', free: totalUsdEstimate, locked: 0 }],
  });
}

describe('dashboard balance sources', () => {
  it('marks each source exchange with its brand dot', () => {
    const body = document.createElement('tbody');
    renderBalanceDetailRows(body, [
      { asset: 'USDT', free: 10, locked: 0, sources: ['Bybit', 'Binance'] },
      { asset: 'BTC', free: 1, locked: 0 },
    ]);

    const [merged, unknown] = [...body.querySelectorAll('.dashboard-balance-source')];
    expect(merged?.textContent).toBe('Binance + Bybit');
    expect(merged?.querySelector('.provider-dot--binance')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(merged?.querySelector('.provider-dot--bybit')).not.toBeNull();
    expect(unknown?.textContent).toBe('—');
  });
});

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
        aprByPositionId: { p1: 30 },
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
      '40%',
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

  it('estimates ETA with active position capital instead of applying APR to the full balance', async () => {
    vi.mocked(getSharedMarketData).mockResolvedValue({
      positionsKey: 'p1',
      snapshot: {
        priceByAsset: { USDT: 1 },
        sourceByAsset: { USDT: 'stable' },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        changePercent24hByAsset: { USDT: 0 },
      },
      metrics: {
        totalUsd: 1055,
        weightedApr: 123.61,
        dailyEarningsUsd: 3.57,
        usdByPositionId: { p1: 1055 },
        aprByPositionId: { p1: 123.61 },
        priceByAsset: { USDT: 1 },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        priceSourceByAsset: { USDT: 'stable' },
      },
    });
    seedState({
      currentBalance: 41055,
      totalInvested: 40000,
      goalAmount: 45000,
    });
    connectExchangeWallet(40000);

    const snapshotSpy = vi.spyOn(projectionMilestones, 'buildProjectionSnapshot');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(snapshotSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        capital: 41055,
        earningCapital: 1055,
        apr: 123.61,
        goal: 45000,
        invested: 40000,
      }),
    );

    dispose();
    container.remove();
  });

  it('keeps dashboard values skeletonized until initial market hydration finishes', async () => {
    let resolveMarketData!: (value: Awaited<ReturnType<typeof getSharedMarketData>>) => void;
    vi.mocked(getSharedMarketData).mockReturnValue(
      new Promise((resolve) => {
        resolveMarketData = resolve;
      }),
    );
    seedState({
      currentBalance: 41055,
      totalInvested: 40000,
      goalAmount: 45000,
    });
    connectExchangeWallet(40000);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);

    expect((container.querySelector('#dash-balance') as HTMLElement).textContent).not.toContain(
      '$41,055.00',
    );
    expect(container.querySelector('#dash-balance .skeleton')).not.toBeNull();

    resolveMarketData({
      positionsKey: 'p1',
      snapshot: {
        priceByAsset: { USDT: 1 },
        sourceByAsset: { USDT: 'stable' },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        changePercent24hByAsset: { USDT: 0 },
      },
      metrics: {
        totalUsd: 1055,
        weightedApr: 123.61,
        dailyEarningsUsd: 3.57,
        usdByPositionId: { p1: 1055 },
        aprByPositionId: { p1: 123.61 },
        priceByAsset: { USDT: 1 },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        priceSourceByAsset: { USDT: 'stable' },
      },
    });
    await flushMicrotasks();

    expect((container.querySelector('#dash-balance') as HTMLElement).textContent).toContain(
      '$41,055.00',
    );

    dispose();
    container.remove();
  });

  it('adds capital ledger balance and APR while keeping BE target user-defined', async () => {
    vi.mocked(getSharedMarketData).mockResolvedValue({
      positionsKey: 'p1',
      snapshot: {
        priceByAsset: { USDT: 1 },
        sourceByAsset: { USDT: 'stable' },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        changePercent24hByAsset: { USDT: 0 },
      },
      metrics: {
        totalUsd: 1055,
        weightedApr: 123.61,
        dailyEarningsUsd: 3.57,
        usdByPositionId: { p1: 1055 },
        aprByPositionId: { p1: 123.61 },
        priceByAsset: { USDT: 1 },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        priceSourceByAsset: { USDT: 'stable' },
      },
    });
    const capitalLedger = getDefaultCapitalLedgerState();
    capitalLedger.vault = {
      activeValue: '110',
      activeValueAt: '2026-05-02T00:00:00.000Z',
      pnlTotal: '10',
    };
    capitalLedger.transactions = [
      { at: '2026-05-01T00:00:00.000Z', type: 'deposit', amount: '100' },
    ];
    seedState({
      currentBalance: 41055,
      totalInvested: 40000,
      goalAmount: 45000,
      capitalLedger,
    });
    connectExchangeWallet(40000);

    const snapshotSpy = vi.spyOn(projectionMilestones, 'buildProjectionSnapshot');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(snapshotSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        capital: 41165,
        earningCapital: 1165,
        goal: 45000,
        invested: 40000,
      }),
    );

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

  it('keeps the stored balance when there are no positions and no exchange data', async () => {
    seedState({ positions: [], currentBalance: 1234 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(container.querySelector('#dash-balance')?.textContent).toContain('$1,234.00');
    expect(loadState().portfolio.currentBalance).toBe(1234);

    dispose();
    container.remove();
  });

  it('shows zero balance when the exchanges report an empty wallet and no positions', async () => {
    seedState({ positions: [], currentBalance: 1234 });
    connectExchangeWallet(0, []);
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
        aprByPositionId: { p1: 30 },
        priceByAsset: { USDT: 1 },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: true,
        hasUnavailablePrices: false,
        priceSourceByAsset: { USDT: 'cache-stale' },
      },
    });
    seedState({ currentBalance: 600 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(container.querySelector('#dash-balance')?.textContent).toContain('$800.00');
    expect(registerApiFailure).toHaveBeenCalled();
    expect(showApiErrorBanner).toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('force refreshes auto data on mount and updates goal progress from the new balance', async () => {
    const syncedPositions: AppState['positions'] = [
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
      positions: syncedPositions,
      currentBalance: 600,
      totalInvested: 1000,
      goalAmount: 2000,
    });
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: syncedPositions,
      count: syncedPositions.length,
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
        aprByPositionId: { 'auto-1': 40 },
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
    expect(getSharedMarketData).toHaveBeenCalledWith(syncedPositions, true);
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
    const numberSpy = vi.spyOn(animation, 'setAnimatedNumber');
    const container = document.createElement('div');
    let dispose: (() => void) | null = null;

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
              aprByPositionId: { p1: 30 },
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
            aprByPositionId: { p1: 45 },
            priceByAsset: { USDT: 1 },
            marketLastUpdatedAt: Date.now(),
            hasStalePrices: false,
            hasUnavailablePrices: false,
            priceSourceByAsset: { USDT: 'stable' },
          },
        };
      });
      seedState({ currentBalance: 400 });

      document.body.appendChild(container);
      dispose = renderDashboard(container);

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
    } finally {
      dispose?.();
      container.remove();
      vi.clearAllTimers();
      numberSpy.mockRestore();
      rafSpy.mockRestore();
      cafSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('animates dashboard balance and PnL after the first market hydration', async () => {
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
    const numberSpy = vi.spyOn(animation, 'setAnimatedNumber');
    const container = document.createElement('div');
    let dispose: (() => void) | null = null;

    try {
      let metricCall = 0;
      vi.mocked(getSharedMarketData).mockImplementation(async () => {
        metricCall += 1;
        const totalUsd = metricCall === 1 ? 400 : 650;
        return {
          positionsKey: 'p1',
          snapshot: {
            priceByAsset: { ETH: metricCall === 1 ? 2000 : 2500, USDT: 1 },
            sourceByAsset: { ETH: 'live', USDT: 'stable' },
            marketLastUpdatedAt: Date.now(),
            hasStalePrices: false,
            hasUnavailablePrices: false,
            changePercent24hByAsset: { ETH: 0, USDT: 0 },
          },
          metrics: {
            totalUsd,
            weightedApr: metricCall === 1 ? 30 : 45,
            dailyEarningsUsd: metricCall === 1 ? 0.32 : 0.8,
            usdByPositionId: { p1: totalUsd },
            aprByPositionId: { p1: metricCall === 1 ? 30 : 45 },
            priceByAsset: { USDT: 1 },
            marketLastUpdatedAt: Date.now(),
            hasStalePrices: false,
            hasUnavailablePrices: false,
            priceSourceByAsset: { USDT: 'stable' },
          },
        };
      });
      seedState({ currentBalance: 400, totalInvested: 1000 });

      document.body.appendChild(container);
      dispose = renderDashboard(container);

      await vi.advanceTimersByTimeAsync(240);
      await Promise.resolve();
      await Promise.resolve();

      const callsAfterInitialHydration = numberSpy.mock.calls.length;

      await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(240);
      await Promise.resolve();
      await Promise.resolve();

      const postHydrationCalls = numberSpy.mock.calls.slice(callsAfterInitialHydration);
      const animatedIds = postHydrationCalls
        .filter((call) => {
          const options = call[4] as { enabled?: boolean } | undefined;
          return options?.enabled === true;
        })
        .map((call) => (call[1] as HTMLElement | null)?.id);

      expect(animatedIds).toContain('dash-balance');
      expect(animatedIds).toContain('dash-pnl');
      expect(animatedIds).toContain('dash-pnl-pct');
      expect(container.querySelector('#dash-balance')?.textContent).toContain('$650.00');
      expect(container.querySelector('#dash-pnl')?.textContent).toContain('-$350.00');
    } finally {
      dispose?.();
      container.remove();
      vi.clearAllTimers();
      numberSpy.mockRestore();
      rafSpy.mockRestore();
      cafSpy.mockRestore();
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
    expect(container.querySelector('#dashboard-positions-count')?.textContent?.trim()).toBe('1');
    expect(container.querySelector('#dashboard-positions-count .skeleton')).toBeNull();

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

  it('renders account balance detail in dashboard when an exchange is connected', async () => {
    seedState({ positions: [] });
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: [],
      count: 0,
      totalUsdEstimate: 260,
      balances: [
        { asset: 'USDT', free: 250, locked: 10 },
        { asset: 'ETH', free: 0.25, locked: 0 },
      ],
      accountReport: {
        fetchedAt: Date.now(),
        products: [
          {
            product: 'coin-m-futures',
            label: 'Futuros COIN-M',
            status: 'ok',
            balanceUsd: null,
            balanceAmounts: [{ asset: 'BTC', amount: 0.01 }],
            unrealizedPnl: [],
            dailyPnl: [],
            dailyRewards: [],
            positionCount: 1,
            includedInTotal: true,
          },
        ],
        dailyPnl: [],
        dailyRewards: [],
        externalFlows: [],
        issues: [],
        isPartial: false,
      },
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
    expect(container.querySelector('#dashboard-balance-strip-items')?.textContent).toContain('BTC');
    expect(container.querySelector('#dashboard-balance-strip-items')?.textContent).toContain(
      '260.00',
    );

    dispose();
    container.remove();
  });

  it('uses the consolidated account daily PnL in the existing dashboard rail', async () => {
    seedState({ positions: [] });
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: [],
      count: 0,
      totalUsdEstimate: 260,
      balances: [{ asset: 'USDT', free: 260, locked: 0 }],
      accountReport: {
        fetchedAt: Date.now(),
        products: [],
        dailyPnl: [],
        dailyRewards: [],
        externalFlows: [],
        issues: [],
        explicitDailyPnlUsd: -3,
        dailyBalanceChangeUsd: -3,
        isPartial: false,
      },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(container.querySelector('#dashboard-daily')?.textContent).toContain('-$3.00');
    expect(container.querySelector('#dashboard-apr')?.textContent).toContain('-421.15%');

    dispose();
    container.remove();
  });

  it('adds live active-position run-rate to Binance product PnL without double counting the balance', async () => {
    seedState({ positions: [] });
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: [
        {
          id: 'auto-1',
          asset: 'ETH',
          direction: 'buy-low',
          subscriptionAsset: 'USDT',
          amount: 100,
          targetPrice: 2000,
          entryDate: '2026-02-20',
          settlementDate: '2026-02-23',
          apr: 36.5,
          source: 'Binance',
          positionKind: 'dual',
        },
      ],
      count: 1,
      totalUsdEstimate: 900,
      balances: [{ asset: 'USDT', free: 900, locked: 0 }],
      accountReport: {
        fetchedAt: Date.now(),
        products: [],
        dailyPnl: [],
        dailyRewards: [],
        externalFlows: [],
        issues: [],
        explicitDailyPnlUsd: 2,
        dailyBalanceChangeUsd: 2,
        isPartial: false,
      },
    });
    vi.mocked(getSharedMarketData).mockResolvedValue({
      positionsKey: 'auto-1',
      snapshot: {
        priceByAsset: { USDT: 1, ETH: 2000 },
        sourceByAsset: { USDT: 'stable', ETH: 'live' },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        changePercent24hByAsset: { USDT: 0, ETH: 0 },
      },
      metrics: {
        totalUsd: 100,
        weightedApr: 36.5,
        dailyEarningsUsd: 0.1,
        usdByPositionId: { 'auto-1': 100 },
        aprByPositionId: { 'auto-1': 36.5 },
        priceByAsset: { USDT: 1 },
        marketLastUpdatedAt: Date.now(),
        hasStalePrices: false,
        hasUnavailablePrices: false,
        priceSourceByAsset: { USDT: 'stable' },
      },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect(container.querySelector('#dashboard-daily')?.textContent).toContain('$2.10');
    // APR = (2.10 / (900 + 100)) * 365 * 100, using total account value.
    expect(container.querySelector('#dashboard-apr')?.textContent).toContain('76.65%');

    dispose();
    container.remove();
  });

  it('animates account balance detail values when balances refresh in-place', async () => {
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
    const numberSpy = vi.spyOn(animation, 'setAnimatedNumber');
    const container = document.createElement('div');
    let dispose: (() => void) | null = null;

    try {
      seedState({ positions: [] });
      saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
      vi.mocked(syncPositionsFromBinance)
        .mockResolvedValueOnce({
          positions: [],
          count: 0,
          totalUsdEstimate: 260,
          balances: [{ asset: 'USDT', free: 250, locked: 10 }],
        })
        .mockResolvedValueOnce({
          positions: [],
          count: 0,
          totalUsdEstimate: 280,
          balances: [{ asset: 'USDT', free: 275, locked: 5 }],
        });

      document.body.appendChild(container);
      dispose = renderDashboard(container);

      await vi.advanceTimersByTimeAsync(240);
      await Promise.resolve();
      await Promise.resolve();

      const entry = container.querySelector('.dashboard-balance-entry');
      const total = container.querySelector('.dashboard-balance-total-value');
      expect(entry).not.toBeNull();
      expect(total?.textContent).toContain('260.00 USDT');

      const callsAfterInitialHydration = numberSpy.mock.calls.length;

      await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(240);
      await Promise.resolve();
      await Promise.resolve();

      expect(container.querySelector('.dashboard-balance-entry')).toBe(entry);

      const animatedBalanceDetailClasses = numberSpy.mock.calls
        .slice(callsAfterInitialHydration)
        .filter((call) => {
          const options = call[4] as { enabled?: boolean } | undefined;
          return options?.enabled === true;
        })
        .map((call) => (call[1] as HTMLElement | null)?.className ?? '');

      expect(
        animatedBalanceDetailClasses.some((name) => name.includes('dashboard-balance-total-value')),
      ).toBe(true);
      expect(
        animatedBalanceDetailClasses.some((name) =>
          name.includes('dashboard-balance-breakdown-value'),
        ),
      ).toBe(true);
      expect(total?.textContent).toContain('280.00 USDT');
    } finally {
      dispose?.();
      container.remove();
      vi.clearAllTimers();
      numberSpy.mockRestore();
      rafSpy.mockRestore();
      cafSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('adds active auto positions to the locked amount in the account balance detail', async () => {
    const syncedPositions: AppState['positions'] = [
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
    seedState({ positions: syncedPositions });
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: syncedPositions,
      count: syncedPositions.length,
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

  it('lists every exchange feeding an asset in the account balance source column', async () => {
    const syncedPositions: AppState['positions'] = [
      {
        id: 'usdt-1',
        asset: 'ETH',
        direction: 'buy-low',
        subscriptionAsset: 'USDT',
        amount: 40,
        targetPrice: 2200,
        entryDate: '2026-02-20',
        settlementDate: '2026-02-22',
        apr: 40,
        source: 'Bybit',
      },
    ];
    seedState({ positions: syncedPositions });
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: syncedPositions,
      count: syncedPositions.length,
      totalUsdEstimate: 300,
      balances: [
        { asset: 'USDT', free: 250, locked: 10, source: 'Binance' },
        { asset: 'ETH', free: 0.25, locked: 0, source: 'Bybit' },
        { asset: 'BTC', free: 0.01, locked: 0 },
      ],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const sourceByAsset = Object.fromEntries(
      [...container.querySelectorAll('.dashboard-balance-entry')].map((row) => [
        row.querySelector('.asset-pair')?.textContent?.trim(),
        row.querySelectorAll('td')[1]?.textContent?.trim(),
      ]),
    );

    expect(sourceByAsset.USDT).toBe('Binance + Bybit');
    expect(sourceByAsset.ETH).toBe('Bybit');
    expect(sourceByAsset.BTC).toBe('—');

    dispose();
    container.remove();
  });

  it('hides both milestone ticks while the dashboard is still loading', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);

    expect((container.querySelector('#dash-prog-tick-be') as HTMLElement).hidden).toBe(true);
    expect((container.querySelector('#dash-prog-tick-goal') as HTMLElement).hidden).toBe(true);

    dispose();
    container.remove();
  });

  it('hides both milestone ticks when the goal scale is degenerate', async () => {
    seedState({ positions: [], totalInvested: 0, goalAmount: 0, currentBalance: 0 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    expect((container.querySelector('#dash-prog-tick-be') as HTMLElement).hidden).toBe(true);
    expect((container.querySelector('#dash-prog-tick-goal') as HTMLElement).hidden).toBe(true);

    dispose();
    container.remove();
  });

  it('hangs a milestone label to the right when its marker sits near the start', async () => {
    seedState({ totalInvested: 100, goalAmount: 10000, currentBalance: 50 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const beTick = container.querySelector('#dash-prog-tick-be') as HTMLElement;
    const goalTick = container.querySelector('#dash-prog-tick-goal') as HTMLElement;

    expect(beTick.hidden).toBe(false);
    expect(beTick.classList.contains('is-after')).toBe(true);
    expect(goalTick.classList.contains('is-before')).toBe(true);
    expect(goalTick.style.left).toBe('100%');
    // El titulo cede su fila para que la marca baja no lo cruce.
    expect(container.querySelector('#dash-prog-head')?.className).toContain('has-edge-tick');

    dispose();
    container.remove();
  });

  it('lifts the lower milestone label when both markers nearly overlap', async () => {
    seedState({ totalInvested: 1000, goalAmount: 1050, currentBalance: 600 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const beTick = container.querySelector('#dash-prog-tick-be') as HTMLElement;
    const goalTick = container.querySelector('#dash-prog-tick-goal') as HTMLElement;

    expect(beTick.classList.contains('is-before')).toBe(true);
    expect(beTick.classList.contains('is-stacked')).toBe(true);
    expect(goalTick.classList.contains('is-stacked')).toBe(false);
    expect(container.querySelector('#dash-prog-head')?.className).toContain('has-stacked-tick');

    dispose();
    container.remove();
  });

  it('keeps both milestone labels inline when the markers are far apart', async () => {
    seedState({ totalInvested: 1000, goalAmount: 1500, currentBalance: 600 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    const beTick = container.querySelector('#dash-prog-tick-be') as HTMLElement;
    const goalTick = container.querySelector('#dash-prog-tick-goal') as HTMLElement;

    expect(beTick.classList.contains('is-before')).toBe(true);
    expect(beTick.classList.contains('is-stacked')).toBe(false);
    expect(goalTick.classList.contains('is-before')).toBe(true);
    expect(goalTick.classList.contains('is-stacked')).toBe(false);
    expect(container.querySelector('#dash-prog-head')?.className).toBe('progress-head');
    // Las marcas nombran el hito con su importe: sin la cifra repetirian los chips.
    expect(beTick.querySelector('.progress-tick-text')?.textContent).toBe('Breakeven $1,000');
    expect(goalTick.querySelector('.progress-tick-text')?.textContent).toBe('Meta $1,500');

    dispose();
    container.remove();
  });

  it('hides the meta tick and pins the BE tick to the end in be-only mode', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderDashboard(container);
    await flushMicrotasks();

    (container.querySelector('#dashboard-legend-goal') as HTMLButtonElement).click();

    const beTick = container.querySelector('#dash-prog-tick-be') as HTMLElement;
    const goalTick = container.querySelector('#dash-prog-tick-goal') as HTMLElement;

    expect(goalTick.hidden).toBe(true);
    expect(beTick.hidden).toBe(false);
    expect(beTick.style.left).toBe('100%');
    expect(beTick.classList.contains('is-before')).toBe(true);
    expect(beTick.querySelector('.progress-tick-text')?.textContent).toContain('Breakeven $');

    dispose();
    container.remove();
  });
});
