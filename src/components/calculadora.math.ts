import type { CycleResults, PriceUnit, Purchase, PurchaseTotals } from '../types';
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
      totalQty += qty;
      // El importe si se redondea a centavos, que es dinero; el precio unitario
      // no, o un activo de $0.004 quedaria en cero.
      totalUsd += roundTo(qty * priceRaw, 2);
      validCount++;
    }
  }

  totalUsd = roundTo(totalUsd, 2);
  const avgPrice = totalQty > 0 ? totalUsd / totalQty : NaN;
  return { totalQty, totalUsd, avgPrice, validCount };
}

export function computeFeeMultiplier(makerPct: number, sides = 2): number {
  const maker = Number.isFinite(makerPct) ? makerPct / 100 : 0;
  return Math.pow(1 - maker, sides);
}

/**
 * Resuelve el precio de venta desde su unidad de captura.
 *
 * Sin redondear: el ciclo vive en el cociente venta/recompra, y medio centavo
 * ahi puede ser un cuarto del margen. Vendiendo a $2 y recomprando un 1.70%
 * abajo, cuadrar C=1.966 a 1.97 hundia el APR de 284% a 247%; a $0.004 el
 * redondeo lo mandaba a cero y la pantalla entera moria. El redondeo es cosa
 * del formato de salida, no del modelo.
 */
export function resolveSellPrice(value: number, unit: PriceUnit, basePrice: number): number {
  if (!Number.isFinite(value)) return NaN;
  if (unit === 'usd') return value > 0 ? value : NaN;
  if (!Number.isFinite(basePrice) || basePrice <= 0) return NaN;
  const price = basePrice * (1 + value / 100);
  return price > 0 ? price : NaN;
}

/** Resuelve el precio de recompra; el % siempre cuelga del precio de venta real. */
export function resolveRebuyPrice(value: number, unit: PriceUnit, sellPrice: number): number {
  if (!Number.isFinite(value)) return NaN;
  if (unit === 'usd') return value > 0 ? value : NaN;
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) return NaN;
  const price = sellPrice * (1 - value / 100);
  return price > 0 ? price : NaN;
}

export interface CycleInput {
  basePrice: number;
  capital: number;
  trades: number;
  makerFeePct: number;
  sellValue: number;
  sellUnit: PriceUnit;
  rebuyValue: number;
  rebuyUnit: PriceUnit;
}

/**
 * Calcula la cadena completa base -> venta -> recompra.
 *
 * Vender la bolsa a B y recomprarla a C la multiplica por (B/C) menos las dos
 * comisiones: ese es el rendimiento que se repite cada ciclo y el que alimenta
 * el APR. El resultado de la venta contra el costo de entrada (B/A) se informa
 * aparte porque solo ocurre una vez: tras recomprar, la base ya es otra.
 */
export function computeCycle(input: CycleInput): CycleResults {
  const { basePrice, capital, trades, makerFeePct } = input;

  const feeMultiplier = computeFeeMultiplier(makerFeePct, 2);

  const baseValid = Number.isFinite(basePrice) && basePrice > 0;
  const capitalValid = Number.isFinite(capital) && capital > 0;

  const sellPrice = resolveSellPrice(input.sellValue, input.sellUnit, basePrice);
  const rebuyPrice = resolveRebuyPrice(input.rebuyValue, input.rebuyUnit, sellPrice);

  const sellValid = Number.isFinite(sellPrice) && sellPrice > 0;
  const rebuyValid = Number.isFinite(rebuyPrice) && rebuyPrice > 0;

  const sellRatio = baseValid && sellValid ? sellPrice / basePrice : NaN;
  const sellMovePct = Number.isFinite(sellRatio) ? (sellRatio - 1) * 100 : NaN;
  const rebuyDipPct = sellValid && rebuyValid ? (1 - rebuyPrice / sellPrice) * 100 : NaN;

  const saleNetUsd =
    Number.isFinite(sellRatio) && capitalValid ? capital * (sellRatio * feeMultiplier - 1) : NaN;

  const cycleRatio = sellValid && rebuyValid ? sellPrice / rebuyPrice : NaN;
  const cycleNetPct = Number.isFinite(cycleRatio) ? (cycleRatio * feeMultiplier - 1) * 100 : NaN;
  // Lo que crece es la bolsa, y la bolsa vale lo que se vende: capital*(B/A).
  // Valorarla sobre el capital de coste inflaria el neto de una venta hundida
  // (vender a 2 lo que costo 2495 mueve centavos, no cientos de dolares) y lo
  // dejaria descuadrado frente al fee, que si se cobra sobre lo negociado.
  const cycleNetUsd =
    Number.isFinite(cycleNetPct) && Number.isFinite(sellRatio) && capitalValid
      ? (capital * sellRatio * cycleNetPct) / 100
      : NaN;

  const apr =
    Number.isFinite(cycleNetPct) && Number.isFinite(trades) && trades > 0
      ? cycleNetPct * trades
      : NaN;

  // Se cobra sobre el importe vendido y sobre lo que queda para recomprar.
  const feeUsd =
    Number.isFinite(sellRatio) && capitalValid ? capital * sellRatio * (1 - feeMultiplier) : NaN;

  return {
    sellPrice,
    rebuyPrice,
    sellMovePct,
    rebuyDipPct,
    saleNetUsd,
    cycleNetPct,
    cycleNetUsd,
    apr,
    feeUsd,
  };
}
