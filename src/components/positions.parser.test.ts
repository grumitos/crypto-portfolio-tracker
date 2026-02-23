import { describe, expect, it } from 'vitest';
import { parseBinancePositions } from './positions.parser';

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
});
