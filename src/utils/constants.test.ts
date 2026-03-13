import { describe, expect, it } from 'vitest';
import { MARKET_POLL_INTERVAL_MS, ONE_DAY_MS, ONE_MINUTE_MS, ONE_SECOND_MS } from './constants';

describe('constants', () => {
  it('exposes shared time constants', () => {
    expect(MARKET_POLL_INTERVAL_MS).toBe(60_000);
    expect(ONE_SECOND_MS).toBe(1000);
    expect(ONE_MINUTE_MS).toBe(60_000);
    expect(ONE_DAY_MS).toBe(86_400_000);
  });
});
