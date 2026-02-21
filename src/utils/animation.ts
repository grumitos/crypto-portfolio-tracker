// ── Shared animation utilities ──
// Extracted from dashboard.ts and simulator.ts to eliminate duplication.

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

/**
 * Parse a numeric value from an element's text content (strips non-numeric chars).
 */
function parseNumericFromText(raw: string): number {
  const parsed = Number(raw.replace(/[^\d.-]+/g, ''));
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
