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

/**
 * Une los datos de una linea de contexto con un punto medio de espaciado uniforme: el
 * espacio normal queda corto junto al punto de marca, asi que el margen lo fija el CSS.
 */
export function joinContextMeta(segments: string[]): string {
  return segments.join('<span class="context-meta-sep" aria-hidden="true"> · </span>');
}

/** Proveedores con color de marca propio; el color vive en `--brand-*` de variables.css. */
const PROVIDER_BRANDS: Readonly<Record<string, string>> = {
  Binance: 'binance',
  Bybit: 'bybit',
  Hyperliquid: 'hyperliquid',
};

/**
 * Nombre de un proveedor precedido de un punto con su color de marca. El texto conserva
 * el color de la interfaz: los colores de marca no llegan al contraste minimo en el tema
 * claro. `label` permite un texto distinto del nombre (p. ej. "Conexion Hyperliquid").
 */
export function providerName(name: string, label: string = name): string {
  const safeLabel = escapeHtml(label);
  const brand = PROVIDER_BRANDS[name];
  if (!brand) return safeLabel;
  return `<span class="provider-name"><span class="provider-dot provider-dot--${brand}" aria-hidden="true"></span>${safeLabel}</span>`;
}
