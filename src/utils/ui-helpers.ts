// ── Shared UI helper functions ──

/**
 * Renders a skeleton loading placeholder span.
 */
export function skeletonSpan(width = '80px'): string {
  return `<span class="skeleton skeleton-number" style="width:${width}">&nbsp;</span>`;
}
