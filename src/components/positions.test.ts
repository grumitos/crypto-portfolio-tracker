import { describe, it, expect } from 'vitest';
import { parseBinancePositions, parseImportedPositions } from './positions';

describe('positions bulk import parser', () => {
  it('ignores direction rows as pair delimiters and parses pasted Binance blocks', () => {
    const raw = `image
image
USDT-ETH
Buy-low
2026-02-20 08:45
6,865.5 USDT
≈ $6,865.5
1,925	2026-02-23 03:00
191.04%
Holding
image
image
USDC-ETH
Buy-low
2026-02-19 14:29
100 USDC
≈ $100.03
1,925	2026-02-23 03:00
136.95%
Holding`;

    const parsed = parseBinancePositions(raw);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      direction: 'buy-low',
      asset: 'ETH',
      subscriptionAsset: 'USDT',
      amount: 6865.5,
      targetPrice: 1925,
      entryDate: '2026-02-20',
      entryTime: '08:45',
      settlementDate: '2026-02-23',
      settlementTime: '03:00',
      apr: 191.04,
    });
    expect(parsed[1]).toMatchObject({
      direction: 'buy-low',
      asset: 'ETH',
      subscriptionAsset: 'USDC',
      amount: 100,
      targetPrice: 1925,
      entryDate: '2026-02-19',
      entryTime: '14:29',
      settlementDate: '2026-02-23',
      settlementTime: '03:00',
      apr: 136.95,
    });
  });

  it('consolidates repeated binance blocks with the same pair and settlement', () => {
    const raw = `USDT-ETH
Buy-low
2026-02-20 08:45
100 USDT
1,925 2026-02-23 03:00
191.04%
Holding

USDT-ETH
Buy-low
2026-02-20 09:45
200 USDT
1,930 2026-02-23 03:00
100%
Holding`;

    const parsed = parseImportedPositions(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      direction: 'buy-low',
      asset: 'ETH',
      subscriptionAsset: 'USDT',
      amount: 300,
      settlementDate: '2026-02-23',
      settlementTime: '03:00',
    });
    expect(parsed[0].components).toHaveLength(2);
    expect(parsed[0].targetPrice).toBeCloseTo((100 * 1925 + 200 * 1930) / 300, 10);
    expect(parsed[0].apr).toBeCloseTo((100 * 191.04 + 200 * 100) / 300, 10);
  });
});
