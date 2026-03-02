import { sanitizeDashboardLegendState } from '../utils/dashboard-goal';
import { DASHBOARD_VIEW_KEY } from '../utils/storage';
import type { DashboardLegendState } from '../types';

interface DashboardViewState {
  legend?: Partial<DashboardLegendState>;
  be?: unknown;
  goal?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toBooleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function parseLegendState(raw: unknown): Partial<DashboardLegendState> | null {
  if (!isRecord(raw)) return null;

  const view = raw as DashboardViewState;
  if (isRecord(view.legend)) {
    return {
      be: toBooleanOrUndefined(view.legend.be),
      goal: toBooleanOrUndefined(view.legend.goal),
    };
  }

  return {
    be: toBooleanOrUndefined(view.be),
    goal: toBooleanOrUndefined(view.goal),
  };
}

export function loadDashboardLegendState(defaultState: DashboardLegendState): DashboardLegendState {
  const fallback = sanitizeDashboardLegendState(defaultState);
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(DASHBOARD_VIEW_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    const legend = parseLegendState(parsed);
    if (!legend) return fallback;

    return sanitizeDashboardLegendState({
      be: legend.be ?? fallback.be,
      goal: legend.goal ?? fallback.goal,
    });
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[dashboard.state] failed to load legend state', err);
    }
    return fallback;
  }
}

export function saveDashboardLegendState(state: DashboardLegendState): void {
  if (typeof localStorage === 'undefined') return;
  const next = sanitizeDashboardLegendState(state);
  localStorage.setItem(DASHBOARD_VIEW_KEY, JSON.stringify({ legend: next }));
}

export function clearDashboardLegendState(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(DASHBOARD_VIEW_KEY);
}
