import { describe, it, expect } from 'vitest';
import {
  formatISODateLocal,
  parseISODateLocal,
  sanitizeISODate,
  parseBinanceDualSettlementUTC,
  isBinanceDualSettlementReached,
} from './date';

describe('date utils', () => {
  it('formats local date as YYYY-MM-DD', () => {
    const date = new Date(2026, 1, 18); // 2026-02-18 local
    expect(formatISODateLocal(date)).toBe('2026-02-18');
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

  it('marks settlement reached only at or after 08:00 UTC', () => {
    expect(isBinanceDualSettlementReached('2026-02-19', new Date('2026-02-19T07:59:59.999Z'))).toBe(
      false,
    );
    expect(isBinanceDualSettlementReached('2026-02-19', new Date('2026-02-19T08:00:00.000Z'))).toBe(
      true,
    );
    expect(isBinanceDualSettlementReached('2026-02-19', new Date('2026-02-19T10:00:00.000Z'))).toBe(
      true,
    );
  });
});
