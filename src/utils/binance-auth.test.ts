import { beforeEach, describe, expect, it } from 'vitest';
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

  it('persists only the API key and keeps the secret in session memory', () => {
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });

    expect(localStorage.getItem('crypto-binance-api')).toBe(JSON.stringify({ apiKey: 'key' }));
    expect(loadStoredApiKey()).toBe('key');
    expect(loadApiCredentials()).toEqual({ apiKey: 'key', apiSecret: 'secret' });
  });

  it('migrates legacy stored secrets out of localStorage when loaded', () => {
    localStorage.setItem(
      'crypto-binance-api',
      JSON.stringify({ apiKey: 'legacy-key', apiSecret: 'legacy-secret' }),
    );

    expect(loadApiCredentials()).toEqual({
      apiKey: 'legacy-key',
      apiSecret: 'legacy-secret',
    });
    expect(localStorage.getItem('crypto-binance-api')).toBe(
      JSON.stringify({ apiKey: 'legacy-key' }),
    );
  });
});
