import type {
  CapitalLedgerPortfolioContribution,
  CapitalLedgerState,
  CapitalLedgerSummary,
  CapitalLedgerSyncSnapshot,
  CapitalLedgerTransaction,
  CapitalLedgerTransactionType,
  CapitalLedgerVault,
  CapitalLedgerVaultUser,
} from '../types';

const MS_PER_DAY = 86_400_000;
const YEAR_DAYS = 365;
const EPSILON = 0.00000001;
const LEGACY_TIMEZONE_OFFSET_MINUTES = -5 * 60;

export interface CapitalLedgerSummaryOptions {
  now?: Date;
  useValuationDate?: boolean;
  pnlSourceOfTruth?: boolean;
}

export interface CapitalLedgerPositionMetrics {
  activeCapital: number;
  activePnl: number;
  activeValue: number;
  activeDays: number;
  capitalDays: number;
  activeApr: number | null;
}

interface CapitalLedgerValuation {
  activeValue: number;
  activeValueAt: Date;
  pnlTotal: number;
}

interface CalculatedTransaction {
  valid: boolean;
  at?: Date;
  amount?: number;
  type?: CapitalLedgerTransactionType;
  cashflow?: number;
  index?: number;
}

interface ActiveLedgerPosition {
  hasTransactions: boolean;
  activeCapital: number;
  capitalDays: number;
}

type CapitalLedgerSummaryInput = Partial<
  Pick<CapitalLedgerState, 'vault' | 'lastSync' | 'transactions'>
>;

export function parseCapitalLedgerDate(value: unknown): Date | null {
  const raw = String(value ?? '').trim();
  let match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:-\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  let year: number;
  let month: number;
  let day: number;
  let hour: number;
  let minute: number;
  let second: number;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const isoDate = new Date(raw);
    return Number.isNaN(isoDate.getTime()) ? null : isoDate;
  }

  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    hour = Number(match[4]);
    minute = Number(match[5]);
    second = Number(match[6] || 0);
  } else {
    match = raw.match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*(?:-\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
    );
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    hour = Number(match[4]);
    minute = Number(match[5]);
    second = Number(match[6] || 0);
  }

  return legacyDateFromParts(year, month, day, hour, minute, second);
}

function legacyDateFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date | null {
  const utcTime =
    Date.UTC(year, month - 1, day, hour, minute, second) - LEGACY_TIMEZONE_OFFSET_MINUTES * 60_000;
  const date = new Date(utcTime);
  const localParts = new Date(date.getTime() + LEGACY_TIMEZONE_OFFSET_MINUTES * 60_000);

  if (
    localParts.getUTCFullYear() !== year ||
    localParts.getUTCMonth() !== month - 1 ||
    localParts.getUTCDate() !== day ||
    localParts.getUTCHours() !== hour ||
    localParts.getUTCMinutes() !== minute ||
    localParts.getUTCSeconds() !== second
  ) {
    return null;
  }

  return date;
}

export function parseCapitalLedgerAmount(value: unknown): number {
  let normalized = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/\$/g, '')
    .replace(/USDC/gi, '');
  if (normalized === '') return NaN;

  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    normalized = normalizeCommaAmount(normalized);
  } else if ((normalized.match(/\./g) || []).length > 1) {
    normalized = normalized.replace(/\./g, '');
  }

  return Number(normalized);
}

function normalizeCommaAmount(value: string): string {
  const parts = value.split(',');
  let sign = '';

  if (parts[0]?.charAt(0) === '-' || parts[0]?.charAt(0) === '+') {
    sign = parts[0].charAt(0);
    parts[0] = parts[0].slice(1);
  }

  if (parts.length === 2) {
    const fraction = parts[1] ?? '';
    if (fraction.length === 3 && parts[0] !== '0') {
      return sign + parts[0] + fraction;
    }
    return `${sign}${parts[0]}.${fraction}`;
  }

  const last = parts[parts.length - 1] ?? '';
  const head = parts.slice(0, -1).join('');
  if (last.length === 3) {
    return sign + head + last;
  }
  return `${sign}${head}.${last}`;
}

export function calculateCapitalLedgerTransaction(
  row: Partial<CapitalLedgerTransaction> | null | undefined,
): CalculatedTransaction {
  const at = parseCapitalLedgerDate(row?.at);
  const amount = parseCapitalLedgerAmount(row?.amount);
  const type: CapitalLedgerTransactionType = row?.type === 'withdrawal' ? 'withdrawal' : 'deposit';

  if (!at || !Number.isFinite(amount) || amount <= 0) {
    return { valid: false };
  }

  return {
    valid: true,
    at,
    amount,
    type,
    cashflow: type === 'deposit' ? -amount : amount,
  };
}

function getValuation(
  data: CapitalLedgerSummaryInput,
  options: CapitalLedgerSummaryOptions | undefined,
  totals: Pick<CapitalLedgerSummary, 'totalDeposited' | 'totalWithdrawn'>,
): CapitalLedgerValuation {
  const now = options?.now ?? new Date();
  const useValuationDate = options?.useValuationDate !== false;
  const pnlSourceOfTruth = Boolean(options?.pnlSourceOfTruth);
  const vault: Partial<CapitalLedgerState['vault']> = data.vault ?? {};
  let pnlTotal = parseCapitalLedgerAmount(vault.pnlTotal);
  let activeValue = parseCapitalLedgerAmount(vault.activeValue);
  const activeValueAt = useValuationDate
    ? (parseCapitalLedgerDate(vault.activeValueAt) ?? now)
    : now;

  if (pnlSourceOfTruth && Number.isFinite(pnlTotal)) {
    activeValue = totals.totalDeposited - totals.totalWithdrawn + pnlTotal;
    if (Number.isFinite(activeValue) && activeValue < 0) {
      activeValue = 0;
      pnlTotal = totals.totalWithdrawn - totals.totalDeposited;
    }
  } else {
    activeValue = Number.isFinite(activeValue) && activeValue > 0 ? activeValue : 0;
    pnlTotal = activeValue + totals.totalWithdrawn - totals.totalDeposited;
  }

  return {
    activeValue: Number.isFinite(activeValue) ? activeValue : 0,
    activeValueAt,
    pnlTotal: Number.isFinite(pnlTotal) ? pnlTotal : 0,
  };
}

function getActiveVaultMetrics(
  data: CapitalLedgerSummaryInput,
  valuationDate: Date,
): Pick<CapitalLedgerPositionMetrics, 'activeCapital' | 'activePnl' | 'activeValue'> | null {
  const snapshot = data.lastSync && typeof data.lastSync === 'object' ? data.lastSync : null;
  const vaults = snapshot && Array.isArray(snapshot.vaults) ? snapshot.vaults : [];
  let activeCapital = 0;
  let activePnl = 0;
  let activeValue = 0;
  let validVaults = 0;

  vaults.forEach((vault) => {
    const metrics = calculateVaultUserMetrics(vault.user, valuationDate);
    if (!metrics) return;

    activeCapital += metrics.activeCapital;
    activePnl += metrics.activePnl;
    activeValue += metrics.activeValue;
    validVaults += 1;
  });

  if (validVaults === 0) return null;

  return { activeCapital, activePnl, activeValue };
}

export function calculateVaultUserMetrics(
  user: Partial<CapitalLedgerVaultUser> | null | undefined,
  valuationDate?: Date | string,
): CapitalLedgerPositionMetrics | null {
  const equity = parseCapitalLedgerAmount(user?.vaultEquity);
  const pnl = parseCapitalLedgerAmount(user?.pnl);

  if (!Number.isFinite(equity) || !Number.isFinite(pnl)) return null;

  const activeCapital = Math.max(0, equity - pnl);
  const activeDays = getActiveVaultDays(user, valuationDate);
  const capitalDays = activeCapital > 0 && activeDays > 0 ? activeCapital * activeDays : 0;

  return {
    activeCapital,
    activePnl: pnl,
    activeValue: equity,
    activeDays,
    capitalDays,
    activeApr: activeCapital > 0 && capitalDays > 0 ? (pnl / capitalDays) * YEAR_DAYS * 100 : null,
  };
}

export function calculateVaultPositionMetrics(
  user: Partial<CapitalLedgerVaultUser> | null | undefined,
  transactions: CapitalLedgerTransaction[],
  valuationDate?: Date | string,
): CapitalLedgerPositionMetrics | null {
  const equity = parseCapitalLedgerAmount(user?.vaultEquity);
  const pnl = parseCapitalLedgerAmount(user?.pnl);
  const fallback = calculateVaultUserMetrics(user, valuationDate);
  const valuation =
    valuationDate instanceof Date ? valuationDate : parseCapitalLedgerDate(valuationDate);

  if (!Number.isFinite(equity) || !valuation) {
    return fallback;
  }

  const position = calculateActiveLedgerPosition(transactions, valuation);
  if (!position.hasTransactions) return fallback;

  const snapshotCapital = Number.isFinite(pnl) ? Math.max(0, equity - pnl) : NaN;
  let activeCapital = position.activeCapital;
  const activePnl = Number.isFinite(pnl) ? pnl : equity - activeCapital;
  let capitalDays = position.capitalDays;

  if (Number.isFinite(snapshotCapital)) {
    if (position.activeCapital > EPSILON) {
      const scale = snapshotCapital / position.activeCapital;
      capitalDays *= scale;
      activeCapital = snapshotCapital;
    } else if (snapshotCapital <= EPSILON) {
      activeCapital = 0;
      capitalDays = 0;
    } else {
      return fallback;
    }
  }

  if (activeCapital <= EPSILON) {
    activeCapital = 0;
    capitalDays = 0;
  }

  const activeDays = activeCapital > 0 ? capitalDays / activeCapital : 0;

  return {
    activeCapital,
    activePnl,
    activeValue: equity,
    activeDays,
    capitalDays,
    activeApr:
      activeCapital > 0 && capitalDays > 0 ? (activePnl / capitalDays) * YEAR_DAYS * 100 : null,
  };
}

function calculateActiveLedgerPosition(
  transactions: CapitalLedgerTransaction[],
  valuation: Date,
): ActiveLedgerPosition {
  let activeCapital = 0;
  let capitalDays = 0;
  let lastDateMs: number | null = null;
  const validTransactions = (Array.isArray(transactions) ? transactions : [])
    .map((row, index): CalculatedTransaction => {
      const tx = calculateCapitalLedgerTransaction(row);
      tx.index = index;
      return tx;
    })
    .filter(
      (tx): tx is CalculatedTransaction & { at: Date; amount: number; cashflow: number } =>
        tx.valid && tx.at instanceof Date && tx.at <= valuation,
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.index ?? 0) - (b.index ?? 0));

  validTransactions.forEach((tx) => {
    const txTime = tx.at.getTime();
    if (lastDateMs !== null && txTime > lastDateMs && activeCapital > 0) {
      capitalDays += activeCapital * ((txTime - lastDateMs) / MS_PER_DAY);
    }

    if (tx.type === 'deposit') {
      activeCapital += tx.amount;
    } else if (activeCapital > EPSILON) {
      const remainingCapital = Math.max(0, activeCapital - tx.amount);
      if (remainingCapital <= EPSILON) {
        activeCapital = 0;
        capitalDays = 0;
      } else {
        const scale = remainingCapital / activeCapital;
        capitalDays *= scale;
        activeCapital = remainingCapital;
      }
    } else {
      activeCapital = 0;
      capitalDays = 0;
    }

    if (activeCapital <= EPSILON) {
      activeCapital = 0;
      capitalDays = 0;
    }

    lastDateMs = txTime;
  });

  if (lastDateMs !== null && valuation.getTime() > lastDateMs && activeCapital > 0) {
    capitalDays += activeCapital * ((valuation.getTime() - lastDateMs) / MS_PER_DAY);
  }

  return {
    hasTransactions: validTransactions.length > 0,
    activeCapital,
    capitalDays,
  };
}

function getActiveVaultDays(
  user: Partial<CapitalLedgerVaultUser> | null | undefined,
  valuationDate?: Date | string,
): number {
  const daysFollowing = Number(user?.daysFollowing);
  let entryTime = Number(user?.vaultEntryTime);
  const parsedValuationDate =
    valuationDate instanceof Date ? valuationDate : parseCapitalLedgerDate(valuationDate);
  const valuationTime = parsedValuationDate instanceof Date ? parsedValuationDate.getTime() : NaN;

  if (Number.isFinite(entryTime) && entryTime > 0 && Number.isFinite(valuationTime)) {
    if (entryTime < 1_000_000_000_000) entryTime *= 1000;
    if (entryTime < valuationTime) {
      return (valuationTime - entryTime) / MS_PER_DAY;
    }
  }

  return Number.isFinite(daysFollowing) && daysFollowing > 0 ? daysFollowing : 0;
}

function getHistoricalPnl(data: CapitalLedgerSummaryInput): number {
  const snapshot = data.lastSync && typeof data.lastSync === 'object' ? data.lastSync : null;
  const vaults = snapshot && Array.isArray(snapshot.vaults) ? snapshot.vaults : [];
  const summaryPnl = parseCapitalLedgerAmount(snapshot?.summary?.pnlTotal);
  let allTimeTotal = 0;
  let hasAllTime = false;

  vaults.forEach((vault) => {
    const value = parseCapitalLedgerAmount(vault.user?.allTimePnl);
    if (Number.isFinite(value)) {
      allTimeTotal += value;
      hasAllTime = true;
    }
  });

  if (hasAllTime) return allTimeTotal;
  if (Number.isFinite(summaryPnl)) return summaryPnl;
  return NaN;
}

export function calculateCapitalLedgerSummary(
  data: CapitalLedgerSummaryInput,
  options?: CapitalLedgerSummaryOptions,
): CapitalLedgerSummary {
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];
  let totalDeposited = 0;
  let totalWithdrawn = 0;
  let validTransactions = 0;
  let invalidTransactions = 0;
  let firstDateMs: number | null = null;
  const cashflows: Array<{ at: Date; amount: number }> = [];

  transactions.forEach((row) => {
    const tx = calculateCapitalLedgerTransaction(row);
    if (
      !tx.valid ||
      !(tx.at instanceof Date) ||
      !Number.isFinite(tx.amount) ||
      !Number.isFinite(tx.cashflow)
    ) {
      if (row.at || row.amount) invalidTransactions += 1;
      return;
    }

    validTransactions += 1;
    const txAmount = tx.amount as number;
    const txCashflow = tx.cashflow as number;
    if (tx.type === 'deposit') totalDeposited += txAmount;
    if (tx.type === 'withdrawal') totalWithdrawn += txAmount;
    if (firstDateMs === null || tx.at.getTime() < firstDateMs) {
      firstDateMs = tx.at.getTime();
    }
    cashflows.push({ at: tx.at, amount: txCashflow });
  });

  const valuation = getValuation(data, options, { totalDeposited, totalWithdrawn });
  const activeVaultMetrics = getActiveVaultMetrics(data, valuation.activeValueAt);
  const activeValue = activeVaultMetrics ? activeVaultMetrics.activeValue : valuation.activeValue;

  if (activeValue !== 0) {
    cashflows.push({ at: valuation.activeValueAt, amount: activeValue });
    const valuationTime = valuation.activeValueAt.getTime();
    if (firstDateMs === null || valuationTime < firstDateMs) firstDateMs = valuationTime;
  }

  const ledgerPnl = activeValue + totalWithdrawn - totalDeposited;
  const historicalPnl = getHistoricalPnl(data);
  const pnlTotal = Number.isFinite(historicalPnl)
    ? historicalPnl
    : activeVaultMetrics
      ? ledgerPnl
      : valuation.pnlTotal;
  const netCapital = Math.max(0, totalDeposited - totalWithdrawn);
  const elapsedDays =
    firstDateMs !== null
      ? Math.max(0, (valuation.activeValueAt.getTime() - firstDateMs) / MS_PER_DAY)
      : 0;
  const xirrRate = calculateCapitalLedgerXirr(cashflows);
  const xirrApr = xirrRate === null ? null : xirrRate * 100;

  return {
    totalDeposited,
    totalWithdrawn,
    activeValue,
    pnlTotal,
    ledgerPnl,
    netCapital,
    activeCapital: activeVaultMetrics ? activeVaultMetrics.activeCapital : null,
    activePnl: activeVaultMetrics ? activeVaultMetrics.activePnl : null,
    displayPnl: pnlTotal,
    displayCapital: netCapital,
    validTransactions,
    invalidTransactions,
    elapsedDays,
    xirrApr,
    apr: xirrApr,
  };
}

export function calculateCapitalLedgerXirr(
  cashflows: Array<{ at: Date; amount: number }>,
): number | null {
  const valid = cashflows
    .filter((flow) => flow.at instanceof Date && Number.isFinite(flow.amount) && flow.amount !== 0)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const hasPositive = valid.some((flow) => flow.amount > 0);
  const hasNegative = valid.some((flow) => flow.amount < 0);
  if (valid.length < 2 || !hasPositive || !hasNegative) return null;

  const start = valid[0].at;

  function npv(rate: number): number {
    return valid.reduce((sum, flow) => {
      const years = (flow.at.getTime() - start.getTime()) / MS_PER_DAY / YEAR_DAYS;
      return sum + flow.amount / Math.pow(1 + rate, years);
    }, 0);
  }

  let low = -0.999999;
  let high = 10;
  let lowValue = npv(low);
  let highValue = npv(high);
  let attempts = 0;

  while (lowValue * highValue > 0 && attempts < 128 && high < 1e100) {
    high = high * 2 + 1;
    highValue = npv(high);
    attempts += 1;
  }

  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) {
    return null;
  }

  for (let index = 0; index < 120; index += 1) {
    const mid = (low + high) / 2;
    const midValue = npv(mid);
    if (Math.abs(midValue) < 0.0000000001) return mid;
    if (lowValue * midValue > 0) {
      low = mid;
      lowValue = midValue;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

export function getCapitalLedgerPortfolioContribution(
  ledger: CapitalLedgerState | null | undefined,
): CapitalLedgerPortfolioContribution {
  const summary = calculateCapitalLedgerSummary(ledger ?? {}, {
    pnlSourceOfTruth: true,
    useValuationDate: true,
  });
  const investedCapital = roundCurrency(Math.max(0, summary.displayCapital));
  const pnl = Number.isFinite(summary.displayPnl) ? summary.displayPnl : 0;
  const balanceValue = roundCurrency(Math.max(0, investedCapital + pnl));
  const activeValue = roundCurrency(Math.max(0, summary.activeValue));
  const apr =
    activeValue > 0 && summary.apr !== null && Number.isFinite(summary.apr) ? summary.apr : null;
  const earningCapital = apr !== null && activeValue > 0 ? activeValue : 0;
  const dailyEarningsUsd = apr !== null ? (earningCapital * (apr / 100)) / YEAR_DAYS : 0;
  const snapshot = ledger?.lastSync;

  return {
    investedCapital,
    balanceValue,
    pnl,
    activeValue,
    earningCapital,
    apr,
    dailyEarningsUsd,
    vaultCount: snapshot?.summary.vaultCount ?? snapshot?.vaults.length ?? 0,
    movementCount: ledger?.transactions.length ?? 0,
    lastSyncAt: ledger?.hyperliquid.lastSyncAt || snapshot?.fetchedAt || '',
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function currentCapitalLedgerValuationDate(
  ledger: CapitalLedgerState,
  snapshot: CapitalLedgerSyncSnapshot | null = ledger.lastSync,
): string {
  return snapshot?.fetchedAt || ledger.hyperliquid.lastSyncAt || ledger.vault.activeValueAt || '';
}

export function vaultPositionTransactions(
  ledger: CapitalLedgerState,
  vault: Pick<CapitalLedgerVault, 'vaultAddress'>,
): CapitalLedgerTransaction[] {
  const vaults = ledger.lastSync?.vaults ?? [];
  const includeUnassigned = vaults.length === 1;
  const address = vault.vaultAddress;

  return ledger.transactions.filter((row) => {
    return row.vaultAddress === address || (includeUnassigned && !row.vaultAddress);
  });
}
