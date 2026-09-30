import './styles/global.css';
import { renderDashboard } from './components/dashboard';
import { renderPositions } from './components/positions';
import { renderCapital } from './components/capital';
import { renderSimulator } from './components/simulator';
import { renderCalculadora } from './components/calculadora';
import { initTheme, toggleTheme, getResolvedTheme } from './utils/theme';
import { syncApiLastUpdatedLabel } from './utils/api-status';
import { iconSettings, iconRefreshCw, iconSun, iconMoon } from './utils/icons';
import type { View } from './types';
import { getCurrentView, initRouter, navigateTo, handleTransitionEntry } from './utils/router';
import { loadState, onStorageChange } from './utils/storage';
import { openApiConfigModal } from './components/positions/api-config-modal';
import { renderAppShell } from './components/app-shell.template';
import type { AppShellNavItem } from './components/app-shell.constants';
import { applyTypographyConfig } from './utils/typography';
import { saveApiCredentials } from './utils/binance-auth';
import { clearAllCaches as clearBinanceClientCaches } from './utils/binance-client';
import {
  clearBinanceSyncCaches,
  hasAnyExchangeApiCredentials,
  syncPositionsFromBinance,
} from './utils/binance-sync';
import { saveBybitApiCredentials } from './utils/bybit-auth';
import { clearBybitClientCaches } from './utils/bybit-client';
import { clearMarketCaches } from './utils/market';
import { loadLocalVaultCredentials } from './utils/local-vault';
import {
  clearApiRuntimeCache,
  getPositionsCacheKey,
  rememberAutoPortfolioSnapshot,
  rememberBalanceSummary,
} from './utils/api-runtime-cache';
import { showApiErrorBanner } from './utils/notifications';

let disposeActiveView: (() => void) | null = null;
function themeIcon(): string {
  return getResolvedTheme() === 'dark' ? iconSun(15) : iconMoon(15);
}

function syncThemeButton(button: Element | null): void {
  if (!(button instanceof HTMLButtonElement)) return;
  const isDarkTheme = getResolvedTheme() === 'dark';
  button.innerHTML = themeIcon();
  button.setAttribute('aria-pressed', isDarkTheme ? 'true' : 'false');
}

async function hydrateLocalVaultSession(): Promise<void> {
  const credentials = await loadLocalVaultCredentials();
  if (credentials?.binance) {
    saveApiCredentials(credentials.binance);
  }
  if (credentials?.bybit) {
    saveBybitApiCredentials(credentials.bybit);
  }
}

async function init(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  initTheme();
  await hydrateLocalVaultSession();

  const navItems: AppShellNavItem[] = [
    { view: 'dashboard', label: 'Dashboard', active: true },
    { view: 'positions', label: 'Posiciones', active: false },
    { view: 'capital', label: 'Capital', active: false },
    { view: 'simulator', label: 'Simulador', active: false },
    { view: 'calculadora', label: 'Calculadora', active: false },
  ];
  app.innerHTML = renderAppShell(
    iconRefreshCw(15),
    iconSettings(15),
    themeIcon(),
    navItems,
    getResolvedTheme() === 'dark',
  );

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
    syncThemeButton(app.querySelector('#btn-theme'));
  });

  app.querySelector('#btn-config')?.addEventListener('click', () => {
    openApiConfigModal();
  });

  app.querySelector('#btn-sync-positions')?.addEventListener('click', async () => {
    const syncBtn = app.querySelector('#btn-sync-positions') as HTMLButtonElement | null;
    if (!syncBtn || syncBtn.disabled || !hasAnyExchangeApiCredentials()) return;

    syncBtn.disabled = true;
    syncBtn.classList.add('syncing');
    syncBtn.setAttribute('aria-busy', 'true');

    try {
      const previousPositionsKey = getPositionsCacheKey(loadState().positions);
      clearApiRuntimeCache();
      clearBinanceSyncCaches();
      clearBinanceClientCaches();
      clearBybitClientCaches();
      clearMarketCaches();
      const snapshot = await syncPositionsFromBinance(true);
      rememberAutoPortfolioSnapshot(snapshot);
      rememberBalanceSummary({
        balances: snapshot.balances,
        totalUsdEstimate: snapshot.totalUsdEstimate,
        accountReport: snapshot.accountReport,
      });
      window.dispatchEvent(
        new CustomEvent('exchange-sync-complete', {
          detail: { snapshot, previousPositionsKey },
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      showApiErrorBanner(
        `No se pudieron sincronizar las posiciones desde exchanges configurados: ${message}`,
      );
    } finally {
      syncBtn.disabled = false;
      syncBtn.classList.remove('syncing');
      syncBtn.removeAttribute('aria-busy');
      updatePositionsSyncButton(app);
    }
  });

  syncApiLastUpdatedLabel();

  initRouter((view) => renderView(app, view));
  renderView(app, getCurrentView());

  requestAnimationFrame(() => {
    window.setTimeout(() => {
      applyTypographyConfig();
      // La tipografia de la marca llega despues del primer render y ensancha
      // las pestanas: hasta que no esta, el riel de vistas mide de menos y el
      // desplazamiento hacia la pestana activa se queda corto. No vale
      // fonts.ready, que resuelve antes de que la hoja recien insertada llegue
      // a pedir ninguna fuente; el aviso bueno es el fin de cada carga.
      document.fonts?.addEventListener('loadingdone', () => revealActiveNavButton(app));
    }, 0);
  });

  // Las actualizaciones de otra pestaña hidratan la vista montada; no se vuelve
  // a generar la plantilla ni se muestran skeletons de una carga inicial.
  onStorageChange(() => window.dispatchEvent(new Event('portfolio-state-updated')));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      window.dispatchEvent(new Event('portfolio-tab-visible'));
    }
  });

  // Keyboard shortcuts (bound once)
  const viewKeys: Record<string, View> = {
    '1': 'dashboard',
    '2': 'positions',
    '3': 'capital',
    '4': 'simulator',
    '5': 'calculadora',
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
  revealActiveNavButton(app);
}

/**
 * A anchos de movil las cinco vistas no caben en una linea y el riel se
 * desplaza en horizontal. Sin esto la pestana activa puede quedar fuera de la
 * parte visible -- en Calculadora a 360px se sale entera, 93 de sus 95px -- y
 * la vista en la que estas se queda sin indicador. Se ajusta scrollLeft del
 * propio riel en vez de scrollIntoView para no arrastrar la pagina con el.
 */
function revealActiveNavButton(app: HTMLElement): void {
  const nav = app.querySelector<HTMLElement>('.nav');
  const activeBtn = app.querySelector<HTMLElement>('.nav-btn.active');
  if (!nav || !activeBtn) return;

  const hiddenWidth = nav.scrollWidth - nav.clientWidth;
  if (hiddenWidth <= 0) return;

  // Medido contra la caja del riel: el riel no esta posicionado, asi que su
  // offsetParent no es el, y offsetLeft daria un origen equivocado.
  const navBox = nav.getBoundingClientRect();
  const buttonBox = activeBtn.getBoundingClientRect();
  const relativeLeft = buttonBox.left - navBox.left + nav.scrollLeft;
  const centered = relativeLeft - (nav.clientWidth - buttonBox.width) / 2;
  nav.scrollLeft = Math.max(0, Math.min(centered, hiddenWidth));
}

function renderView(app: HTMLElement, view: View): void {
  disposeActiveView?.();
  disposeActiveView = null;

  const viewContainer = document.getElementById('view-container');
  if (!viewContainer) return;

  updateActiveNavButton(app, view);
  updatePositionsSyncButton(app);
  syncApiLastUpdatedLabel();

  const onStateChange = () => renderView(app, getCurrentView());

  switch (view) {
    case 'dashboard':
      disposeActiveView = renderDashboard(viewContainer, {
        forceRefreshOnMount: false,
      });
      break;
    case 'positions':
      disposeActiveView = renderPositions(viewContainer, onStateChange);
      break;
    case 'capital':
      disposeActiveView = renderCapital(viewContainer);
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

function updatePositionsSyncButton(app: HTMLElement): void {
  const syncBtn = app.querySelector('#btn-sync-positions') as HTMLButtonElement | null;
  if (!syncBtn) return;

  const isAvailable = hasAnyExchangeApiCredentials();
  syncBtn.disabled = !isAvailable;

  if (!isAvailable) {
    syncBtn.classList.remove('syncing');
  }
}

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
