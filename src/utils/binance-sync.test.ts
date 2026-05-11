import { beforeEach, describe, expect, it, vi } from '#test';

vi.mock('./binance-client', () => ({
  fetchDualPositions: vi.fn(),
  fetchAccountBalances: vi.fn(),
}));

vi.mock('./bybit-client', () => ({
  fetchBybitAssetBalances: vi.fn(),
  fetchBybitDiscountBuyPositions: vi.fn(),
  fetchBybitDualAssetPositions: vi.fn(),
  fetchBybitOpenPositions: vi.fn(),
  fetchBybitWalletBalances: vi.fn(),
}));

vi.mock('./market', () => ({
  getAssetPriceSnapshot: vi.fn(),
}));

import { fetchAccountBalances, fetchDualPositions } from './binance-client';
import {
  fetchBybitAssetBalances,
  fetchBybitDiscountBuyPositions,
  fetchBybitDualAssetPositions,
  fetchBybitOpenPositions,
  fetchBybitWalletBalances,
} from './bybit-client';
import { saveApiCredentials, clearApiCredentials } from './binance-auth';
import { saveBybitApiCredentials, clearBybitApiCredentials } from './bybit-auth';
import { formatISODateLocal, formatTimeHHMMLocal, resolveBinanceDualSettlementLocal } from './date';
import { getAssetPriceSnapshot } from './market';
import { createMemoryStorage } from '../test/test-utils';
import {
  clearBinanceSyncCaches,
  fetchBalanceSummary,
  fetchBinancePortfolioSnapshot,
} from './binance-sync';

describe('binance sync cache', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T12:00:00.000Z'));
    clearApiCredentials();
    clearBybitApiCredentials();
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
    clearBinanceSyncCaches();

    vi.mocked(fetchAccountBalances).mockResolvedValue([
      { asset: 'USDT', free: 100, locked: 0 },
      { asset: 'ETH', free: 1, locked: 0 },
    ]);

    vi.mocked(getAssetPriceSnapshot).mockResolvedValue({
      priceByAsset: { ETH: 2000 },
      sourceByAsset: { ETH: 'live' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
    });

    vi.mocked(fetchDualPositions).mockResolvedValue([
      {
        id: '1',
        investCoin: 'USDT',
        exercisedCoin: 'ETH',
        amount: 100,
        strikePrice: 2000,
        duration: 2,
        settleDate: '2026-03-16',
        apr: 40,
        optionType: 'PUT',
        status: 'PURCHASE_SUCCESS',
      },
    ]);
    vi.mocked(fetchBybitAssetBalances).mockResolvedValue([]);
    vi.mocked(fetchBybitWalletBalances).mockResolvedValue([]);
    vi.mocked(fetchBybitOpenPositions).mockResolvedValue([]);
    vi.mocked(fetchBybitDualAssetPositions).mockResolvedValue([]);
    vi.mocked(fetchBybitDiscountBuyPositions).mockResolvedValue([]);
  });

  it('reuses balance summary within 60 seconds', async () => {
    const first = await fetchBalanceSummary();
    const second = await fetchBalanceSummary();

    expect(first.totalUsdEstimate).toBe(2100);
    expect(second.totalUsdEstimate).toBe(2100);
    expect(fetchAccountBalances).toHaveBeenCalledTimes(1);
    expect(getAssetPriceSnapshot).toHaveBeenCalledTimes(1);
  });

  it('combines Binance and Bybit balances when both exchanges are configured', async () => {
    saveBybitApiCredentials({ apiKey: 'bybit-key', apiSecret: 'bybit-secret' });
    vi.mocked(fetchBybitWalletBalances).mockResolvedValue([
      { asset: 'BTC', walletBalance: 0.1, locked: 0.02, usdValue: 7000 },
    ]);

    const summary = await fetchBalanceSummary(true);

    expect(summary.totalUsdEstimate).toBe(9100);
    expect(summary.balances).toEqual([
      { asset: 'USDT', free: 100, locked: 0, source: 'Binance' },
      { asset: 'ETH', free: 1, locked: 0, source: 'Binance' },
      { asset: 'BTC', free: 0.08, locked: 0.02, source: 'Bybit' },
    ]);
  });

  it('returns available exchange balances when another configured exchange times out', async () => {
    saveBybitApiCredentials({ apiKey: 'bybit-key', apiSecret: 'bybit-secret' });
    vi.mocked(fetchBybitWalletBalances).mockReturnValue(new Promise(() => {}));

    const summaryPromise = fetchBalanceSummary(true);
    await vi.advanceTimersByTimeAsync(12_000);
    const summary = await summaryPromise;

    expect(summary.totalUsdEstimate).toBe(2100);
    expect(summary.balances).toEqual([
      { asset: 'USDT', free: 100, locked: 0, source: 'Binance' },
      { asset: 'ETH', free: 1, locked: 0, source: 'Binance' },
    ]);
  });

  it('falls back to Bybit asset balances when account wallet balance is not allowed', async () => {
    saveBybitApiCredentials({ apiKey: 'bybit-key', apiSecret: 'bybit-secret' });
    vi.mocked(fetchBybitWalletBalances).mockRejectedValue(new Error('permission denied'));
    vi.mocked(fetchBybitAssetBalances).mockResolvedValue([
      { asset: 'SOL', walletBalance: 2, locked: 0, usdValue: 0 },
    ]);
    vi.mocked(getAssetPriceSnapshot).mockResolvedValueOnce({
      priceByAsset: { ETH: 2000, SOL: 150 },
      sourceByAsset: { ETH: 'live', SOL: 'live' },
      marketLastUpdatedAt: Date.now(),
      hasStalePrices: false,
      hasUnavailablePrices: false,
    });

    const summary = await fetchBalanceSummary(true);

    expect(fetchBybitAssetBalances).toHaveBeenCalledTimes(1);
    expect(summary.totalUsdEstimate).toBe(2400);
    expect(summary.balances).toEqual(
      expect.arrayContaining([{ asset: 'SOL', free: 2, locked: 0, source: 'Bybit' }]),
    );
  });

  it('supports a Bybit-only balance summary', async () => {
    clearApiCredentials();
    saveBybitApiCredentials({ apiKey: 'bybit-key', apiSecret: 'bybit-secret' });
    vi.mocked(fetchBybitWalletBalances).mockResolvedValue([
      { asset: 'USDT', walletBalance: 50, locked: 0, usdValue: 50 },
    ]);

    const summary = await fetchBalanceSummary(true);

    expect(fetchAccountBalances).not.toHaveBeenCalled();
    expect(summary.totalUsdEstimate).toBe(50);
    expect(summary.balances).toEqual([{ asset: 'USDT', free: 50, locked: 0, source: 'Bybit' }]);
  });

  it('returns an empty summary when no exchange credentials exist', async () => {
    clearApiCredentials();
    clearBybitApiCredentials();

    const summary = await fetchBalanceSummary(true);

    expect(summary).toEqual({ balances: [], totalUsdEstimate: 0 });
    expect(fetchAccountBalances).not.toHaveBeenCalled();
    expect(fetchBybitWalletBalances).not.toHaveBeenCalled();
  });

  it('throws when every configured exchange balance read fails', async () => {
    vi.mocked(fetchAccountBalances).mockRejectedValue(new Error('binance down'));

    await expect(fetchBalanceSummary(true)).rejects.toThrow(
      'No se pudieron leer saldos de exchanges configurados.',
    );
  });

  it('expires balance summary cache after 60 seconds', async () => {
    await fetchBalanceSummary();
    vi.advanceTimersByTime(60_001);
    await fetchBalanceSummary();

    expect(fetchAccountBalances).toHaveBeenCalledTimes(2);
    expect(getAssetPriceSnapshot).toHaveBeenCalledTimes(2);
  });

  it('reuses the full Binance portfolio snapshot within 60 seconds', async () => {
    await fetchBinancePortfolioSnapshot();
    await fetchBinancePortfolioSnapshot();

    expect(fetchDualPositions).toHaveBeenCalledTimes(1);
    expect(fetchAccountBalances).toHaveBeenCalledTimes(1);
  });

  it('includes Bybit derivative positions in the automatic snapshot', async () => {
    saveBybitApiCredentials({ apiKey: 'bybit-key', apiSecret: 'bybit-secret' });
    vi.mocked(fetchBybitOpenPositions).mockResolvedValue([
      {
        id: 'bybit_BTCUSDT_Buy',
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'Buy',
        size: 0.05,
        avgPrice: 70000,
        markPrice: 71000,
        positionValue: 3550,
        unrealizedPnl: 50,
        updatedTime: Date.parse('2026-03-14T11:30:00.000Z'),
      },
    ]);

    const snapshot = await fetchBinancePortfolioSnapshot(true);

    expect(snapshot.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bybit_BTCUSDT_Buy',
          source: 'Bybit',
          positionKind: 'derivative',
          displaySymbol: 'BTCUSDT',
          notionalUsd: 3550,
          unrealizedPnlUsd: 50,
        }),
      ]),
    );
  });

  it('includes Bybit Dual Asset positions in the automatic snapshot', async () => {
    saveBybitApiCredentials({ apiKey: 'bybit-key', apiSecret: 'bybit-secret' });
    vi.mocked(fetchBybitDualAssetPositions).mockResolvedValue([
      {
        id: 'bybit_dual_19035',
        productId: '36320',
        baseCoin: 'ETH',
        quoteCoin: 'USDT',
        investCoin: 'USDT',
        amount: 20,
        apr: 902.7,
        direction: 'BuyLow',
        targetPrice: 2325,
        settlementTime: Date.parse('2026-03-17T23:59:59.000Z'),
        status: 'Active',
        yieldStartAt: Date.parse('2026-03-14T00:00:00.000Z'),
        projectedProfit: 1.25,
      },
    ]);

    const snapshot = await fetchBinancePortfolioSnapshot(true);

    expect(snapshot.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bybit_dual_19035',
          source: 'Bybit',
          positionKind: 'dual',
          displaySymbol: 'ETHUSDT',
          direction: 'buy-low',
          subscriptionAsset: 'USDT',
          quoteAsset: 'USDT',
          amount: 20,
          targetPrice: 2325,
          apr: 902.7,
          projectedProfit: 1.25,
        }),
      ]),
    );
  });

  it('preserves Bybit Dual Asset quote coin for crypto-cross positions', async () => {
    saveBybitApiCredentials({ apiKey: 'bybit-key', apiSecret: 'bybit-secret' });
    vi.mocked(fetchBybitDualAssetPositions).mockResolvedValue([
      {
        id: 'bybit_dual_eth_btc',
        productId: '36399',
        baseCoin: 'ETH',
        quoteCoin: 'BTC',
        investCoin: 'ETH',
        amount: 1,
        apr: 120,
        direction: 'SellHigh',
        targetPrice: 0.055,
        settlementTime: Date.parse('2026-05-10T08:00:00.000Z'),
        status: 'Active',
        yieldStartAt: Date.parse('2026-05-09T08:00:00.000Z'),
      },
    ]);

    const snapshot = await fetchBinancePortfolioSnapshot(true);

    expect(snapshot.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bybit_dual_eth_btc',
          displaySymbol: 'ETHBTC',
          direction: 'sell-high',
          asset: 'ETH',
          subscriptionAsset: 'ETH',
          quoteAsset: 'BTC',
          targetPrice: 0.055,
        }),
      ]),
    );
  });

  it('includes Bybit Discount Buy positions in the automatic snapshot', async () => {
    saveBybitApiCredentials({ apiKey: 'bybit-key', apiSecret: 'bybit-secret' });
    vi.mocked(fetchBybitDiscountBuyPositions).mockResolvedValue([
      {
        id: 'bybit_discount_buy_11959',
        productId: '7037',
        coin: 'USDT',
        underlyingAsset: 'BTC',
        amount: 200,
        apr: 1,
        purchasePrice: 74019,
        knockoutPrice: 76050,
        settlementTime: Date.parse('2026-04-15T08:00:00.000Z'),
        status: 'Active',
        duration: '1d',
        yieldStartAt: Date.parse('2026-04-14T08:00:00.000Z'),
        projectedProfit: 0.005479452054794521,
      },
    ]);

    const snapshot = await fetchBinancePortfolioSnapshot(true);

    expect(snapshot.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bybit_discount_buy_11959',
          source: 'Bybit',
          positionKind: 'discount-buy',
          displaySymbol: 'BTCUSDT',
          direction: 'buy-low',
          subscriptionAsset: 'USDT',
          amount: 200,
          targetPrice: 74019,
          apr: 1,
          projectedProfit: 0.005479452054794521,
        }),
      ]),
    );
  });

  it('prefers purchaseTime over purchaseEndTime when mapping the subscription date', async () => {
    vi.mocked(fetchDualPositions).mockResolvedValue([
      {
        id: '1',
        investCoin: 'USDT',
        exercisedCoin: 'ETH',
        amount: 100,
        strikePrice: 2000,
        duration: 2,
        settleDate: '2026-03-16',
        apr: 40,
        optionType: 'PUT',
        status: 'PURCHASE_SUCCESS',
        purchaseTime: Date.parse('2026-03-12T14:30:00.000Z'),
        purchaseEndTime: Date.parse('2026-03-15T23:59:00.000Z'),
      },
    ]);

    const snapshot = await fetchBinancePortfolioSnapshot(true);
    const expected = new Date('2026-03-12T14:30:00.000Z');

    expect(snapshot.positions[0]?.entryDate).toBe(formatISODateLocal(expected));
    expect(snapshot.positions[0]?.entryTime).toBe(
      `${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`,
    );
    expect(snapshot.positions[0]?.entryTimeSource).toBe('binance_purchase_time');
    expect(snapshot.positions[0]?.settlementTime).toBe(
      formatTimeHHMMLocal(new Date('2026-03-16T08:00:00.000Z')),
    );
    expect(snapshot.positions[0]?.settlementTimeSource).toBe('binance_settle_date_rule');
  });

  it('falls back to settlement UTC minus duration instead of purchaseEndTime when purchaseTime is absent', async () => {
    vi.mocked(fetchDualPositions).mockResolvedValue([
      {
        id: '1',
        investCoin: 'USDT',
        exercisedCoin: 'ETH',
        amount: 100,
        strikePrice: 2000,
        duration: 5,
        settleDate: '2026-03-20',
        apr: 40,
        optionType: 'PUT',
        status: 'PURCHASE_SUCCESS',
        purchaseEndTime: Date.parse('2026-03-19T23:59:00.000Z'),
      },
    ]);

    const snapshot = await fetchBinancePortfolioSnapshot(true);
    const expected = new Date(Date.UTC(2026, 2, 15, 8, 0, 0, 0));

    expect(snapshot.positions[0]?.entryDate).toBe(formatISODateLocal(expected));
    expect(snapshot.positions[0]?.entryTime).toBe(
      `${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`,
    );
    expect(snapshot.positions[0]?.entryTimeSource).toBe('derived_settle_minus_duration');
  });

  it('maps settlement date and time using Binance default cutoff in local time', async () => {
    vi.mocked(fetchDualPositions).mockResolvedValue([
      {
        id: '1',
        investCoin: 'BNB',
        exercisedCoin: 'USDT',
        amount: 0.25,
        strikePrice: 500,
        duration: 3,
        settleDate: '2026-03-20',
        apr: 32,
        optionType: 'CALL',
        status: 'PURCHASE_SUCCESS',
      },
    ]);

    const snapshot = await fetchBinancePortfolioSnapshot(true);
    const expectedSettlement = resolveBinanceDualSettlementLocal('2026-03-20');

    expect(snapshot.positions[0]?.settlementDate).toBe(expectedSettlement!.date);
    expect(snapshot.positions[0]?.settlementTime).toBe(expectedSettlement!.time);
  });
});
