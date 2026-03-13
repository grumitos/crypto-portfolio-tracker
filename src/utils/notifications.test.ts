import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDom } from '../test/test-utils';

describe('notifications utils', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    resetDom();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('creates API error banner only once', async () => {
    const notifications = await import('./notifications');
    notifications.showApiErrorBanner('primer error');
    notifications.showApiErrorBanner('segundo error');

    const banners = document.querySelectorAll('#api-error-banner');
    expect(banners).toHaveLength(1);
  });

  it('reuses banner and updates message on repeated calls', async () => {
    const notifications = await import('./notifications');
    notifications.showApiErrorBanner('fallo 1');
    notifications.showApiErrorBanner('fallo 2');

    const banner = document.getElementById('api-error-banner') as HTMLElement;
    const text = banner.querySelector('.api-error-banner-text') as HTMLElement;
    expect(text.textContent).toBe('fallo 2');
    expect(banner.classList.contains('is-visible')).toBe(true);
  });

  it('auto-hides banner after configured delay', async () => {
    const notifications = await import('./notifications');
    notifications.showApiErrorBanner('fallo temporal');
    const banner = document.getElementById('api-error-banner') as HTMLElement;

    expect(banner.classList.contains('is-visible')).toBe(true);
    vi.advanceTimersByTime(5500);
    expect(banner.classList.contains('is-visible')).toBe(false);
  });
});
