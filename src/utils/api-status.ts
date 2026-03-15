import { API_LAST_UPDATED_KEY } from './storage';
import { MARKET_POLL_INTERVAL_MS, ONE_SECOND_MS } from './constants';
import { getNextMarketPollAt } from './market-poller';

const API_LAST_UPDATED_ELEMENT_ID = 'app-last-update';
const API_STATUS_REFRESH_MS = ONE_SECOND_MS;

let cachedLastUpdatedAt: number | null | undefined;
let hasApiFailure = false;
let statusTicker: ReturnType<typeof setInterval> | null = null;
let fallbackNextPollAt: number | null = null;

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readStoredTimestamp(): number | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return normalizeTimestamp(localStorage.getItem(API_LAST_UPDATED_KEY));
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[api-status] failed to read timestamp from storage', err);
    }
    return null;
  }
}

function writeStoredTimestamp(value: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(API_LAST_UPDATED_KEY, String(value));
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[api-status] failed to write timestamp to storage', err);
    }
    // Ignore storage failures (private mode, quota, etc.)
  }
}

function formatRelativeElapsed(ts: number): string {
  const diffMs = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `hace ${seconds} segundo${seconds === 1 ? '' : 's'}`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} minuto${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} hora${hours === 1 ? '' : 's'}`;

  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

function resolveNextPollAt(): number | null {
  const scheduledByPoller = getNextMarketPollAt();
  if (scheduledByPoller) {
    fallbackNextPollAt = scheduledByPoller;
    return scheduledByPoller;
  }

  if (fallbackNextPollAt && fallbackNextPollAt > Date.now()) {
    return fallbackNextPollAt;
  }

  return fallbackNextPollAt;
}

function ensureFallbackNextPollAt(): void {
  const scheduledByPoller = getNextMarketPollAt();
  if (scheduledByPoller) {
    fallbackNextPollAt = scheduledByPoller;
    return;
  }

  if (!fallbackNextPollAt || fallbackNextPollAt <= Date.now()) {
    fallbackNextPollAt = Date.now() + MARKET_POLL_INTERVAL_MS;
  }
}

function formatCountdownLabel(nextPollAt: number | null, prefix: string): string {
  if (!nextPollAt) return `${prefix} pendiente`;
  const remainingMs = nextPollAt - Date.now();
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${prefix} en ${remainingSeconds}s`;
}

function resolveHeaderLabel(ts: number | null): string {
  const nextPollAt = resolveNextPollAt();

  if (!ts) {
    if (hasApiFailure) {
      return `Actualización: sin conexión · ${formatCountdownLabel(nextPollAt, 'reintento')}`;
    }
    return 'Actualizado: pendiente';
  }

  const relative = formatRelativeElapsed(ts);
  if (hasApiFailure) {
    return `Actualización: error · último dato ${relative} · ${formatCountdownLabel(nextPollAt, 'reintento')}`;
  }
  return formatCountdownLabel(nextPollAt, 'próxima actualización');
}

function updateHeaderLabel(): void {
  if (typeof document === 'undefined') return;
  const target = document.getElementById(API_LAST_UPDATED_ELEMENT_ID);
  if (!target) return;
  target.textContent = resolveHeaderLabel(getLastApiUpdatedAt());
  target.classList.toggle('is-error', hasApiFailure);
}

function ensureStatusTicker(): void {
  if (statusTicker) return;
  statusTicker = setInterval(() => {
    updateHeaderLabel();
  }, API_STATUS_REFRESH_MS);
}

export function getLastApiUpdatedAt(): number | null {
  if (cachedLastUpdatedAt !== undefined) {
    return cachedLastUpdatedAt;
  }
  cachedLastUpdatedAt = readStoredTimestamp();
  return cachedLastUpdatedAt;
}

export function syncApiLastUpdatedLabel(): void {
  ensureStatusTicker();
  updateHeaderLabel();
}

export function registerApiLastUpdatedAt(nextValue: number | null): void {
  const normalized = normalizeTimestamp(nextValue);
  if (!normalized) return;

  const current = getLastApiUpdatedAt();
  const latest = current ? Math.max(current, normalized) : normalized;
  cachedLastUpdatedAt = latest;
  hasApiFailure = false;
  ensureFallbackNextPollAt();
  writeStoredTimestamp(latest);
  ensureStatusTicker();
  updateHeaderLabel();
}

export function registerApiFailure(): void {
  hasApiFailure = true;
  ensureFallbackNextPollAt();
  ensureStatusTicker();
  updateHeaderLabel();
}
