import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DualPosition } from '../types';
import type { AssetPriceSnapshot } from './market';

const BINANCE_GLOBAL_URL = 'https://api.binance.com/api/v3/ticker/price';
const BINANCE_US_URL = 'https://api.binance.us/api/v3/ticker/price';

function jsonResponse(
  payload: unknown,
  options: {
    ok?: boolean;
    status?: number;
    headers?: Record<string, string>;
  } = {},
): Response {
  const ok = options.ok ?? true;
  const status = options.status ?? (ok ? 200 : 500);
  const headerMap = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    ok,
    status,
    headers: {
      get: (name: string) => headerMap[name.toLowerCase()] ?? null,
    } as Headers,
    json: async () => payload,
  } as Response;
}

function failResponse(status = 500): Response {
  return jsonResponse({}, { ok: false, status });
}

function makePosition(
  id: string,
  subscriptionAsset: string,
  amount: number,
  apr: number,
): DualPosition {
  return {
    id,
    asset: 'ETH',
    direction: 'buy-low',
    subscriptionAsset,
    amount,
    targetPrice: 2000,
    entryDate: '2026-02-20',
    settlementDate: '2026-02-21',
    apr,
  };
}

async function readAssetPriceUSD(
  market: typeof import('./market'),
  asset: string,
): Promise<number> {
  const normalized = asset.toUpperCase().trim();
  const snapshot = await market.getAssetPriceSnapshot([normalized]);
  return snapshot.priceByAsset[normalized] ?? 0;
}

describe('market utils', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns stable assets as 1 without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');

    expect(await readAssetPriceUSD(market, 'USDT')).toBe(1);
    expect(await readAssetPriceUSD(market, 'usdc')).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves direct USDT pair and supports object ticker payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      symbol: 'ETHUSDT',
      price: '2500.5',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');

    expect(await readAssetPriceUSD(market, 'ETH')).toBe(2500.5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves asset price through BTC fallback when direct pair is unavailable', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('symbol=ETHUSDT')) return jsonResponse({});
      if (url.includes('symbols=')) {
        return jsonResponse([
          { symbol: 'ETHBTC', price: '0.05' },
          { symbol: 'BTCUSDT', price: '60000' },
        ]);
      }
      return failResponse();
    });

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');

    expect(await readAssetPriceUSD(market, 'ETH')).toBe(3000);
  });

  it('parses batched array payloads for multiple assets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { symbol: 'ETHUSDT', price: '2000' },
      { symbol: 'SOLUSDT', price: '150' },
    ]));

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');
    const priceMap = (await market.getAssetPriceSnapshot(['ETH', 'SOL'])).priceByAsset;

    expect(priceMap.ETH).toBe(2000);
    expect(priceMap.SOL).toBe(150);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns price snapshot with sources and market timestamp', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { symbol: 'ETHUSDT', price: '2000' },
      { symbol: 'SOLUSDT', price: '150' },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');

    const snapshot = await market.getAssetPriceSnapshot(['ETH', 'SOL']);
    expect(snapshot.priceByAsset.ETH).toBe(2000);
    expect(snapshot.priceByAsset.SOL).toBe(150);
    expect(snapshot.sourceByAsset.ETH).toBe('live');
    expect(snapshot.marketLastUpdatedAt).not.toBeNull();
    expect(snapshot.hasStalePrices).toBe(false);
    expect(snapshot.hasUnavailablePrices).toBe(false);
  });

  it('uses fresh cache on repeated calls within TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T00:00:00.000Z'));

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      symbol: 'ETHUSDT',
      price: '2050',
    }));

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');

    expect(await readAssetPriceUSD(market, 'ETH')).toBe(2050);
    expect(await readAssetPriceUSD(market, 'ETH')).toBe(2050);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores fresh cache when forceRefresh is true', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T00:00:00.000Z'));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ symbol: 'ETHUSDT', price: '2000' }))
      .mockResolvedValueOnce(jsonResponse({ symbol: 'ETHUSDT', price: '2100' }));

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');
    const positions = [makePosition('p1', 'ETH', 1, 10)];

    const first = await market.calculatePositionMetrics(positions);
    const second = await market.calculatePositionMetrics(positions, { forceRefresh: true });

    expect(first.totalUsd).toBe(2000);
    expect(second.totalUsd).toBe(2100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to stale cache when refresh fails after TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T00:00:00.000Z'));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ symbol: 'ETHUSDT', price: '1800' }))
      .mockResolvedValue(failResponse());

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');
    const positions = [makePosition('p1', 'ETH', 2, 15)];

    const initial = await market.calculatePositionMetrics(positions);
    expect(initial.totalUsd).toBe(3600);

    vi.setSystemTime(new Date('2026-02-21T00:01:01.000Z'));
    const stale = await market.calculatePositionMetrics(positions);

    expect(stale.totalUsd).toBe(3600);
    expect(stale.hasStalePrices).toBe(true);
    expect(stale.priceSourceByAsset.ETH).toBe('cache-stale');
  });

  it('marks unavailable assets as 0 when there is no cache fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(failResponse());
    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');

    const metrics = await market.calculatePositionMetrics([makePosition('p1', 'ETH', 2, 15)]);

    expect(metrics.totalUsd).toBe(0);
    expect(metrics.hasUnavailablePrices).toBe(true);
    expect(metrics.priceSourceByAsset.ETH).toBe('unavailable');
    expect(metrics.usdByPositionId.p1).toBe(0);
  });

  it('calculates position metrics from snapshot and filters to subscription assets', async () => {
    const market = await import('./market');
    const snapshot: AssetPriceSnapshot = {
      priceByAsset: { ETH: 2000, USDT: 1, SOL: 150 },
      sourceByAsset: { ETH: 'live', USDT: 'stable', SOL: 'live' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
    };

    const metrics = market.calculatePositionMetricsFromSnapshot([
      makePosition('usdt', 'USDT', 100, 10),
      makePosition('eth', 'ETH', 0.5, 20),
    ], snapshot);

    expect(metrics.totalUsd).toBeCloseTo(1100, 8);
    expect(metrics.weightedApr).toBeCloseTo((10 * 100 + 20 * 1000) / 1100, 8);
    expect(metrics.dailyEarningsUsd).toBeCloseTo((100 * 0.1) / 365 + (1000 * 0.2) / 365, 8);
    expect(metrics.priceByAsset.SOL).toBeUndefined();
    expect(metrics.priceSourceByAsset.USDT).toBe('stable');
    expect(metrics.priceSourceByAsset.ETH).toBe('live');
  });

  it('deduplicates in-flight ticker requests for concurrent calls', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return jsonResponse({ symbol: 'ETHUSDT', price: '2200' });
    });

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');

    const [a, b] = await Promise.all([
      readAssetPriceUSD(market, 'ETH'),
      readAssetPriceUSD(market, 'eth'),
    ]);

    expect(a).toBe(2200);
    expect(b).toBe(2200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to secondary endpoint when primary endpoint fails', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(BINANCE_GLOBAL_URL)) return failResponse(500);
      if (url.startsWith(BINANCE_US_URL)) {
        return jsonResponse({ symbol: 'ETHUSDT', price: '2200' });
      }
      return failResponse(500);
    });

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');
    const snapshot = await market.getAssetPriceSnapshot(['ETH'], { forceRefresh: true });

    expect(snapshot.priceByAsset.ETH).toBe(2200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(BINANCE_GLOBAL_URL);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(BINANCE_US_URL);
  });

  it('aborts a slow primary endpoint and falls back to secondary endpoint', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(BINANCE_GLOBAL_URL)) {
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (!signal) return;
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      }
      if (url.startsWith(BINANCE_US_URL)) {
        return Promise.resolve(jsonResponse({ symbol: 'ETHUSDT', price: '2000' }));
      }
      return Promise.resolve(failResponse(500));
    });

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');
    const request = readAssetPriceUSD(market, 'ETH');

    await vi.advanceTimersByTimeAsync(6000);
    await expect(request).resolves.toBe(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(BINANCE_GLOBAL_URL);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(BINANCE_US_URL);
  });

  it('temporarily blocks rate-limited endpoint and skips it while blocked', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T00:00:00.000Z'));

    const fetchMock = vi.fn().mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(BINANCE_GLOBAL_URL)) {
        return jsonResponse({}, { ok: false, status: 429, headers: { 'Retry-After': '120' } });
      }
      if (url.startsWith(BINANCE_US_URL)) {
        return jsonResponse({ symbol: 'ETHUSDT', price: '2100' });
      }
      return failResponse(500);
    });

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');

    await market.getAssetPriceSnapshot(['ETH'], { forceRefresh: true });
    await market.getAssetPriceSnapshot(['ETH'], { forceRefresh: true });

    const globalCalls = fetchMock.mock.calls.filter((call) => String(call[0]).startsWith(BINANCE_GLOBAL_URL));
    const usCalls = fetchMock.mock.calls.filter((call) => String(call[0]).startsWith(BINANCE_US_URL));

    expect(globalCalls).toHaveLength(1);
    expect(usCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts numeric ticker prices and ignores malformed symbols', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { symbol: 'ETHUSDT', price: 2100.75 },
      { symbol: 'INVALID SYMBOL', price: '1000' },
      { symbol: 'BTCUSDT', price: 'bad' },
    ]));

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');
    const snapshot = await market.getAssetPriceSnapshot(['ETH', 'BTC'], { forceRefresh: true });

    expect(snapshot.priceByAsset.ETH).toBe(2100.75);
    expect(snapshot.priceByAsset.BTC).toBe(0);
    expect(snapshot.sourceByAsset.BTC).toBe('unavailable');
  });

  it('drops very old stale cache entries instead of keeping them indefinitely', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T00:00:00.000Z'));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ symbol: 'ETHUSDT', price: '1800' }))
      .mockResolvedValue(failResponse());

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');

    const first = await market.getAssetPriceSnapshot(['ETH'], { forceRefresh: true });
    expect(first.sourceByAsset.ETH).toBe('live');

    vi.setSystemTime(new Date('2026-02-22T01:00:00.000Z'));
    const afterOneDay = await market.getAssetPriceSnapshot(['ETH'], { forceRefresh: true });
    expect(afterOneDay.sourceByAsset.ETH).toBe('unavailable');
  });

  it('bounds cache growth by evicting oldest entries when the cache overflows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T00:00:00.000Z'));

    const assets = Array.from({ length: 270 }, (_, index) => `A${index.toString(36).toUpperCase().padStart(2, '0')}`);
    const oldestAsset = assets[0];
    const firstPayload = assets.map((asset, index) => ({
      symbol: `${asset}USDT`,
      price: String(100 + index),
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(firstPayload))
      .mockResolvedValue(failResponse());

    vi.stubGlobal('fetch', fetchMock);
    const market = await import('./market');

    const seeded = await market.getAssetPriceSnapshot(assets, { forceRefresh: true });
    expect(seeded.sourceByAsset[oldestAsset]).toBe('live');

    vi.setSystemTime(new Date('2026-02-21T00:01:01.000Z'));
    const oldestRefresh = await market.getAssetPriceSnapshot([oldestAsset], { forceRefresh: true });
    expect(oldestRefresh.sourceByAsset[oldestAsset]).toBe('unavailable');
  });
});
