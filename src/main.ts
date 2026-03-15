import './styles/global.css';
import { renderDashboard } from './components/dashboard';
import { renderPositions } from './components/positions';
import { renderSimulator } from './components/simulator';
import { renderCalculadora } from './components/calculadora';
import { initTheme, toggleTheme, getResolvedTheme } from './utils/theme';
import { syncApiLastUpdatedLabel } from './utils/api-status';
import {
  iconDashboard,
  iconLayers,
  iconTrendingUp,
  iconCalculator,
  iconSettings,
  iconSun,
  iconMoon,
} from './utils/icons';
import type { View } from './types';
import { enhanceNumberSteppers } from './utils/number-stepper';
import { getCurrentView, initRouter, navigateTo, handleTransitionEntry } from './utils/router';
import { onStorageChange } from './utils/storage';
import { openApiConfigModal } from './components/positions/api-config-modal';
import { renderAppShell } from './components/app-shell.template';
import type { AppShellNavItem } from './components/app-shell.constants';
import { applyTypographyConfig } from './utils/typography';

let disposeActiveView: (() => void) | null = null;

applyTypographyConfig();

function themeIcon(): string {
  return getResolvedTheme() === 'dark' ? iconSun(15) : iconMoon(15);
}

function init(): void {
  const app = document.getElementById('app');
  if (!app) return;

  initTheme();

  const navItems: AppShellNavItem[] = [
    { view: 'dashboard', label: 'Dashboard', icon: iconDashboard(15), active: true },
    { view: 'positions', label: 'Posiciones', icon: iconLayers(15), active: false },
    { view: 'simulator', label: 'Simulador', icon: iconTrendingUp(15), active: false },
    { view: 'calculadora', label: 'Calculadora', icon: iconCalculator(15), active: false },
  ];
  app.innerHTML = renderAppShell(iconSettings(15), themeIcon(), navItems);

  // Nav events (bound once)
  app.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextView = (btn as HTMLElement).dataset.view as View;
      if (nextView === getCurrentView()) return;

      if (window.location.hash.slice(1) !== nextView) {
        window.location.hash = nextView;
      } else {
        navigateTo(nextView, (v) => renderView(app, v));
      }
    });
  });

  // Theme toggle (bound once)
  app.querySelector('#btn-theme')?.addEventListener('click', () => {
    toggleTheme();
    const themeBtn = app.querySelector('#btn-theme');
    if (themeBtn) themeBtn.innerHTML = themeIcon();
  });

  app.querySelector('#btn-config')?.addEventListener('click', () => {
    openApiConfigModal();
  });

  enhanceNumberSteppers(app);
  syncApiLastUpdatedLabel();

  initRouter((view) => renderView(app, view));
  renderView(app, getCurrentView());

  // Re-render when another tab modifies localStorage
  onStorageChange(() => renderView(app, getCurrentView()));

  // Keyboard shortcuts (bound once)
  const viewKeys: Record<string, View> = {
    '1': 'dashboard',
    '2': 'positions',
    '3': 'simulator',
    '4': 'calculadora',
  };

  document.addEventListener('keydown', (e) => {
    // Ignore when typing in an input/textarea/select
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Ctrl+S / Cmd+S → open unified config modal
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      openApiConfigModal();
      return;
    }

    // 1-4 → navigate views
    const view = viewKeys[e.key];
    if (view && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (view !== getCurrentView()) {
        window.location.hash = view;
      }
    }
  });
}

function updateActiveNavButton(app: HTMLElement, view: View): void {
  app.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    const isActive = (btn as HTMLElement).dataset.view === view;
    btn.classList.toggle('active', isActive);
    if (isActive) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });
}

function renderView(app: HTMLElement, view: View): void {
  disposeActiveView?.();
  disposeActiveView = null;

  const viewContainer = document.getElementById('view-container');
  if (!viewContainer) return;

  updateActiveNavButton(app, view);
  syncApiLastUpdatedLabel();

  const onStateChange = () => renderView(app, getCurrentView());

  switch (view) {
    case 'dashboard':
      disposeActiveView = renderDashboard(viewContainer);
      break;
    case 'positions':
      disposeActiveView = renderPositions(viewContainer, onStateChange);
      break;
    case 'simulator':
      disposeActiveView = renderSimulator(viewContainer);
      break;
    case 'calculadora':
      disposeActiveView = renderCalculadora(viewContainer);
      break;
  }

  handleTransitionEntry(viewContainer);
}

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
