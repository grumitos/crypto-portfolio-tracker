const API_ERROR_BANNER_ID = 'api-error-banner';
const API_ERROR_VISIBLE_CLASS = 'is-visible';
const API_ERROR_HIDE_DELAY_MS = 5500;

let hideTimer: ReturnType<typeof setTimeout> | null = null;

function hideBanner(banner: HTMLElement): void {
  banner.classList.remove(API_ERROR_VISIBLE_CLASS);
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function getBannerHost(): HTMLElement {
  const inlineHost = document.querySelector('[data-inline-status-region]');
  return inlineHost instanceof HTMLElement ? inlineHost : document.body;
}

function ensureApiErrorBanner(): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const host = getBannerHost();
  const existing = document.getElementById(API_ERROR_BANNER_ID);
  if (existing) {
    if (existing.parentElement !== host) host.appendChild(existing);
    return existing;
  }

  const banner = document.createElement('div');
  banner.id = API_ERROR_BANNER_ID;
  banner.className = 'api-error-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');

  const text = document.createElement('span');
  text.className = 'api-error-banner-text';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'api-error-banner-close';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => hideBanner(banner));

  banner.append(text, closeBtn);
  host.appendChild(banner);
  return banner;
}

export function showApiErrorBanner(message = 'No se pudo actualizar precios desde la API.'): void {
  const banner = ensureApiErrorBanner();
  if (!banner) return;

  const text = banner.querySelector('.api-error-banner-text');
  if (text) text.textContent = message;
  banner.classList.add(API_ERROR_VISIBLE_CLASS);

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    banner.classList.remove(API_ERROR_VISIBLE_CLASS);
    hideTimer = null;
  }, API_ERROR_HIDE_DELAY_MS);
}
