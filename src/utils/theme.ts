// ── Theme Management ──
// Handles light/dark mode with system preference detection,
// localStorage persistence, and runtime theme switching.

const STORAGE_KEY = 'crypto-theme';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ChartColors {
  line: string;
  fill: string;
  beTarget: string;
  goalTarget: string;
  grid: string;
  tick: string;
  legend: string;
  pointBg: string;
}

const CHART_COLORS_LIGHT: ChartColors = {
  line: '#C96442',
  fill: 'rgba(201, 100, 66, 0.16)',
  beTarget: 'rgba(201, 100, 66, 0.42)',
  goalTarget: 'rgba(106, 124, 82, 0.36)',
  grid: 'rgba(31, 30, 29, 0.12)',
  tick: '#6E6A63',
  legend: '#3F3D39',
  pointBg: '#C96442',
};

const CHART_COLORS_DARK: ChartColors = {
  line: '#DF805F',
  fill: 'rgba(223, 128, 95, 0.22)',
  beTarget: 'rgba(223, 128, 95, 0.46)',
  goalTarget: 'rgba(158, 174, 134, 0.42)',
  grid: 'rgba(222, 220, 209, 0.16)',
  tick: '#B7B1A3',
  legend: '#DED9CB',
  pointBg: '#DF805F',
};

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

export function getChartColors(): ChartColors {
  return getResolvedTheme() === 'dark' ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;
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
    meta.content = resolved === 'dark' ? '#262624' : '#FAF9F5';
  }

  // Update favicon stroke color
  const faviconStroke = resolved === 'dark' ? '%23FAF9F5' : '%23141413';
  const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (favicon) {
    favicon.href = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='${faviconStroke}' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='22 7 13.5 15.5 8.5 10.5 2 17'/%3E%3Cpolyline points='16 7 22 7 22 13'/%3E%3C/svg%3E`;
  }

  // Notify listeners
  for (const cb of listeners) {
    cb(resolved);
  }
}
