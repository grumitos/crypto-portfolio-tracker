import { afterEach, beforeEach, describe, expect, it, vi } from '#test';
import { createMemoryStorage, resetDom } from '../test/test-utils';
import { resetApiStatusForTests } from './api-status';

async function loadApiStatus() {
  return import('./api-status');
}

function addStatusTarget(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'app-last-update';
  document.body.appendChild(el);
  return el;
}

describe('api-status utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetApiStatusForTests();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    resetDom();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shows pending label before any successful market sync', async () => {
    const target = addStatusTarget();
    const apiStatus = await loadApiStatus();
    apiStatus.syncApiLastUpdatedLabel();

    expect(target.textContent).toBe('Actualizado: pendiente');
    expect(target.classList.contains('is-error')).toBe(false);
  });

  it('registers success and clears previous failure state', async () => {
    vi.setSystemTime(new Date('2026-02-21T00:00:10.000Z'));
    const target = addStatusTarget();
    const apiStatus = await loadApiStatus();

    apiStatus.registerApiFailure();
    expect(target.textContent).toContain('sin conexión');
    expect(target.textContent).toContain('reintento en 60s');
    expect(target.classList.contains('is-error')).toBe(true);

    apiStatus.registerApiLastUpdatedAt(new Date('2026-02-21T00:00:05.000Z').getTime());

    expect(target.textContent).toBe('se actualiza en 60s');
    expect(target.classList.contains('is-error')).toBe(false);
  });

  it('renders error label with last successful timestamp when failure happens', async () => {
    vi.setSystemTime(new Date('2026-02-21T00:02:00.000Z'));
    const target = addStatusTarget();
    const apiStatus = await loadApiStatus();

    apiStatus.registerApiLastUpdatedAt(new Date('2026-02-21T00:01:30.000Z').getTime());
    apiStatus.registerApiFailure();

    expect(target.textContent).toContain('Actualización: error');
    expect(target.textContent).toContain('último dato');
    expect(target.textContent).toContain('reintento en 60s');
    expect(target.classList.contains('is-error')).toBe(true);
  });

  it('keeps the maximum timestamp across consecutive updates', async () => {
    const apiStatus = await loadApiStatus();

    apiStatus.registerApiLastUpdatedAt(2000);
    apiStatus.registerApiLastUpdatedAt(1000);
    apiStatus.registerApiLastUpdatedAt(3000);

    expect(apiStatus.getLastApiUpdatedAt()).toBe(3000);
  });

  it('refreshes relative label over time using ticker', async () => {
    vi.setSystemTime(new Date('2026-02-21T00:00:00.000Z'));
    const target = addStatusTarget();
    const apiStatus = await loadApiStatus();

    apiStatus.registerApiLastUpdatedAt(new Date('2026-02-20T23:59:59.000Z').getTime());
    expect(target.textContent).toBe('se actualiza en 60s');

    vi.advanceTimersByTime(61_000);
    expect(target.textContent).toBe('se actualiza en 0s');
  });
});
