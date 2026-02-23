import './styles/global.css';
import { renderDashboard } from './components/dashboard';
import { renderPositions } from './components/positions';
import { renderSimulator } from './components/simulator';
import { renderCalculadora } from './components/calculadora';
import { initTheme, toggleTheme, getResolvedTheme } from './utils/theme';
import { syncApiLastUpdatedLabel } from './utils/api-status';
import { iconDashboard, iconLayers, iconTrendingUp, iconCalculator, iconArchive, iconSun, iconMoon } from './utils/icons';
import type { View } from './types';
import { renderBackupModal, bindBackupEvents } from './components/backup';
import { enhanceNumberSteppers } from './utils/number-stepper';
import { getCurrentView, initRouter, navigateTo, handleTransitionEntry } from './utils/router';

let disposeActiveView: (() => void) | null = null;

function init(): void {
  const app = document.getElementById('app');
  if (!app) return;

  initTheme();
  initRouter((view) => render(app, view));
  render(app, getCurrentView());
}

function themeIcon(): string {
  return getResolvedTheme() === 'dark' ? iconSun(15) : iconMoon(15);
}

function render(app: HTMLElement, view: View): void {
  disposeActiveView?.();
  disposeActiveView = null;

  app.innerHTML = `
    <header class="app-header">
      <div class="app-brand">
        <div class="app-title">Crypto <span>Portfolio Tracker</span></div>
        <div class="app-last-update" id="app-last-update">Actualizado: pendiente</div>
      </div>
      <nav class="nav">
        <button class="nav-btn ${view === 'dashboard' ? 'active' : ''}" data-view="dashboard">${iconDashboard(15)}Dashboard</button>
        <button class="nav-btn ${view === 'positions' ? 'active' : ''}" data-view="positions">${iconLayers(15)}Posiciones</button>
        <button class="nav-btn ${view === 'simulator' ? 'active' : ''}" data-view="simulator">${iconTrendingUp(15)}Simulador</button>
        <button class="nav-btn ${view === 'calculadora' ? 'active' : ''}" data-view="calculadora">${iconCalculator(15)}Calculadora</button>
        <button class="nav-btn" id="btn-backup" title="Exportar/Importar datos">${iconArchive(15)}</button>
        <button class="theme-toggle" id="btn-theme" title="Cambiar tema">${themeIcon()}</button>
      </nav>
    </header>
    <main id="view-container"></main>

    ${renderBackupModal()}
  `;
  syncApiLastUpdatedLabel();

  const viewContainer = document.getElementById('view-container')!;
  const onStateChange = () => render(app, getCurrentView());

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

  // Nav events
  app.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextView = (btn as HTMLElement).dataset.view as View;
      if (nextView === getCurrentView()) return;

      if (window.location.hash.slice(1) !== nextView) {
        window.location.hash = nextView;
      } else {
        navigateTo(nextView, (v) => render(app, v));
      }
    });
  });

  // Theme toggle
  app.querySelector('#btn-theme')?.addEventListener('click', () => {
    toggleTheme();
    render(app, getCurrentView());
  });

  bindBackupEvents(app, onStateChange);
  enhanceNumberSteppers(app);
}

document.addEventListener('DOMContentLoaded', init);
