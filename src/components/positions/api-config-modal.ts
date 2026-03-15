import { openModal, closeModal, bindModalEvents } from '../../utils/modal-manager';
import {
  loadApiCredentials,
  saveApiCredentials,
  clearApiCredentials,
  hasApiCredentials,
  loadPositionsMode,
  savePositionsMode,
} from '../../utils/binance-auth';
import { testApiConnection, clearAllCaches } from '../../utils/binance-client';
import { clearBinanceSyncCaches } from '../../utils/binance-sync';
import { clearApiRuntimeCache } from '../../utils/api-runtime-cache';
import { clearMarketCaches } from '../../utils/market';
import { escapeHtml } from '../../utils/ui-helpers';
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

  const creds = loadApiCredentials();
  const mode = loadPositionsMode();
  const isAuto = mode === 'auto';
  const { portfolio } = loadState();

  dialog.innerHTML = `
    <div class="modal modal--wide modal-api-config">
      <div class="modal-api-config-head">
        <div>
          <h3 class="modal-title">Configuración</h3>
          <p class="text-muted modal-api-config-copy">
            Ajusta el modo de trabajo, la meta del portfolio y el acceso a Binance en un solo lugar.
          </p>
        </div>
      </div>

      <!-- Mode toggle -->
      <div class="form-group">
        <label>Modo de operacion</label>
        <div class="mode-toggle">
          <button type="button" class="mode-btn${!isAuto ? ' active' : ''}" data-mode="manual" id="mode-manual">Manual</button>
          <button type="button" class="mode-btn${isAuto ? ' active' : ''}" data-mode="auto" id="mode-auto">Binance</button>
        </div>
        <div class="text-muted hint-text" id="mode-hint">
          ${isAuto ? 'Binance sincroniza datos y saldo de forma automatica.' : 'Manual: la app muestra los datos guardados localmente o restaurados desde backup.'}
        </div>
      </div>

      <!-- Financial config -->
      <div class="dual-market-divider"></div>

      <div class="form-group">
        <label for="input-cfg-invested">Total invertido (USD)</label>
        <input type="text" id="input-cfg-invested" inputmode="decimal" value="${formatEditableCurrency(portfolio.totalInvested)}">
      </div>
      <div class="form-group">
        <label for="input-cfg-goal">Meta (USD)</label>
        <input type="text" id="input-cfg-goal" inputmode="decimal" value="${formatEditableCurrency(portfolio.goalAmount)}">
      </div>
      <div id="cfg-savings-section" ${isAuto ? 'hidden' : ''}>
        <div class="form-group">
          <label for="input-cfg-savings">Ahorros / stablecoins fuera de posiciones (USD)</label>
          <input type="text" id="input-cfg-savings" inputmode="decimal" value="${formatEditableCurrency(portfolio.savings)}">
        </div>
      </div>

      <!-- Binance API config (always visible) -->
      <div id="api-config-fields">
        <div class="dual-market-divider"></div>

        <div class="form-group">
          <label for="input-api-key">API Key</label>
          <input type="text" id="input-api-key" placeholder="Tu API Key de Binance"
                 value="${escapeHtml(creds?.apiKey ?? '')}" autocomplete="off" spellcheck="false">
        </div>
        <div class="form-group">
          <label for="input-api-secret">API Secret</label>
          <input type="password" id="input-api-secret" placeholder="Tu API Secret"
                 value="${escapeHtml(creds?.apiSecret ?? '')}" autocomplete="off" spellcheck="false">
        </div>
      </div>

      <div id="api-config-status" class="dual-market-status" hidden></div>

      <div class="dual-market-divider"></div>

      <section class="modal-api-config-section" aria-labelledby="backup-section-title">
        <div class="modal-api-config-section-head">
          <div>
            <div class="card-title" id="backup-section-title">Importar y exportar</div>
            <p class="text-muted modal-api-config-section-copy">
              Gestiona tus respaldos sin salir de Configuración.
            </p>
          </div>
        </div>
        ${renderBackupSection()}
      </section>

      <div class="modal-actions">
        <button type="button" class="btn" id="btn-api-config-cancel">Cancelar</button>
        <button type="button" class="btn btn-danger btn-sm modal-action-spacer" id="btn-api-config-clear" ${creds ? '' : 'hidden'}>Eliminar API</button>
        <button type="button" class="btn btn-sm" id="btn-api-config-test">Probar conexión</button>
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
      dialog
        .querySelectorAll('.mode-btn')
        .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.mode === mode));

      const clearBtn = dialog.querySelector('#btn-api-config-clear') as HTMLElement;
      const hintEl = dialog.querySelector('#mode-hint') as HTMLElement;
      const savingsSection = dialog.querySelector('#cfg-savings-section') as HTMLElement;

      if (mode === 'auto') {
        savingsSection.hidden = true;
        clearBtn.hidden = !hasApiCredentials();
        hintEl.textContent = 'Binance sincroniza datos y saldo de forma automatica.';
      } else {
        savingsSection.hidden = false;
        clearBtn.hidden = !hasApiCredentials();
        hintEl.textContent =
          'Manual: la app muestra los datos guardados localmente o restaurados desde backup.';
      }
    });
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

    // Temporarily save to test
    const prevCreds = loadApiCredentials();
    saveApiCredentials({ apiKey: key, apiSecret: secret, tradingPin: prevCreds?.tradingPin });

    showStatus(statusEl, 'Probando conexion...', 'info');

    const result = await testApiConnection();

    if (result.success) {
      const perms = result.permissions.join(', ') || 'N/A';
      const hasWithdraw = result.permissions.includes('WITHDRAW');
      if (hasWithdraw) {
        showStatus(
          statusEl,
          `Conexion exitosa, pero tu API key tiene permiso WITHDRAW. Por seguridad, crea una nueva key sin este permiso. Permisos: ${perms}`,
          'warning',
        );
      } else {
        showStatus(statusEl, `Conexion exitosa. Permisos: ${perms}`, 'success');
      }
    } else {
      // Restore previous creds on failure
      if (prevCreds) saveApiCredentials(prevCreds);
      else clearApiCredentials();
      showStatus(statusEl, `Error: ${result.error ?? 'Unknown'}`, 'error');
    }
  });

  dialog.querySelector('#btn-api-config-save')?.addEventListener('click', async () => {
    const keyInput = dialog.querySelector('#input-api-key') as HTMLInputElement;
    const secretInput = dialog.querySelector('#input-api-secret') as HTMLInputElement;
    const investedInput = dialog.querySelector('#input-cfg-invested') as HTMLInputElement;
    const goalInput = dialog.querySelector('#input-cfg-goal') as HTMLInputElement;
    const savingsInput = dialog.querySelector('#input-cfg-savings') as HTMLInputElement;

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
    const key = keyInput.value.trim();
    const secret = secretInput.value.trim();

    if (key && secret) {
      const prevCreds = loadApiCredentials();
      saveApiCredentials({ apiKey: key, apiSecret: secret, tradingPin: prevCreds?.tradingPin });
      clearAllRuntimeCaches();
    } else if (selectedMode === 'auto') {
      showStatus(statusEl, 'API Key y Secret son requeridos para la lectura con Binance.', 'error');
      return;
    }

    closeModal(dialog);
    dispatchConfigChange();
  });

  dialog.querySelector('#btn-api-config-clear')?.addEventListener('click', () => {
    clearApiCredentials();
    clearAllRuntimeCaches();
    closeModal(dialog);
    dispatchConfigChange();
  });
}

function clearAllRuntimeCaches(): void {
  clearAllCaches();
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
}

export function onApiConfigChange(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener('binance-config-change', handler);
  return () => window.removeEventListener('binance-config-change', handler);
}

export { hasApiCredentials };
