import type { BinanceApiCredentials } from '../types';

const STORAGE_KEY = 'crypto-binance-api';
let apiSecretSessionValue: string | null = null;

interface StoredApiCredentials {
  apiKey: string;
}

// ── Credentials persistence ──

export function saveApiCredentials(creds: BinanceApiCredentials): void {
  apiSecretSessionValue = creds.apiSecret;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey: creds.apiKey }));
  } catch {
    // storage full or unavailable
  }
}

export function loadStoredApiKey(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'apiKey' in parsed &&
      typeof (parsed as { apiKey: unknown }).apiKey === 'string'
    ) {
      return (parsed as { apiKey: string }).apiKey;
    }
    return '';
  } catch {
    return '';
  }
}

export function loadApiCredentials(): BinanceApiCredentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'apiKey' in parsed &&
      typeof (parsed as StoredApiCredentials).apiKey === 'string'
    ) {
      const stored = parsed as StoredApiCredentials;
      if (!apiSecretSessionValue) return null;
      return {
        apiKey: stored.apiKey,
        apiSecret: apiSecretSessionValue,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearApiCredentials(): void {
  apiSecretSessionValue = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasApiCredentials(): boolean {
  return loadApiCredentials() !== null;
}
