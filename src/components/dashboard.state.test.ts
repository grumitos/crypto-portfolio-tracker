import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../test/test-utils';
import { DASHBOARD_VIEW_KEY } from '../utils/storage';
import {
  clearDashboardLegendState,
  loadDashboardLegendState,
  saveDashboardLegendState,
} from './dashboard.state';

describe('dashboard view state', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it('loads fallback state when no dashboard view is persisted', () => {
    expect(loadDashboardLegendState({ be: true, goal: true })).toEqual({ be: true, goal: true });
    expect(loadDashboardLegendState({ be: false, goal: true })).toEqual({ be: false, goal: true });
  });

  it('loads legend state from current persisted shape', () => {
    localStorage.setItem(DASHBOARD_VIEW_KEY, JSON.stringify({ legend: { be: false, goal: true } }));
    expect(loadDashboardLegendState({ be: true, goal: true })).toEqual({ be: false, goal: true });
  });

  it('loads legend state from legacy persisted shape', () => {
    localStorage.setItem(DASHBOARD_VIEW_KEY, JSON.stringify({ be: true, goal: false }));
    expect(loadDashboardLegendState({ be: true, goal: true })).toEqual({ be: true, goal: false });
  });

  it('falls back when persisted json is malformed', () => {
    localStorage.setItem(DASHBOARD_VIEW_KEY, '{bad');
    expect(loadDashboardLegendState({ be: false, goal: true })).toEqual({ be: false, goal: true });
  });

  it('sanitizes invalid persisted state to keep at least one legend active', () => {
    localStorage.setItem(
      DASHBOARD_VIEW_KEY,
      JSON.stringify({ legend: { be: false, goal: false } }),
    );
    expect(loadDashboardLegendState({ be: true, goal: true })).toEqual({ be: true, goal: true });
  });

  it('saves and clears dashboard legend state', () => {
    saveDashboardLegendState({ be: false, goal: true });
    expect(localStorage.getItem(DASHBOARD_VIEW_KEY)).toBe(
      JSON.stringify({ legend: { be: false, goal: true } }),
    );

    clearDashboardLegendState();
    expect(localStorage.getItem(DASHBOARD_VIEW_KEY)).toBeNull();
  });
});
