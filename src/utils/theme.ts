const STORAGE_KEY = 'crypto-theme';
const THEME_COLOR_VAR = '--browser-theme-color';
const FAVICON_STROKE_VAR = '--favicon-stroke-encoded';

const CSS_FALLBACKS = {
  browserThemeColorLight: '#FAF9F5',
  browserThemeColorDark: '#262624',
  faviconStrokeLight: '%23141413',
  faviconStrokeDark: '%23FAF9F5',
  chartLineLight: '#cc7d5e',
  chartFillLight: 'rgba(204, 125, 94, 0.16)',
  chartBeLight: 'rgba(204, 125, 94, 0.42)',
  chartGoalLight: 'rgba(126, 164, 138, 0.36)',
  chartGridLight: 'rgba(45, 45, 43, 0.12)',
  chartTickLight: '#6b6860',
  chartLegendLight: '#3d3b37',
  chartPointLight: '#cc7d5e',
  chartLineDark: '#d4896b',
  chartFillDark: 'rgba(212, 137, 107, 0.22)',
  chartBeDark: 'rgba(212, 137, 107, 0.46)',
  chartGoalDark: 'rgba(159, 195, 171, 0.42)',
  chartGridDark: 'rgba(222, 220, 209, 0.16)',
  chartTickDark: '#b5b0a5',
  chartLegendDark: '#e6e3db',
  chartPointDark: '#d4896b',
} as const;

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
  const resolvedTheme = getResolvedTheme();
  return {
    line: readThemeVariable(
      '--chart-line',
      resolvedTheme === 'dark' ? CSS_FALLBACKS.chartLineDark : CSS_FALLBACKS.chartLineLight,
    ),
    fill: readThemeVariable(
      '--chart-fill',
      resolvedTheme === 'dark' ? CSS_FALLBACKS.chartFillDark : CSS_FALLBACKS.chartFillLight,
    ),
    beTarget: readThemeVariable(
      '--chart-target-be',
      resolvedTheme === 'dark' ? CSS_FALLBACKS.chartBeDark : CSS_FALLBACKS.chartBeLight,
    ),
    goalTarget: readThemeVariable(
      '--chart-target-goal',
      resolvedTheme === 'dark' ? CSS_FALLBACKS.chartGoalDark : CSS_FALLBACKS.chartGoalLight,
    ),
    grid: readThemeVariable(
      '--chart-grid',
      resolvedTheme === 'dark' ? CSS_FALLBACKS.chartGridDark : CSS_FALLBACKS.chartGridLight,
    ),
    tick: readThemeVariable(
      '--chart-tick',
      resolvedTheme === 'dark' ? CSS_FALLBACKS.chartTickDark : CSS_FALLBACKS.chartTickLight,
    ),
    legend: readThemeVariable(
      '--chart-legend',
      resolvedTheme === 'dark' ? CSS_FALLBACKS.chartLegendDark : CSS_FALLBACKS.chartLegendLight,
    ),
    pointBg: readThemeVariable(
      '--chart-point',
      resolvedTheme === 'dark' ? CSS_FALLBACKS.chartPointDark : CSS_FALLBACKS.chartPointLight,
    ),
  };
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
