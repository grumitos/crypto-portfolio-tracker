export function formatISODateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISODateLocal(): string {
  return formatISODateLocal(new Date());
}

function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseISODateLocal(value: string): Date | null {
  if (!isISODate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function sanitizeISODate(value: unknown, fallback: string = todayISODateLocal()): string {
  if (typeof value !== 'string') return fallback;
  const parsed = parseISODateLocal(value.trim());
  return parsed ? formatISODateLocal(parsed) : fallback;
}

export const BINANCE_DUAL_SETTLEMENT_HOUR_UTC = 8;

export function parseBinanceDualSettlementUTC(value: string): Date | null {
  if (!isISODate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, BINANCE_DUAL_SETTLEMENT_HOUR_UTC, 0, 0, 0));
}

export function isBinanceDualSettlementReached(settlementDate: string, now: Date = new Date()): boolean {
  const settlementAt = parseBinanceDualSettlementUTC(settlementDate);
  if (!settlementAt) return false;
  return now.getTime() >= settlementAt.getTime();
}
