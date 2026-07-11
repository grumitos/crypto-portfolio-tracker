import { beforeEach, describe, expect, it, vi } from '#test';
import { flushMicrotasks } from './test/test-utils';

vi.mock('./components/dashboard', () => ({
  renderDashboard: vi.fn((container: HTMLElement) => {
    container.innerHTML = '<section>dashboard</section>';
    return () => {};
  }),
}));

vi.mock('./components/positions', () => ({
  renderPositions: vi.fn((container: HTMLElement) => {
    container.innerHTML = '<section>positions</section>';
    return () => {};
  }),
}));

vi.mock('./components/capital', () => ({
  renderCapital: vi.fn((container: HTMLElement) => {
    container.innerHTML = '<section>capital</section>';
  }),
}));

vi.mock('./components/simulator', () => ({
  renderSimulator: vi.fn((container: HTMLElement) => {
    container.innerHTML = '<section>simulator</section>';
  }),
}));

vi.mock('./components/calculadora', () => ({
  renderCalculadora: vi.fn((container: HTMLElement) => {
    container.innerHTML = '<section>calculadora</section>';
  }),
}));

vi.mock('./utils/theme', () => ({
  initTheme: vi.fn(),
  toggleTheme: vi.fn(),
  getResolvedTheme: vi.fn(() => 'light'),
}));

vi.mock('./utils/api-status', () => ({
  syncApiLastUpdatedLabel: vi.fn(),
}));

vi.mock('./utils/icons', () => ({
  iconDashboard: vi.fn(() => '<span></span>'),
  iconLayers: vi.fn(() => '<span></span>'),
  iconTrendingUp: vi.fn(() => '<span></span>'),
  iconCalculator: vi.fn(() => '<span></span>'),
  iconSettings: vi.fn(() => '<span></span>'),
  iconRefreshCw: vi.fn(() => '<span></span>'),
  iconSun: vi.fn(() => '<span></span>'),
  iconMoon: vi.fn(() => '<span></span>'),
  iconWallet: vi.fn(() => '<span></span>'),
}));

vi.mock('./utils/number-stepper', () => ({
  enhanceNumberSteppers: vi.fn(),
}));

vi.mock('./utils/router', () => ({
  getCurrentView: vi.fn(() => 'dashboard'),
  initRouter: vi.fn(),
  navigateTo: vi.fn(),
  handleTransitionEntry: vi.fn(),
}));

vi.mock('./utils/storage', () => ({
  onStorageChange: vi.fn(),
}));

vi.mock('./components/positions/api-config-modal', () => ({
  openApiConfigModal: vi.fn(),
}));

vi.mock('./components/app-shell.template', () => ({
  renderAppShell: vi.fn(
    () => `
      <button type="button" id="btn-sync-positions">sync</button>
      <button type="button" id="btn-config">config</button>
      <button type="button" id="btn-theme">theme</button>
      <button type="button" class="nav-btn" data-view="dashboard">dashboard</button>
      <main id="view-container"></main>
    `,
  ),
}));

vi.mock('./utils/binance-auth', () => ({
  isAutoMode: vi.fn(() => true),
  saveApiCredentials: vi.fn(),
}));

vi.mock('./utils/binance-client', () => ({
  clearAllCaches: vi.fn(),
}));

vi.mock('./utils/binance-sync', () => ({
  clearBinanceSyncCaches: vi.fn(),
  hasAnyExchangeApiCredentials: vi.fn(() => true),
  syncPositionsFromBinance: vi.fn(),
}));

vi.mock('./utils/bybit-auth', () => ({
  saveBybitApiCredentials: vi.fn(),
}));

vi.mock('./utils/bybit-client', () => ({
  clearBybitClientCaches: vi.fn(),
}));

vi.mock('./utils/market', () => ({
  clearMarketCaches: vi.fn(),
}));

vi.mock('./utils/local-vault', () => ({
  loadLocalVaultCredentials: vi.fn(async () => null),
}));

vi.mock('./utils/api-runtime-cache', () => ({
  clearApiRuntimeCache: vi.fn(),
  rememberAutoPortfolioSnapshot: vi.fn(),
  rememberBalanceSummary: vi.fn(),
}));

vi.mock('./utils/notifications', () => ({
  showApiErrorBanner: vi.fn(),
}));

import { syncPositionsFromBinance } from './utils/binance-sync';
import { showApiErrorBanner } from './utils/notifications';

describe('app shell manual exchange sync', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    vi.clearAllMocks();
  });

  it('shows a banner instead of leaking a rejection when manual sync fails', async () => {
    vi.mocked(syncPositionsFromBinance).mockRejectedValue(
      new Error('No se pudieron leer saldos de exchanges configurados.'),
    );

    await import('./main');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushMicrotasks();

    document.getElementById('btn-sync-positions')?.click();
    await flushMicrotasks();

    expect(showApiErrorBanner).toHaveBeenCalledWith(
      'No se pudieron sincronizar las posiciones desde exchanges configurados: No se pudieron leer saldos de exchanges configurados.',
    );
    expect(
      (document.getElementById('btn-sync-positions') as HTMLButtonElement | null)?.disabled,
    ).toBe(false);
  });
});
