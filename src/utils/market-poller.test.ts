import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_POLL_INTERVAL_MS } from './constants';

async function loadMarketPoller() {
  vi.resetModules();
  return import('./market-poller');
}

describe('market-poller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('runs immediate callback with forceRefresh=false when requested', async () => {
    const poller = await loadMarketPoller();
    const callback = vi.fn();

    const unsubscribe = poller.subscribeToMarketTicks(callback, true);
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(false);

    unsubscribe();
  });

  it('ticks subscribed callbacks with forceRefresh=true on interval', async () => {
    const poller = await loadMarketPoller();
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = poller.subscribeToMarketTicks(first, false);
    const unsubscribeSecond = poller.subscribeToMarketTicks(second, false);

    await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
    expect(first).toHaveBeenCalledWith(true);
    expect(second).toHaveBeenCalledWith(true);

    unsubscribeFirst();
    first.mockClear();
    second.mockClear();
    await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(true);

    unsubscribeSecond();
    second.mockClear();
    await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
    expect(second).not.toHaveBeenCalled();
  });

  it('prevents re-entrant hydration while previous tick is still running', async () => {
    const poller = await loadMarketPoller();
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = () => resolve();
    });

    const callback = vi.fn().mockImplementation(async () => {
      await gate;
    });

    const unsubscribe = poller.subscribeToMarketTicks(callback, false);
    await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);

    expect(callback).toHaveBeenCalledTimes(1);

    resolveGate();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('isolates errors from one subscriber so other subscribers keep running', async () => {
    const poller = await loadMarketPoller();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();

    const unsubBad = poller.subscribeToMarketTicks(bad, false);
    const unsubGood = poller.subscribeToMarketTicks(good, false);

    await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);

    unsubBad();
    unsubGood();
  });

  it('isolates async rejections so polling continues for other subscribers', async () => {
    const poller = await loadMarketPoller();
    const badAsync = vi.fn(async () => {
      throw new Error('async boom');
    });
    const good = vi.fn();

    const unsubBad = poller.subscribeToMarketTicks(badAsync, false);
    const unsubGood = poller.subscribeToMarketTicks(good, false);

    await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(MARKET_POLL_INTERVAL_MS);

    expect(badAsync).toHaveBeenCalledTimes(2);
    expect(good).toHaveBeenCalledTimes(2);

    unsubBad();
    unsubGood();
  });
});
