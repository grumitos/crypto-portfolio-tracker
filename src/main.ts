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
  iconArchive,
  iconSun,
  iconMoon,
} from './utils/icons';
import type { View } from './types';
import { renderBackupModal, bindBackupEvents } from './components/backup';
import { enhanceNumberSteppers } from './utils/number-stepper';
import { getCurrentView, initRouter, navigateTo, handleTransitionEntry } from './utils/router';
import { onStorageChange } from './utils/storage';
import { openModal } from './utils/modal-manager';

let disposeActiveView: (() => void) | null = null;

function themeIcon(): string {
  return getResolvedTheme() === 'dark' ? iconSun(15) : iconMoon(15);
}

function init(): void {
  const app = document.getElementById('app');
  if (!app) return;

  initTheme();

  // Render shell (header + nav + backup modal) once
  app.innerHTML = `
    <header class="app-header">
      <div class="app-brand">
        <h1 class="app-title">Crypto <span>Portfolio Tracker</span></h1>
        <div class="app-last-update" id="app-last-update">Actualizado: pendiente</div>
      </div>
      <nav class="nav">
        <button class="nav-btn active" data-view="dashboard">${iconDashboard(15)}Dashboard</button>
        <button class="nav-btn" data-view="positions">${iconLayers(15)}Posiciones</button>
        <button class="nav-btn" data-view="simulator">${iconTrendingUp(15)}Simulador</button>
        <button class="nav-btn" data-view="calculadora">${iconCalculator(15)}Calculadora</button>
        <button class="nav-btn" id="btn-backup" title="Exportar/Importar datos">${iconArchive(15)}</button>
        <button class="theme-toggle" id="btn-theme" title="Cambiar tema">${themeIcon()}</button>
      </nav>
    </header>
    <main id="view-container"></main>
    ${renderBackupModal()}
  `;

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

  const onStateChange = () => renderView(app, getCurrentView());
  bindBackupEvents(app, onStateChange);
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

    // Ctrl+S / Cmd+S → open backup modal
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      openModal(app.querySelector('#modal-backup'));
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
