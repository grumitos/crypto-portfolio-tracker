import { openModal, closeModal, bindModalEvents } from '../../utils/modal-manager';
import {
  loadApiCredentials,
  loadStoredApiKey,
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

  const creds = loadApiCredentials();
  const apiKey = creds?.apiKey ?? loadStoredApiKey();
  const mode = loadPositionsMode();
  const isAuto = mode === 'auto';
  const { portfolio } = loadState();

  dialog.innerHTML = `
    <div class="modal modal--wide modal-api-config">
      <div class="modal-api-config-head">
        <div class="modal-api-config-headline">
          <span class="modal-api-config-eyebrow">Centro de control</span>
          <h3 class="modal-title modal-title--flush">Configuración</h3>
        </div>
        <p class="text-muted modal-api-config-copy">
          Ajusta portfolio, modo de lectura y acceso a Binance desde una sola vista.
        </p>
      </div>

      <div id="api-config-status" class="dual-market-status" hidden></div>

      <div class="modal-api-config-layout">
        <section class="modal-api-block modal-api-block--portfolio" aria-labelledby="config-portfolio-title">
          <div class="modal-api-block-head">
            <div class="modal-api-block-kicker" id="config-portfolio-title">${iconWallet(14)} Portfolio y modo</div>
            <p class="text-muted modal-api-block-copy">
              Define cómo calcula la app el saldo y cuál es el objetivo que persigues.
            </p>
          </div>

          <div class="modal-mode-panel">
            <div class="modal-mode-panel-head">
              <span class="modal-field-label">Modo de operación</span>
              <span class="modal-mode-pill${isAuto ? ' is-auto' : ''}" id="mode-current-badge">
                ${isAuto ? 'Binance' : 'Manual'}
              </span>
            </div>
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
                Binance
              </button>
            </div>
            <div class="text-muted hint-text modal-mode-hint" id="mode-hint">
              ${isAuto ? 'Binance sincroniza datos y saldo de forma automática.' : 'Manual: la app usa los datos guardados o restaurados desde backup.'}
            </div>
          </div>

          <div class="modal-api-form-grid modal-api-form-grid--portfolio">
            <div class="form-group">
              <label for="input-cfg-invested">Total invertido (USD)</label>
              <input type="text" id="input-cfg-invested" inputmode="decimal" value="${formatEditableCurrency(portfolio.totalInvested)}">
            </div>
            <div class="form-group">
              <label for="input-cfg-goal">Meta (USD)</label>
              <input type="text" id="input-cfg-goal" inputmode="decimal" value="${formatEditableCurrency(portfolio.goalAmount)}">
            </div>
            <div id="cfg-savings-section" class="modal-api-form-span" ${isAuto ? 'hidden' : ''}>
              <div class="form-group">
                <label for="input-cfg-savings">Ahorros / stablecoins fuera de posiciones (USD)</label>
                <input type="text" id="input-cfg-savings" inputmode="decimal" value="${formatEditableCurrency(portfolio.savings)}">
              </div>
            </div>
          </div>
        </section>

        <section class="modal-api-block modal-api-block--binance" aria-labelledby="config-binance-title">
          <div class="modal-api-block-head">
            <div class="modal-api-block-kicker" id="config-binance-title">${iconLock(14)} Acceso Binance</div>
            <p class="text-muted modal-api-block-copy">
              Usa una API de solo lectura para sincronizar saldos y posiciones sin exponer permisos de trading.
            </p>
          </div>

          <div id="api-config-fields" class="modal-api-form-grid">
            <div class="form-group">
              <label for="input-api-key">API Key</label>
              <input type="text" id="input-api-key" placeholder="Tu API Key de Binance"
                     value="${escapeHtml(apiKey)}" autocomplete="off" spellcheck="false">
            </div>
            <div class="form-group">
              <label for="input-api-secret">API Secret</label>
              <input type="password" id="input-api-secret" placeholder="Tu API Secret"
                     value="${escapeHtml(creds?.apiSecret ?? '')}" autocomplete="off" spellcheck="false">
            </div>
          </div>

          <p class="text-muted modal-api-block-note">
            Recomendado: deja la key sin permisos <span class="mono">TRADE</span> ni <span class="mono">WITHDRAW</span>.
          </p>
        </section>

        <section class="modal-api-block modal-api-block--backup modal-api-config-section" aria-labelledby="backup-section-title">
          <div class="modal-api-block-head">
            <div class="modal-api-block-kicker" id="backup-section-title">${iconArchive(14)} Respaldo</div>
            <p class="text-muted modal-api-block-copy">
              Exporta o restaura tus datos sin abrir otra pantalla.
            </p>
          </div>
          ${renderBackupSection({ embedded: true })}
        </section>
      </div>

      <div class="modal-actions modal-api-config-actions">
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
      dialog.querySelectorAll('.mode-btn').forEach((b) => {
        const isActive = (b as HTMLElement).dataset.mode === mode;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });

      const clearBtn = dialog.querySelector('#btn-api-config-clear') as HTMLElement;
      const hintEl = dialog.querySelector('#mode-hint') as HTMLElement;
      const modeBadge = dialog.querySelector('#mode-current-badge') as HTMLElement;
      const savingsSection = dialog.querySelector('#cfg-savings-section') as HTMLElement;

      if (mode === 'auto') {
        savingsSection.hidden = true;
        clearBtn.hidden = !hasApiCredentials();
        hintEl.textContent = 'Binance sincroniza datos y saldo de forma automática.';
        modeBadge.textContent = 'Binance';
        modeBadge.classList.add('is-auto');
      } else {
        savingsSection.hidden = false;
        clearBtn.hidden = !hasApiCredentials();
        hintEl.textContent = 'Manual: la app usa los datos guardados o restaurados desde backup.';
        modeBadge.textContent = 'Manual';
        modeBadge.classList.remove('is-auto');
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

    showStatus(statusEl, 'Probando conexión...', 'info');

    const result = await testApiConnection({ apiKey: key, apiSecret: secret });

    if (result.success) {
      const perms = result.permissions.join(', ') || 'N/A';
      const hasWritePermissions =
        result.permissions.includes('WITHDRAW') || result.permissions.includes('TRADE');
      if (hasWritePermissions) {
        showStatus(
          statusEl,
          `Conexión exitosa, pero tu API key no es de solo lectura. Por seguridad, usa una key sin permisos TRADE ni WITHDRAW. Permisos: ${perms}`,
          'warning',
        );
      } else {
        showStatus(statusEl, `Conexión exitosa. Permisos: ${perms}`, 'success');
      }
    } else {
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
      saveApiCredentials({ apiKey: key, apiSecret: secret });
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
