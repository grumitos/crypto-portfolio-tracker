import type {
  AppState,
  PortfolioData,
  DualPosition,
  DualPositionComponent,
  BalanceSnapshot,
  CalculadoraState,
  Purchase,
  PositionEntryTimeSource,
  PositionSettlementTimeSource,
  CapitalLedgerDiscoveredVault,
  CapitalLedgerState,
  CapitalLedgerSyncSnapshot,
  CapitalLedgerTransaction,
  CapitalLedgerVault,
  CapitalLedgerVaultConfig,
  CapitalLedgerVaultSummary,
  CapitalLedgerVaultUser,
} from '../types';
import { sanitizeISODate, todayISODateLocal } from './date';
import { parseLooseNumber } from './parse-number';
import { showApiErrorBanner } from './notifications';

function notifyStorageError(): void {
  showApiErrorBanner(
    'No se pudieron guardar los datos. Almacenamiento local lleno o no disponible.',
  );
}

export const STORAGE_KEY = 'crypto-portfolio-tracker';
export const CALC_KEY = 'crypto-calculadora';
export const SIMULATOR_VIEW_KEY = 'crypto-simulator-view';
export const DASHBOARD_VIEW_KEY = 'crypto-dashboard-view';
export const API_LAST_UPDATED_KEY = 'crypto-api-last-updated-at';
export const DEFAULT_CALC_SELL_PCT = '2.30';
export const DEFAULT_CALC_REBUY_PCT = '1.70';
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function getDefaultPortfolio(): PortfolioData {
  const today = todayISODateLocal();
  return {
    totalInvested: 0,
    currentBalance: 0,
    goalAmount: 0,
    lastUpdated: today,
    balanceHistory: [{ date: today, balance: 0 }],
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
    capitalLedger: getDefaultCapitalLedgerState(),
  };
}

export function getDefaultCapitalLedgerState(): CapitalLedgerState {
  return {
    schemaVersion: 2,
    vault: {
      activeValue: '',
      activeValueAt: '',
      pnlTotal: '',
    },
    hyperliquid: {
      vaultAddress: '',
      userAddress: '',
      lastSyncAt: '',
    },
    lastSync: null,
    transactions: [],
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
  const clean = value
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9_-]/g, '');
  return clean || fallback;
}

function sanitizeId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim().replace(/[^\w-]/g, '');
  return clean || fallback;
}

function sanitizeDateRange(
  entryRaw: unknown,
  settlementRaw: unknown,
): { entryDate: string; settlementDate: string } {
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

function sanitizeLedgerText(value: unknown, maxLength = 240): string {
  if (value === undefined || value === null) return '';
  const clean = String(value).trim();
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

function sanitizeLedgerAddress(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(clean) ? clean : '';
}

function sanitizeLedgerUrl(value: unknown): string {
  const clean = sanitizeLedgerText(value, 500);
  if (!clean) return '';
  try {
    const url = new URL(clean);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function sanitizeLedgerDateTime(value: unknown): string {
  const clean = sanitizeLedgerText(value, 80);
  if (!clean) return '';
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? clean : parsed.toISOString();
}

function sanitizeLedgerNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeEntryTimeSource(value: unknown): PositionEntryTimeSource | undefined {
  switch (value) {
    case 'binance_purchase_time':
    case 'derived_settle_minus_duration':
    case 'derived_purchase_end_time':
    case 'derived_now':
      return value;
    default:
      return undefined;
  }
}

function sanitizeSettlementTimeSource(value: unknown): PositionSettlementTimeSource | undefined {
  return value === 'binance_settle_date_rule' ? value : undefined;
}

function sanitizePositionSource(value: unknown): DualPosition['source'] | undefined {
  return value === 'Binance' || value === 'Bybit' ? value : undefined;
}

function sanitizePositionKind(value: unknown): DualPosition['positionKind'] | undefined {
  return value === 'dual' || value === 'derivative' || value === 'discount-buy' ? value : undefined;
}

function sanitizePositionSide(value: unknown): DualPosition['side'] | undefined {
  return value === 'long' || value === 'short' ? value : undefined;
}

function sanitizeBalanceHistory(
  rawHistory: unknown,
  fallbackDate: string,
  fallbackBalance: number,
): BalanceSnapshot[] {
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
  const goalAmount = sanitizePositive(record.goalAmount, totalInvested);
  const lastUpdated = sanitizeISODate(record.lastUpdated, defaults.lastUpdated);
  const balanceHistory = sanitizeBalanceHistory(record.balanceHistory, lastUpdated, currentBalance);

  return {
    totalInvested,
    currentBalance,
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

  const position: DualPosition = {
    id,
    asset: sanitizeSymbol(record.asset, defaults.asset),
    direction: sanitizeDirection(record.direction),
    subscriptionAsset: sanitizeSymbol(record.subscriptionAsset, defaults.subscriptionAsset),
    amount: sanitizeNonNegative(record.amount, defaults.amount),
    targetPrice: sanitizeNonNegative(record.targetPrice, defaults.targetPrice),
    entryDate,
    entryTime: sanitizeTime(record.entryTime),
    entryTimeSource: sanitizeEntryTimeSource(record.entryTimeSource),
    settlementDate,
    settlementTime: sanitizeTime(record.settlementTime),
    settlementTimeSource: sanitizeSettlementTimeSource(record.settlementTimeSource),
    apr: sanitizeNonNegative(record.apr, defaults.apr),
    ...(components.length > 1 ? { components } : {}),
  };

  if (typeof record.quoteAsset === 'string') {
    const quoteAsset = sanitizeSymbol(record.quoteAsset, '');
    if (quoteAsset) position.quoteAsset = quoteAsset;
  }

  const source = sanitizePositionSource(record.source);
  if (source) position.source = source;

  const positionKind = sanitizePositionKind(record.positionKind);
  if (positionKind) position.positionKind = positionKind;

  if (typeof record.displaySymbol === 'string') {
    position.displaySymbol = sanitizeSymbol(record.displaySymbol, '');
  }

  const notionalUsd = sanitizeNonNegative(record.notionalUsd, NaN);
  if (Number.isFinite(notionalUsd)) position.notionalUsd = notionalUsd;

  const unrealizedPnlUsd = sanitizeNumber(record.unrealizedPnlUsd, NaN);
  if (Number.isFinite(unrealizedPnlUsd)) position.unrealizedPnlUsd = unrealizedPnlUsd;

  const projectedProfit = sanitizeNumber(record.projectedProfit, NaN);
  if (Number.isFinite(projectedProfit)) position.projectedProfit = projectedProfit;

  const expectedSettlementAsset = sanitizeSymbol(record.expectedSettlementAsset, '');
  if (expectedSettlementAsset) position.expectedSettlementAsset = expectedSettlementAsset;

  const expectedSettlementAmount = sanitizeNonNegative(record.expectedSettlementAmount, NaN);
  if (Number.isFinite(expectedSettlementAmount)) {
    position.expectedSettlementAmount = expectedSettlementAmount;
  }

  const side = sanitizePositionSide(record.side);
  if (side) position.side = side;

  return position;
}

function sanitizePositionComponents(
  rawComponents: unknown,
  parentId: string,
): DualPositionComponent[] {
  if (!Array.isArray(rawComponents)) return [];

  const components: DualPositionComponent[] = [];
  rawComponents.forEach((item, index) => {
    const record = isRecord(item) ? item : {};
    const componentId = sanitizeId(record.id, `${parentId}_component_${index + 1}`);
    const { entryDate, settlementDate } = sanitizeDateRange(
      record.entryDate,
      record.settlementDate,
    );
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

function sanitizeCapitalLedgerConfig(rawConfig: unknown): CapitalLedgerVaultConfig {
  const record = isRecord(rawConfig) ? rawConfig : {};
  return {
    vaultAddress: sanitizeLedgerAddress(record.vaultAddress),
    userAddress: sanitizeLedgerAddress(record.userAddress),
  };
}

function sanitizeCapitalLedgerSummary(rawSummary: unknown): CapitalLedgerVaultSummary {
  const record = isRecord(rawSummary) ? rawSummary : {};
  const vaultCount = sanitizeLedgerNullableNumber(record.vaultCount);
  const movementCount = sanitizeLedgerNullableNumber(record.movementCount);
  return {
    activeValue: sanitizeNumericText(record.activeValue, ''),
    pnlTotal: sanitizeNumericText(record.pnlTotal, ''),
    ...(vaultCount !== null ? { vaultCount } : {}),
    ...(movementCount !== null ? { movementCount } : {}),
  };
}

function sanitizeCapitalLedgerVaultUser(rawUser: unknown): CapitalLedgerVaultUser | null {
  if (!isRecord(rawUser)) return null;
  return {
    userAddress: sanitizeLedgerAddress(rawUser.userAddress),
    vaultEquity: sanitizeNumericText(rawUser.vaultEquity, ''),
    pnl: sanitizeNumericText(rawUser.pnl, ''),
    allTimePnl: sanitizeNumericText(rawUser.allTimePnl, ''),
    daysFollowing: sanitizeLedgerNullableNumber(rawUser.daysFollowing),
    vaultEntryTime: sanitizeLedgerNullableNumber(rawUser.vaultEntryTime),
    lockupUntil: sanitizeLedgerNullableNumber(rawUser.lockupUntil),
  };
}

function sanitizeCapitalLedgerVault(rawVault: unknown): CapitalLedgerVault | null {
  if (!isRecord(rawVault)) return null;
  const vaultAddress = sanitizeLedgerAddress(rawVault.vaultAddress);
  if (!vaultAddress) return null;
  return {
    vaultAddress,
    url: sanitizeLedgerUrl(rawVault.url),
    name: sanitizeLedgerText(rawVault.name, 120),
    apr: sanitizeLedgerNullableNumber(rawVault.apr),
    user: sanitizeCapitalLedgerVaultUser(rawVault.user),
    maxWithdrawable: sanitizeNumericText(rawVault.maxWithdrawable, ''),
    isClosed: rawVault.isClosed === true,
    allowDeposits: typeof rawVault.allowDeposits === 'boolean' ? rawVault.allowDeposits : null,
  };
}

function sanitizeCapitalLedgerDiscoveredVault(
  rawVault: unknown,
): CapitalLedgerDiscoveredVault | null {
  if (!isRecord(rawVault)) return null;
  const vaultAddress = sanitizeLedgerAddress(rawVault.vaultAddress);
  if (!vaultAddress) return null;
  return {
    vaultAddress,
    equity: sanitizeNumericText(rawVault.equity, ''),
    lockedUntilTimestamp: sanitizeLedgerNullableNumber(rawVault.lockedUntilTimestamp),
  };
}

function sanitizeCapitalLedgerTransaction(
  rawTransaction: unknown,
): CapitalLedgerTransaction | null {
  if (!isRecord(rawTransaction)) return null;
  const at = sanitizeLedgerText(rawTransaction.at, 80);
  const amount = sanitizeNumericText(rawTransaction.amount, '');
  if (!at && !amount) return null;
  const time = sanitizeLedgerNullableNumber(rawTransaction.time);
  return {
    id: sanitizeLedgerText(rawTransaction.id, 140),
    at,
    type: rawTransaction.type === 'withdrawal' ? 'withdrawal' : 'deposit',
    amount,
    url: sanitizeLedgerUrl(rawTransaction.url),
    vaultAddress: sanitizeLedgerAddress(rawTransaction.vaultAddress),
    hash: sanitizeLedgerText(rawTransaction.hash, 120),
    ...(time !== null ? { time } : {}),
  };
}

function sanitizeCapitalLedgerSyncSnapshot(rawSnapshot: unknown): CapitalLedgerSyncSnapshot | null {
  if (!isRecord(rawSnapshot)) return null;
  const config = sanitizeCapitalLedgerConfig(rawSnapshot.config);
  const vaults = Array.isArray(rawSnapshot.vaults)
    ? rawSnapshot.vaults
        .map(sanitizeCapitalLedgerVault)
        .filter((vault): vault is CapitalLedgerVault => Boolean(vault))
    : [];
  const movements = Array.isArray(rawSnapshot.movements)
    ? rawSnapshot.movements
        .map(sanitizeCapitalLedgerTransaction)
        .filter((movement): movement is CapitalLedgerTransaction => Boolean(movement))
    : [];
  const discoveredVaults = Array.isArray(rawSnapshot.discoveredVaults)
    ? rawSnapshot.discoveredVaults
        .map(sanitizeCapitalLedgerDiscoveredVault)
        .filter((vault): vault is CapitalLedgerDiscoveredVault => Boolean(vault))
    : [];
  const hasSnapshot =
    rawSnapshot.ok === true ||
    Boolean(rawSnapshot.fetchedAt || config.vaultAddress || config.userAddress) ||
    vaults.length > 0 ||
    movements.length > 0 ||
    discoveredVaults.length > 0;

  if (!hasSnapshot) return null;

  return {
    ok: rawSnapshot.ok !== false,
    fetchedAt: sanitizeLedgerDateTime(rawSnapshot.fetchedAt),
    config,
    summary: sanitizeCapitalLedgerSummary(rawSnapshot.summary),
    discoveredVaults,
    vaults,
    movements,
  };
}

function sanitizeCapitalLedger(rawCapitalLedger: unknown): CapitalLedgerState {
  const defaults = getDefaultCapitalLedgerState();
  const record = isRecord(rawCapitalLedger) ? rawCapitalLedger : {};
  const vault = isRecord(record.vault) ? record.vault : {};
  const hyperliquid = isRecord(record.hyperliquid) ? record.hyperliquid : {};
  const lastSync = sanitizeCapitalLedgerSyncSnapshot(record.lastSync);
  const transactions = Array.isArray(record.transactions)
    ? record.transactions
        .map(sanitizeCapitalLedgerTransaction)
        .filter((transaction): transaction is CapitalLedgerTransaction => Boolean(transaction))
    : [];

  return {
    schemaVersion: 2,
    vault: {
      activeValue: sanitizeNumericText(vault.activeValue, defaults.vault.activeValue),
      activeValueAt: sanitizeLedgerDateTime(vault.activeValueAt),
      pnlTotal: sanitizeNumericText(vault.pnlTotal, defaults.vault.pnlTotal),
    },
    hyperliquid: {
      vaultAddress: sanitizeLedgerAddress(hyperliquid.vaultAddress),
      userAddress: sanitizeLedgerAddress(hyperliquid.userAddress),
      lastSyncAt: sanitizeLedgerDateTime(hyperliquid.lastSyncAt),
    },
    lastSync,
    transactions: lastSync ? lastSync.movements : transactions,
  };
}

function isExchangePositionId(value: string): boolean {
  return value.startsWith('binance_') || value.startsWith('bybit_');
}

/** Estado escrito por versiones que separaban posiciones cargadas a mano de las sincronizadas. */
function isLegacyDualBucketState(state: Record<string, unknown>): boolean {
  return 'manualPositions' in state || 'autoPositions' in state || 'positionsConfig' in state;
}

/**
 * Las posiciones solo llegan de los exchanges conectados. Del estado antiguo se
 * conserva el bucket sincronizado y se descartan las filas cargadas a mano, que
 * ninguna sincronizacion puede volver a producir.
 */
function sanitizeSyncedPositions(state: Record<string, unknown>): DualPosition[] {
  const positions = sanitizePositions(state.positions);
  if (!isLegacyDualBucketState(state)) return positions;

  const legacyAutoPositions = sanitizePositions(state.autoPositions);
  return legacyAutoPositions.length > 0
    ? legacyAutoPositions
    : positions.filter((position) => isExchangePositionId(position.id));
}

function sanitizeAppState(raw: Partial<AppState> | null | undefined): AppState {
  const state = isRecord(raw) ? raw : {};

  return {
    portfolio: sanitizePortfolio(state.portfolio),
    positions: sanitizeSyncedPositions(state),
    capitalLedger: sanitizeCapitalLedger(state.capitalLedger),
  };
}

function inferSellSyncSource(sellPrice: string, sellPct: string): 'price' | 'percent' | null {
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

  const sellSyncSource =
    merged.sellSyncSource === 'price' || merged.sellSyncSource === 'percent'
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
    if (typeof process !== 'undefined' ? process.env.PUBLIC_APP_ENV !== 'production' : true) {
      console.warn('[storage] failed to load app state', err);
    }
    return getDefaultState();
  }
}

export function saveState(state: AppState | Partial<AppState>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeAppState(state)));
  } catch (err) {
    if (typeof process !== 'undefined' ? process.env.PUBLIC_APP_ENV !== 'production' : true) {
      console.warn('[storage] failed to save app state', err);
    }
    notifyStorageError();
  }
}

/** Guarda la lista devuelta por la sincronizacion de exchanges. */
export function replaceSyncedPositions(positions: DualPosition[]): AppState {
  const state = loadState();
  state.positions = sanitizePositions(positions);
  saveState(state);
  return state;
}

export function saveCapitalLedgerState(capitalLedger: CapitalLedgerState): AppState {
  const state = loadState();
  state.capitalLedger = sanitizeCapitalLedger(capitalLedger);
  saveState(state);
  return state;
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

// ── Calculadora State (separate key) ──

export function getDefaultCalcState(): CalculadoraState {
  return {
    price: '',
    capital: '20000',
    trades: '200',
    sellPrice: '',
    sellPct: DEFAULT_CALC_SELL_PCT,
    rebuyPct: DEFAULT_CALC_REBUY_PCT,
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
    if (typeof process !== 'undefined' ? process.env.PUBLIC_APP_ENV !== 'production' : true) {
      console.warn('[storage] failed to load calculadora state', err);
    }
    return sanitizeCalcState(getDefaultCalcState());
  }
}

export function saveCalcState(state: CalculadoraState): void {
  try {
    localStorage.setItem(CALC_KEY, JSON.stringify(state));
  } catch (err) {
    if (typeof process !== 'undefined' ? process.env.PUBLIC_APP_ENV !== 'production' : true) {
      console.warn('[storage] failed to save calculadora state', err);
    }
    notifyStorageError();
  }
}

// ── Cross-tab sync ──

type StorageChangeListener = () => void;

const storageChangeListeners: StorageChangeListener[] = [];

/**
 * Subscribe to cross-tab storage changes. The callback is invoked when another
 * tab writes to the app's main storage key.
 */
export function onStorageChange(listener: StorageChangeListener): () => void {
  storageChangeListeners.push(listener);
  return () => {
    const idx = storageChangeListeners.indexOf(listener);
    if (idx >= 0) storageChangeListeners.splice(idx, 1);
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === CALC_KEY) {
      storageChangeListeners.forEach((fn) => {
        try {
          fn();
        } catch {
          /* subscriber error */
        }
      });
    }
  });
}
