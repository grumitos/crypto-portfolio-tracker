import type { BinanceApiCredentials, PositionsMode } from '../types';
import { loadStoredPositionsMode, saveStoredPositionsMode } from './storage';

const STORAGE_KEY = 'crypto-binance-api';
const LEGACY_MODE_KEY = 'crypto-positions-mode';
const TRADING_SESSION_DURATION_MS = 15 * 60 * 1000; // 15 minutes

let tradingSessionExpiresAt: number | null = null;

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
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
      return parsed as BinanceApiCredentials;
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
  tradingSessionExpiresAt = null;
}

export function hasApiCredentials(): boolean {
  return loadApiCredentials() !== null;
}

// ── Trading PIN (Level 2) ──

export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function saveTradingPin(pin: string): Promise<void> {
  const creds = loadApiCredentials();
  if (!creds) return;
  creds.tradingPin = await hashPin(pin);
  saveApiCredentials(creds);
}

export function hasTradingPin(): boolean {
  const creds = loadApiCredentials();
  return typeof creds?.tradingPin === 'string' && creds.tradingPin.length > 0;
}

export async function verifyTradingPin(pin: string): Promise<boolean> {
  const creds = loadApiCredentials();
  if (!creds?.tradingPin) return false;
  const hashed = await hashPin(pin);
  return hashed === creds.tradingPin;
}

// ── Trading session (temporary Level 2 unlock) ──

export async function activateTradingSession(pin: string): Promise<boolean> {
  const valid = await verifyTradingPin(pin);
  if (!valid) return false;
  tradingSessionExpiresAt = Date.now() + TRADING_SESSION_DURATION_MS;
  return true;
}

export function isTradingSessionActive(): boolean {
  if (!tradingSessionExpiresAt) return false;
  if (Date.now() >= tradingSessionExpiresAt) {
    tradingSessionExpiresAt = null;
    return false;
  }
  return true;
}

export function getTradingSessionRemainingMs(): number {
  if (!tradingSessionExpiresAt) return 0;
  return Math.max(0, tradingSessionExpiresAt - Date.now());
}

export function deactivateTradingSession(): void {
  tradingSessionExpiresAt = null;
}
