import type { DualPosition } from '../types';
import {
  BINANCE_DUAL_SETTLEMENT_HOUR_UTC,
  parseBinanceDualSettlementUTC,
  parseISODateLocal,
} from './date';

const DAY_MS = 24 * 60 * 60 * 1000;
const YIELD_TRUNC_SCALE = 10000;
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normalizeTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const clean = value.trim();
  return HHMM_PATTERN.test(clean) ? clean : undefined;
}

function parseLocalDateTime(dateIso: string, time: string): Date | null {
  const date = parseISODateLocal(dateIso);
  const parsedTime = normalizeTime(time);
  if (!date || !parsedTime) return null;
  const [hours, minutes] = parsedTime.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
}

export function resolveDualEntryAt(
  position: Pick<DualPosition, 'entryDate' | 'entryTime'>,
): Date | null {
  const explicitTime = normalizeTime(position.entryTime);
  if (explicitTime) {
    return parseLocalDateTime(position.entryDate, explicitTime);
  }
  return parseISODateLocal(position.entryDate);
}

export function resolveDualSettlementAt(
  position: Pick<DualPosition, 'settlementDate' | 'settlementTime'>,
): Date | null {
  const explicitTime = normalizeTime(position.settlementTime);
  if (explicitTime) {
    return parseLocalDateTime(position.settlementDate, explicitTime);
  }
  return parseBinanceDualSettlementUTC(position.settlementDate);
}

function dayIndexAtCutoff(date: Date): number {
  const cutoffOffsetMs = BINANCE_DUAL_SETTLEMENT_HOUR_UTC * 60 * 60 * 1000;
  return Math.floor((date.getTime() - cutoffOffsetMs) / DAY_MS);
}

export function calculateDualBilledDays(subscriptionAt: Date, settlementAt: Date): number {
  const subDay = dayIndexAtCutoff(subscriptionAt);
  const setDay = dayIndexAtCutoff(settlementAt);
  return Math.max(1, setDay - subDay);
}

export function calculateDualProjectedBilledDays(
  position: Pick<DualPosition, 'entryDate' | 'entryTime' | 'settlementDate' | 'settlementTime'>,
): number {
  const subscriptionAt = resolveDualEntryAt(position);
  const settlementAt = resolveDualSettlementAt(position);
  if (!subscriptionAt || !settlementAt) return 0;
  return calculateDualBilledDays(subscriptionAt, settlementAt);
}

export function calculateDualElapsedBilledDays(
  position: Pick<DualPosition, 'entryDate' | 'entryTime' | 'settlementDate' | 'settlementTime'>,
  now: Date = new Date(),
): number {
  const subscriptionAt = resolveDualEntryAt(position);
  const settlementAt = resolveDualSettlementAt(position);
  if (!subscriptionAt || !settlementAt) return 0;
  if (now.getTime() <= subscriptionAt.getTime()) return 0;

  const projectedDays = calculateDualBilledDays(subscriptionAt, settlementAt);
  const upperBound = now.getTime() < settlementAt.getTime() ? now : settlementAt;
  const elapsed = dayIndexAtCutoff(upperBound) - dayIndexAtCutoff(subscriptionAt);
  return Math.max(0, Math.min(projectedDays, elapsed));
}

export function calculateDualYield(aprPercentage: number, billedDays: number): number {
  const rawYield = (aprPercentage / 100) * (billedDays / 365);
  return Math.floor(rawYield * YIELD_TRUNC_SCALE) / YIELD_TRUNC_SCALE;
}

export function calculateDualProfitFromBilledDays(
  amount: number,
  aprPercentage: number,
  billedDays: number,
): number {
  return amount * calculateDualYield(aprPercentage, billedDays);
}

export function calculateDualProjectedProfit(
  position: Pick<
    DualPosition,
    | 'amount'
    | 'apr'
    | 'entryDate'
    | 'entryTime'
    | 'settlementDate'
    | 'settlementTime'
    | 'projectedProfit'
  >,
): number {
  if (Number.isFinite(position.projectedProfit)) {
    return position.projectedProfit as number;
  }
  const billedDays = calculateDualProjectedBilledDays(position);
  return calculateDualProfitFromBilledDays(position.amount, position.apr, billedDays);
}

export function isDualSettlementReached(
  position: Pick<DualPosition, 'settlementDate' | 'settlementTime'>,
  now: Date = new Date(),
): boolean {
  const settlementAt = resolveDualSettlementAt(position);
  if (!settlementAt) return false;
  return now.getTime() >= settlementAt.getTime();
}
