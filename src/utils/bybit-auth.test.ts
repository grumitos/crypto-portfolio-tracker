import { beforeEach, describe, expect, it } from '#test';
import { createMemoryStorage } from '../test/test-utils';
import {
  clearBybitApiCredentials,
  loadBybitApiCredentials,
  loadStoredBybitApiKey,
  saveBybitApiCredentials,
} from './bybit-auth';

describe('bybit auth', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    clearBybitApiCredentials();
  });

  it('keeps API secret in memory and persists only the API key by default', () => {
    saveBybitApiCredentials({ apiKey: 'key', apiSecret: 'secret' });

    expect(localStorage.getItem('crypto-bybit-api')).toBe(JSON.stringify({ apiKey: 'key' }));
    expect(loadStoredBybitApiKey()).toBe('key');
    expect(loadBybitApiCredentials()).toEqual({ apiKey: 'key', apiSecret: 'secret' });
  });

  it('ignores legacy persisted secrets instead of loading them', () => {
    localStorage.setItem(
      'crypto-bybit-api',
      JSON.stringify({ apiKey: 'persisted-key', apiSecret: 'persisted-secret' }),
    );

    expect(loadStoredBybitApiKey()).toBe('persisted-key');
    expect(loadBybitApiCredentials()).toBeNull();
  });
});
