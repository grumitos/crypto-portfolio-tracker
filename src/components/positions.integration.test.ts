import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPositions } from './positions';
import { loadState, saveState } from '../utils/storage';
import type { AppState } from '../types';
import { createMemoryStorage, flushMicrotasks, mockMatchMedia, resetDom } from '../test/test-utils';

vi.mock('../utils/market', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/market')>();
  return {
    ...actual,
    getAssetPriceSnapshot: vi.fn(),
    calculatePositionMetricsFromSnapshot: vi.fn(),
  };
});

vi.mock('../utils/api-status', () => ({
  registerApiFailure: vi.fn(),
  registerApiLastUpdatedAt: vi.fn(),
}));

vi.mock('../utils/notifications', () => ({
  showApiErrorBanner: vi.fn(),
}));

vi.mock('../utils/dialogs', () => ({
  showConfirmDialog: vi.fn(async () => true),
  showAlertDialog: vi.fn(async () => undefined),
}));

import { calculatePositionMetricsFromSnapshot, getAssetPriceSnapshot } from '../utils/market';
import { registerApiFailure, registerApiLastUpdatedAt } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { showAlertDialog, showConfirmDialog } from '../utils/dialogs';
import { DEFAULT_ASSET_POOL } from './positions.parser';

const NON_STABLE_SPOT_ASSETS = DEFAULT_ASSET_POOL.filter((asset) => asset !== 'USDT' && asset !== 'USDC');

function seedState(positions: AppState['positions']): void {
  saveState({
    portfolio: {
      totalInvested: 1000,
      currentBalance: 900,
      savings: 900,
      goalAmount: 1500,
      lastUpdated: '2026-02-21',
      balanceHistory: [{ date: '2026-02-21', balance: 900 }],
    },
    positions,
  });
}

function validImportBlock(): string {
  return `USDT-ETH
Buy-low
2026-02-20 08:45
100 USDT
1,925 2026-02-23 03:00
191.04%
Holding`;
}

describe('positions integration', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    resetDom();
    mockMatchMedia(true);
    vi.clearAllMocks();
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    vi.mocked(showAlertDialog).mockResolvedValue();

    vi.mocked(getAssetPriceSnapshot).mockResolvedValue({
      priceByAsset: { BTC: 50000, ETH: 2000, BNB: 500, SOL: 150, USDT: 1, USDC: 1 },
      sourceByAsset: { BTC: 'live', ETH: 'live', BNB: 'live', SOL: 'live', USDT: 'stable', USDC: 'stable' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
    });
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 400,
      weightedApr: 35,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { p1: 400 },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'stable' },
    });
  });

  it('renders empty state and skips market metrics when there are no positions', async () => {
    seedState([]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(container.textContent).toContain('No tienes posiciones registradas');
    expect((container.querySelector('#positions-apr') as HTMLElement).textContent).toContain('---');
    expect(getAssetPriceSnapshot).not.toHaveBeenCalled();
    expect(calculatePositionMetricsFromSnapshot).not.toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('hydrates market metrics and position USD values for existing rows', async () => {
    seedState([{
      id: 'p1',
      asset: 'ETH',
      direction: 'buy-low',
      subscriptionAsset: 'USDT',
      amount: 1,
      targetPrice: 2100,
      entryDate: '2026-02-20',
      entryTime: '08:45',
      settlementDate: '2026-02-23',
      settlementTime: '03:00',
      apr: 40,
    }]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(container.querySelector('#positions-apr')?.textContent).toContain('35.00%');
    expect(container.querySelector('#positions-capital')?.textContent).toContain('$400.00');
    expect(container.querySelector('#positions-daily')?.textContent).toContain('$0.40');
    expect(container.querySelector('#position-usd-p1')?.textContent).toContain('$400.00');
    expect(container.querySelector('#positions-spot-ETH')?.textContent).toContain('ETH');
    expect(container.querySelector('#positions-spot-value-ETH')?.textContent).toContain('$2,000.00');
    expect(container.querySelector('#positions-spot-BTC')?.textContent).toContain('BTC');
    expect(container.querySelector('#positions-spot-value-BTC')?.textContent).toContain('$50,000.00');
    expect(container.querySelector('#positions-spot-USDT')).toBeNull();
    expect(container.querySelector('#positions-spot-USDC')).toBeNull();
    expect(container.querySelector('#position-spot-p1')).toBeNull();
    expect(registerApiLastUpdatedAt).toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('renders spot strip skeleton cards before market hydration', () => {
    seedState([{
      id: 'p1',
      asset: 'ETH',
      direction: 'buy-low',
      subscriptionAsset: 'USDT',
      amount: 1,
      targetPrice: 2100,
      entryDate: '2026-02-20',
      entryTime: '08:45',
      settlementDate: '2026-02-23',
      settlementTime: '03:00',
      apr: 40,
    }]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());

    const strip = container.querySelector('#positions-spot-strip') as HTMLElement;
    const value = container.querySelector('#positions-spot-value-ETH') as HTMLElement;
    const missingPositionAsset = container.querySelector('#positions-spot-value-BTC') as HTMLElement;

    expect(strip.style.display).toBe('flex');
    expect(value.querySelector('.skeleton')).not.toBeNull();
    expect(missingPositionAsset.querySelector('.skeleton')).not.toBeNull();

    dispose();
    container.remove();
  });

  it('does not animate stats from remembered values on remount hydration', async () => {
    mockMatchMedia(false);
    seedState([{
      id: 'p1',
      asset: 'ETH',
      direction: 'buy-low',
      subscriptionAsset: 'USDT',
      amount: 1,
      targetPrice: 2100,
      entryDate: '2026-02-20',
      entryTime: '08:45',
      settlementDate: '2026-02-23',
      settlementTime: '03:00',
      apr: 40,
    }]);

    let now = 0;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      now += 16;
      cb(now);
      return now;
    });

    const firstContainer = document.createElement('div');
    document.body.appendChild(firstContainer);
    const disposeFirst = renderPositions(firstContainer, vi.fn());
    await flushMicrotasks();
    expect(firstContainer.querySelector('#positions-apr')?.textContent).toContain('35.00%');

    disposeFirst();
    firstContainer.remove();

    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 500,
      weightedApr: 55,
      dailyEarningsUsd: 0.6,
      usdByPositionId: { p1: 500 },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'stable' },
    });
    rafSpy.mockClear();

    const secondContainer = document.createElement('div');
    document.body.appendChild(secondContainer);
    const disposeSecond = renderPositions(secondContainer, vi.fn());

    expect((secondContainer.querySelector('#positions-apr') as HTMLElement).querySelector('.skeleton')).not.toBeNull();

    await flushMicrotasks();
    expect(secondContainer.querySelector('#positions-apr')?.textContent).toContain('55.00%');
    expect(rafSpy).not.toHaveBeenCalled();

    disposeSecond();
    secondContainer.remove();
    rafSpy.mockRestore();
  });

  it('opens add modal and persists a new position', async () => {
    seedState([]);
    const onStateChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, onStateChange);
    await flushMicrotasks();

    (container.querySelector('#btn-add-position') as HTMLButtonElement).click();
    (container.querySelector('#input-amount') as HTMLInputElement).value = '150';
    (container.querySelector('#input-apr') as HTMLInputElement).value = '80';
    (container.querySelector('#input-target') as HTMLInputElement).value = '2000';
    (container.querySelector('#input-entry-date') as HTMLInputElement).value = '2026-02-21';
    (container.querySelector('#input-entry-time') as HTMLInputElement).value = '09:00';
    (container.querySelector('#input-settlement-date') as HTMLInputElement).value = '2026-02-22';
    (container.querySelector('#input-settlement-time') as HTMLInputElement).value = '03:00';
    (container.querySelector('#btn-save-position') as HTMLButtonElement).click();

    const next = loadState();
    expect(next.positions).toHaveLength(1);
    expect(next.positions[0].amount).toBe(150);
    expect(next.positions[0].apr).toBe(80);
    expect(onStateChange).toHaveBeenCalledTimes(1);

    dispose();
    container.remove();
  });

  it('supports edit mode click, delete and bulk replace import flow', async () => {
    seedState([{
      id: 'p1',
      asset: 'ETH',
      direction: 'buy-low',
      subscriptionAsset: 'USDT',
      amount: 1,
      targetPrice: 2100,
      entryDate: '2026-02-20',
      entryTime: '08:45',
      settlementDate: '2026-02-23',
      settlementTime: '03:00',
      apr: 40,
    }]);

    const onStateChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, onStateChange);
    await flushMicrotasks();

    (container.querySelector('#btn-toggle-edit') as HTMLButtonElement).click();
    (container.querySelector('tr[data-id="p1"]') as HTMLTableRowElement).click();
    expect((container.querySelector('#modal-position') as HTMLElement).style.display).toBe('flex');
    expect((container.querySelector('#input-position-id') as HTMLInputElement).value).toBe('p1');

    (container.querySelector('.btn-del-pos') as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(loadState().positions).toHaveLength(0);
    expect(onStateChange).toHaveBeenCalledTimes(1);

    (container.querySelector('#btn-bulk-import') as HTMLButtonElement).click();
    const text = container.querySelector('#input-bulk-import') as HTMLTextAreaElement;
    text.value = validImportBlock();
    (container.querySelector('#btn-apply-bulk-import') as HTMLButtonElement).click();
    await flushMicrotasks();

    expect(loadState().positions).toHaveLength(1);
    expect(loadState().positions[0].asset).toBe('ETH');
    expect(onStateChange).toHaveBeenCalledTimes(2);
    expect(showConfirmDialog).toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('registers API failures and shows banner when prices are stale/unavailable', async () => {
    seedState([{
      id: 'p1',
      asset: 'ETH',
      direction: 'buy-low',
      subscriptionAsset: 'USDT',
      amount: 1,
      targetPrice: 2100,
      entryDate: '2026-02-20',
      settlementDate: '2026-02-23',
      apr: 40,
    }]);

    vi.mocked(getAssetPriceSnapshot).mockResolvedValue({
      priceByAsset: { USDT: 1, ETH: 2000 },
      sourceByAsset: { USDT: 'cache-stale', ETH: 'cache-stale' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: true,
      hasUnavailablePrices: false,
    });
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 400,
      weightedApr: 35,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { p1: 400 },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: true,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'cache-stale' },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(registerApiFailure).toHaveBeenCalled();
    expect(showApiErrorBanner).toHaveBeenCalled();
    dispose();
    container.remove();
  });

  it('renders N/D in header spot card when spot price is unavailable', async () => {
    seedState([{
      id: 'p1',
      asset: 'ETH',
      direction: 'buy-low',
      subscriptionAsset: 'USDT',
      amount: 1,
      targetPrice: 2100,
      entryDate: '2026-02-20',
      settlementDate: '2026-02-23',
      apr: 40,
    }]);

    vi.mocked(getAssetPriceSnapshot).mockResolvedValue({
      priceByAsset: { USDT: 1, ETH: 0 },
      sourceByAsset: { USDT: 'stable', ETH: 'unavailable' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: true,
    });
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 400,
      weightedApr: 35,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { p1: 400 },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'stable' },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(container.querySelector('#positions-spot-value-ETH')?.textContent).toContain('N/D');
    expect(container.querySelector('#position-spot-p1')).toBeNull();
    expect(registerApiFailure).toHaveBeenCalled();
    expect(showApiErrorBanner).toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('orders header spot cards by exposure USD desc and then symbol', async () => {
    seedState([
      {
        id: 'p1',
        asset: 'ETH',
        direction: 'buy-low',
        subscriptionAsset: 'USDT',
        amount: 1,
        targetPrice: 2100,
        entryDate: '2026-02-20',
        settlementDate: '2026-02-23',
        apr: 40,
      },
      {
        id: 'p2',
        asset: 'SOL',
        direction: 'buy-low',
        subscriptionAsset: 'USDT',
        amount: 1,
        targetPrice: 120,
        entryDate: '2026-02-20',
        settlementDate: '2026-02-23',
        apr: 40,
      },
    ]);

    vi.mocked(getAssetPriceSnapshot).mockResolvedValue({
      priceByAsset: { USDT: 1, ETH: 2000, SOL: 150 },
      sourceByAsset: { USDT: 'stable', ETH: 'live', SOL: 'live' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
    });
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 600,
      weightedApr: 35,
      dailyEarningsUsd: 0.6,
      usdByPositionId: { p1: 450, p2: 150 },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'stable' },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(getAssetPriceSnapshot).toHaveBeenCalledWith(
      expect.arrayContaining([...NON_STABLE_SPOT_ASSETS]),
      expect.objectContaining({ forceRefresh: false }),
    );
    const cards = [...container.querySelectorAll('#positions-spot-strip .positions-spot-card')];
    expect(cards).toHaveLength(NON_STABLE_SPOT_ASSETS.length);
    expect(cards[0]?.id).toBe('positions-spot-ETH');
    expect(cards[1]?.id).toBe('positions-spot-SOL');
    expect(cards[2]?.id).toBe('positions-spot-BNB');
    expect(cards[3]?.id).toBe('positions-spot-BTC');
    expect(container.querySelector('#positions-spot-USDC')).toBeNull();
    expect(container.querySelector('#positions-spot-USDT')).toBeNull();

    dispose();
    container.remove();
  });

  it('falls back to monogram when local and remote logos fail', async () => {
    seedState([{
      id: 'p1',
      asset: 'ETH',
      direction: 'buy-low',
      subscriptionAsset: 'USDT',
      amount: 1,
      targetPrice: 2100,
      entryDate: '2026-02-20',
      settlementDate: '2026-02-23',
      apr: 40,
    }]);

    vi.mocked(getAssetPriceSnapshot).mockResolvedValue({
      priceByAsset: { USDT: 1, ETH: 2000 },
      sourceByAsset: { USDT: 'stable', ETH: 'live' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
    });
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 400,
      weightedApr: 35,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { p1: 400 },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'stable' },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    const card = container.querySelector('#positions-spot-ETH') as HTMLElement;
    const img = card.querySelector('.positions-spot-logo') as HTMLImageElement;
    const fallback = card.querySelector('.positions-spot-fallback') as HTMLElement;

    expect(img.src.startsWith('data:image/svg+xml') || img.src.includes('/src/assets/crypto/eth.svg')).toBe(true);

    img.dispatchEvent(new Event('error'));
    expect(img.src).toContain('https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/eth.svg');
    expect(fallback.style.display).toBe('none');

    img.dispatchEvent(new Event('error'));
    expect(img.style.display).toBe('none');
    expect(fallback.style.display).toBe('inline-flex');
    expect(fallback.textContent).toBe('ETH');

    dispose();
    container.remove();
  });
});
