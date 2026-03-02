import type {
  AchievedResults,
  Purchase,
  PurchaseTotals,
  StrategyResults,
} from '../types';
import { parseLooseNumber } from '../utils/parse-number';

export function parseNum(value: string): number {
  return parseLooseNumber(value);
}

export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return NaN;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function computePurchaseTotals(purchases: Purchase[]): PurchaseTotals {
  let totalQty = 0;
  let totalUsd = 0;
  let validCount = 0;

  for (const p of purchases) {
    const qty = parseNum(p.qty);
    const priceRaw = parseNum(p.price);
    if (Number.isFinite(qty) && qty > 0 && Number.isFinite(priceRaw) && priceRaw > 0) {
      const price = roundTo(priceRaw, 2);
      totalQty += qty;
      totalUsd += roundTo(qty * price, 2);
      validCount++;
    }
  }

  totalUsd = roundTo(totalUsd, 2);
  const avgPrice = totalQty > 0 ? roundTo(totalUsd / totalQty, 2) : NaN;
  return { totalQty, totalUsd, avgPrice, validCount };
}

export function computeFeeMultiplier(makerPct: number, sides = 2): number {
  const maker = Number.isFinite(makerPct) ? makerPct / 100 : 0;
  return Math.pow(1 - maker, sides);
}

export function computeAchievedResults(
  sellPriceActual: number,
  trades: number,
  capital: number,
  basePrice: number,
  makerFeePct: number,
): AchievedResults {
  const achievedR = Number.isFinite(sellPriceActual) && Number.isFinite(basePrice) && basePrice > 0
    ? sellPriceActual / basePrice - 1 : NaN;
  const achievedMovement = Number.isFinite(achievedR) ? achievedR * 100 : NaN;
  const feeMultiplier = computeFeeMultiplier(makerFeePct, 2);
  const achievedProfitPerTrade = Number.isFinite(achievedR) && Number.isFinite(capital) && capital > 0
    ? capital * ((1 + achievedR) * feeMultiplier - 1) : NaN;
  const achievedAnnualProfit = Number.isFinite(achievedProfitPerTrade) && Number.isFinite(trades) && trades > 0
    ? achievedProfitPerTrade * trades : NaN;
  const achievedApr = Number.isFinite(achievedAnnualProfit) && Number.isFinite(capital) && capital > 0
    ? (achievedAnnualProfit / capital) * 100 : NaN;

  return { achievedR, achievedMovement, achievedProfitPerTrade, achievedAnnualProfit, achievedApr };
}

export function computeStrategyResults(
  basePrice: number,
  capital: number,
  sellPct: number,
  rebuyPct: number,
  makerFeePct: number,
): StrategyResults {
  const sell = Number.isFinite(sellPct) ? sellPct / 100 : NaN;
  const rebuy = Number.isFinite(rebuyPct) ? rebuyPct / 100 : NaN;
  const feeTotalPct = Number.isFinite(makerFeePct) ? makerFeePct * 2 : NaN;
  const feeMultiplier = computeFeeMultiplier(makerFeePct, 2);

  const validBase = Number.isFinite(basePrice) && basePrice > 0;
  const sellPrice = validBase && Number.isFinite(sell) ? basePrice * (1 + sell) : NaN;
  const rebuyPrice = Number.isFinite(sellPrice) && Number.isFinite(rebuy) ? sellPrice * (1 - rebuy) : NaN;

  const netPct = Number.isFinite(sell) && Number.isFinite(feeMultiplier)
    ? ((1 + sell) * feeMultiplier - 1) * 100 : NaN;
  const netUsd = Number.isFinite(netPct) && Number.isFinite(capital) && capital > 0
    ? (capital * netPct) / 100 : NaN;

  const cycleMultiplier = Number.isFinite(rebuy) && rebuy < 1 && Number.isFinite(feeMultiplier)
    ? feeMultiplier / (1 - rebuy) : NaN;
  const netPctCycle = Number.isFinite(cycleMultiplier) ? (cycleMultiplier - 1) * 100 : NaN;
  const netUsdCycle = Number.isFinite(netPctCycle) && Number.isFinite(capital) && capital > 0
    ? (capital * netPctCycle) / 100 : NaN;

  return { sellPrice, rebuyPrice, netPct, netUsd, netPctCycle, netUsdCycle, feeTotalPct };
}
