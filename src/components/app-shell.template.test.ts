import { describe, expect, it } from '#test';
import { renderAppShell } from './app-shell.template';
import type { AppShellNavItem } from './app-shell.constants';

const navItems: AppShellNavItem[] = [
  { view: 'dashboard', label: 'Dashboard', active: true },
  { view: 'positions', label: 'Posiciones', active: false },
  { view: 'simulator', label: 'Simulador', active: false },
  { view: 'calculadora', label: 'Calculadora', active: false },
];

describe('renderAppShell', () => {
  it('renders live update status and current navigation state', () => {
    document.body.innerHTML = renderAppShell('sync', 'config', 'theme', navItems, false);

    const status = document.getElementById('app-last-update');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.getAttribute('aria-atomic')).toBe('true');

    expect(document.querySelector('.nav-btn.active')?.textContent).toContain('Dashboard');
    expect(document.querySelector('.nav-btn.active')?.getAttribute('aria-current')).toBe('page');
    expect(document.getElementById('btn-theme')?.getAttribute('aria-pressed')).toBe('false');
  });
});
