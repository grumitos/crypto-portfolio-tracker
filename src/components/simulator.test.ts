import { beforeEach, describe, expect, it, vi } from '#test';
import { renderSimulator } from './simulator';
import { renderProjectionChart } from './simulator.template';
import { SIMULATOR_VIEW_KEY, getDefaultCapitalLedgerState, saveState } from '../utils/storage';
import type { AppState, ProjectionRow } from '../types';
import * as calculator from '../utils/calculator';
import * as animation from '../utils/animation';
import { createMemoryStorage, flushMicrotasks, mockMatchMedia, resetDom } from '../test/test-utils';
import { getSharedMarketData } from '../utils/api-runtime-cache';
import { registerApiFailure } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { resetMarketPollerForTests } from '../utils/market-poller';
import { MARKET_POLL_INTERVAL_MS } from '../utils/constants';

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
  currentBalance?: number;
  positions?: AppState['positions'];
  capitalLedger?: AppState['capitalLedger'];
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
      aprByPositionId: { p1: weightedApr },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'stable' },
    },
  });
}

function chartRows(balances: number[]): ProjectionRow[] {
  return balances.map((balance, month) => ({
    month,
    date: `2026-${String(month + 1).padStart(2, '0')}-15`,
    balance,
    earned: balance - balances[0],
  }));
}

function renderChartHost(
  input: Omit<Parameters<typeof renderProjectionChart>[0], 'formatDate'>,
): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderProjectionChart({ ...input, formatDate: (value) => value });
  return host;
}

function seedState(options: SeedSimulatorOptions = {}): void {
  const state: AppState = {
    portfolio: {
      totalInvested: options.totalInvested ?? 1200,
      currentBalance: options.currentBalance ?? 1000,
      goalAmount: options.goalAmount ?? 1500,
      lastUpdated: '2026-02-21',
      balanceHistory: [{ date: '2026-02-21', balance: options.currentBalance ?? 1000 }],
    },
    positions: options.positions ?? [DEFAULT_POSITION],
    capitalLedger: options.capitalLedger ?? getDefaultCapitalLedgerState(),
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

  it('shows the projection chart and table skeletons on initial load', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);

    expect((container.querySelector('#sim-table-container') as HTMLElement).hidden).toBe(false);
    expect(container.querySelector('#projection-chart')).not.toBeNull();
    expect(container.querySelector('#sim-projection-chart-skeleton')).not.toBeNull();
    expect(container.querySelector('#sim-table .sim-projection-skeleton')).not.toBeNull();

    dispose();
    container.remove();
  });

  it('marks milestone rows in the projection table', async () => {
    seedState({ currentBalance: 400, totalInvested: 410, goalAmount: 430 });
    mockAutoMetrics({ totalUsd: 400, weightedApr: 35 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    const headers = Array.from(container.querySelectorAll('#sim-table th')).map((th) =>
      th.textContent?.trim(),
    );

    expect(headers).toContain('Hito');
    expect(container.querySelector('[data-projection-cell="milestone"] .chip-warn')).not.toBeNull();
    expect(container.querySelector('[data-projection-cell="milestone"] .chip-gain')).not.toBeNull();

    dispose();
    container.remove();
  });

  it('draws the projection curve from the generated rows', async () => {
    seedState({ currentBalance: 400, totalInvested: 410, goalAmount: 430 });
    mockAutoMetrics({ totalUsd: 400, weightedApr: 35 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    const chart = container.querySelector('#projection-chart') as HTMLElement;
    expect(chart.querySelector('#sim-projection-chart-skeleton')).toBeNull();

    const line = chart.querySelector('.ch-line') as SVGPathElement | null;
    expect(line).not.toBeNull();
    // Mes 0 (hoy) + 12 meses proyectados = 13 vertices.
    expect((line?.getAttribute('d') ?? '').split('L')).toHaveLength(13);
    expect(chart.querySelector('.ch-dot-be')).not.toBeNull();
    expect(chart.querySelector('.ch-dot-goal')).not.toBeNull();

    dispose();
    container.remove();
  });

  it('updates projection table values in-place with animation after market ticks', async () => {
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
      let marketCall = 0;
      vi.mocked(getSharedMarketData).mockImplementation(async () => {
        marketCall += 1;
        const totalUsd = marketCall === 1 ? 400 : 650;
        const weightedApr = marketCall === 1 ? 35 : 45;
        return {
          positionsKey: 'p1',
          snapshot: {
            priceByAsset: { ETH: marketCall === 1 ? 2000 : 2500, USDT: 1 },
            sourceByAsset: { ETH: 'live', USDT: 'stable' },
            marketLastUpdatedAt: Date.now(),
            hasStalePrices: false,
            hasUnavailablePrices: false,
            changePercent24hByAsset: { ETH: 0, USDT: 0 },
          },
          metrics: {
            totalUsd,
            weightedApr,
            dailyEarningsUsd: 0.4,
            usdByPositionId: { p1: totalUsd },
            aprByPositionId: { p1: weightedApr },
            priceByAsset: { USDT: 1 },
            marketLastUpdatedAt: Date.now(),
            hasStalePrices: false,
            hasUnavailablePrices: false,
            priceSourceByAsset: { USDT: 'stable' },
          },
        };
      });

      document.body.appendChild(container);
      dispose = renderSimulator(container);

      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      await Promise.resolve();

      const table = container.querySelector('.sim-projection-table');
      const firstBalanceCell = container.querySelector(
        '[data-projection-row="1"] [data-projection-cell="balance"]',
      );
      expect(table).not.toBeNull();
      expect(firstBalanceCell).not.toBeNull();

      const callsAfterInitialHydration = numberSpy.mock.calls.length;

      await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      await Promise.resolve();

      expect(container.querySelector('.sim-projection-table')).toBe(table);
      expect(
        container.querySelector('[data-projection-row="1"] [data-projection-cell="balance"]'),
      ).toBe(firstBalanceCell);

      const postHydrationCalls = numberSpy.mock.calls.slice(callsAfterInitialHydration);
      const animatedProjectionCells = postHydrationCalls
        .filter((call) => {
          const options = call[4] as { enabled?: boolean } | undefined;
          return options?.enabled === true;
        })
        .map((call) => (call[1] as HTMLElement | null)?.dataset.projectionCell);

      expect(animatedProjectionCells).toContain('balance');
      expect(animatedProjectionCells).toContain('earned');
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

    expect(initialCapitalHint).toBe('Balance combinado; APR sobre capital activo');
    expect(initialAprHint).toBe('Promedio ponderado (USD): N/D');
    expect(capitalInput.value).toBe('');
    expect(aprInput.value).toBe('');

    await flushMicrotasks();

    expect(capitalHint.textContent?.trim()).toBe('Balance combinado; APR sobre capital activo');
    expect(aprHint.textContent?.trim()).toBe('Promedio ponderado (USD): 35.00%');
    expect(capitalInput.value).toBe('1000.00');
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

    expect((container.querySelector('#sim-capital') as HTMLInputElement).value).toBe('1000.00');
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

  it('uses combined balance with active earning capital for AUTO values', async () => {
    seedState({
      currentBalance: 41055,
      totalInvested: 40000,
      goalAmount: 45000,
    });
    mockAutoMetrics({ totalUsd: 1055, weightedApr: 123.61 });
    const projectionSpy = vi.spyOn(calculator, 'generateProjection');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    expect((container.querySelector('#sim-capital') as HTMLInputElement).value).toBe('41055.00');
    expect((container.querySelector('#sim-apr') as HTMLInputElement).value).toBe('123.61');
    expect((container.querySelector('#sim-out-daily') as HTMLElement).textContent).toContain(
      '$3.57',
    );
    expect(projectionSpy).toHaveBeenCalledWith(
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

  it('includes capital ledger AUTO capital and APR while keeping BE target user-defined', async () => {
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
    mockAutoMetrics({ totalUsd: 1055, weightedApr: 123.61 });
    const projectionSpy = vi.spyOn(calculator, 'generateProjection');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    expect((container.querySelector('#sim-capital') as HTMLInputElement).value).toBe('41165.00');

    expect(projectionSpy).toHaveBeenCalledWith(
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

  it('uses edited capital and APR as a manual calculator after AUTO values hydrate', async () => {
    seedState({
      currentBalance: 41055,
      totalInvested: 40000,
      goalAmount: 45000,
    });
    mockAutoMetrics({ totalUsd: 1055, weightedApr: 123.61 });
    const projectionSpy = vi.spyOn(calculator, 'generateProjection');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderSimulator(container);
    await flushMicrotasks();
    projectionSpy.mockClear();

    const capitalInput = container.querySelector('#sim-capital') as HTMLInputElement;
    const aprInput = container.querySelector('#sim-apr') as HTMLInputElement;
    capitalInput.value = '2000';
    capitalInput.dispatchEvent(new Event('input', { bubbles: true }));
    aprInput.value = '50';
    aprInput.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('#btn-simulate') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect((container.querySelector('#sim-capital-tag') as HTMLElement).textContent).toBe('MANUAL');
    expect((container.querySelector('#sim-apr-tag') as HTMLElement).textContent).toBe('MANUAL');
    expect((container.querySelector('#sim-out-daily') as HTMLElement).textContent).toContain(
      '$2.74',
    );

    const lastCall = projectionSpy.mock.calls[projectionSpy.mock.calls.length - 1]?.[0];
    expect(lastCall).toEqual(
      expect.objectContaining({
        capital: 2000,
        apr: 50,
        goal: 45000,
        invested: 40000,
      }),
    );
    expect(lastCall).not.toHaveProperty('earningCapital');

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
    expect((container.querySelector('#sim-table-container') as HTMLElement).hidden).toBe(true);
    expect((container.querySelector('#sim-chart-block') as HTMLElement).hidden).toBe(true);

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
      'Balance combinado; APR sobre capital activo',
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

  it('keeps milestone labels out of the SVG for every data set', () => {
    // Hitos muy separados y hitos casi pegados: dentro del SVG ambos rotulos
    // acababan en la misma `y` y se superponian sobre la curva.
    const dataSets = [
      { invested: 1000, goal: 12000 },
      { invested: 9000, goal: 9050 },
    ];

    dataSets.forEach(({ invested, goal }) => {
      const host = renderChartHost({
        rows: chartRows([900, 3000, 6000, 9200, 12500]),
        invested,
        goal,
        breakEvenMilestone: { label: 'Breakeven', amount: '$9,000.00', date: '24/11/2026' },
        goalMilestone: { label: 'Meta', amount: '$100,000.00', date: '24/12/2028' },
      });

      expect(host.querySelector('svg text')).toBeNull();
      expect(host.querySelectorAll('.chart-legend-item').length).toBe(2);
      expect(host.querySelector('.chart-legend .chip-warn')).not.toBeNull();
      expect(host.querySelector('.chart-legend .chip-gain')).not.toBeNull();
      expect(host.querySelector('.chart-legend svg')).toBeNull();
      expect(host.querySelectorAll('.ch-guide').length).toBe(2);
    });
  });

  it('drops the milestone that does not apply instead of leaving a stray dot', () => {
    const host = renderChartHost({
      rows: chartRows([900, 1100, 1400, 1800, 2300]),
      invested: 1000,
      goal: 0,
      breakEvenMilestone: { label: 'Breakeven', amount: '$1,000.00', date: '15/03/2026' },
      goalMilestone: null,
    });

    expect(host.querySelectorAll('.chart-legend-item').length).toBe(1);
    expect(host.querySelector('.chart-legend .chip-gain')).toBeNull();
    expect(host.querySelector('.ch-dot-goal')).toBeNull();
    expect(host.querySelectorAll('.ch-guide').length).toBe(1);
  });

  it('omits the separator when a milestone has no projected date', () => {
    const host = renderChartHost({
      rows: chartRows([900, 1100, 1400, 1800, 2300]),
      invested: 1000,
      goal: 50000,
      breakEvenMilestone: { label: 'Breakeven', amount: '$1,000.00', date: '15/03/2026' },
      goalMilestone: { label: 'Meta', amount: '$50,000.00', date: null },
    });

    const items = Array.from(host.querySelectorAll('.chart-legend-item')).map((item) =>
      (item.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );

    expect(items).toEqual(['Breakeven $1,000.00 · 15/03/2026', 'Meta $50,000.00']);
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
