import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./binance-client', () => ({
  fetchDualPositions: vi.fn(),
  fetchAccountBalances: vi.fn(),
}));

vi.mock('./market', () => ({
  getAssetPriceSnapshot: vi.fn(),
}));

import { fetchAccountBalances, fetchDualPositions } from './binance-client';
import { formatISODateLocal, formatTimeHHMMLocal, resolveBinanceDualSettlementLocal } from './date';
import { getAssetPriceSnapshot } from './market';
import {
  clearBinanceSyncCaches,
  fetchBalanceSummary,
  fetchBinancePortfolioSnapshot,
} from './binance-sync';

describe('binance sync cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T12:00:00.000Z'));
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
  });

  it('reuses balance summary within 60 seconds', async () => {
    const first = await fetchBalanceSummary();
    const second = await fetchBalanceSummary();

    expect(first.totalUsdEstimate).toBe(2100);
    expect(second.totalUsdEstimate).toBe(2100);
    expect(fetchAccountBalances).toHaveBeenCalledTimes(1);
    expect(getAssetPriceSnapshot).toHaveBeenCalledTimes(1);
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

    expect(snapshot.positions[0]?.settlementDate).toBe(expectedSettlement?.date);
    expect(snapshot.positions[0]?.settlementTime).toBe(expectedSettlement?.time);
  });
});
