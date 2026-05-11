// ── Shared animation utilities ──

export type TextAnimationMode = 'fade' | 'scramble';

interface NumberAnimationOptions {
  enabled?: boolean;
  durationMs?: number;
  epsilon?: number;
  stabilityKey?: string;
  allowRememberedStart?: boolean;
}

interface TextAnimationOptions {
  enabled?: boolean;
  durationMs?: number;
  mode?: TextAnimationMode;
  className?: string;
  stabilityKey?: string;
}

const DEFAULT_SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const MAX_REMEMBERED_VALUES = 512;
const lastNumericValueByKey = new Map<string, number>();
const lastTextValueByKey = new Map<string, string>();

function setRememberedValue<T>(map: Map<string, T>, key: string, value: T): void {
  // Keep insertion order to evict oldest remembered keys when the map grows.
  if (map.has(key)) map.delete(key);
  map.set(key, value);

  if (map.size <= MAX_REMEMBERED_VALUES) return;
  const oldestKey = map.keys().next().value as string | undefined;
  if (oldestKey) map.delete(oldestKey);
}

function resolveStabilityKey(el: HTMLElement, explicitKey?: string): string | null {
  const trimmed = explicitKey?.trim();
  if (trimmed) return trimmed;
  if (el.id) return `#${el.id}`;
  return null;
}

function setRememberedNumber(stabilityKey: string | null, value: number): void {
  if (!stabilityKey) return;
  setRememberedValue(lastNumericValueByKey, stabilityKey, value);
}

function getRememberedNumber(stabilityKey: string | null): number | undefined {
  if (!stabilityKey) return undefined;
  return lastNumericValueByKey.get(stabilityKey);
}

function setRememberedText(stabilityKey: string | null, value: string): void {
  if (!stabilityKey) return;
  setRememberedValue(lastTextValueByKey, stabilityKey, value);
}

function getRememberedText(stabilityKey: string | null): string | undefined {
  if (!stabilityKey) return undefined;
  return lastTextValueByKey.get(stabilityKey);
}

export function resetAnimationMemoryForTests(): void {
  lastNumericValueByKey.clear();
  lastTextValueByKey.clear();
}

export function getAnimationMemorySizesForTests(): { numeric: number; text: number } {
  return {
    numeric: lastNumericValueByKey.size,
    text: lastTextValueByKey.size,
  };
}

function requestTrackedFrame(
  map: WeakMap<HTMLElement, number>,
  el: HTMLElement,
  step: FrameRequestCallback,
): void {
  // Placeholder avoids stale ids when RAF callbacks are executed synchronously (tests).
  map.set(el, -1);
  const animationId = window.requestAnimationFrame(step);
  if (map.has(el)) {
    map.set(el, animationId);
  }
}

/**
 * Cancel a running requestAnimationFrame tracked in a WeakMap.
 */
export function stopValueAnimation(
  map: WeakMap<HTMLElement, number>,
  el: HTMLElement | null,
): void {
  if (!el) return;
  const animationId = map.get(el);
  if (typeof animationId === 'number') {
    window.cancelAnimationFrame(animationId);
    map.delete(el);
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    if (typeof process !== 'undefined' ? process.env.PUBLIC_APP_ENV !== 'production' : true) {
      console.warn('[animation] matchMedia unavailable', err);
    }
    return false;
  }
}

/**
 * Parse a numeric value from an element's text content (strips non-numeric chars).
 */
function parseNumericFromText(raw: string): number {
  const cleaned = raw.replace(/[^\d.-]+/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.' || cleaned === '.-') {
    return NaN;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Read the current numeric value from an element's dataset or text content.
 */
export function getElementNumericValue(el: HTMLElement, fallback: number): number {
  const fromDataset = Number(el.dataset.numericValue);
  if (Number.isFinite(fromDataset)) return fromDataset;
  const fromText = parseNumericFromText(el.textContent ?? '');
  return Number.isFinite(fromText) ? fromText : fallback;
}

/**
 * Animate numeric outputs (currency, percentages, durations) using RAF interpolation.
 */
export function setAnimatedNumber(
  map: WeakMap<HTMLElement, number>,
  el: HTMLElement | null,
  end: number,
  formatter: (value: number) => string,
  options: NumberAnimationOptions = {},
): void {
  if (!el) return;

  const enabled = options.enabled === true && !prefersReducedMotion();
  const durationMs = options.durationMs ?? 180;
  const epsilon = options.epsilon ?? 0.0001;
  const stabilityKey = resolveStabilityKey(el, options.stabilityKey);
  const allowRememberedStart = options.allowRememberedStart !== false;

  stopValueAnimation(map, el);

  if (!Number.isFinite(end)) {
    if (stabilityKey) lastNumericValueByKey.delete(stabilityKey);
    delete el.dataset.numericValue;
    return;
  }

  const liveStart = getElementNumericValue(el, Number.NaN);
  const rememberedStart = getRememberedNumber(stabilityKey);
  const start = Number.isFinite(liveStart)
    ? liveStart
    : allowRememberedStart && Number.isFinite(rememberedStart)
      ? (rememberedStart as number)
      : end;
  const formattedEnd = formatter(end);

  if (!enabled) {
    el.dataset.numericValue = String(end);
    el.textContent = formattedEnd;
    setRememberedNumber(stabilityKey, end);
    return;
  }

  const formattedStart = formatter(start);
  if (formattedStart === formattedEnd || Math.abs(start - end) < epsilon) {
    el.dataset.numericValue = String(end);
    el.textContent = formattedEnd;
    setRememberedNumber(stabilityKey, end);
    return;
  }

  let startedAt: number | null = null;
  const step = (timestamp: number) => {
    if (startedAt === null) startedAt = timestamp;
    const progress = Math.min((timestamp - startedAt) / durationMs, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (end - start) * eased;

    el.dataset.numericValue = String(current);
    el.textContent = formatter(current);

    if (progress < 1) {
      requestTrackedFrame(map, el, step);
      return;
    }

    el.dataset.numericValue = String(end);
    el.textContent = formattedEnd;
    setRememberedNumber(stabilityKey, end);
    map.delete(el);
  };

  requestTrackedFrame(map, el, step);
}

function randomScrambleChar(target: string): string {
  if (target === ' ' || target === '\u00a0') return target;
  if (/\d/.test(target)) return String(Math.floor(Math.random() * 10));
  if (/[A-Z]/.test(target)) {
    return DEFAULT_SCRAMBLE_CHARS[Math.floor(Math.random() * 26)];
  }
  if (/[a-z]/.test(target)) {
    return DEFAULT_SCRAMBLE_CHARS[26 + Math.floor(Math.random() * 26)];
  }
  if (/[^\w\s]/.test(target)) return target;
  return DEFAULT_SCRAMBLE_CHARS[Math.floor(Math.random() * DEFAULT_SCRAMBLE_CHARS.length)];
}

/**
 * Animate text outputs with simple fade or scramble transitions.
 */
export function setAnimatedText(
  map: WeakMap<HTMLElement, number>,
  el: HTMLElement | null,
  text: string,
  options: TextAnimationOptions = {},
): void {
  if (!el) return;

  const mode = options.mode ?? 'fade';
  const className = options.className ?? 'text-swap';
  const enabled = options.enabled === true && !prefersReducedMotion();
  const stabilityKey = resolveStabilityKey(el, options.stabilityKey);
  const rememberedText = getRememberedText(stabilityKey);

  stopValueAnimation(map, el);

  if (!enabled || el.textContent === text || rememberedText === text) {
    el.textContent = text;
    setRememberedText(stabilityKey, text);
    return;
  }

  if (mode === 'fade') {
    el.textContent = text;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setRememberedText(stabilityKey, text);
    return;
  }

  const liveText = el.textContent ?? '';
  const startText = liveText.length > 0 ? liveText : (rememberedText ?? '');
  const durationMs = options.durationMs ?? 180;
  const finalText = text;
  const startLength = startText.length;
  const finalLength = finalText.length;

  let startedAt: number | null = null;
  const step = (timestamp: number) => {
    if (startedAt === null) startedAt = timestamp;
    const progress = Math.min((timestamp - startedAt) / durationMs, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const settledCount = Math.floor(finalLength * eased);
    const dynamicLength = Math.max(
      0,
      Math.round(startLength + (finalLength - startLength) * eased),
    );

    let out = '';
    for (let i = 0; i < dynamicLength; i++) {
      if (i < settledCount && i < finalLength) {
        out += finalText[i];
        continue;
      }

      const targetChar = i < finalLength ? finalText[i] : '';
      out += randomScrambleChar(
        targetChar ||
          DEFAULT_SCRAMBLE_CHARS[Math.floor(Math.random() * DEFAULT_SCRAMBLE_CHARS.length)],
      );
    }

    el.textContent = out;

    if (progress < 1) {
      requestTrackedFrame(map, el, step);
      return;
    }

    el.textContent = finalText;
    setRememberedText(stabilityKey, finalText);
    map.delete(el);
  };

  requestTrackedFrame(map, el, step);
}
