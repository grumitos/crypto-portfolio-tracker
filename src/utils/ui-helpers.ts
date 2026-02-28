// ── Shared UI helper functions ──

/**
 * Renders a skeleton loading placeholder span.
 */
export function skeletonSpan(width = '80px'): string {
  return `<span class="skeleton skeleton-number" style="width:${width}">&nbsp;</span>`;
}

const htmlEscapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const htmlEscapeRe = /[&<>"']/g;

/**
 * Escape a string for safe interpolation into HTML templates (innerHTML).
 * Prevents XSS from user-controlled data like asset names or IDs.
 */
export function escapeHtml(str: string): string {
  return str.replace(htmlEscapeRe, (ch) => htmlEscapeMap[ch] ?? ch);
}
