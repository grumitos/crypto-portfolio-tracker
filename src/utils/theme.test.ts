import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, resetDom } from '../test/test-utils';

interface MatchMediaController {
  setMatches: (next: boolean) => void;
}

function installMatchMedia(initialMatches: boolean): MatchMediaController {
  let listener: ((event: MediaQueryListEvent) => void) | null = null;
  let matches = initialMatches;

  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockImplementation(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_event: 'change', cb: (event: MediaQueryListEvent) => void) => {
        listener = cb;
      },
      removeEventListener: vi.fn(),
    })),
    configurable: true,
    writable: true,
  });

  return {
    setMatches: (next) => {
      matches = next;
      listener?.({ matches } as MediaQueryListEvent);
    },
  };
}

function addThemeMetaElements(): void {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  document.head.appendChild(meta);

  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  document.head.appendChild(favicon);
}

describe('theme utils', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    resetDom();
    document.head.innerHTML = '';
  });

  it('resolves theme from explicit and system preferences', async () => {
    installMatchMedia(true);
    const theme = await import('./theme');

    expect(theme.getThemePreference()).toBe('system');
    expect(theme.getResolvedTheme()).toBe('dark');

    theme.setTheme('light');
    expect(theme.getThemePreference()).toBe('light');
    expect(theme.getResolvedTheme()).toBe('light');
  });

  it('updates root dataset, meta theme-color and favicon when applying theme', async () => {
    installMatchMedia(false);
    addThemeMetaElements();
    const theme = await import('./theme');

    theme.setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect((document.querySelector('meta[name="theme-color"]') as HTMLMetaElement).content).toBe(
      '#262624',
    );
    expect((document.querySelector('link[rel="icon"]') as HTMLLinkElement).href).toContain(
      '%23FAF9F5',
    );

    theme.toggleTheme();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect((document.querySelector('meta[name="theme-color"]') as HTMLMetaElement).content).toBe(
      '#FAF9F5',
    );
    expect((document.querySelector('link[rel="icon"]') as HTMLLinkElement).href).toContain(
      '%23141413',
    );
  });

  it('returns chart colors according to resolved theme', async () => {
    const media = installMatchMedia(false);
    const theme = await import('./theme');
    const light = theme.getChartColors();

    theme.setTheme('system');
    media.setMatches(true);
    const dark = theme.getChartColors();

    expect(light.line).not.toBe(dark.line);
    expect(dark.grid).toContain('rgba');
  });

  it('notifies listeners on theme changes and reacts to system changes', async () => {
    const media = installMatchMedia(false);
    const theme = await import('./theme');
    const listener = vi.fn();
    theme.onThemeChange(listener);

    theme.setTheme('dark');
    expect(listener).toHaveBeenLastCalledWith('dark');

    theme.setTheme('system');
    theme.initTheme();
    media.setMatches(true);

    expect(listener).toHaveBeenLastCalledWith('dark');
  });
});
