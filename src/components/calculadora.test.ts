import { afterEach, beforeEach, describe, expect, it, vi } from '#test';
import { renderCalculadora } from './calculadora';
import { createMemoryStorage, mockMatchMedia, resetDom } from '../test/test-utils';
import { DEFAULT_CALC_REBUY, DEFAULT_CALC_SELL, saveCalcState } from '../utils/storage';
import * as storage from '../utils/storage';
import type { CalculadoraState } from '../types';

function parseDisplayedNumber(value: string | null): number {
  if (!value) return NaN;
  return Number.parseFloat(value.replace(/[^\d.-]+/g, ''));
}

function seedCalcState(overrides: Partial<CalculadoraState> = {}): void {
  saveCalcState({
    price: '100',
    capital: '1000',
    trades: '10',
    sell: '2',
    sellUnit: 'pct',
    rebuy: '1',
    rebuyUnit: 'pct',
    fdusdEnabled: false,
    purchases: [],
    ...overrides,
  });
}

describe('calculadora integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    mockMatchMedia(true);
    resetDom();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks capital and base price when valid purchases are present', () => {
    seedCalcState({
      price: '',
      capital: '0',
      trades: '100',
      purchases: [
        { id: 1, qty: '2', price: '100' },
        { id: 2, qty: '1', price: '130' },
      ],
    });

    const container = document.createElement('div');
    renderCalculadora(container);

    const capitalInput = container.querySelector('#calc-capital') as HTMLInputElement;
    const priceInput = container.querySelector('#calc-price') as HTMLInputElement;
    const lockTag = container.querySelector('#calc-price-lock') as HTMLElement;

    expect(capitalInput.readOnly).toBe(true);
    expect(capitalInput.value).toBe('330.00');
    expect(priceInput.readOnly).toBe(true);
    expect(priceInput.value).toBe('110.00');
    expect(lockTag.hidden).toBe(false);
  });

  it('propaga el precio de venta capturado en dolares a los objetivos del ciclo', () => {
    seedCalcState({ sell: '110', sellUnit: 'usd', rebuy: '5', rebuyUnit: 'pct' });

    const container = document.createElement('div');
    renderCalculadora(container);

    const sellOut = container.querySelector('#calc-out-sell-price') as HTMLElement;
    const rebuyOut = container.querySelector('#calc-out-rebuy-price') as HTMLElement;

    // La recompra cuelga del precio de venta real, no de un porcentaje viejo.
    expect(parseDisplayedNumber(sellOut.textContent)).toBeCloseTo(110, 2);
    expect(parseDisplayedNumber(rebuyOut.textContent)).toBeCloseTo(104.5, 2);

    const sellInput = container.querySelector('#calc-sell') as HTMLInputElement;
    sellInput.value = '120';
    sellInput.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(150);

    expect(parseDisplayedNumber(sellOut.textContent)).toBeCloseTo(120, 2);
    expect(parseDisplayedNumber(rebuyOut.textContent)).toBeCloseTo(114, 2);
  });

  it('conserva el precio al cambiar la unidad de captura', () => {
    seedCalcState({ sell: '110', sellUnit: 'usd' });

    const container = document.createElement('div');
    renderCalculadora(container);

    const sellInput = container.querySelector('#calc-sell') as HTMLInputElement;
    const pctBtn = container.querySelector('#calc-sell-unit-pct') as HTMLButtonElement;
    const usdBtn = container.querySelector('#calc-sell-unit-usd') as HTMLButtonElement;

    pctBtn.click();

    // 110 sobre una base de 100 son 10%, no un 110%.
    expect(parseDisplayedNumber(sellInput.value)).toBeCloseTo(10, 4);
    expect(pctBtn.classList.contains('active')).toBe(true);
    expect(sellInput.classList.contains('has-suffix')).toBe(true);

    usdBtn.click();

    expect(parseDisplayedNumber(sellInput.value)).toBeCloseTo(110, 2);
    expect(sellInput.classList.contains('has-prefix')).toBe(true);
  });

  it('muestra el equivalente en la unidad contraria bajo cada campo', () => {
    seedCalcState({ sell: '110', sellUnit: 'usd', rebuy: '5', rebuyUnit: 'pct' });

    const container = document.createElement('div');
    renderCalculadora(container);

    const sellHint = container.querySelector('#calc-sell-hint') as HTMLElement;
    const rebuyHint = container.querySelector('#calc-rebuy-hint') as HTMLElement;

    expect(parseDisplayedNumber(sellHint.textContent)).toBeCloseTo(10, 4);
    expect(parseDisplayedNumber(rebuyHint.textContent)).toBeCloseTo(104.5, 2);
  });

  it('mantiene el APR y el neto por ciclo describiendo la misma magnitud', () => {
    seedCalcState({ sell: '110', sellUnit: 'usd', rebuy: '5', rebuyUnit: 'pct', trades: '10' });

    const container = document.createElement('div');
    renderCalculadora(container);

    const apr = parseDisplayedNumber(
      (container.querySelector('#calc-out-apr') as HTMLElement).textContent,
    );
    const cycleUsd = parseDisplayedNumber(
      (container.querySelector('#calc-out-net-cycle-usd') as HTMLElement).textContent,
    );

    // El neto USD se valora sobre lo negociado: capital * (venta / compra).
    expect(apr).toBeCloseTo(((cycleUsd * 10) / (1000 * 1.1)) * 100, 1);
  });

  it('avisa cuando la venta queda por debajo de la compra', () => {
    seedCalcState({ price: '2495', sell: '2', sellUnit: 'usd', rebuy: '1.5', rebuyUnit: 'pct' });

    const container = document.createElement('div');
    renderCalculadora(container);

    const chip = container.querySelector('#calc-signal-status') as HTMLElement;
    const cyclePct = parseDisplayedNumber(
      (container.querySelector('#calc-out-net-cycle-pct') as HTMLElement).textContent,
    );

    // El ciclo repetible sigue rindiendo, pero la operacion realiza una perdida.
    expect(cyclePct).toBeGreaterThan(0);
    expect(chip.classList.contains('chip-loss')).toBe(true);
    expect(chip.textContent).toContain('Venta bajo tu compra');
  });

  it('updates output metrics when the fee changes', () => {
    seedCalcState();

    const container = document.createElement('div');
    renderCalculadora(container);

    const aprEl = container.querySelector('#calc-out-apr') as HTMLElement;
    const fdusdBtn = container.querySelector('#calc-fee-fdusd') as HTMLButtonElement;
    const spotApr = parseDisplayedNumber(aprEl.textContent);

    // Pagando en FDUSD la comision maker es 0, asi que el ciclo rinde mas.
    fdusdBtn.click();

    const fdusdApr = parseDisplayedNumber(aprEl.textContent);
    expect(fdusdApr).toBeGreaterThan(spotApr);
  });

  it('resets execution fields back to defaults', () => {
    seedCalcState({ sell: '120', sellUnit: 'usd', rebuy: '95', rebuyUnit: 'usd' });

    const container = document.createElement('div');
    renderCalculadora(container);

    const sellInput = container.querySelector('#calc-sell') as HTMLInputElement;
    const rebuyInput = container.querySelector('#calc-rebuy') as HTMLInputElement;
    const resetBtn = container.querySelector('#calc-reset-exec') as HTMLButtonElement;

    resetBtn.click();

    expect(sellInput.value).toBe(DEFAULT_CALC_SELL);
    expect(rebuyInput.value).toBe(DEFAULT_CALC_REBUY);
    expect(sellInput.classList.contains('has-suffix')).toBe(true);
    expect(
      (container.querySelector('#calc-sell-unit-pct') as HTMLElement).classList.contains('active'),
    ).toBe(true);
  });

  it('returns a dispose function that does not throw', () => {
    seedCalcState();

    const container = document.createElement('div');
    const dispose = renderCalculadora(container);

    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
  });

  it('cancels pending debounced saves when disposed', () => {
    const saveSpy = vi.spyOn(storage, 'saveCalcState');
    seedCalcState();

    const container = document.createElement('div');
    const dispose = renderCalculadora(container);
    saveSpy.mockClear();

    const priceInput = container.querySelector('#calc-price') as HTMLInputElement;
    priceInput.value = '125';
    priceInput.dispatchEvent(new Event('input', { bubbles: true }));

    dispose();
    vi.advanceTimersByTime(250);

    expect(saveSpy).not.toHaveBeenCalled();
  });
});
