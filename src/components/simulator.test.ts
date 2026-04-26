import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSimulator } from './simulator';
import { SIMULATOR_VIEW_KEY, saveState } from '../utils/storage';
import type { AppState } from '../types';
import * as calculator from '../utils/calculator';
import { createMemoryStorage, flushMicrotasks, mockMatchMedia, resetDom } from '../test/test-utils';
import { getSharedMarketData } from '../utils/api-runtime-cache';
import { registerApiFailure } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { resetMarketPollerForTests } from '../utils/market-poller';

vi.mock('../utils/api-runtime-cache', () => ({
  getSharedMarketData: vi.fn(),
  clearApiRuntimeCache: vi.fn(),
}));

vi.mock('../utils/api-status', () => ({
  registerApiFailure: vi.fn(),
  registerApiLastUpdatedAt: vi.fn(),
}));

vi.mock('../utils/notifications', () => ({
  showApiErrorBanner: vi.fn(),
}));

interface SeedSimulatorOptions {
  totalInvested?: number;
  goalAmount?: number;
  positions?: AppState['positions'];
}

const DEFAULT_POSITION: AppState['positions'][number] = {
  id: 'p1',
  asset: 'ETH',
  direction: 'buy-low',
  subscriptionAsset: 'USDT',
  amount: 100,
  targetPrice: 2000,
  entryDate: '2026-02-20',
  settlementDate: '2026-02-21',
  apr: 35,
};

function mockAutoMetrics({
  totalUsd = 400,
  weightedApr = 35,
}: {
  totalUsd?: number;
  weightedApr?: number;
} = {}): void {
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
      totalUsd,
      weightedApr,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { p1: totalUsd },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'stable' },
    },
  });
}

function seedState(options: SeedSimulatorOptions = {}): void {
  const state: AppState = {
    portfolio: {
      totalInvested: options.totalInvested ?? 1200,
      currentBalance: 1000,
      savings: 1000,
      goalAmount: options.goalAmount ?? 1500,
      lastUpdated: '2026-02-21',
      balanceHistory: [{ date: '2026-02-21', balance: 1000 }],
    },
    positions: options.positions ?? [DEFAULT_POSITION],
    manualPositions: options.positions ?? [DEFAULT_POSITION],
    autoPositions: [],
    positionsConfig: { mode: 'manual' },
  };

  saveState(state);
}

describe('simulator dual milestones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    mockMatchMedia(true);
    resetDom();
    resetMarketPollerForTests();
    seedState();
    mockAutoMetrics();
  });

  it('renders without target mode buttons and shows both BE/Meta columns', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    expect(container.querySelectorAll('.sim-target-btn').length).toBe(0);
    expect(container.querySelector('#sim-out-be-date')).not.toBeNull();
    expect(container.querySelector('#sim-out-be-time')).not.toBeNull();
    expect(container.querySelector('#sim-out-goal-date')).not.toBeNull();
    expect(container.querySelector('#sim-out-goal-time')).not.toBeNull();

    const projectionRows = container.querySelectorAll('#sim-table tbody tr');
    expect(projectionRows.length).toBeGreaterThan(0);

    dispose();
    container.remove();
  });

  it('shows projection table skeleton on initial load without a chart', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);

    expect((container.querySelector('#sim-table-container') as HTMLElement).style.display).toBe(
      'block',
    );
    expect(container.querySelector('#projection-chart')).toBeNull();
    expect(container.querySelector('#sim-projection-chart-skeleton')).toBeNull();
    expect(container.querySelector('#sim-table .sim-projection-table-skeleton')).not.toBeNull();

    dispose();
    container.remove();
  });

  it('marks milestone rows in the projection table', async () => {
    seedState({ totalInvested: 410, goalAmount: 430 });
    mockAutoMetrics({ totalUsd: 400, weightedApr: 35 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    const headers = Array.from(container.querySelectorAll('#sim-table th')).map((th) =>
      th.textContent?.trim(),
    );

    expect(headers).toContain('Hito');
    expect(container.querySelector('.sim-projection-badge-be')).not.toBeNull();
    expect(container.querySelector('.sim-projection-badge-goal')).not.toBeNull();

    dispose();
    container.remove();
  });

  it('shows N/D for auto APR hint until market hydration completes', async () => {
    seedState({ positions: [DEFAULT_POSITION] });
    mockAutoMetrics({ totalUsd: 400, weightedApr: 35 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);

    const capitalHint = container.querySelector('#sim-capital-hint') as HTMLElement;
    const aprHint = container.querySelector('#sim-apr-hint') as HTMLElement;
    const capitalInput = container.querySelector('#sim-capital') as HTMLInputElement;
    const aprInput = container.querySelector('#sim-apr') as HTMLInputElement;
    const initialCapitalHint = capitalHint.textContent?.trim();
    const initialAprHint = aprHint.textContent?.trim();

    expect(initialCapitalHint).toBe('Capital en posiciones');
    expect(initialAprHint).toBe('Promedio ponderado (USD): N/D');
    expect(capitalInput.value).toBe('');
    expect(aprInput.value).toBe('');

    await flushMicrotasks();

    expect(capitalHint.textContent?.trim()).toBe('Capital en posiciones');
    expect(aprHint.textContent?.trim()).toBe('Promedio ponderado (USD): 35.00%');
    expect(capitalInput.value).toBe('400.00');
    expect(aprInput.value).toBe('35.00');

    dispose();
    container.remove();
  });

  it('ignores persisted auto values until hydrated with market metrics', async () => {
    seedState({ positions: [DEFAULT_POSITION] });
    localStorage.setItem(
      SIMULATOR_VIEW_KEY,
      JSON.stringify({
        capital: 9999.99,
        apr: 141.3,
        frequency: 'weekly',
        goal: 99999.99,
        autoCapital: true,
        autoApr: true,
        autoGoal: true,
      }),
    );
    mockAutoMetrics({ totalUsd: 400, weightedApr: 35 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);

    expect((container.querySelector('#sim-capital') as HTMLInputElement).value).toBe('');
    expect((container.querySelector('#sim-apr') as HTMLInputElement).value).toBe('');
    expect((container.querySelector('#sim-apr-hint') as HTMLElement).textContent?.trim()).toBe(
      'Promedio ponderado (USD): N/D',
    );

    await flushMicrotasks();

    expect((container.querySelector('#sim-capital') as HTMLInputElement).value).toBe('400.00');
    expect((container.querySelector('#sim-apr') as HTMLInputElement).value).toBe('35.00');
    expect((container.querySelector('#sim-apr-hint') as HTMLElement).textContent?.trim()).toBe(
      'Promedio ponderado (USD): 35.00%',
    );

    dispose();
    container.remove();
  });

  it('calculates and renders BE and Meta outputs by default', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    const beDate = container.querySelector('#sim-out-be-date') as HTMLElement;
    const beTime = container.querySelector('#sim-out-be-time') as HTMLElement;
    const goalDate = container.querySelector('#sim-out-goal-date') as HTMLElement;
    const goalTime = container.querySelector('#sim-out-goal-time') as HTMLElement;

    expect(beDate.textContent).not.toBe('---');
    expect(beTime.textContent).not.toBe('---');
    expect(goalDate.textContent).not.toBe('---');
    expect(goalTime.textContent).not.toBe('---');

    dispose();
    container.remove();
  });

  it('switches goal to manual and keeps BE based on invested target', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    const goalInput = container.querySelector('#sim-goal') as HTMLInputElement;
    const beDate = container.querySelector('#sim-out-be-date') as HTMLElement;
    const goalDate = container.querySelector('#sim-out-goal-date') as HTMLElement;
    const simulateButton = container.querySelector('#btn-simulate') as HTMLButtonElement;
    const beDateBefore = beDate.textContent;
    const goalDateBefore = goalDate.textContent;

    goalInput.value = '5000';
    goalInput.dispatchEvent(new Event('input', { bubbles: true }));
    simulateButton.click();
    await flushMicrotasks();

    const stored = JSON.parse(localStorage.getItem(SIMULATOR_VIEW_KEY) ?? '{}') as {
      autoGoal?: boolean;
    };

    expect(stored.autoGoal).toBe(false);
    expect(beDate.textContent).toBe(beDateBefore);
    expect(goalDate.textContent).not.toBe(goalDateBefore);

    dispose();
    container.remove();
  });

  it('keeps BE visible when manual Meta is invalid', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    const goalInput = container.querySelector('#sim-goal') as HTMLInputElement;
    const beDate = container.querySelector('#sim-out-be-date') as HTMLElement;
    const goalDate = container.querySelector('#sim-out-goal-date') as HTMLElement;
    const goalTime = container.querySelector('#sim-out-goal-time') as HTMLElement;
    const simulateButton = container.querySelector('#btn-simulate') as HTMLButtonElement;

    goalInput.value = '';
    goalInput.dispatchEvent(new Event('input', { bubbles: true }));
    simulateButton.click();
    await flushMicrotasks();

    expect(beDate.textContent).not.toBe('---');
    expect(goalDate.textContent).toBe('---');
    expect(goalTime.textContent).toBe('---');

    dispose();
    container.remove();
  });

  it('no longer depends on hidden mode input', async () => {
    const first = document.createElement('div');
    document.body.appendChild(first);
    const disposeFirst = renderSimulator(first);
    await flushMicrotasks();

    disposeFirst();
    first.remove();

    const second = document.createElement('div');
    document.body.appendChild(second);
    const disposeSecond = renderSimulator(second);
    await flushMicrotasks();

    expect(second.querySelector('#sim-target-mode')).toBeNull();
    expect(second.querySelectorAll('.sim-target-btn').length).toBe(0);

    disposeSecond();
    second.remove();
  });

  it('runs a single projection call per simulation', async () => {
    const projectionSpy = vi.spyOn(calculator, 'generateProjection');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();
    projectionSpy.mockClear();

    const simulateButton = container.querySelector('#btn-simulate') as HTMLButtonElement;
    simulateButton.click();

    expect(projectionSpy).toHaveBeenCalledTimes(1);

    dispose();
    container.remove();
  });

  it('shows invalid outputs when core simulation inputs are invalid', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    (container.querySelector('#sim-capital') as HTMLInputElement).value = '0';
    (container.querySelector('#sim-apr') as HTMLInputElement).value = '';
    (container.querySelector('#btn-simulate') as HTMLButtonElement).click();

    expect((container.querySelector('#sim-out-be-date') as HTMLElement).textContent).toBe('---');
    expect((container.querySelector('#sim-out-goal-date') as HTMLElement).textContent).toBe('---');
    expect((container.querySelector('#sim-table-container') as HTMLElement).style.display).toBe(
      'none',
    );

    dispose();
    container.remove();
  });

  it('restores AUTO tags and hints when reset button is clicked', async () => {
    seedState({ goalAmount: 2500 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    const goalInput = container.querySelector('#sim-goal') as HTMLInputElement;
    goalInput.value = '5000';
    goalInput.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('#btn-sim-reset') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect((container.querySelector('#sim-capital-tag') as HTMLElement).textContent).toBe('AUTO');
    expect((container.querySelector('#sim-apr-tag') as HTMLElement).textContent).toBe('AUTO');
    expect((container.querySelector('#sim-goal-tag') as HTMLElement).textContent).toBe('AUTO');
    expect((container.querySelector('#sim-goal') as HTMLInputElement).value).toBe('2500.00');
    expect((container.querySelector('#sim-capital-hint') as HTMLElement).textContent).toContain(
      'Capital en posiciones',
    );
    expect((container.querySelector('#sim-apr-hint') as HTMLElement).textContent).toContain(
      'Promedio ponderado (USD):',
    );
    expect((container.querySelector('#sim-goal-hint') as HTMLElement).textContent).toContain(
      'Meta del dashboard',
    );

    dispose();
    container.remove();
  });

  it('handles auto-value hydration failures by reporting API error', async () => {
    seedState({ positions: [DEFAULT_POSITION] });
    vi.mocked(getSharedMarketData).mockRejectedValue(new Error('api down'));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    expect(registerApiFailure).toHaveBeenCalled();
    expect(showApiErrorBanner).toHaveBeenCalled();

    dispose();
    container.remove();
  });
});
