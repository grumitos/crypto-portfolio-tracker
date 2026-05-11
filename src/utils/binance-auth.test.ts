import { beforeEach, describe, expect, it } from '#test';
import { createMemoryStorage } from '../test/test-utils';
import {
  clearApiCredentials,
  loadApiCredentials,
  loadStoredApiKey,
  saveApiCredentials,
} from './binance-auth';

describe('binance auth', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    clearApiCredentials();
  });

  it('keeps API secret in memory and persists only the API key by default', () => {
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });

    expect(localStorage.getItem('crypto-binance-api')).toBe(JSON.stringify({ apiKey: 'key' }));
    expect(loadStoredApiKey()).toBe('key');
    expect(loadApiCredentials()).toEqual({ apiKey: 'key', apiSecret: 'secret' });
  });

  it('ignores legacy persisted secrets instead of loading them', () => {
    localStorage.setItem(
      'crypto-binance-api',
      JSON.stringify({ apiKey: 'persisted-key', apiSecret: 'persisted-secret' }),
    );

    expect(loadStoredApiKey()).toBe('persisted-key');
    expect(loadApiCredentials()).toBeNull();
  });
});
