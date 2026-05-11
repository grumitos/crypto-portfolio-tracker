import { beforeEach, describe, expect, it, vi } from '#test';
import { mockMatchMedia } from '../test/test-utils';
import {
  getAnimationMemorySizesForTests,
  getElementNumericValue,
  resetAnimationMemoryForTests,
  setAnimatedNumber,
  setAnimatedText,
  stopValueAnimation,
} from './animation';

describe('animation utils', () => {
  beforeEach(() => {
    resetAnimationMemoryForTests();
  });

  it('reads numeric values from dataset, text and fallback', () => {
    const el = document.createElement('div');

    el.dataset.numericValue = '42.5';
    expect(getElementNumericValue(el, 0)).toBe(42.5);

    delete el.dataset.numericValue;
    el.textContent = '$1,234.56';
    expect(getElementNumericValue(el, 0)).toBe(1234.56);

    el.textContent = '';
    expect(getElementNumericValue(el, 77)).toBe(77);

    el.textContent = 'not-a-number';
    expect(getElementNumericValue(el, 99)).toBe(99);
  });

  it('cancels tracked animation frames and clears the map', () => {
    const el = document.createElement('div');
    const map = new WeakMap<HTMLElement, number>();
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    map.set(el, 123);

    stopValueAnimation(map, el);
    stopValueAnimation(map, null);

    expect(cancelSpy).toHaveBeenCalledWith(123);
    expect(map.has(el)).toBe(false);
    cancelSpy.mockRestore();
  });

  it('animates numeric values and commits final output', () => {
    mockMatchMedia(false);
    const el = document.createElement('div');
    el.textContent = '0';
    const map = new WeakMap<HTMLElement, number>();
    let now = 0;
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        now += 16;
        cb(now);
        return now;
      });

    setAnimatedNumber(map, el, 100, (next) => next.toFixed(0), {
      enabled: true,
      durationMs: 64,
    });

    expect(el.textContent).toBe('100');
    expect(el.dataset.numericValue).toBe('100');
    expect(map.has(el)).toBe(false);
    expect(rafSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('animates text in fade and scramble modes', () => {
    mockMatchMedia(false);
    const fadeEl = document.createElement('div');
    const scrambleEl = document.createElement('div');
    fadeEl.textContent = 'Meta';
    scrambleEl.textContent = 'Meta';
    const map = new WeakMap<HTMLElement, number>();
    let now = 0;
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        now += 16;
        cb(now);
        return now;
      });

    setAnimatedText(map, fadeEl, 'BE', { enabled: true, mode: 'fade', className: 'text-swap' });
    setAnimatedText(map, scrambleEl, 'breakeven', {
      enabled: true,
      mode: 'scramble',
      durationMs: 80,
    });

    expect(fadeEl.textContent).toBe('BE');
    expect(fadeEl.classList.contains('text-swap')).toBe(true);
    expect(scrambleEl.textContent).toBe('breakeven');
    expect(map.has(scrambleEl)).toBe(false);
    rafSpy.mockRestore();
  });

  it('falls back to direct text update when reduced motion is enabled', () => {
    mockMatchMedia(true);
    const el = document.createElement('div');
    el.textContent = 'Meta';
    const map = new WeakMap<HTMLElement, number>();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

    setAnimatedText(map, el, 'BE', { enabled: true, mode: 'scramble' });

    expect(el.textContent).toBe('BE');
    expect(rafSpy).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('skips numeric animation when the formatted output does not change', () => {
    mockMatchMedia(false);
    const el = document.createElement('div');
    el.dataset.numericValue = '49.49';
    el.textContent = '~49d';
    const map = new WeakMap<HTMLElement, number>();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

    setAnimatedNumber(map, el, 49.12, (next) => `~${Math.round(next)}d`, {
      enabled: true,
      durationMs: 64,
    });

    expect(rafSpy).not.toHaveBeenCalled();
    expect(el.textContent).toBe('~49d');
    expect(el.dataset.numericValue).toBe('49.12');
    rafSpy.mockRestore();
  });

  it('skips numeric re-animation for remounted elements when the value did not change', () => {
    mockMatchMedia(false);
    const map = new WeakMap<HTMLElement, number>();
    let now = 0;
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        now += 16;
        cb(now);
        return now;
      });

    const first = document.createElement('div');
    first.id = 'positions-apr';
    first.textContent = '120.00%';
    setAnimatedNumber(map, first, 141.01, (next) => `${next.toFixed(2)}%`, {
      enabled: true,
      durationMs: 64,
    });
    const callsAfterFirst = rafSpy.mock.calls.length;

    const remount = document.createElement('div');
    remount.id = 'positions-apr';
    setAnimatedNumber(map, remount, 141.01, (next) => `${next.toFixed(2)}%`, {
      enabled: true,
      durationMs: 64,
    });

    expect(rafSpy.mock.calls.length).toBe(callsAfterFirst);
    expect(remount.textContent).toBe('141.01%');
    expect(remount.dataset.numericValue).toBe('141.01');
    rafSpy.mockRestore();
  });

  it('ignores remembered numeric start when allowRememberedStart is false', () => {
    mockMatchMedia(false);
    const map = new WeakMap<HTMLElement, number>();
    let now = 0;
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        now += 16;
        cb(now);
        return now;
      });

    const first = document.createElement('div');
    first.id = 'sim-out-apr';
    first.textContent = '20.00%';
    setAnimatedNumber(map, first, 20, (next) => `${next.toFixed(2)}%`, {
      enabled: true,
      durationMs: 64,
    });

    rafSpy.mockClear();

    const remount = document.createElement('div');
    remount.id = 'sim-out-apr';
    remount.textContent = 'N/D';
    setAnimatedNumber(map, remount, 35, (next) => `${next.toFixed(2)}%`, {
      enabled: true,
      durationMs: 64,
      allowRememberedStart: false,
    });

    expect(rafSpy).not.toHaveBeenCalled();
    expect(remount.textContent).toBe('35.00%');
    expect(remount.dataset.numericValue).toBe('35');
    rafSpy.mockRestore();
  });

  it('caps remembered numeric values to avoid unbounded memory growth', () => {
    mockMatchMedia(true);
    const map = new WeakMap<HTMLElement, number>();

    for (let i = 0; i < 700; i += 1) {
      const el = document.createElement('div');
      el.id = `metric-${i}`;
      setAnimatedNumber(map, el, i, (next) => `${next}`, { enabled: false });
    }

    expect(getAnimationMemorySizesForTests().numeric).toBeLessThanOrEqual(512);
  });

  it('caps remembered text values to avoid unbounded memory growth', () => {
    mockMatchMedia(true);
    const map = new WeakMap<HTMLElement, number>();

    for (let i = 0; i < 700; i += 1) {
      const el = document.createElement('div');
      el.id = `label-${i}`;
      setAnimatedText(map, el, `value-${i}`, { enabled: false, mode: 'fade' });
    }

    expect(getAnimationMemorySizesForTests().text).toBeLessThanOrEqual(512);
  });
});
