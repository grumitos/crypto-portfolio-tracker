import { beforeEach, describe, expect, it, vi } from 'vitest';

const animationMocks = vi.hoisted(() => ({
  setAnimatedNumber: vi.fn(),
  setAnimatedText: vi.fn(),
  stopValueAnimation: vi.fn(),
}));

vi.mock('./animation', () => ({
  setAnimatedNumber: animationMocks.setAnimatedNumber,
  setAnimatedText: animationMocks.setAnimatedText,
  stopValueAnimation: animationMocks.stopValueAnimation,
}));

import {
  animateCurrency,
  animateNumber,
  animatePercent,
  animateTextFade,
  animateTextScramble,
  setStaticOutput,
  stopAllAnimations,
} from './animated-output';

describe('animated-output', () => {
  beforeEach(() => {
    animationMocks.setAnimatedNumber.mockReset();
    animationMocks.setAnimatedText.mockReset();
    animationMocks.stopValueAnimation.mockReset();

    animationMocks.setAnimatedNumber.mockImplementation(
      (
        _map: WeakMap<HTMLElement, number>,
        el: HTMLElement | null,
        end: number,
        formatter: (value: number) => string,
      ) => {
        if (!el) return;
        el.dataset.numericValue = String(end);
        el.textContent = formatter(end);
      },
    );
    animationMocks.setAnimatedText.mockImplementation(
      (_map: WeakMap<HTMLElement, number>, el: HTMLElement | null, text: string) => {
        if (!el) return;
        el.textContent = text;
      },
    );
  });

  it('stops both numeric and text animations', () => {
    const el = document.createElement('div');
    stopAllAnimations(el);

    expect(animationMocks.stopValueAnimation).toHaveBeenCalledTimes(2);
    expect(animationMocks.stopValueAnimation.mock.calls[0][1]).toBe(el);
    expect(animationMocks.stopValueAnimation.mock.calls[1][1]).toBe(el);
  });

  it('animates currency output and clears text animation first', () => {
    const el = document.createElement('div');

    animateCurrency(el, 12.5, true, 420);

    expect(animationMocks.stopValueAnimation).toHaveBeenCalledTimes(1);
    expect(animationMocks.setAnimatedNumber).toHaveBeenCalledTimes(1);
    const call = animationMocks.setAnimatedNumber.mock.calls[0];
    const formatter = call[3] as (next: number) => string;
    const options = call[4] as {
      enabled: boolean;
      durationMs: number;
      allowRememberedStart: boolean;
    };
    expect(formatter(10)).toBe('$10.00');
    expect(options).toEqual({ enabled: true, durationMs: 420, allowRememberedStart: false });
  });

  it('animates percent in signed and unsigned modes', () => {
    const el = document.createElement('div');

    animatePercent(el, 4.25, true, true);
    animatePercent(el, 4.25, false, false, 300);

    expect(animationMocks.setAnimatedNumber).toHaveBeenCalledTimes(2);

    const signedFormatter = animationMocks.setAnimatedNumber.mock.calls[0][3] as (
      next: number,
    ) => string;
    const unsignedFormatter = animationMocks.setAnimatedNumber.mock.calls[1][3] as (
      next: number,
    ) => string;
    const unsignedOptions = animationMocks.setAnimatedNumber.mock.calls[1][4] as {
      durationMs: number;
      enabled: boolean;
    };

    expect(signedFormatter(2)).toBe('+2.00%');
    expect(unsignedFormatter(2)).toBe('2.00%');
    expect(unsignedOptions.durationMs).toBe(300);
    expect(unsignedOptions.enabled).toBe(false);
  });

  it('falls back to text placeholder when numeric value is not finite', () => {
    const el = document.createElement('div');
    el.dataset.numericValue = '8';

    animateNumber(el, Number.NaN, (value) => value.toFixed(2), true);

    expect(animationMocks.setAnimatedNumber).not.toHaveBeenCalled();
    expect(animationMocks.setAnimatedText).toHaveBeenCalledTimes(1);
    const options = animationMocks.setAnimatedText.mock.calls[0][3] as {
      mode: string;
      className: string;
      enabled: boolean;
    };
    expect(options).toEqual({ enabled: true, mode: 'fade', className: 'text-swap' });
    expect(el.dataset.numericValue).toBeUndefined();
    expect(el.textContent).toBe('---');
  });

  it('animates a generic finite number', () => {
    const el = document.createElement('div');

    animateNumber(el, 123.456, (next) => next.toFixed(1), true, 100);

    expect(animationMocks.setAnimatedNumber).toHaveBeenCalledTimes(1);
    const formatter = animationMocks.setAnimatedNumber.mock.calls[0][3] as (next: number) => string;
    const options = animationMocks.setAnimatedNumber.mock.calls[0][4] as { durationMs: number };
    expect(formatter(12.34)).toBe('12.3');
    expect(options.durationMs).toBe(100);
  });

  it('animates fade and scramble text modes', () => {
    const el = document.createElement('div');
    el.dataset.numericValue = '99';

    animateTextFade(el, 'faded', true);
    animateTextScramble(el, 'scrambled', false, 700);

    expect(animationMocks.stopValueAnimation).toHaveBeenCalledTimes(2);
    expect(animationMocks.setAnimatedText).toHaveBeenCalledTimes(2);

    const fadeOptions = animationMocks.setAnimatedText.mock.calls[0][3] as {
      mode: string;
      className: string;
    };
    const scrambleOptions = animationMocks.setAnimatedText.mock.calls[1][3] as {
      mode: string;
      className: string;
      durationMs: number;
    };

    expect(fadeOptions).toEqual({ enabled: true, mode: 'fade', className: 'text-swap' });
    expect(scrambleOptions).toEqual({
      enabled: false,
      mode: 'scramble',
      className: 'text-swap',
      durationMs: 700,
    });
    expect(el.dataset.numericValue).toBeUndefined();
  });

  it('sets static output and clears animation state', () => {
    const el = document.createElement('div');
    el.dataset.numericValue = '5';

    setStaticOutput(el, 'N/A');

    expect(animationMocks.stopValueAnimation).toHaveBeenCalledTimes(2);
    expect(el.dataset.numericValue).toBeUndefined();
    expect(el.textContent).toBe('N/A');
  });

  it('is a no-op for null elements', () => {
    animateCurrency(null, 10, true);
    animatePercent(null, 10, true);
    animateNumber(null, 10, (value) => String(value), true);
    animateTextFade(null, 'x', true);
    animateTextScramble(null, 'x', true);
    setStaticOutput(null, 'x');
    stopAllAnimations(null);

    expect(animationMocks.setAnimatedNumber).not.toHaveBeenCalled();
    expect(animationMocks.setAnimatedText).not.toHaveBeenCalled();
    expect(animationMocks.stopValueAnimation).toHaveBeenCalledTimes(2);
  });
});
