import { describe, expect, it } from 'vitest';
import { parseBinancePositions, parseImportedPositions } from './positions.parser';

describe('positions parser', () => {
  it('parses buy-low and sell-high blocks', () => {
    const raw = `
USDT-ETH
Buy-low
2026-02-20 08:45
100 USDT
1,925 2026-02-23 03:00
191.04%
Holding

SOL-USDT
Sell-high
2026-02-19 12:00
15 SOL
90 2026-02-21 03:00
88.5%
Holding
`.trim();

    const parsed = parseBinancePositions(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].direction).toBe('buy-low');
    expect(parsed[0].asset).toBe('ETH');
    expect(parsed[0].subscriptionAsset).toBe('USDT');
    expect(parsed[1].direction).toBe('sell-high');
    expect(parsed[1].asset).toBe('SOL');
    expect(parsed[1].subscriptionAsset).toBe('SOL');
  });

  it('parses Spanish "Comprar bajo" direction from pasted Binance rows', () => {
    const raw = `
image
image
USDT-ETH
Comprar bajo
2026-03-03 03:44
19,101.4 USDT
≈ $19,101.4
1,875 2026-03-04 03:00
140.39%
Holding
image
image
USDT-ETH
Comprar bajo
2026-03-03 03:43
19,101 USDT
≈ $19,101
1,850 2026-03-04 03:00
103.62%
Holding
`.trim();

    const parsed = parseBinancePositions(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed.every((position) => position.direction === 'buy-low')).toBe(true);
    expect(parsed[0]).toMatchObject({
      asset: 'ETH',
      subscriptionAsset: 'USDT',
      amount: 19101.4,
      targetPrice: 1875,
      entryDate: '2026-03-03',
      entryTime: '03:44',
      settlementDate: '2026-03-04',
      settlementTime: '03:00',
      apr: 140.39,
    });
    expect(parsed[1]).toMatchObject({
      asset: 'ETH',
      subscriptionAsset: 'USDT',
      amount: 19101,
      targetPrice: 1850,
      entryDate: '2026-03-03',
      entryTime: '03:43',
      settlementDate: '2026-03-04',
      settlementTime: '03:00',
      apr: 103.62,
    });
  });

  it('rejects blocks using assets outside the allowed pool', () => {
    const raw = `
DOGE-USDT
Buy-low
2026-02-20 08:45
100 USDT
0.12 2026-02-23 03:00
20%
`.trim();

    expect(parseBinancePositions(raw)).toEqual([]);
  });

  it('rejects incomplete chunks with missing required fields', () => {
    const missingApr = `
USDT-ETH
Buy-low
2026-02-20 08:45
100 USDT
1,925 2026-02-23 03:00
`.trim();

    const missingSettlement = `
USDT-ETH
Buy-low
2026-02-20 08:45
100 USDT
191.04%
`.trim();

    expect(parseBinancePositions(missingApr)).toEqual([]);
    expect(parseBinancePositions(missingSettlement)).toEqual([]);
  });

  it('extracts target from standalone numeric line when settlement is separate', () => {
    const raw = `
USDT-ETH
Buy-low
2026-02-19 14:29
100 USDT
1,925
2026-02-23 03:00
136.95%
`.trim();

    const parsed = parseBinancePositions(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].targetPrice).toBe(1925);
    expect(parsed[0].entryDate).toBe('2026-02-19');
    expect(parsed[0].settlementDate).toBe('2026-02-23');
  });

  it('consolidates repeated binance blocks with weighted APR and target', () => {
    const raw = `
USDT-ETH
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
Holding
`.trim();

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

  it('keeps positions with different settlement dates separate after consolidation', () => {
    const raw = `
USDT-ETH
Buy-low
2026-02-20 08:45
40 USDT
1,925 2026-02-23 03:00
120%
Holding

USDT-ETH
Buy-low
2026-02-20 08:45
60 USDT
1,930 2026-02-24 03:00
110%
Holding
`.trim();

    const parsed = parseImportedPositions(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed.every(p => p.asset === 'ETH')).toBe(true);
    expect(parsed.map(p => p.amount).sort((a, b) => a - b)).toEqual([40, 60]);
  });

  it('returns empty arrays for empty and malformed imports', () => {
    const malformed = `
USDT-ETH
Buy-low
2026-02-20 08:45
1,925 2026-02-23 03:00
191.04%
`.trim();

    expect(parseBinancePositions('')).toEqual([]);
    expect(parseImportedPositions('')).toEqual([]);
    expect(parseBinancePositions(malformed)).toEqual([]);
    expect(parseImportedPositions('lorem ipsum dolor sit amet')).toEqual([]);
  });

  it('rejects negative amounts and invalid datetime formats', () => {
    const negativeAmount = `
USDT-ETH
Buy-low
2026-02-20 08:45
-100 USDT
1,925 2026-02-23 03:00
191.04%
`.trim();

    const invalidDateTime = `
USDT-ETH
Buy-low
2026-02-20 25:61
100 USDT
1,925 2026-02-23 03:00
191.04%
`.trim();

    expect(parseBinancePositions(negativeAmount)).toEqual([]);
    expect(parseBinancePositions(invalidDateTime)).toEqual([]);
  });

  it('accepts APR=0 as a valid parsed position', () => {
    const zeroApr = `
USDT-ETH
Buy-low
2026-02-20 08:45
100 USDT
1,925 2026-02-23 03:00
0%
`.trim();

    const parsed = parseBinancePositions(zeroApr);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].apr).toBe(0);
  });
});
