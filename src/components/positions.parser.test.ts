import { describe, expect, it } from 'vitest';
import { parseBinancePositions, parseBybitPositions, parseImportedPositions } from './positions.parser';

function utcToLocalParts(value: string): { date: string; time: string } {
  const [datePart, timePart] = value.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second ?? 0, 0));
  const localDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  const localTime = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  return { date: localDate, time: localTime };
}

describe('positions parser', () => {
  it('parses buy-low and sell-high blocks', () => {
    const raw = `
USDT-ETH
Buy-low
2026-02-20 08:45
100 USDT
1,925 2026-02-23 03:00
191.04%
Holding

SOL-USDT
Sell-high
2026-02-19 12:00
15 SOL
90 2026-02-21 03:00
88.5%
Holding
`.trim();

    const parsed = parseBinancePositions(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].direction).toBe('buy-low');
    expect(parsed[0].asset).toBe('ETH');
    expect(parsed[0].subscriptionAsset).toBe('USDT');
    expect(parsed[1].direction).toBe('sell-high');
    expect(parsed[1].asset).toBe('SOL');
    expect(parsed[1].subscriptionAsset).toBe('SOL');
  });

  it('rejects blocks using assets outside the allowed pool', () => {
    const raw = `
DOGE-USDT
Buy-low
2026-02-20 08:45
100 USDT
0.12 2026-02-23 03:00
20%
`.trim();

    expect(parseBinancePositions(raw)).toEqual([]);
  });

  it('rejects incomplete chunks with missing required fields', () => {
    const missingApr = `
USDT-ETH
Buy-low
2026-02-20 08:45
100 USDT
1,925 2026-02-23 03:00
`.trim();

    const missingSettlement = `
USDT-ETH
Buy-low
2026-02-20 08:45
100 USDT
191.04%
`.trim();

    expect(parseBinancePositions(missingApr)).toEqual([]);
    expect(parseBinancePositions(missingSettlement)).toEqual([]);
  });

  it('extracts target from standalone numeric line when settlement is separate', () => {
    const raw = `
USDT-ETH
Buy-low
2026-02-19 14:29
100 USDT
1,925
2026-02-23 03:00
136.95%
`.trim();

    const parsed = parseBinancePositions(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].targetPrice).toBe(1925);
    expect(parsed[0].entryDate).toBe('2026-02-19');
    expect(parsed[0].settlementDate).toBe('2026-02-23');
  });

  it('parses bybit table rows with spanish headers', () => {
    const raw = `
Producto	Precio objetivo	Importe de la inversion	Periodo de staking	Desde Cuenta	Hacia Cuenta	Precio Final	Hora de la Orden (UTC)	Direccion de la orden	APR	Liquidacion (UTC)	Ganancias	Estado	Tipo de orden	ID de la orden
SOL-USDT	82.0000	40.87873348 SOL	< 1 Dia	Financiacion	--	--	2026-02-27 23:00:01	Vende caro	200.33%	2026-02-28 07:59:59	--	Activo	Suscribete	e47afe8e-ff1b-46b8-8cbd-79e5014cf5aa
SOL-USDT	82.0000	186.14819636 SOL	< 1 Dia	Financiacion	--	--	2026-02-27 22:59:47	Vende caro	347.65%	2026-02-28 07:59:59	--	Activo	Suscribete	0d0a7216-6e4e-458b-8dd1-2b91378de6e7
`.trim();

    const parsed = parseBybitPositions(raw);
    const expectedEntry = utcToLocalParts('2026-02-27 23:00:01');
    const expectedSettlement = utcToLocalParts('2026-02-28 07:59:59');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      direction: 'sell-high',
      asset: 'SOL',
      subscriptionAsset: 'SOL',
      amount: 40.87873348,
      targetPrice: 82,
      entryDate: expectedEntry.date,
      entryTime: expectedEntry.time,
      settlementDate: expectedSettlement.date,
      settlementTime: expectedSettlement.time,
      apr: 200.33,
    });
  });

  it('auto-detects bybit and consolidates same pair using weighted apr', () => {
    const raw = `
Producto	Precio objetivo	Importe de la inversion	Periodo de staking	Desde Cuenta	Hacia Cuenta	Precio Final	Hora de la Orden (UTC)	Direccion de la orden	APR	Liquidacion (UTC)	Ganancias	Estado	Tipo de orden	ID de la orden
SOL-USDT	82.0000	40.87873348 SOL	< 1 Dia	Financiacion	--	--	2026-02-27 23:00:01	Vende caro	200.33%	2026-02-28 07:59:59	--	Activo	Suscribete	e47afe8e-ff1b-46b8-8cbd-79e5014cf5aa
SOL-USDT	82.0000	186.14819636 SOL	< 1 Dia	Financiacion	--	--	2026-02-27 22:59:47	Vende caro	347.65%	2026-02-28 07:59:59	--	Activo	Suscribete	0d0a7216-6e4e-458b-8dd1-2b91378de6e7
SOL-USDT	82.0000	47.99823126 SOL	< 1 Dia	Financiacion	--	--	2026-02-27 22:59:35	Vende caro	386.19%	2026-02-28 07:59:59	--	Activo	Suscribete	f74bf5db-182c-46cf-8793-7923e4289dd2
SOL-USDT	82.0000	96.00000000 SOL	< 1 Dia	Financiacion	--	--	2026-02-27 22:59:10	Vende caro	397.80%	2026-02-28 07:59:59	--	Activo	Suscribete	d5e43113-73b4-4b36-93c0-b5515beb2fc0
`.trim();

    const parsed = parseImportedPositions(raw);
    const expectedEntry = utcToLocalParts('2026-02-27 22:59:10');
    const expectedSettlement = utcToLocalParts('2026-02-28 07:59:59');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      direction: 'sell-high',
      asset: 'SOL',
      subscriptionAsset: 'SOL',
      amount: 371.0251611,
      targetPrice: 82,
      entryDate: expectedEntry.date,
      entryTime: expectedEntry.time,
      settlementDate: expectedSettlement.date,
      settlementTime: expectedSettlement.time,
    });
    expect(parsed[0].components).toHaveLength(4);
    expect(parsed[0].apr).toBeCloseTo(349.3803322895, 6);
  });

  it('deduplicates repeated bybit rows by order id', () => {
    const raw = `
Producto	Precio objetivo	Importe de la inversion	Periodo de staking	Desde Cuenta	Hacia Cuenta	Precio Final	Hora de la Orden (UTC)	Direccion de la orden	APR	Liquidacion (UTC)	Ganancias	Estado	Tipo de orden	ID de la orden
SOL-USDT	82.0000	40.87873348 SOL	< 1 Dia	Financiacion	--	--	2026-02-27 23:00:01	Vende caro	200.33%	2026-02-28 07:59:59	--	Activo	Suscribete	e47afe8e-ff1b-46b8-8cbd-79e5014cf5aa
SOL-USDT	82.0000	40.87873348 SOL	< 1 Dia	Financiacion	--	--	2026-02-27 23:00:01	Vende caro	200.33%	2026-02-28 07:59:59	--	Activo	Suscribete	e47afe8e-ff1b-46b8-8cbd-79e5014cf5aa
`.trim();

    const parsed = parseBybitPositions(raw);
    expect(parsed).toHaveLength(1);
  });

  it('keeps positions with different settlement dates separate after consolidation', () => {
    const raw = [
      'Producto\tPrecio objetivo\tImporte de la inversion\tPeriodo de staking\tDesde Cuenta\tHacia Cuenta\tPrecio Final\tHora de la Orden (UTC)\tDireccion de la orden\tAPR\tLiquidacion (UTC)\tGanancias\tEstado\tTipo de orden\tID de la orden',
      'SOL-USDT\t82.0000\t40.00000000 SOL\t< 1 Dia\tFinanciacion\t--\t--\t2026-02-27 22:00:00\tVende caro\t200.00%\t2026-02-28 07:59:59\t--\tActivo\tSuscribete\taaa-111',
      'SOL-USDT\t82.0000\t60.00000000 SOL\t1 Dia\tFinanciacion\t--\t--\t2026-02-27 22:00:00\tVende caro\t150.00%\t2026-03-01 07:59:59\t--\tActivo\tSuscribete\tbbb-222',
    ].join('\n');

    const parsed = parseImportedPositions(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed.every(p => p.asset === 'SOL')).toBe(true);
    expect(parsed.map(p => p.amount).sort((a, b) => a - b)).toEqual([40, 60]);
  });
});
