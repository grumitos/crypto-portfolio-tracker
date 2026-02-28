// ── Shared animated output helpers ──
// Reusable wrappers over animation.ts for currency, percent, and text outputs.

import { formatUSD, formatPct } from './calculator';
import {
    setAnimatedNumber,
    setAnimatedText,
    stopValueAnimation,
} from './animation';

const DEFAULT_NUMBER_ANIM_MS = 560;

const valueAnimMap = new WeakMap<HTMLElement, number>();
const textAnimMap = new WeakMap<HTMLElement, number>();

// ── Stop helpers ──

export function stopAllAnimations(el: HTMLElement | null): void {
    stopValueAnimation(valueAnimMap, el);
    stopValueAnimation(textAnimMap, el);
}

// ── Currency output ──

export function animateCurrency(
    el: HTMLElement | null,
    value: number,
    animate: boolean,
    durationMs = DEFAULT_NUMBER_ANIM_MS,
): void {
    if (!el) return;
    stopValueAnimation(textAnimMap, el);
    setAnimatedNumber(
        valueAnimMap,
        el,
        value,
        (next) => formatUSD(next),
        { enabled: animate, durationMs, allowRememberedStart: false },
    );
}

// ── Percent output ──

export function animatePercent(
    el: HTMLElement | null,
    value: number,
    animate: boolean,
    signed = false,
    durationMs = DEFAULT_NUMBER_ANIM_MS,
): void {
    if (!el) return;
    stopValueAnimation(textAnimMap, el);
    setAnimatedNumber(
        valueAnimMap,
        el,
        value,
        (next) => (signed ? formatPct(next) : `${next.toFixed(2)}%`),
        { enabled: animate, durationMs, allowRememberedStart: false },
    );
}

// ── Number output ──

export function animateNumber(
    el: HTMLElement | null,
    value: number | null,
    formatter: (next: number) => string,
    animate: boolean,
    durationMs = DEFAULT_NUMBER_ANIM_MS,
): void {
    if (!el) return;
    stopValueAnimation(textAnimMap, el);
    if (!Number.isFinite(value)) {
        animateTextFade(el, '---', animate);
        return;
    }
    setAnimatedNumber(
        valueAnimMap,
        el,
        value as number,
        (next) => formatter(next),
        { enabled: animate, durationMs, allowRememberedStart: false },
    );
}

// ── Text outputs ──

export function animateTextFade(
    el: HTMLElement | null,
    text: string,
    animate: boolean,
): void {
    if (!el) return;
    stopValueAnimation(valueAnimMap, el);
    delete el.dataset.numericValue;
    setAnimatedText(textAnimMap, el, text, {
        enabled: animate,
        mode: 'fade',
        className: 'text-swap',
    });
}

export function animateTextScramble(
    el: HTMLElement | null,
    text: string,
    animate: boolean,
    durationMs = 260,
): void {
    if (!el) return;
    stopValueAnimation(valueAnimMap, el);
    delete el.dataset.numericValue;
    setAnimatedText(textAnimMap, el, text, {
        enabled: animate,
        mode: 'scramble',
        className: 'text-swap',
        durationMs,
    });
}

export function setStaticOutput(el: HTMLElement | null, text: string): void {
    if (!el) return;
    stopAllAnimations(el);
    delete el.dataset.numericValue;
    el.textContent = text;
}
