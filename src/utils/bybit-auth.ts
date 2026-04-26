import type { BybitApiCredentials } from '../types';

const STORAGE_KEY = 'crypto-bybit-api';
let bybitApiSecretSessionValue: string | null = null;

interface StoredBybitApiCredentials {
  apiKey: string;
}

export function saveBybitApiCredentials(creds: BybitApiCredentials): void {
  bybitApiSecretSessionValue = creds.apiSecret;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey: creds.apiKey }));
  } catch {
    // storage full or unavailable
  }
}

export function loadStoredBybitApiKey(): string {
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

export function loadBybitApiCredentials(): BybitApiCredentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'apiKey' in parsed &&
      typeof (parsed as StoredBybitApiCredentials).apiKey === 'string'
    ) {
      const stored = parsed as StoredBybitApiCredentials;
      if (!bybitApiSecretSessionValue) return null;
      return {
        apiKey: stored.apiKey,
        apiSecret: bybitApiSecretSessionValue,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearBybitApiCredentials(): void {
  bybitApiSecretSessionValue = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasBybitApiCredentials(): boolean {
  return loadBybitApiCredentials() !== null;
}
