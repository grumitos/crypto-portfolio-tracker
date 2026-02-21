const API_ERROR_BANNER_ID = 'api-error-banner';
const API_ERROR_VISIBLE_CLASS = 'is-visible';
const API_ERROR_HIDE_DELAY_MS = 5500;

let hideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureApiErrorBanner(): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const existing = document.getElementById(API_ERROR_BANNER_ID);
  if (existing) return existing;

  const banner = document.createElement('div');
  banner.id = API_ERROR_BANNER_ID;
  banner.className = 'api-error-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  document.body.appendChild(banner);
  return banner;
}

export function showApiErrorBanner(
  message = 'No se pudo actualizar precios desde la API.'
): void {
  const banner = ensureApiErrorBanner();
  if (!banner) return;

  banner.textContent = message;
  banner.classList.add(API_ERROR_VISIBLE_CLASS);

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    banner.classList.remove(API_ERROR_VISIBLE_CLASS);
    hideTimer = null;
  }, API_ERROR_HIDE_DELAY_MS);
}
