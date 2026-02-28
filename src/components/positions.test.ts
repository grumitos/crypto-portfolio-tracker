import { describe, it, expect } from 'vitest';
import { parseBinancePositions, parseImportedPositions } from './positions';

function utcToLocalParts(value: string): { date: string; time: string } {
  const [datePart, timePart] = value.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second ?? 0, 0));
  const localDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  const localTime = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  return { date: localDate, time: localTime };
}

describe('positions bulk import parser', () => {
  it('ignores direction rows as pair delimiters and parses pasted Binance blocks', () => {
    const raw = `image
image
USDT-ETH
Buy-low
2026-02-20 08:45
6,865.5 USDT
≈ $6,865.5
1,925	2026-02-23 03:00
191.04%
Holding
image
image
USDC-ETH
Buy-low
2026-02-19 14:29
100 USDC
≈ $100.03
1,925	2026-02-23 03:00
136.95%
Holding`;

    const parsed = parseBinancePositions(raw);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      direction: 'buy-low',
      asset: 'ETH',
      subscriptionAsset: 'USDT',
      amount: 6865.5,
      targetPrice: 1925,
      entryDate: '2026-02-20',
      entryTime: '08:45',
      settlementDate: '2026-02-23',
      settlementTime: '03:00',
      apr: 191.04,
    });
    expect(parsed[1]).toMatchObject({
      direction: 'buy-low',
      asset: 'ETH',
      subscriptionAsset: 'USDC',
      amount: 100,
      targetPrice: 1925,
      entryDate: '2026-02-19',
      entryTime: '14:29',
      settlementDate: '2026-02-23',
      settlementTime: '03:00',
      apr: 136.95,
    });
  });

  it('parses and consolidates bybit rows when source is selected', () => {
    const raw = `Producto	Precio objetivo	Importe de la inversion	Periodo de staking	Desde Cuenta	Hacia Cuenta	Precio Final	Hora de la Orden (UTC)	Direccion de la orden	APR	Liquidacion (UTC)	Ganancias	Estado	Tipo de orden	ID de la orden
SOL-USDT	82.0000	40.87873348 SOL	< 1 Dia	Financiacion	--	--	2026-02-27 23:00:01	Vende caro	200.33%	2026-02-28 07:59:59	--	Activo	Suscribete	e47afe8e-ff1b-46b8-8cbd-79e5014cf5aa
SOL-USDT	82.0000	186.14819636 SOL	< 1 Dia	Financiacion	--	--	2026-02-27 22:59:47	Vende caro	347.65%	2026-02-28 07:59:59	--	Activo	Suscribete	0d0a7216-6e4e-458b-8dd1-2b91378de6e7`;

    const parsed = parseImportedPositions(raw, 'bybit');
    const expectedEntry = utcToLocalParts('2026-02-27 22:59:47');
    const expectedSettlement = utcToLocalParts('2026-02-28 07:59:59');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      direction: 'sell-high',
      asset: 'SOL',
      subscriptionAsset: 'SOL',
      targetPrice: 82,
      entryDate: expectedEntry.date,
      entryTime: expectedEntry.time,
      settlementDate: expectedSettlement.date,
      settlementTime: expectedSettlement.time,
    });
    expect(parsed[0].components).toHaveLength(2);
    expect(parsed[0].amount).toBeCloseTo(227.02692984, 10);
    expect(parsed[0].apr).toBeCloseTo(321.1233891679, 6);
  });
});
