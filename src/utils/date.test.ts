import { describe, it, expect } from '#test';
import {
  formatISODateLocal,
  formatTimeHHMMLocal,
  parseISODateLocal,
  sanitizeISODate,
  parseBinanceDualSettlementUTC,
  resolveBinanceDualSettlementLocal,
} from './date';

describe('date utils', () => {
  it('formats local date as YYYY-MM-DD', () => {
    const date = new Date(2026, 1, 18); // 2026-02-18 local
    expect(formatISODateLocal(date)).toBe('2026-02-18');
  });

  it('formats local time as HH:mm', () => {
    const date = new Date(2026, 1, 18, 4, 7, 59);
    expect(formatTimeHHMMLocal(date)).toBe('04:07');
  });

  it('parses valid ISO date and rejects invalid date', () => {
    expect(parseISODateLocal('2026-02-18')).not.toBeNull();
    expect(parseISODateLocal('2026-02-31')).toBeNull();
  });

  it('sanitizes unknown values with fallback', () => {
    expect(sanitizeISODate('bad-date', '2026-02-18')).toBe('2026-02-18');
    expect(sanitizeISODate('2026-02-19', '2026-02-18')).toBe('2026-02-19');
  });

  it('parses Binance Dual settlement timestamp at 08:00 UTC', () => {
    const settlement = parseBinanceDualSettlementUTC('2026-02-19');
    expect(settlement?.toISOString()).toBe('2026-02-19T08:00:00.000Z');
  });

  it('resolves Binance settlement into local date/time parts', () => {
    // TZ is pinned to America/Bogota (UTC-5) in src/test/setup.ts: 08:00 UTC => 03:00.
    expect(resolveBinanceDualSettlementLocal('2026-02-19')).toEqual({
      date: '2026-02-19',
      time: '03:00',
    });
  });
});
