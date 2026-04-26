const STORAGE_KEY = 'crypto-theme';
const THEME_COLOR_VAR = '--browser-theme-color';
const FAVICON_STROKE_VAR = '--favicon-stroke-encoded';

const CSS_FALLBACKS = {
  browserThemeColorLight: '#F8F8F6',
  browserThemeColorDark: '#1F1F1E',
  faviconStrokeLight: '%23121212',
  faviconStrokeDark: '%23F8F8F6',
} as const;

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

type ThemeChangeCallback = (theme: ResolvedTheme) => void;
const listeners: ThemeChangeCallback[] = [];

// ── Public API ──

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

export function getResolvedTheme(): ResolvedTheme {
  const pref = getThemePreference();
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(preference: ThemePreference): void {
  localStorage.setItem(STORAGE_KEY, preference);
  applyTheme();
}

export function toggleTheme(): void {
  const current = getResolvedTheme();
  setTheme(current === 'dark' ? 'light' : 'dark');
}

export function onThemeChange(callback: ThemeChangeCallback): void {
  listeners.push(callback);
}

export function initTheme(): void {
  applyTheme();

  // Listen for system preference changes (only matters when preference = 'system')
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePreference() === 'system') {
      applyTheme();
    }
  });
}

// ── Internal ──

function applyTheme(): void {
  const resolved = getResolvedTheme();
  const root = document.documentElement;

  if (resolved === 'dark') {
    root.dataset.theme = 'dark';
  } else {
    delete root.dataset.theme;
  }

  // Update meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (meta) {
    meta.content = readThemeVariable(
      THEME_COLOR_VAR,
      resolved === 'dark'
        ? CSS_FALLBACKS.browserThemeColorDark
        : CSS_FALLBACKS.browserThemeColorLight,
    );
  }

  // Update favicon stroke color
  const faviconStroke = readThemeVariable(
    FAVICON_STROKE_VAR,
    resolved === 'dark' ? CSS_FALLBACKS.faviconStrokeDark : CSS_FALLBACKS.faviconStrokeLight,
  );
  const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (favicon) {
    favicon.href = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='${faviconStroke}' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='22 7 13.5 15.5 8.5 10.5 2 17'/%3E%3Cpolyline points='16 7 22 7 22 13'/%3E%3C/svg%3E`;
  }

  // Notify listeners
  for (const cb of listeners) {
    cb(resolved);
  }
}

function readThemeVariable(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
