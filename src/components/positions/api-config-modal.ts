import { openModal, closeModal, bindModalEvents } from '../../utils/modal-manager';
import {
  loadStoredApiKey,
  saveApiCredentials,
  clearApiCredentials,
  loadPositionsMode,
  savePositionsMode,
} from '../../utils/binance-auth';
import { testApiConnection, clearAllCaches } from '../../utils/binance-client';
import {
  clearBybitApiCredentials,
  loadStoredBybitApiKey,
  saveBybitApiCredentials,
} from '../../utils/bybit-auth';
import { clearBybitClientCaches, testBybitApiConnection } from '../../utils/bybit-client';
import { clearBinanceSyncCaches } from '../../utils/binance-sync';
import { clearApiRuntimeCache } from '../../utils/api-runtime-cache';
import { clearMarketCaches } from '../../utils/market';
import {
  clearLocalVaultCredential,
  loadLocalVaultCredentials,
  saveLocalVaultCredential,
} from '../../utils/local-vault';
import { escapeHtml } from '../../utils/ui-helpers';
import { iconArchive, iconLock, iconWallet } from '../../utils/icons';
import { loadState, updatePortfolio, updateBalance } from '../../utils/storage';
import { parseFlexibleNumber } from '../../utils/parse-number';
import { bindBackupControls, renderBackupSection } from '../backup';
import type { PositionsMode } from '../../types';

function formatEditableCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

let modalEl: HTMLDialogElement | null = null;

function getOrCreateModal(): HTMLDialogElement {
  if (modalEl) return modalEl;

  const dialog = document.createElement('dialog');
  dialog.id = 'modal-api-config';
  dialog.className = 'modal-overlay';

  const apiKey = loadStoredApiKey();
  const bybitApiKey = loadStoredBybitApiKey();
  const mode = loadPositionsMode();
  const hasStoredBinanceApiKey = apiKey.length > 0;
  const hasStoredBybitApiKey = bybitApiKey.length > 0;
  const isAuto = mode === 'auto';
  const { portfolio } = loadState();

  dialog.innerHTML = `
    <div class="modal modal--wide modal-api-config">
      <div class="modal-api-config-head">
        <div class="modal-api-config-headline">
          <span class="modal-api-config-eyebrow">Configuración</span>
        </div>
      </div>

      <div id="api-config-status" class="dual-market-status" hidden></div>

      <div class="modal-api-config-layout">
        <section class="modal-api-block modal-api-block--portfolio" aria-labelledby="config-portfolio-title">
          <div class="modal-api-block-head">
            <div class="modal-api-block-kicker" id="config-portfolio-title">${iconWallet(14)} Portfolio</div>
          </div>

          <div class="modal-mode-panel">
            <div class="modal-mode-panel-head">
              <span class="modal-field-label">Modo de lectura</span>
              <div class="mode-toggle">
                <button
                  type="button"
                  class="mode-btn${!isAuto ? ' active' : ''}"
                  data-mode="manual"
                  id="mode-manual"
                  aria-pressed="${!isAuto ? 'true' : 'false'}"
                >
                  Manual
                </button>
                <button
                  type="button"
                  class="mode-btn${isAuto ? ' active' : ''}"
                  data-mode="auto"
                  id="mode-auto"
                  aria-pressed="${isAuto ? 'true' : 'false'}"
                >
                  Auto
                </button>
              </div>
            </div>
          </div>

          <div class="modal-api-form-grid modal-api-form-grid--portfolio">
            <div class="form-group">
              <label for="input-cfg-invested">Invertido USD</label>
              <input type="text" id="input-cfg-invested" inputmode="decimal" value="${formatEditableCurrency(portfolio.totalInvested)}">
            </div>
            <div class="form-group">
              <label for="input-cfg-goal">Meta USD</label>
              <input type="text" id="input-cfg-goal" inputmode="decimal" value="${formatEditableCurrency(portfolio.goalAmount)}">
            </div>
            <div id="cfg-savings-section" class="modal-api-form-span" ${isAuto ? 'hidden' : ''}>
              <div class="form-group">
                <label for="input-cfg-savings">Ahorros externos USD</label>
                <input type="text" id="input-cfg-savings" inputmode="decimal" value="${formatEditableCurrency(portfolio.savings)}">
              </div>
            </div>
          </div>
        </section>

        <section class="modal-api-block modal-api-block--security" aria-labelledby="config-security-title">
          <div class="modal-api-block-head">
            <div class="modal-api-block-kicker" id="config-security-title">${iconLock(14)} Seguridad</div>
          </div>
          <div class="modal-api-inline-actions">
            <button type="button" class="btn btn-sm" id="btn-api-vault-unlock">Cargar DPAPI</button>
          </div>
        </section>

        <section class="modal-api-block modal-api-block--binance" aria-labelledby="config-binance-title">
          <div class="modal-api-block-head">
            <div class="modal-api-block-kicker" id="config-binance-title">${iconLock(14)} Binance</div>
          </div>

          <div id="api-config-fields" class="modal-api-form-grid">
            <div class="form-group">
              <label for="input-api-key">API Key Binance</label>
              <input type="text" id="input-api-key" placeholder="Tu API Key de Binance"
                     value="${escapeHtml(apiKey)}" autocomplete="off" spellcheck="false">
            </div>
            <div class="form-group">
              <label for="input-api-secret">API Secret Binance</label>
              <input type="password" id="input-api-secret" placeholder="Tu API Secret"
                     value="" autocomplete="off" spellcheck="false">
            </div>
          </div>

          <div class="modal-api-inline-actions">
            <button type="button" class="btn btn-sm" id="btn-api-config-test">Probar Binance</button>
            <button type="button" class="btn btn-danger btn-sm" id="btn-api-config-clear" ${hasStoredBinanceApiKey ? '' : 'disabled aria-disabled="true"'}>Eliminar Binance</button>
          </div>
        </section>

        <section class="modal-api-block modal-api-block--bybit" aria-labelledby="config-bybit-title">
          <div class="modal-api-block-head">
            <div class="modal-api-block-kicker" id="config-bybit-title">${iconLock(14)} Bybit</div>
          </div>

          <div id="bybit-api-config-fields" class="modal-api-form-grid">
            <div class="form-group">
              <label for="input-bybit-api-key">API Key Bybit</label>
              <input type="text" id="input-bybit-api-key" placeholder="Tu API Key de Bybit"
                     value="${escapeHtml(bybitApiKey)}" autocomplete="off" spellcheck="false">
            </div>
            <div class="form-group">
              <label for="input-bybit-api-secret">API Secret Bybit</label>
              <input type="password" id="input-bybit-api-secret" placeholder="Tu API Secret"
                     value="" autocomplete="off" spellcheck="false">
            </div>
          </div>

          <div class="modal-api-inline-actions">
            <button type="button" class="btn btn-sm" id="btn-bybit-api-config-test">Probar Bybit</button>
            <button type="button" class="btn btn-danger btn-sm" id="btn-bybit-api-config-clear" ${hasStoredBybitApiKey ? '' : 'disabled aria-disabled="true"'}>Eliminar Bybit</button>
          </div>

        </section>

        <section class="modal-api-block modal-api-block--backup modal-api-config-section" aria-labelledby="backup-section-title">
          <div class="modal-api-block-head">
            <div class="modal-api-block-kicker" id="backup-section-title">${iconArchive(14)} Respaldo</div>
          </div>
          ${renderBackupSection({ embedded: true })}
        </section>
      </div>

      <div class="modal-actions modal-api-config-actions">
        <button type="button" class="btn" id="btn-api-config-cancel">Cancelar</button>
        <button type="button" class="btn btn-primary" id="btn-api-config-save">Guardar</button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);
  modalEl = dialog;

  bindModalEvents(dialog, [dialog.querySelector('#btn-api-config-cancel') as HTMLElement]);
  bindApiConfigEvents(dialog);
  bindBackupControls(dialog, () => {
    closeModal(dialog);
    dispatchConfigChange();
  });

  return dialog;
}

function bindApiConfigEvents(dialog: HTMLDialogElement): void {
  const statusEl = dialog.querySelector('#api-config-status') as HTMLElement;
  let selectedMode: PositionsMode = loadPositionsMode();

  // Mode toggle
  dialog.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PositionsMode;
      selectedMode = mode;
      dialog.querySelectorAll('.mode-btn').forEach((b) => {
        const isActive = (b as HTMLElement).dataset.mode === mode;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });

      const clearBtn = dialog.querySelector('#btn-api-config-clear') as HTMLButtonElement;
      const bybitClearBtn = dialog.querySelector(
        '#btn-bybit-api-config-clear',
      ) as HTMLButtonElement;
      const savingsSection = dialog.querySelector('#cfg-savings-section') as HTMLElement;

      if (mode === 'auto') {
        savingsSection.hidden = true;
        clearBtn.disabled = !loadStoredApiKey();
        clearBtn.setAttribute('aria-disabled', clearBtn.disabled ? 'true' : 'false');
        bybitClearBtn.disabled = !loadStoredBybitApiKey();
        bybitClearBtn.setAttribute('aria-disabled', bybitClearBtn.disabled ? 'true' : 'false');
      } else {
        savingsSection.hidden = false;
        clearBtn.disabled = !loadStoredApiKey();
        clearBtn.setAttribute('aria-disabled', clearBtn.disabled ? 'true' : 'false');
        bybitClearBtn.disabled = !loadStoredBybitApiKey();
        bybitClearBtn.setAttribute('aria-disabled', bybitClearBtn.disabled ? 'true' : 'false');
      }
    });
  });

  dialog.querySelector('#btn-bybit-api-config-test')?.addEventListener('click', async () => {
    const keyInput = dialog.querySelector('#input-bybit-api-key') as HTMLInputElement;
    const secretInput = dialog.querySelector('#input-bybit-api-secret') as HTMLInputElement;
    const key = keyInput.value.trim();
    const secret = secretInput.value.trim();

    if (!key || !secret) {
      showStatus(statusEl, 'Ingresa API Key y Secret de Bybit.', 'error');
      return;
    }

    showStatus(statusEl, 'Probando conexión Bybit...', 'info');

    const result = await testBybitApiConnection({ apiKey: key, apiSecret: secret });

    if (result.success) {
      const permissionGroups = Object.entries(result.permissions)
        .filter(([, values]) => values.length > 0)
        .map(([group, values]) => `${group}: ${values.join(', ')}`)
        .join('; ');
      const perms = permissionGroups || 'N/A';

      if (!result.readOnly) {
        showStatus(
          statusEl,
          `Conexión Bybit exitosa, pero la API key no es de solo lectura. Bybit debe devolver readOnly: 1. Permisos: ${perms}`,
          'warning',
        );
      } else {
        showStatus(
          statusEl,
          `Conexión Bybit exitosa en modo solo lectura. Permisos: ${perms}`,
          'success',
        );
      }
    } else {
      showStatus(statusEl, `Error Bybit: ${result.error ?? 'Unknown'}`, 'error');
    }
  });

  dialog.querySelector('#btn-api-config-test')?.addEventListener('click', async () => {
    const keyInput = dialog.querySelector('#input-api-key') as HTMLInputElement;
    const secretInput = dialog.querySelector('#input-api-secret') as HTMLInputElement;
    const key = keyInput.value.trim();
    const secret = secretInput.value.trim();

    if (!key || !secret) {
      showStatus(statusEl, 'Ingresa API Key y Secret.', 'error');
      return;
    }

    showStatus(statusEl, 'Probando conexión...', 'info');

    const result = await testApiConnection({ apiKey: key, apiSecret: secret });

    if (result.success) {
      const perms = result.permissions.join(', ') || 'N/A';
      const hasWritePermissions =
        result.permissions.includes('WITHDRAW') ||
        result.permissions.includes('TRADE') ||
        !result.readOnly;
      if (hasWritePermissions) {
        const warnings = result.permissionWarnings.length
          ? ` Detalle: ${result.permissionWarnings.join('; ')}`
          : '';
        showStatus(
          statusEl,
          `Conexión exitosa, pero tu API key no es de solo lectura. Por seguridad, usa una key sin permisos TRADE, WITHDRAW ni transferencias. Permisos: ${perms}.${warnings}`,
          'warning',
        );
      } else {
        showStatus(
          statusEl,
          `Conexión exitosa en modo solo lectura. Permisos: ${perms}`,
          'success',
        );
      }
    } else {
      showStatus(statusEl, `Error: ${result.error ?? 'Unknown'}`, 'error');
    }
  });

  dialog.querySelector('#btn-api-vault-unlock')?.addEventListener('click', async () => {
    const credentials = await loadLocalVaultCredentials();
    const binanceUnlocked = credentials?.binance !== undefined;
    const bybitUnlocked = credentials?.bybit !== undefined;

    if (credentials?.binance) saveApiCredentials(credentials.binance);
    if (credentials?.bybit) saveBybitApiCredentials(credentials.bybit);

    if (binanceUnlocked || bybitUnlocked) {
      showStatus(statusEl, 'Credenciales DPAPI cargadas para esta sesión.', 'success');
      clearAllRuntimeCaches();
      dispatchConfigChange();
      return;
    }

    showStatus(statusEl, 'No se encontraron credenciales DPAPI guardadas.', 'error');
  });

  dialog.querySelector('#btn-api-config-save')?.addEventListener('click', async () => {
    const keyInput = dialog.querySelector('#input-api-key') as HTMLInputElement;
    const secretInput = dialog.querySelector('#input-api-secret') as HTMLInputElement;
    const bybitKeyInput = dialog.querySelector('#input-bybit-api-key') as HTMLInputElement;
    const bybitSecretInput = dialog.querySelector('#input-bybit-api-secret') as HTMLInputElement;
    const investedInput = dialog.querySelector('#input-cfg-invested') as HTMLInputElement;
    const goalInput = dialog.querySelector('#input-cfg-goal') as HTMLInputElement;
    const savingsInput = dialog.querySelector('#input-cfg-savings') as HTMLInputElement;
    const storedBinanceKey = loadStoredApiKey();
    const storedBybitKey = loadStoredBybitApiKey();
    const key = keyInput.value.trim();
    const secret = secretInput.value.trim();
    const bybitKey = bybitKeyInput.value.trim();
    const bybitSecret = bybitSecretInput.value.trim();
    const shouldSaveBinanceCredentials = secret.length > 0 || key !== storedBinanceKey;
    const shouldSaveBybitCredentials = bybitSecret.length > 0 || bybitKey !== storedBybitKey;
    const hasStoredExchangeCredentials = storedBinanceKey.length > 0 || storedBybitKey.length > 0;

    if (shouldSaveBinanceCredentials && (!key || !secret)) {
      showStatus(statusEl, 'API Key y Secret son requeridos para guardar Binance.', 'error');
      return;
    }

    if (shouldSaveBybitCredentials && (!bybitKey || !bybitSecret)) {
      showStatus(statusEl, 'API Key y Secret son requeridos para guardar Bybit.', 'error');
      return;
    }

    if (
      selectedMode === 'auto' &&
      !shouldSaveBinanceCredentials &&
      !shouldSaveBybitCredentials &&
      !hasStoredExchangeCredentials
    ) {
      showStatus(statusEl, 'Configura Binance o Bybit para usar el modo Auto.', 'error');
      return;
    }

    let shouldClearCaches = false;

    if (shouldSaveBinanceCredentials) {
      showStatus(statusEl, 'Validando Binance...', 'info');
      const result = await testApiConnection({ apiKey: key, apiSecret: secret });
      if (!result.success) {
        showStatus(statusEl, `Error Binance: ${result.error ?? 'Unknown'}`, 'error');
        return;
      }
      if (!result.readOnly) {
        const warnings = result.permissionWarnings.length
          ? ` Detalle: ${result.permissionWarnings.join('; ')}`
          : '';
        showStatus(
          statusEl,
          `Binance debe ser solo lectura antes de guardar. Permisos: ${result.permissions.join(', ') || 'N/A'}.${warnings}`,
          'error',
        );
        return;
      }
    }

    if (shouldSaveBybitCredentials) {
      showStatus(statusEl, 'Validando Bybit...', 'info');
      const result = await testBybitApiConnection({ apiKey: bybitKey, apiSecret: bybitSecret });
      if (!result.success) {
        showStatus(statusEl, `Error Bybit: ${result.error ?? 'Unknown'}`, 'error');
        return;
      }
      if (!result.readOnly) {
        showStatus(statusEl, 'Bybit debe devolver readOnly: 1 antes de guardar.', 'error');
        return;
      }
    }

    // Save financial settings
    const invested = parseFlexibleNumber(investedInput.value);
    const goal = parseFlexibleNumber(goalInput.value);
    if (!isNaN(invested) && !isNaN(goal) && invested > 0 && goal > 0) {
      updatePortfolio({ totalInvested: invested, goalAmount: goal });
    }

    // Save savings (manual mode only)
    if (selectedMode !== 'auto') {
      const savings = parseFlexibleNumber(savingsInput.value);
      if (!isNaN(savings) && savings >= 0) {
        const before = loadState();
        const basePositionsValue =
          before.positions.length > 0
            ? before.portfolio.currentBalance - before.portfolio.savings
            : 0;
        const nextBalance = Math.max(0, Math.round((basePositionsValue + savings) * 100) / 100);
        updatePortfolio({ savings });
        updateBalance(nextBalance);
      }
    }

    // Save mode
    savePositionsMode(selectedMode);

    // Save API credentials for read-only Binance sync.
    if (shouldSaveBinanceCredentials) {
      const saved = await saveLocalVaultCredential('binance', { apiKey: key, apiSecret: secret });
      if (!saved) {
        showStatus(statusEl, 'No se pudo guardar Binance en el vault DPAPI local.', 'error');
        return;
      }
      saveApiCredentials({ apiKey: key, apiSecret: secret });
      shouldClearCaches = true;
    }

    if (shouldSaveBybitCredentials) {
      const saved = await saveLocalVaultCredential('bybit', {
        apiKey: bybitKey,
        apiSecret: bybitSecret,
      });
      if (!saved) {
        showStatus(statusEl, 'No se pudo guardar Bybit en el vault DPAPI local.', 'error');
        return;
      }
      saveBybitApiCredentials({ apiKey: bybitKey, apiSecret: bybitSecret });
      shouldClearCaches = true;
    }

    if (shouldClearCaches) {
      clearAllRuntimeCaches();
    }

    closeModal(dialog);
    dispatchConfigChange();
  });

  dialog.querySelector('#btn-api-config-clear')?.addEventListener('click', () => {
    clearApiCredentials();
    void clearLocalVaultCredential('binance');
    clearAllRuntimeCaches();
    closeModal(dialog);
    dispatchConfigChange();
  });

  dialog.querySelector('#btn-bybit-api-config-clear')?.addEventListener('click', () => {
    clearBybitApiCredentials();
    void clearLocalVaultCredential('bybit');
    clearAllRuntimeCaches();
    closeModal(dialog);
    dispatchConfigChange();
  });
}

function clearAllRuntimeCaches(): void {
  clearAllCaches();
  clearBybitClientCaches();
  clearBinanceSyncCaches();
  clearMarketCaches();
  clearApiRuntimeCache();
}

function showStatus(
  el: HTMLElement,
  message: string,
  type: 'info' | 'success' | 'error' | 'warning',
): void {
  el.hidden = false;
  el.className = `dual-market-status dual-market-status--${type}`;
  el.textContent = message;
}

function dispatchConfigChange(): void {
  window.dispatchEvent(new CustomEvent('binance-config-change'));
}

// ── Public API ──

export function openApiConfigModal(): void {
  // Re-create to refresh values
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
  }
  const dialog = getOrCreateModal();
  openModal(dialog);
  const panel = dialog.querySelector<HTMLElement>('.modal-api-config');
  if (panel) {
    panel.scrollTop = 0;
    requestAnimationFrame(() => {
      panel.scrollTop = 0;
    });
  }
}

export function onApiConfigChange(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener('binance-config-change', handler);
  return () => window.removeEventListener('binance-config-change', handler);
}
