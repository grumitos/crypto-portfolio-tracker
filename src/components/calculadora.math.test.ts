import { describe, expect, it } from '#test';
import {
  computeCycle,
  computeFeeMultiplier,
  computePurchaseTotals,
  parseNum,
  resolveRebuyPrice,
  resolveSellPrice,
  roundTo,
} from './calculadora.math';

const NO_FEE = {
  basePrice: 100,
  capital: 1000,
  trades: 10,
  makerFeePct: 0,
  sellValue: 110,
  sellUnit: 'usd',
  rebuyValue: 5,
  rebuyUnit: 'pct',
} as const;

describe('calculadora math helpers', () => {
  it('parses noisy numeric strings', () => {
    expect(parseNum(' $ 1,234.56abc ')).toBeCloseTo(1234.56, 8);
    expect(parseNum('-10.5%')).toBeCloseTo(-10.5, 8);
  });

  it('rounds numbers deterministically', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(123.4567, 3)).toBe(123.457);
  });

  it('computes fee multiplier by number of sides', () => {
    const expectedDefault = Math.pow(1 - 0.075 / 100, 2);
    expect(computeFeeMultiplier(0.075)).toBeCloseTo(expectedDefault, 12);
    expect(computeFeeMultiplier(0.1, 1)).toBeCloseTo(0.999, 12);
  });

  it('computes purchase totals only from valid rows', () => {
    const totals = computePurchaseTotals([
      { id: 1, qty: '2', price: '100' },
      { id: 2, qty: '1.5', price: '150.5' },
      { id: 3, qty: '0', price: '10' },
      { id: 4, qty: 'bad', price: '10' },
    ]);

    expect(totals.validCount).toBe(2);
    expect(totals.totalQty).toBeCloseTo(3.5, 8);
    expect(totals.totalUsd).toBeCloseTo(425.75, 8);
    // Sin redondear: el promedio es un precio, y redondearlo rompe activos baratos.
    expect(totals.avgPrice).toBeCloseTo(425.75 / 3.5, 8);
  });

  it('no redondea precios sub-centavo hasta dejarlos en cero', () => {
    const totals = computePurchaseTotals([{ id: 1, qty: '1000000', price: '0.004' }]);

    expect(totals.validCount).toBe(1);
    expect(totals.totalUsd).toBeCloseTo(4000, 8);
    expect(totals.avgPrice).toBeCloseTo(0.004, 12);

    const cycle = computeCycle({
      basePrice: 0.004,
      capital: 4000,
      trades: 365,
      makerFeePct: 0.075,
      sellValue: 2.3,
      sellUnit: 'pct',
      rebuyValue: 1.7,
      rebuyUnit: 'pct',
    });

    // El ciclo solo depende del hueco venta/recompra: mismo neto que a $2490.
    expect(cycle.cycleNetPct).toBeCloseTo((computeFeeMultiplier(0.075, 2) / 0.983 - 1) * 100, 10);
    expect(Number.isNaN(cycle.apr)).toBe(false);
  });

  it('mantiene el ciclo intacto en precios donde medio centavo pesa', () => {
    // Vender a $2 y recomprar 1.70% abajo da C = 1.966; cuadrarlo a 1.97
    // hundia el neto de 1.5769% a 1.3706%, un 13% menos de APR por redondeo.
    const cycle = computeCycle({
      basePrice: 2495,
      capital: 35000,
      trades: 180,
      makerFeePct: 0.075,
      sellValue: 2,
      sellUnit: 'usd',
      rebuyValue: 1.7,
      rebuyUnit: 'pct',
    });

    expect(cycle.rebuyPrice).toBeCloseTo(1.966, 10);
    expect(cycle.cycleNetPct).toBeCloseTo((computeFeeMultiplier(0.075, 2) / 0.983 - 1) * 100, 10);
  });

  it('resuelve cada precio segun su unidad de captura', () => {
    expect(resolveSellPrice(110, 'usd', 100)).toBeCloseTo(110, 8);
    expect(resolveSellPrice(10, 'pct', 100)).toBeCloseTo(110, 8);
    expect(resolveRebuyPrice(104.5, 'usd', 110)).toBeCloseTo(104.5, 8);
    expect(resolveRebuyPrice(5, 'pct', 110)).toBeCloseTo(104.5, 8);
  });

  it('encadena base -> venta -> recompra', () => {
    const cycle = computeCycle(NO_FEE);

    expect(cycle.sellPrice).toBeCloseTo(110, 8);
    expect(cycle.rebuyPrice).toBeCloseTo(104.5, 8);
    expect(cycle.sellMovePct).toBeCloseTo(10, 8);
    expect(cycle.rebuyDipPct).toBeCloseTo(5, 8);
  });

  it('cuelga la recompra del precio de venta, no del precio base', () => {
    const enUsd = computeCycle(NO_FEE);
    const enPct = computeCycle({ ...NO_FEE, sellValue: 10, sellUnit: 'pct' });

    // Capturar la venta en $ o en % describe el mismo precio: mismos objetivos.
    expect(enPct.sellPrice).toBeCloseTo(enUsd.sellPrice, 8);
    expect(enPct.rebuyPrice).toBeCloseTo(enUsd.rebuyPrice, 8);
  });

  it('separa el resultado de la venta del rendimiento repetible del ciclo', () => {
    const cycle = computeCycle(NO_FEE);

    // La venta gana 10% sobre el costo de entrada: ocurre una sola vez.
    expect(cycle.saleNetUsd).toBeCloseTo(100, 8);
    // El ciclo repetible es lo que crece la bolsa al recomprar 5% mas abajo,
    // valorado sobre lo que se negocia (capital * B/A), no sobre el coste.
    expect(cycle.cycleNetPct).toBeCloseTo((110 / 104.5 - 1) * 100, 8);
    expect(cycle.cycleNetUsd).toBeCloseTo((110 / 104.5 - 1) * 1000 * 1.1, 8);
  });

  it('anualiza el ciclo repetible y no el resultado de la venta', () => {
    const cycle = computeCycle(NO_FEE);

    expect(cycle.apr).toBeCloseTo(cycle.cycleNetPct * 10, 8);
    // El APR y el neto por ciclo describen la misma magnitud: no pueden diverger.
    expect(cycle.apr).toBeCloseTo(((cycle.cycleNetUsd * 10) / (1000 * 1.1)) * 100, 8);
  });

  it('valora el ciclo sobre lo negociado, no sobre el coste de entrada', () => {
    // Vender a 2 lo que costo 2495 mueve centavos aunque el ciclo rinda un 1.5%.
    const hundida = computeCycle({ ...NO_FEE, basePrice: 2495, sellValue: 2, rebuyValue: 1.5 });

    expect(hundida.cycleNetPct).toBeGreaterThan(0);
    expect(hundida.cycleNetUsd).toBeLessThan(1);
    expect(hundida.saleNetUsd).toBeLessThan(-990);
  });

  it('cobra comision en las dos patas y la descuenta del ciclo', () => {
    const conFee = computeCycle({ ...NO_FEE, makerFeePct: 0.075 });
    const feeMultiplier = computeFeeMultiplier(0.075, 2);

    expect(conFee.feeUsd).toBeCloseTo(1000 * 1.1 * (1 - feeMultiplier), 8);
    expect(conFee.cycleNetPct).toBeLessThan(computeCycle(NO_FEE).cycleNetPct);
  });

  it('returns NaN for invalid math inputs', () => {
    const sinBase = computeCycle({ ...NO_FEE, basePrice: NaN, sellValue: 10, sellUnit: 'pct' });
    const sinRecompra = computeCycle({ ...NO_FEE, rebuyValue: NaN });

    expect(Number.isNaN(sinBase.sellPrice)).toBe(true);
    expect(Number.isNaN(sinBase.apr)).toBe(true);
    // Sin recompra no hay ciclo repetible, pero la venta si es evaluable.
    expect(Number.isNaN(sinRecompra.cycleNetPct)).toBe(true);
    expect(sinRecompra.sellMovePct).toBeCloseTo(10, 8);
  });
});
