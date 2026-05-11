import { afterEach, beforeEach, describe, expect, it, vi } from '#test';
import { renderCalculadora } from './calculadora';
import { createMemoryStorage, mockMatchMedia, resetDom } from '../test/test-utils';
import { DEFAULT_CALC_REBUY_PCT, DEFAULT_CALC_SELL_PCT, saveCalcState } from '../utils/storage';
import * as storage from '../utils/storage';

function parseDisplayedNumber(value: string | null): number {
  if (!value) return NaN;
  return Number.parseFloat(value.replace(/[^\d.-]+/g, ''));
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
    saveCalcState({
      price: '',
      capital: '0',
      trades: '100',
      sellPrice: '',
      sellPct: '0.98',
      rebuyPct: '0.85',
      feePreset: 'spot',
      fdusdEnabled: false,
      sellSyncSource: 'percent',
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
    expect(lockTag.style.display).toBe('inline-flex');
  });

  it('keeps sell price and sell percent synchronized in both directions', () => {
    saveCalcState({
      price: '100',
      capital: '1000',
      trades: '10',
      sellPrice: '',
      sellPct: '0.98',
      rebuyPct: '0.85',
      feePreset: 'spot',
      fdusdEnabled: false,
      sellSyncSource: 'percent',
      purchases: [],
    });

    const container = document.createElement('div');
    renderCalculadora(container);

    const sellPriceInput = container.querySelector('#calc-sell-price') as HTMLInputElement;
    const sellPctInput = container.querySelector('#calc-sell-pct') as HTMLInputElement;

    sellPctInput.focus();
    sellPctInput.value = '2';
    sellPctInput.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(150);

    expect(sellPriceInput.readOnly).toBe(true);
    expect(sellPctInput.readOnly).toBe(false);
    expect(sellPriceInput.value).toBe('102.00');

    sellPriceInput.focus();
    sellPriceInput.value = '110';
    sellPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(150);

    expect(sellPriceInput.readOnly).toBe(false);
    expect(sellPctInput.readOnly).toBe(true);
    expect(parseDisplayedNumber(sellPctInput.value)).toBeCloseTo(10, 4);
  });

  it('updates output metrics when fee preset changes', () => {
    saveCalcState({
      price: '100',
      capital: '1000',
      trades: '10',
      sellPrice: '',
      sellPct: '2',
      rebuyPct: '1',
      feePreset: 'spot',
      fdusdEnabled: false,
      sellSyncSource: 'percent',
      purchases: [],
    });

    const container = document.createElement('div');
    renderCalculadora(container);

    const aprEl = container.querySelector('#calc-out-apr') as HTMLElement;
    const futuresBtn = container.querySelector('#calc-fee-futures') as HTMLButtonElement;
    const spotApr = parseDisplayedNumber(aprEl.textContent);

    futuresBtn.click();

    const futuresApr = parseDisplayedNumber(aprEl.textContent);
    expect(futuresApr).toBeGreaterThan(spotApr);
  });

  it('resets execution fields back to defaults', () => {
    saveCalcState({
      price: '100',
      capital: '1000',
      trades: '10',
      sellPrice: '120',
      sellPct: '5',
      rebuyPct: '2',
      feePreset: 'spot',
      fdusdEnabled: false,
      sellSyncSource: 'price',
      purchases: [],
    });

    const container = document.createElement('div');
    renderCalculadora(container);

    const sellPriceInput = container.querySelector('#calc-sell-price') as HTMLInputElement;
    const sellPctInput = container.querySelector('#calc-sell-pct') as HTMLInputElement;
    const rebuyPctInput = container.querySelector('#calc-rebuy-pct') as HTMLInputElement;
    const resetBtn = container.querySelector('#calc-reset-exec') as HTMLButtonElement;

    resetBtn.click();

    expect(sellPriceInput.value).toBe('102.30');
    expect(sellPctInput.value).toBe(DEFAULT_CALC_SELL_PCT);
    expect(rebuyPctInput.value).toBe(DEFAULT_CALC_REBUY_PCT);
    expect(sellPriceInput.readOnly).toBe(true);
    expect(sellPctInput.readOnly).toBe(false);
  });

  it('returns a dispose function that does not throw', () => {
    saveCalcState({
      price: '100',
      capital: '1000',
      trades: '10',
      sellPrice: '',
      sellPct: '0.98',
      rebuyPct: '0.85',
      feePreset: 'spot',
      fdusdEnabled: false,
      sellSyncSource: 'percent',
      purchases: [],
    });

    const container = document.createElement('div');
    const dispose = renderCalculadora(container);

    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
  });

  it('cancels pending debounced saves when disposed', () => {
    const saveSpy = vi.spyOn(storage, 'saveCalcState');
    saveCalcState({
      price: '100',
      capital: '1000',
      trades: '10',
      sellPrice: '',
      sellPct: '0.98',
      rebuyPct: '0.85',
      feePreset: 'spot',
      fdusdEnabled: false,
      sellSyncSource: 'percent',
      purchases: [],
    });

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
