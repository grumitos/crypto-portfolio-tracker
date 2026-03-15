import type { BinanceApiCredentials, PositionsMode } from '../types';
import { loadStoredPositionsMode, saveStoredPositionsMode } from './storage';

const STORAGE_KEY = 'crypto-binance-api';
const LEGACY_MODE_KEY = 'crypto-positions-mode';

// ── Positions mode (single source of truth: main app state) ──

export function loadPositionsMode(): PositionsMode {
  try {
    const stateMode = loadStoredPositionsMode();
    if (stateMode) {
      // Migrate: remove legacy key if present
      try {
        localStorage.removeItem(LEGACY_MODE_KEY);
      } catch {
        /* ignore */
      }
      return stateMode;
    }
    // Fallback: migrate from legacy key
    const raw = localStorage.getItem(LEGACY_MODE_KEY);
    const mode: PositionsMode = raw === 'auto' ? 'auto' : 'manual';
    // Persist into main state and remove legacy key
    saveStoredPositionsMode(mode);
    try {
      localStorage.removeItem(LEGACY_MODE_KEY);
    } catch {
      /* ignore */
    }
    return mode;
  } catch {
    return 'manual';
  }
}

export function savePositionsMode(mode: PositionsMode): void {
  saveStoredPositionsMode(mode);
  // Clean up legacy key if still present
  try {
    localStorage.removeItem(LEGACY_MODE_KEY);
  } catch {
    /* ignore */
  }
}

export function isAutoMode(): boolean {
  return loadPositionsMode() === 'auto';
}

// ── Credentials persistence ──

export function saveApiCredentials(creds: BinanceApiCredentials): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ apiKey: creds.apiKey, apiSecret: creds.apiSecret }),
    );
  } catch {
    // storage full or unavailable
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
      'apiSecret' in parsed &&
      typeof (parsed as BinanceApiCredentials).apiKey === 'string' &&
      typeof (parsed as BinanceApiCredentials).apiSecret === 'string'
    ) {
      return {
        apiKey: (parsed as BinanceApiCredentials).apiKey,
        apiSecret: (parsed as BinanceApiCredentials).apiSecret,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearApiCredentials(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasApiCredentials(): boolean {
  return loadApiCredentials() !== null;
}
