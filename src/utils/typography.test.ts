import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDom } from '../test/test-utils';

describe('typography config', () => {
  beforeEach(() => {
    vi.resetModules();
    resetDom();
    document.head.innerHTML = '';
  });

  it('injects font preconnects, stylesheet and root font variables', async () => {
    const { applyTypographyConfig } = await import('./typography');

    applyTypographyConfig({
      stylesheetHref: 'https://example.test/fonts.css',
      preconnectHosts: ['https://fonts.example.test', 'https://static.example.test'],
      fontSans: 'Inter, sans-serif',
      fontMono: 'Mono, monospace',
    });

    const preconnects = [
      ...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preconnect"]'),
    ];
    expect(preconnects.map((link) => link.href)).toEqual([
      'https://fonts.example.test/',
      'https://static.example.test/',
    ]);
    expect(preconnects[0].crossOrigin).toBeNull();
    expect(preconnects[1].crossOrigin).toBe('anonymous');

    const stylesheet = document.getElementById('app-font-stylesheet') as HTMLLinkElement | null;
    expect(stylesheet?.href).toBe('https://example.test/fonts.css');
    expect(document.documentElement.style.getPropertyValue('--font-family-ui')).toBe(
      'Inter, sans-serif',
    );
    expect(document.documentElement.style.getPropertyValue('--font-family-mono')).toBe(
      'Mono, monospace',
    );
  });

  it('reuses existing preconnects and updates an existing stylesheet link', async () => {
    const existingPreconnect = document.createElement('link');
    existingPreconnect.rel = 'preconnect';
    existingPreconnect.href = 'https://fonts.example.test';
    document.head.appendChild(existingPreconnect);

    const existingStylesheet = document.createElement('link');
    existingStylesheet.id = 'app-font-stylesheet';
    existingStylesheet.rel = 'stylesheet';
    existingStylesheet.href = 'https://old.example.test/fonts.css';
    document.head.appendChild(existingStylesheet);

    const { applyTypographyConfig } = await import('./typography');
    applyTypographyConfig({
      stylesheetHref: 'https://new.example.test/fonts.css',
      preconnectHosts: ['https://fonts.example.test'],
      fontSans: 'System UI',
      fontMono: 'Mono',
    });

    expect(document.head.querySelectorAll('link[rel="preconnect"]')).toHaveLength(1);
    expect(existingStylesheet.href).toBe('https://new.example.test/fonts.css');
  });
});
