import { APP_SHELL_COPY, type AppShellNavItem } from './app-shell.constants';

function renderNavButton(item: AppShellNavItem): string {
  return `
    <button
      type="button"
      class="nav-btn${item.active ? ' active' : ''}"
      data-view="${item.view}"
      ${item.active ? 'aria-current="page"' : ''}
    >
      ${item.icon}${item.label}
    </button>
  `;
}

export function renderAppShell(
  syncIcon: string,
  configIcon: string,
  themeIcon: string,
  navItems: AppShellNavItem[],
  isDarkTheme: boolean,
): string {
  return `
    <header class="app-header">
      <div class="app-brand">
        <h1 class="app-title">${APP_SHELL_COPY.titlePrefix} <span>${APP_SHELL_COPY.titleSuffix}</span></h1>
        <div class="app-last-update" id="app-last-update">${APP_SHELL_COPY.lastUpdatePending}</div>
      </div>
      <div class="app-shell-actions">
        <nav class="nav" aria-label="${APP_SHELL_COPY.navLabel}">
          ${navItems.map(renderNavButton).join('')}
        </nav>
        <div class="app-utility-actions" role="group" aria-label="${APP_SHELL_COPY.utilityActionsLabel}">
          <button
            type="button"
            class="utility-btn utility-btn--icon-only"
            id="btn-sync-positions"
            title="${APP_SHELL_COPY.syncLabel}"
            aria-label="${APP_SHELL_COPY.syncLabel}"
          >
            ${syncIcon}
          </button>
          <button
            type="button"
            class="utility-btn utility-btn--icon-only"
            id="btn-config"
            title="${APP_SHELL_COPY.configLabel}"
            aria-label="${APP_SHELL_COPY.configLabel}"
          >
            ${configIcon}
          </button>
          <button
            type="button"
            class="theme-toggle"
            id="btn-theme"
            title="${APP_SHELL_COPY.themeLabel}"
            aria-label="${APP_SHELL_COPY.themeLabel}"
            aria-pressed="${isDarkTheme ? 'true' : 'false'}"
          >
            ${themeIcon}
          </button>
        </div>
      </div>
    </header>
    <main id="view-container" tabindex="-1"></main>
  `;
}
