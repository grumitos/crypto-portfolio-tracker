import { beforeEach, describe, expect, it, vi } from '#test';
import { renderPositions } from './positions';
import { saveState } from '../utils/storage';
import type { AppState } from '../types';
import { createMemoryStorage, flushMicrotasks, mockMatchMedia, resetDom } from '../test/test-utils';
import { clearApiRuntimeCache } from '../utils/api-runtime-cache';
import { resetMarketPollerForTests } from '../utils/market-poller';
import { MARKET_POLL_INTERVAL_MS } from '../utils/constants';
import * as animation from '../utils/animation';

vi.mock('../utils/market', () => {
  function normalizeAsset(asset: string): string {
    return asset.toUpperCase().trim();
  }

  function isValidPrice(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  function calculateDiscountBuyNoKnockoutProfit(
    position: { asset: string; amount: number; targetPrice: number },
    snapshot: { priceByAsset: Record<string, number> },
  ): number | null {
    const spotPrice = snapshot.priceByAsset[normalizeAsset(position.asset)] ?? 0;
    if (
      !isValidPrice(spotPrice) ||
      !isValidPrice(position.amount) ||
      !isValidPrice(position.targetPrice)
    ) {
      return null;
    }
    return (spotPrice - position.targetPrice) * (position.amount / position.targetPrice);
  }

  function calculateDiscountBuyEffectiveApr(
    position: {
      asset: string;
      subscriptionAsset: string;
      amount: number;
      targetPrice: number;
    },
    snapshot: { priceByAsset: Record<string, number> },
  ): number | null {
    const profit = calculateDiscountBuyNoKnockoutProfit(position, snapshot);
    const subscriptionPrice =
      snapshot.priceByAsset[normalizeAsset(position.subscriptionAsset)] ?? 0;
    const capitalUsd = position.amount * subscriptionPrice;
    if (profit === null || !isValidPrice(capitalUsd)) return null;
    return (profit / capitalUsd) * 365 * 100;
  }

  return {
    calculateDiscountBuyEffectiveApr,
    calculateDiscountBuyNoKnockoutProfit,
    normalizeAsset,
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

vi.mock('../utils/binance-sync', () => ({
  syncPositionsFromBinance: vi.fn(),
  hasAnyExchangeApiCredentials: () =>
    localStorage.getItem('crypto-binance-api') !== null ||
    localStorage.getItem('crypto-bybit-api') !== null,
  clearBinanceSyncCaches: vi.fn(),
  listConnectedExchanges: () => {
    const connected: string[] = [];
    if (localStorage.getItem('crypto-binance-api') !== null) connected.push('Binance');
    if (localStorage.getItem('crypto-bybit-api') !== null) connected.push('Bybit');
    return connected;
  },
}));

import { calculatePositionMetricsFromSnapshot, getAssetPriceSnapshot } from '../utils/market';
import { registerApiFailure, registerApiLastUpdatedAt } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { syncPositionsFromBinance } from '../utils/binance-sync';
import { saveApiCredentials } from '../utils/binance-auth';
const NON_STABLE_SPOT_ASSETS = ['BTC', 'ETH', 'BNB', 'SOL'];

function seedState(positions: AppState['positions']): void {
  saveState({
    portfolio: {
      totalInvested: 1000,
      currentBalance: 900,
      goalAmount: 1500,
      lastUpdated: '2026-02-21',
      balanceHistory: [{ date: '2026-02-21', balance: 900 }],
    },
    positions,
  });
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
    clearApiRuntimeCache();
    resetMarketPollerForTests();

    vi.mocked(getAssetPriceSnapshot).mockResolvedValue({
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
      changePercent24hByAsset: { BTC: -1.75, ETH: 2.5, BNB: 0.15, SOL: -0.8, USDT: 0, USDC: 0 },
    });
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 400,
      weightedApr: 35,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { p1: 400 },
      aprByPositionId: { p1: 35 },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'stable' },
    });
  });

  it('asks for an exchange in the empty state when no credentials are configured', async () => {
    seedState([]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(container.textContent).toContain('Conecta un exchange para ver tus posiciones');
    // La linea de contexto nombra la fuente de los datos: sin exchanges no hay
    // fuente y el segmento no se pinta, en vez de anunciar la ausencia.
    expect(container.querySelector('.context-meta')?.textContent?.trim()).toBe(
      'Dual Investment · 0 activas',
    );
    expect((container.querySelector('#positions-apr') as HTMLElement).textContent).toContain('---');
    expect(getAssetPriceSnapshot).not.toHaveBeenCalled();
    expect(calculatePositionMetricsFromSnapshot).not.toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('names the connected exchange in the context line', async () => {
    seedState([]);
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: [],
      count: 0,
      balances: [],
      totalUsdEstimate: 0,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(container.querySelector('.context-meta')?.textContent?.trim()).toBe(
      'Dual Investment · 0 activas · Binance',
    );

    dispose();
    container.remove();
  });

  it('renders empty state and skips market metrics when a connected exchange returns nothing', async () => {
    seedState([]);
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions: [],
      count: 0,
      balances: [],
      totalUsdEstimate: 0,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(container.textContent).toContain('Sin posiciones activas');
    expect(container.textContent).toContain('Sincroniza para consultar posiciones activas.');
    expect((container.querySelector('#positions-apr') as HTMLElement).textContent).toContain('---');
    expect(getAssetPriceSnapshot).not.toHaveBeenCalled();
    expect(calculatePositionMetricsFromSnapshot).not.toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('does not render account balance detail in the positions view', async () => {
    const positions = [
      {
        id: 'p1',
        asset: 'ETH',
        direction: 'buy-low' as const,
        subscriptionAsset: 'USDT',
        amount: 1,
        targetPrice: 2100,
        entryDate: '2026-02-20',
        settlementDate: '2026-02-23',
        apr: 40,
      },
    ];

    seedState(positions);
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockResolvedValue({
      positions,
      count: positions.length,
      balances: [{ asset: 'USDT', free: 300, locked: 0 }],
      totalUsdEstimate: 300,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(syncPositionsFromBinance).toHaveBeenCalled();
    expect(container.querySelector('.balance-strip')).toBeNull();
    expect(container.textContent).not.toContain('Saldo en cuenta');

    dispose();
    container.remove();
  });

  it('hydrates market metrics and keeps buy-low USD equivalent hidden', async () => {
    seedState([
      {
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
      },
    ]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(container.querySelector('#positions-apr')?.textContent).toContain('35.00%');
    expect(container.querySelector('#positions-capital')?.textContent).toContain('$400.00');
    expect(container.querySelector('#positions-daily')?.textContent).toContain('$0.40');
    expect(container.querySelector('#position-usd-p1')).toBeNull();
    expect(container.querySelector('[data-label="Resultado"]')?.textContent).toContain('Ejec.');
    expect(container.querySelector('[data-label="Resultado"]')?.textContent).toContain('No ej.');
    expect(container.querySelector('[data-label="Resultado"]')?.textContent).toContain('ETH');
    expect(container.querySelector('#positions-spot-ETH')?.textContent).toContain('ETH');
    expect(container.querySelector('#positions-spot-value-ETH')?.textContent).toContain(
      '$2,000.00',
    );
    expect(container.querySelector('#positions-spot-change-ETH')?.textContent).toContain('+2.50%');
    expect(container.querySelector('#positions-spot-BTC')?.textContent).toContain('BTC');
    expect(container.querySelector('#positions-spot-value-BTC')?.textContent).toContain(
      '$50,000.00',
    );
    expect(container.querySelector('#positions-spot-change-BTC')?.textContent).toContain('-1.75%');
    expect(container.querySelector('#positions-spot-USDT')).toBeNull();
    expect(container.querySelector('#positions-spot-USDC')).toBeNull();
    expect(container.querySelector('#position-spot-p1')).toBeNull();
    expect(registerApiLastUpdatedAt).toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('hydrates Discount Buy earnings from the no-knockout spot spread', async () => {
    seedState([
      {
        id: 'bybit_discount_buy_1',
        asset: 'ETH',
        direction: 'buy-low',
        subscriptionAsset: 'USDT',
        amount: 1000,
        targetPrice: 1900,
        entryDate: '2026-02-20',
        entryTime: '08:45',
        settlementDate: '2026-02-21',
        settlementTime: '08:45',
        apr: 10,
        positionKind: 'discount-buy',
        projectedProfit: 0.27,
      },
    ]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());

    expect(
      container.querySelector('#position-earn-bybit_discount_buy_1')?.textContent,
    ).not.toContain('+0.27 USDT');

    await flushMicrotasks();

    const earnCell = container.querySelector('#position-earn-bybit_discount_buy_1') as HTMLElement;
    expect(earnCell.textContent).toContain('+52.63 USDT');
    expect(earnCell.textContent).not.toContain('+0.27 USDT');
    expect(container.querySelector('#position-apr-bybit_discount_buy_1')?.textContent).toContain(
      '1921.05%',
    );

    dispose();
    container.remove();
  });

  it('shows USD equivalent for sell-high crypto positions', async () => {
    seedState([
      {
        id: 'p1',
        asset: 'ETH',
        direction: 'sell-high',
        subscriptionAsset: 'ETH',
        amount: 0.2,
        targetPrice: 2400,
        entryDate: '2026-02-20',
        entryTime: '08:45',
        settlementDate: '2026-02-23',
        settlementTime: '03:00',
        apr: 40,
      },
    ]);
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 400,
      weightedApr: 35,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { p1: 400 },
      aprByPositionId: { p1: 35 },
      priceByAsset: { ETH: 2000 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { ETH: 'live' },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());
    await flushMicrotasks();

    expect(container.querySelector('#position-usd-p1')?.textContent).toContain('$400');
    expect(container.querySelector('[data-label="Resultado"]')?.textContent).toContain('Ejec.');
    expect(container.querySelector('[data-label="Resultado"]')?.textContent).toContain('No ej.');
    expect(container.querySelector('[data-label="Resultado"]')?.textContent).toContain('USDT');
    expect(container.querySelector('[data-label="Resultado"]')?.textContent).toContain('ETH');

    dispose();
    container.remove();
  });

  it('renders spot strip skeleton cards before market hydration', () => {
    seedState([
      {
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
      },
    ]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, vi.fn());

    const strip = container.querySelector('#positions-spot-strip') as HTMLElement;
    const value = container.querySelector('#positions-spot-value-ETH') as HTMLElement;
    const change = container.querySelector('#positions-spot-change-ETH') as HTMLElement;
    const missingPositionAsset = container.querySelector(
      '#positions-spot-value-BTC',
    ) as HTMLElement;
    const skeletonCards = [...container.querySelectorAll('#positions-spot-strip .spot-item')];

    expect(strip.hidden).toBe(false);
    // Fixed BTC -> ETH -> BNB -> SOL order, regardless of which assets are held.
    expect(skeletonCards.map((card) => card.id)).toEqual([
      'positions-spot-BTC',
      'positions-spot-ETH',
      'positions-spot-BNB',
      'positions-spot-SOL',
    ]);
    expect(value.querySelector('.skeleton')).not.toBeNull();
    expect(change.querySelector('.skeleton')).not.toBeNull();
    expect(missingPositionAsset.querySelector('.skeleton')).not.toBeNull();

    dispose();
    container.remove();
  });

  it('does not animate stats from remembered values on remount hydration', async () => {
    mockMatchMedia(false);
    seedState([
      {
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
      },
    ]);

    let now = 0;
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
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
      aprByPositionId: { p1: 55 },
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

    expect(
      (secondContainer.querySelector('#positions-apr') as HTMLElement).querySelector('.skeleton'),
    ).not.toBeNull();

    await flushMicrotasks();
    expect(secondContainer.querySelector('#positions-apr')?.textContent).toContain('55.00%');
    expect(rafSpy).not.toHaveBeenCalled();

    disposeSecond();
    secondContainer.remove();
    rafSpy.mockRestore();
  });

  it('keeps rows and the view mounted when only live values change', async () => {
    vi.useFakeTimers();
    mockMatchMedia(false);

    let rafTime = 0;
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        rafTime += 64;
        cb(rafTime);
        return rafTime;
      });
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const numberSpy = vi.spyOn(animation, 'setAnimatedNumber');

    // La cartera no cambia entre sondeos: la misma suscripcion, las mismas
    // condiciones. Lo unico que se mueve es el precio del activo, y con el el
    // valor en USD de la fila.
    const positions: AppState['positions'] = [
      {
        id: 'bybit_dual_eth',
        asset: 'ETH',
        direction: 'sell-high',
        subscriptionAsset: 'ETH',
        quoteAsset: 'USDT',
        amount: 1,
        targetPrice: 2400,
        entryDate: '2026-02-20',
        entryTime: '08:45',
        settlementDate: '2026-02-23',
        settlementTime: '03:00',
        apr: 35,
        positionKind: 'dual',
      },
    ];

    const metricsWithUsd = (usd: number) => ({
      totalUsd: usd,
      weightedApr: 35,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { bybit_dual_eth: usd },
      aprByPositionId: { bybit_dual_eth: 35 },
      priceByAsset: { USDT: 1 },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      priceSourceByAsset: { USDT: 'stable' as const },
    });
    vi.mocked(calculatePositionMetricsFromSnapshot)
      .mockReturnValueOnce(metricsWithUsd(2000))
      .mockReturnValue(metricsWithUsd(2100));

    seedState(positions);
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    vi.mocked(syncPositionsFromBinance).mockImplementation(async () => {
      seedState(positions);
      return {
        positions,
        count: positions.length,
        balances: [],
        totalUsdEstimate: 0,
      };
    });

    const onStateChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, onStateChange);

    try {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();

      const row = container.querySelector('[data-id="bybit_dual_eth"]');
      const usd = container.querySelector('#position-usd-bybit_dual_eth');
      expect(row).not.toBeNull();
      expect(usd?.textContent).toContain('$2,000');
      const callsAfterInitialHydration = numberSpy.mock.calls.length;
      onStateChange.mockClear();

      await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();

      expect(syncPositionsFromBinance).toHaveBeenCalledTimes(2);
      // La misma fila y la misma celda, no unas nuevas con el mismo aspecto, y
      // sin avisar al shell, que redibujaria la vista entera.
      expect(container.querySelector('[data-id="bybit_dual_eth"]')).toBe(row);
      expect(container.querySelector('#position-usd-bybit_dual_eth')).toBe(usd);
      expect(usd?.textContent).toContain('$2,100');
      expect(onStateChange).not.toHaveBeenCalled();

      const postHydrationUsdCalls = numberSpy.mock.calls
        .slice(callsAfterInitialHydration)
        .filter((call) => {
          const el = call[1] as HTMLElement | null;
          return el?.id === 'position-usd-bybit_dual_eth';
        });
      const animatedUsdCall = postHydrationUsdCalls.some((call) => {
        const options = call[4] as { enabled?: boolean } | undefined;
        return options?.enabled === true;
      });
      expect(animatedUsdCall).toBe(true);
      expect(usd?.querySelector('.skeleton')).toBeNull();
    } finally {
      dispose();
      container.remove();
      numberSpy.mockRestore();
      rafSpy.mockRestore();
      cafSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('renders the tracking view in read-only mode', async () => {
    seedState([
      {
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
      },
    ]);

    const onStateChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderPositions(container, onStateChange);
    await flushMicrotasks();

    expect(container.querySelector('#btn-add-position')).toBeNull();
    expect(container.querySelector('#btn-toggle-edit')).toBeNull();
    expect(container.querySelector('#btn-bulk-import')).toBeNull();
    expect(container.querySelector('#btn-open-market')).toBeNull();
    expect(container.querySelector('#modal-position')).toBeNull();
    expect(container.querySelector('#modal-bulk-import')).toBeNull();
    expect(container.querySelector('.btn-del-pos')).toBeNull();
    expect(container.textContent).toContain('Buy Low');
    expect(onStateChange).not.toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('registers API failures and shows banner when prices are stale/unavailable', async () => {
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
    ]);

    vi.mocked(getAssetPriceSnapshot).mockResolvedValue({
      priceByAsset: { USDT: 1, ETH: 2000 },
      sourceByAsset: { USDT: 'cache-stale', ETH: 'cache-stale' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: true,
      hasUnavailablePrices: false,
      changePercent24hByAsset: { USDT: 0, ETH: -0.6 },
    });
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 400,
      weightedApr: 35,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { p1: 400 },
      aprByPositionId: { p1: 35 },
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
    ]);

    vi.mocked(getAssetPriceSnapshot).mockResolvedValue({
      priceByAsset: { USDT: 1, ETH: 0 },
      sourceByAsset: { USDT: 'stable', ETH: 'unavailable' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: true,
      changePercent24hByAsset: { USDT: 0, ETH: null },
    });
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 400,
      weightedApr: 35,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { p1: 400 },
      aprByPositionId: { p1: 35 },
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
    expect(container.querySelector('#positions-spot-change-ETH')?.textContent).toContain('N/D');
    expect(container.querySelector('#position-spot-p1')).toBeNull();
    expect(registerApiFailure).toHaveBeenCalled();
    expect(showApiErrorBanner).toHaveBeenCalled();

    dispose();
    container.remove();
  });

  it('orders header spot cards in fixed BTC→ETH→BNB→SOL order', async () => {
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
      changePercent24hByAsset: { USDT: 0, ETH: 2.1, SOL: -0.5 },
    });
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 600,
      weightedApr: 35,
      dailyEarningsUsd: 0.6,
      usdByPositionId: { p1: 450, p2: 150 },
      aprByPositionId: { p1: 35, p2: 35 },
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
    const cards = [...container.querySelectorAll('#positions-spot-strip .spot-item')];
    expect(cards).toHaveLength(NON_STABLE_SPOT_ASSETS.length);
    expect(cards[0]?.id).toBe('positions-spot-BTC');
    expect(cards[1]?.id).toBe('positions-spot-ETH');
    expect(cards[2]?.id).toBe('positions-spot-BNB');
    expect(cards[3]?.id).toBe('positions-spot-SOL');
    expect(container.querySelector('#positions-spot-USDC')).toBeNull();
    expect(container.querySelector('#positions-spot-USDT')).toBeNull();

    dispose();
    container.remove();
  });

  it('falls back to monogram when local and remote logos fail', async () => {
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
    ]);

    vi.mocked(getAssetPriceSnapshot).mockResolvedValue({
      priceByAsset: { USDT: 1, ETH: 2000 },
      sourceByAsset: { USDT: 'stable', ETH: 'live' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
      changePercent24hByAsset: { USDT: 0, ETH: 1.8 },
    });
    vi.mocked(calculatePositionMetricsFromSnapshot).mockReturnValue({
      totalUsd: 400,
      weightedApr: 35,
      dailyEarningsUsd: 0.4,
      usdByPositionId: { p1: 400 },
      aprByPositionId: { p1: 35 },
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

    expect(img.src).toContain('/assets/crypto/eth.svg');

    img.dispatchEvent(new Event('error'));
    expect(img.src).toContain('/assets/crypto/coinmarketcap/eth.png');
    expect(fallback.style.display).toBe('none');

    img.dispatchEvent(new Event('error'));
    expect(img.src).toBe('https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png');
    expect(fallback.style.display).toBe('none');

    img.dispatchEvent(new Event('error'));
    expect(img.style.display).toBe('none');
    expect(fallback.style.display).toBe('inline-flex');
    expect(fallback.textContent).toBe('ETH');

    dispose();
    container.remove();
  });
});
