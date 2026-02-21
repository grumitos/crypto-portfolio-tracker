import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSimulator } from './simulator';
import { SIMULATOR_VIEW_KEY, saveState } from '../utils/storage';
import type { AppState } from '../types';
import * as calculator from '../utils/calculator';

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

function seedState(goalAmount = 1500): void {
  const state: AppState = {
    portfolio: {
      totalInvested: 1200,
      currentBalance: 1000,
      savings: 1000,
      goalAmount,
      lastUpdated: '2026-02-21',
      balanceHistory: [{ date: '2026-02-21', balance: 1000 }],
    },
    positions: [],
  };

  saveState(state);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('simulator dual milestones', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
      configurable: true,
      writable: true,
    });

    document.body.innerHTML = '';
    seedState();
  });

  it('renders without target mode buttons and shows both BE/Meta columns', async () => {
    const container = document.createElement('div');
    const dispose = renderSimulator(container);
    await flushMicrotasks();

    expect(container.querySelectorAll('.sim-target-btn').length).toBe(0);
    expect(container.querySelector('#sim-out-be-date')).not.toBeNull();
    expect(container.querySelector('#sim-out-be-time')).not.toBeNull();
    expect(container.querySelector('#sim-out-goal-date')).not.toBeNull();
    expect(container.querySelector('#sim-out-goal-time')).not.toBeNull();

    const beCrossing = container.querySelectorAll('tr.sim-row-cross-be');
    expect(beCrossing.length).toBeGreaterThan(0);

    dispose();
  });

  it('calculates and renders BE and Meta outputs by default', async () => {
    const container = document.createElement('div');
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
  });

  it('switches goal to manual and keeps BE based on invested target', async () => {
    const container = document.createElement('div');
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

    const stored = JSON.parse(localStorage.getItem(SIMULATOR_VIEW_KEY) ?? '{}') as { autoGoal?: boolean };

    expect(stored.autoGoal).toBe(false);
    expect(beDate.textContent).toBe(beDateBefore);
    expect(goalDate.textContent).not.toBe(goalDateBefore);

    dispose();
  });

  it('keeps BE visible when manual Meta is invalid', async () => {
    const container = document.createElement('div');
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
  });

  it('persists targetMode as both and no longer depends on hidden mode input', async () => {
    const first = document.createElement('div');
    const disposeFirst = renderSimulator(first);
    await flushMicrotasks();

    const stored = JSON.parse(localStorage.getItem(SIMULATOR_VIEW_KEY) ?? '{}') as { targetMode?: string };
    expect(stored.targetMode).toBe('both');

    disposeFirst();

    const second = document.createElement('div');
    const disposeSecond = renderSimulator(second);
    await flushMicrotasks();

    expect(second.querySelector('#sim-target-mode')).toBeNull();
    expect(second.querySelectorAll('.sim-target-btn').length).toBe(0);

    disposeSecond();
  });

  it('runs a single projection call per simulation', async () => {
    const projectionSpy = vi.spyOn(calculator, 'generateProjection');
    const container = document.createElement('div');
    const dispose = renderSimulator(container);
    await flushMicrotasks();
    projectionSpy.mockClear();

    const simulateButton = container.querySelector('#btn-simulate') as HTMLButtonElement;
    simulateButton.click();

    expect(projectionSpy).toHaveBeenCalledTimes(1);

    dispose();
  });
});
