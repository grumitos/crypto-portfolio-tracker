const STORAGE_KEY = 'crypto-theme';
const THEME_COLOR_VAR = '--browser-theme-color';

const CSS_FALLBACKS = {
  browserThemeColorLight: '#FAF9F7',
  browserThemeColorDark: '#131312',
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

  // El token se lee despues de fijar data-theme: si no, siempre devolveria el valor claro.
  const browserThemeColor = readThemeVariable(
    THEME_COLOR_VAR,
    resolved === 'dark'
      ? CSS_FALLBACKS.browserThemeColorDark
      : CSS_FALLBACKS.browserThemeColorLight,
  );

  // Update meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (meta) {
    meta.content = browserThemeColor;
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
