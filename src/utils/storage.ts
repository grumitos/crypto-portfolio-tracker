import type {
  AppState,
  PortfolioData,
  DualPosition,
  DualPositionComponent,
  BalanceSnapshot,
  CalculadoraState,
  Purchase,
} from '../types';
import { sanitizeISODate, todayISODateLocal } from './date';
import { parseLooseNumber } from './parse-number';

export const STORAGE_KEY = 'crypto-portfolio-tracker';
export const CALC_KEY = 'crypto-calculadora';
export const SIMULATOR_VIEW_KEY = 'crypto-simulator-view';
export const DASHBOARD_VIEW_KEY = 'crypto-dashboard-view';
export const API_LAST_UPDATED_KEY = 'crypto-api-last-updated-at';
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function getDefaultPortfolio(): PortfolioData {
  const today = todayISODateLocal();
  return {
    totalInvested: 0,
    currentBalance: 0,
    savings: 0,
    goalAmount: 0,
    lastUpdated: today,
    balanceHistory: [
      { date: today, balance: 0 }
    ],
  };
}

function getDefaultPositions(): DualPosition[] {
  return [];
}

const DEFAULT_POSITION_TEMPLATE: Omit<DualPosition, 'id'> = {
  asset: 'ETH',
  direction: 'buy-low',
  subscriptionAsset: 'USDT',
  amount: 0,
  targetPrice: 0,
  entryDate: todayISODateLocal(),
  entryTime: undefined,
  settlementDate: todayISODateLocal(),
  settlementTime: undefined,
  apr: 0,
};

function getDefaultState(): AppState {
  return {
    portfolio: getDefaultPortfolio(),
    positions: getDefaultPositions(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeNumber(value: unknown, fallback: number): number {
  const parsed = parseLooseNumber(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeNonNegative(value: unknown, fallback: number): number {
  return Math.max(0, sanitizeNumber(value, fallback));
}

function sanitizePositive(value: unknown, fallback: number): number {
  const sanitized = sanitizeNumber(value, fallback);
  return sanitized > 0 ? sanitized : fallback;
}

function sanitizeDirection(value: unknown): DualPosition['direction'] {
  return value === 'sell-high' ? 'sell-high' : 'buy-low';
}

function sanitizeSymbol(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const clean = value.toUpperCase().trim().replace(/[^A-Z0-9_-]/g, '');
  return clean || fallback;
}

function sanitizeId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim().replace(/[^\w-]/g, '');
  return clean || fallback;
}

function sanitizeDateRange(entryRaw: unknown, settlementRaw: unknown): { entryDate: string; settlementDate: string } {
  const entryDate = sanitizeISODate(entryRaw, todayISODateLocal());
  const settlementDate = sanitizeISODate(settlementRaw, entryDate);
  return settlementDate < entryDate
    ? { entryDate, settlementDate: entryDate }
    : { entryDate, settlementDate };
}

function sanitizeTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return HHMM_PATTERN.test(clean) ? clean : undefined;
}

function sanitizeBalanceHistory(rawHistory: unknown, fallbackDate: string, fallbackBalance: number): BalanceSnapshot[] {
  if (!Array.isArray(rawHistory)) {
    return [{ date: fallbackDate, balance: fallbackBalance }];
  }

  const dedup = new Map<string, number>();
  for (const item of rawHistory) {
    if (!isRecord(item)) continue;
    const date = sanitizeISODate(item.date, '');
    if (!date) continue;
    const balance = sanitizeNonNegative(item.balance, NaN);
    if (!Number.isFinite(balance)) continue;
    dedup.set(date, balance);
  }

  if (!dedup.has(fallbackDate)) {
    dedup.set(fallbackDate, fallbackBalance);
  }

  const sorted = Array.from(dedup.entries())
    .map(([date, balance]) => ({ date, balance }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Keep only the most recent 365 entries to avoid unbounded localStorage growth
  const MAX_HISTORY_ENTRIES = 365;
  return sorted.length > MAX_HISTORY_ENTRIES
    ? sorted.slice(sorted.length - MAX_HISTORY_ENTRIES)
    : sorted;
}

function sanitizePortfolio(rawPortfolio: unknown): PortfolioData {
  const defaults = getDefaultPortfolio();
  const record = isRecord(rawPortfolio) ? rawPortfolio : {};
  const totalInvested = sanitizePositive(record.totalInvested, defaults.totalInvested);
  const currentBalance = sanitizeNonNegative(record.currentBalance, defaults.currentBalance);
  // Migration: if savings is absent, fall back to currentBalance so existing data is preserved
  const savings = 'savings' in record
    ? sanitizeNonNegative(record.savings, currentBalance)
    : currentBalance;
  const goalAmount = sanitizePositive(record.goalAmount, totalInvested);
  const lastUpdated = sanitizeISODate(record.lastUpdated, defaults.lastUpdated);
  const balanceHistory = sanitizeBalanceHistory(record.balanceHistory, lastUpdated, currentBalance);

  return {
    totalInvested,
    currentBalance,
    savings,
    goalAmount,
    lastUpdated,
    balanceHistory,
  };
}

function sanitizePosition(rawPosition: unknown, index: number): DualPosition {
  const defaults = DEFAULT_POSITION_TEMPLATE;
  const record = isRecord(rawPosition) ? rawPosition : {};
  const id = sanitizeId(record.id, `position_${index + 1}`);
  const { entryDate, settlementDate } = sanitizeDateRange(record.entryDate, record.settlementDate);
  const components = sanitizePositionComponents(record.components, id);

  return {
    id,
    asset: sanitizeSymbol(record.asset, defaults.asset),
    direction: sanitizeDirection(record.direction),
    subscriptionAsset: sanitizeSymbol(record.subscriptionAsset, defaults.subscriptionAsset),
    amount: sanitizeNonNegative(record.amount, defaults.amount),
    targetPrice: sanitizeNonNegative(record.targetPrice, defaults.targetPrice),
    entryDate,
    entryTime: sanitizeTime(record.entryTime),
    settlementDate,
    settlementTime: sanitizeTime(record.settlementTime),
    apr: sanitizeNonNegative(record.apr, defaults.apr),
    ...(components.length > 1 ? { components } : {}),
  };
}

function sanitizePositionComponents(rawComponents: unknown, parentId: string): DualPositionComponent[] {
  if (!Array.isArray(rawComponents)) return [];

  const components: DualPositionComponent[] = [];
  rawComponents.forEach((item, index) => {
    const record = isRecord(item) ? item : {};
    const componentId = sanitizeId(record.id, `${parentId}_component_${index + 1}`);
    const { entryDate, settlementDate } = sanitizeDateRange(record.entryDate, record.settlementDate);
    const amount = sanitizeNonNegative(record.amount, NaN);
    const apr = sanitizeNonNegative(record.apr, NaN);
    const targetPrice = sanitizeNonNegative(record.targetPrice, 0);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!Number.isFinite(apr) || apr < 0) return;

    components.push({
      id: componentId,
      amount,
      targetPrice,
      entryDate,
      entryTime: sanitizeTime(record.entryTime),
      settlementDate,
      settlementTime: sanitizeTime(record.settlementTime),
      apr,
    });
  });

  return components;
}

function sanitizePositions(rawPositions: unknown): DualPosition[] {
  if (!Array.isArray(rawPositions)) return [];
  return rawPositions.map((position, index) => sanitizePosition(position, index));
}

function sanitizeAppState(raw: Partial<AppState> | null | undefined): AppState {
  const state = isRecord(raw) ? raw : {};
  return {
    portfolio: sanitizePortfolio(state.portfolio),
    positions: sanitizePositions(state.positions),
  };
}

function isLegacyAppBackupPayload(raw: Record<string, unknown>): boolean {
  const hasPortfolio = Object.prototype.hasOwnProperty.call(raw, 'portfolio');
  const hasPositions = Object.prototype.hasOwnProperty.call(raw, 'positions');
  if (!hasPortfolio && !hasPositions) return false;
  if (hasPortfolio && !isRecord(raw.portfolio)) return false;
  if (hasPositions && !Array.isArray(raw.positions)) return false;
  return true;
}

function inferSellSyncSource(
  sellPrice: string,
  sellPct: string,
): 'price' | 'percent' | null {
  const parsedSellPrice = parseLooseNumber(sellPrice);
  if (Number.isFinite(parsedSellPrice)) return 'price';
  const parsedSellPct = parseLooseNumber(sellPct);
  if (Number.isFinite(parsedSellPct)) return 'percent';
  return null;
}

function sanitizePurchases(rawPurchases: unknown): Purchase[] {
  if (!Array.isArray(rawPurchases)) return [];
  return rawPurchases.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const rawId = typeof record.id === 'number' ? record.id : Number(record.id);
    const safeId = Number.isFinite(rawId) && rawId > 0 ? Math.floor(rawId) : index + 1;
    return {
      id: safeId,
      qty: sanitizeNumericText(record.qty, ''),
      price: sanitizeNumericText(record.price, ''),
    };
  });
}

function sanitizeNumericText(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  const clean = String(value)
    .replace(/[^\d.,+-]/g, '')
    .replace(/,/g, '')
    .trim();
  return clean || fallback;
}

function sanitizeCalcState(raw: Partial<CalculadoraState> | null | undefined): CalculadoraState {
  const defaults = getDefaultCalcState();
  const merged = { ...defaults, ...(raw ?? {}) };
  const feePreset = merged.feePreset === 'futures' ? 'futures' : 'spot';
  const fdusdEnabled = feePreset === 'spot' && merged.fdusdEnabled === true;

  const sellSyncSource = merged.sellSyncSource === 'price' || merged.sellSyncSource === 'percent'
    ? merged.sellSyncSource
    : inferSellSyncSource(
      sanitizeNumericText(merged.sellPrice, defaults.sellPrice),
      sanitizeNumericText(merged.sellPct, defaults.sellPct),
    );

  return {
    price: sanitizeNumericText(merged.price, defaults.price),
    capital: sanitizeNumericText(merged.capital, defaults.capital),
    trades: sanitizeNumericText(merged.trades, defaults.trades),
    sellPrice: sanitizeNumericText(merged.sellPrice, defaults.sellPrice),
    sellPct: sanitizeNumericText(merged.sellPct, defaults.sellPct),
    rebuyPct: sanitizeNumericText(merged.rebuyPct, defaults.rebuyPct),
    feePreset,
    fdusdEnabled,
    sellSyncSource,
    purchases: sanitizePurchases(merged.purchases),
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return sanitizeAppState(parsed);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[storage] failed to load app state', err);
    }
    return getDefaultState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[storage] failed to save app state', err);
    }
  }
}

// ── Portfolio updates ──

export function updatePortfolio(updates: Partial<PortfolioData>): AppState {
  const state = loadState();
  state.portfolio = sanitizePortfolio({ ...state.portfolio, ...updates });
  saveState(state);
  return state;
}

export function updateBalance(balance: number): AppState {
  const state = loadState();
  const today = todayISODateLocal();
  state.portfolio.currentBalance = balance;
  state.portfolio.lastUpdated = today;

  const history = state.portfolio.balanceHistory;
  const todayIndex = history.findIndex((s: BalanceSnapshot) => s.date === today);
  if (todayIndex >= 0) {
    history[todayIndex].balance = balance;
  } else {
    history.push({ date: today, balance });
  }

  saveState(state);
  return state;
}

// ── Position CRUD ──

export function addPosition(position: DualPosition): AppState {
  const state = loadState();
  state.positions.push(sanitizePosition(position, state.positions.length));
  saveState(state);
  return state;
}

export function replacePositions(positions: DualPosition[]): AppState {
  const state = loadState();
  state.positions = sanitizePositions(positions);
  saveState(state);
  return state;
}

export function updatePosition(id: string, updates: Partial<DualPosition>): AppState {
  const state = loadState();
  const idx = state.positions.findIndex((p: DualPosition) => p.id === id);
  if (idx >= 0) {
    state.positions[idx] = sanitizePosition({ ...state.positions[idx], ...updates }, idx);
  }
  saveState(state);
  return state;
}

export function deletePosition(id: string): AppState {
  const state = loadState();
  state.positions = state.positions.filter((p: DualPosition) => p.id !== id);
  saveState(state);
  return state;
}

// ── Backup ──

export function exportBackup(): string {
  return JSON.stringify({
    version: 2,
    exportedAt: new Date().toISOString(),
    app: loadState(),
    calculadora: loadCalcState(),
  }, null, 2);
}

const CURRENT_BACKUP_VERSION = 2;

export function importBackup(json: string): AppState {
  const parsed = JSON.parse(json) as unknown;

  if (isRecord(parsed) && isRecord(parsed.app)) {
    const version = typeof parsed.version === 'number' ? parsed.version : 1;
    if (version > CURRENT_BACKUP_VERSION) {
      throw new Error(
        `Versión de backup no soportada (v${version}). Actualiza la app para importar este archivo.`,
      );
    }

    const appState = sanitizeAppState(parsed.app as Partial<AppState>);
    saveState(appState);

    if (isRecord(parsed.calculadora)) {
      saveCalcState(sanitizeCalcState(parsed.calculadora as Partial<CalculadoraState>));
    }

    return appState;
  }

  if (isRecord(parsed) && isLegacyAppBackupPayload(parsed)) {
    const legacyState = sanitizeAppState(parsed as Partial<AppState>);
    saveState(legacyState);
    return legacyState;
  }

  throw new Error('Formato de backup no valido');
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Calculadora State (separate key) ──

export function getDefaultCalcState(): CalculadoraState {
  return {
    price: '',
    capital: '20000',
    trades: '200',
    sellPrice: '',
    sellPct: '0.98',
    rebuyPct: '0.85',
    feePreset: 'spot',
    fdusdEnabled: false,
    sellSyncSource: null,
    purchases: [],
  };
}

export function loadCalcState(): CalculadoraState {
  try {
    const raw = localStorage.getItem(CALC_KEY);
    if (!raw) return sanitizeCalcState(getDefaultCalcState());
    const parsed = JSON.parse(raw) as Partial<CalculadoraState>;
    return sanitizeCalcState(parsed);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[storage] failed to load calculadora state', err);
    }
    return sanitizeCalcState(getDefaultCalcState());
  }
}

export function saveCalcState(state: CalculadoraState): void {
  try {
    localStorage.setItem(CALC_KEY, JSON.stringify(state));
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[storage] failed to save calculadora state', err);
    }
  }
}
