import { openModal, closeModal, bindModalEvents } from '../../utils/modal-manager';
import {
  loadApiCredentials,
  loadStoredApiKey,
  saveApiCredentials,
  clearApiCredentials,
} from '../../utils/binance-auth';
import { testApiConnection, clearAllCaches } from '../../utils/binance-client';
import {
  clearBybitApiCredentials,
  loadBybitApiCredentials,
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
import { escapeHtml, providerName } from '../../utils/ui-helpers';
import { iconLock, iconWallet, iconX } from '../../utils/icons';
import { loadState, updatePortfolio } from '../../utils/storage';
import { parseFlexibleNumber } from '../../utils/parse-number';

// Relleno de longitud fija para el campo de secret: nunca se renderiza el
// secret real ni se filtra su longitud.
const SECRET_MASK = '•'.repeat(12);

// El campo censurado esta deshabilitado, asi que su value es relleno y no
// entrada del usuario: leerlo enviaria la mascara como secret.
function readSecretInput(input: HTMLInputElement): string {
  return input.disabled ? '' : input.value.trim();
}

function missingSecretMessage(exchange: string, secretInput: HTMLInputElement): string {
  const hint = secretInput.disabled ? ' Elimina las credenciales para escribir unas nuevas.' : '';
  return `API Key y Secret son requeridos para guardar ${exchange}.${hint}`;
}

function formatEditableCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface ExchangeIds {
  name: string;
  keyInput: string;
  secretInput: string;
  testBtn: string;
  clearBtn: string;
}

const BINANCE_IDS: ExchangeIds = {
  name: 'Binance',
  keyInput: 'input-api-key',
  secretInput: 'input-api-secret',
  testBtn: 'btn-api-config-test',
  clearBtn: 'btn-api-config-clear',
};

const BYBIT_IDS: ExchangeIds = {
  name: 'Bybit',
  keyInput: 'input-bybit-api-key',
  secretInput: 'input-bybit-api-secret',
  testBtn: 'btn-bybit-api-config-test',
  clearBtn: 'btn-bybit-api-config-clear',
};

function renderExchange(ids: ExchangeIds, storedApiKey: string): string {
  const isConnected = storedApiKey.length > 0;

  return `
    <div class="cfg-exchange">
      <div class="cfg-exchange-head">
        <span class="cfg-exchange-name">${providerName(ids.name)}</span>
        <span class="chip ${isConnected ? 'chip-gain' : 'chip-idle'}">
          <span class="chip-dot"></span>${isConnected ? 'Conectado' : 'Sin configurar'}
        </span>
      </div>
      <div class="cfg-grid">
        <div class="field">
          <label class="field-label" for="${ids.keyInput}">API Key</label>
          <input class="input" type="text" id="${ids.keyInput}" placeholder="Tu API Key de ${ids.name}"
                 value="${escapeHtml(storedApiKey)}" autocomplete="off" spellcheck="false">
        </div>
        <div class="field">
          <label class="field-label" for="${ids.secretInput}">API Secret</label>
          <input class="input" type="password" id="${ids.secretInput}"
                 ${isConnected ? `value="${SECRET_MASK}" disabled` : `value="" placeholder="Tu API Secret de ${ids.name}"`}
                 autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div class="row">
        <button type="button" class="btn btn-sm" id="${ids.testBtn}">Probar conexión</button>
        <button type="button" class="btn btn-danger btn-sm" id="${ids.clearBtn}" ${isConnected ? '' : 'disabled aria-disabled="true"'}>Eliminar credenciales</button>
      </div>
    </div>`;
}

let modalEl: HTMLDialogElement | null = null;

function getOrCreateModal(): HTMLDialogElement {
  if (modalEl) return modalEl;

  const dialog = document.createElement('dialog');
  dialog.id = 'modal-api-config';
  dialog.className = 'modal-overlay';
  dialog.setAttribute('aria-labelledby', 'modal-api-config-title');

  const apiKey = loadStoredApiKey();
  const bybitApiKey = loadStoredBybitApiKey();
  const { portfolio } = loadState();

  dialog.innerHTML = `
    <div class="modal modal-config">
      <div class="modal-head">
        <h3 class="modal-title" id="modal-api-config-title">Configuración</h3>
        <button type="button" class="icon-btn" id="btn-api-config-close" aria-label="Cerrar configuración">
          ${iconX(15)}
        </button>
      </div>

      <div class="modal-status-slot">
        <div id="api-config-status" class="modal-status" role="status" aria-live="polite" hidden></div>
      </div>

      <div class="modal-body">
        <section class="cfg-section" aria-labelledby="config-portfolio-title">
          <div class="cfg-legend">
            <span class="cfg-legend-title" id="config-portfolio-title">${iconWallet(13)} Portfolio</span>
            <span class="cfg-legend-copy">Define cuanto llevas invertido y cual es el objetivo que persigues.</span>
          </div>
          <div class="cfg-body">
            <div class="cfg-grid">
              <div class="field">
                <label class="field-label" for="input-cfg-invested">Invertido total</label>
                <span class="input-affix">
                  <span class="input-prefix">$</span>
                  <input class="input has-prefix" type="text" id="input-cfg-invested" inputmode="decimal" value="${formatEditableCurrency(portfolio.totalInvested)}">
                </span>
              </div>
              <div class="field">
                <label class="field-label" for="input-cfg-goal">Meta</label>
                <span class="input-affix">
                  <span class="input-prefix">$</span>
                  <input class="input has-prefix" type="text" id="input-cfg-goal" inputmode="decimal" value="${formatEditableCurrency(portfolio.goalAmount)}">
                </span>
              </div>
            </div>
            <span class="field-hint">El saldo y las posiciones se leen de los exchanges conectados; invertido y meta los defines tu.</span>
          </div>
        </section>

        <section class="cfg-section" aria-labelledby="config-exchanges-title">
          <div class="cfg-legend">
            <span class="cfg-legend-title" id="config-exchanges-title">${iconLock(13)} Exchanges</span>
            <span class="cfg-legend-copy">Claves de solo lectura. Nunca habilites permisos de trading ni retiro. El secret guardado no se muestra.</span>
          </div>
          <div class="cfg-body">
            ${renderExchange(BINANCE_IDS, apiKey)}
            ${renderExchange(BYBIT_IDS, bybitApiKey)}
          </div>
        </section>
      </div>

      <div class="modal-foot">
        <span class="muted">Las credenciales se guardan cifradas en el vault local (DPAPI).</span>
        <span class="row">
          <button type="button" class="btn btn-sm" id="btn-api-config-cancel">Cancelar</button>
          <button type="button" class="btn btn-primary btn-sm" id="btn-api-config-save">Guardar cambios</button>
        </span>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);
  modalEl = dialog;

  bindModalEvents(dialog, [
    dialog.querySelector('#btn-api-config-cancel') as HTMLElement,
    dialog.querySelector('#btn-api-config-close') as HTMLElement,
  ]);
  bindApiConfigEvents(dialog);

  return dialog;
}

function syncClearButton(dialog: HTMLDialogElement, id: string, hasCredentials: boolean): void {
  const button = dialog.querySelector(`#${id}`) as HTMLButtonElement;
  button.disabled = !hasCredentials;
  button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
}

function bindApiConfigEvents(dialog: HTMLDialogElement): void {
  const statusEl = dialog.querySelector('#api-config-status') as HTMLElement;

  dialog.querySelector('#btn-bybit-api-config-test')?.addEventListener('click', async () => {
    const keyInput = dialog.querySelector('#input-bybit-api-key') as HTMLInputElement;
    const secretInput = dialog.querySelector('#input-bybit-api-secret') as HTMLInputElement;
    const stored = loadBybitApiCredentials();
    const key = keyInput.value.trim() || stored?.apiKey || '';
    const secret = readSecretInput(secretInput) || stored?.apiSecret || '';

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
    // El campo de secret nunca se rellena, asi que sin este fallback no se
    // podrian probar las credenciales ya guardadas sin re-escribirlas.
    const stored = loadApiCredentials();
    const key = keyInput.value.trim() || stored?.apiKey || '';
    const secret = readSecretInput(secretInput) || stored?.apiSecret || '';

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

  // El vault se carga solo al abrir el modal: no hay accion del usuario que hacer.
  void (async () => {
    const credentials = await loadLocalVaultCredentials();
    if (!credentials?.binance && !credentials?.bybit) return;

    if (credentials.binance) saveApiCredentials(credentials.binance);
    if (credentials.bybit) saveBybitApiCredentials(credentials.bybit);

    // El modal ya se pinto sin credenciales: sin esto, "Eliminar credenciales"
    // seguiria deshabilitado aunque el vault acabe de aportarlas.
    syncClearButton(dialog, BINANCE_IDS.clearBtn, loadStoredApiKey().length > 0);
    syncClearButton(dialog, BYBIT_IDS.clearBtn, loadStoredBybitApiKey().length > 0);

    clearAllRuntimeCaches();
    dispatchConfigChange();
  })();

  dialog.querySelector('#btn-api-config-save')?.addEventListener('click', async () => {
    const keyInput = dialog.querySelector('#input-api-key') as HTMLInputElement;
    const secretInput = dialog.querySelector('#input-api-secret') as HTMLInputElement;
    const bybitKeyInput = dialog.querySelector('#input-bybit-api-key') as HTMLInputElement;
    const bybitSecretInput = dialog.querySelector('#input-bybit-api-secret') as HTMLInputElement;
    const investedInput = dialog.querySelector('#input-cfg-invested') as HTMLInputElement;
    const goalInput = dialog.querySelector('#input-cfg-goal') as HTMLInputElement;
    const storedBinanceKey = loadStoredApiKey();
    const storedBybitKey = loadStoredBybitApiKey();
    const key = keyInput.value.trim();
    const secret = readSecretInput(secretInput);
    const bybitKey = bybitKeyInput.value.trim();
    const bybitSecret = readSecretInput(bybitSecretInput);
    const shouldSaveBinanceCredentials = secret.length > 0 || key !== storedBinanceKey;
    const shouldSaveBybitCredentials = bybitSecret.length > 0 || bybitKey !== storedBybitKey;

    if (shouldSaveBinanceCredentials && (!key || !secret)) {
      showStatus(statusEl, missingSecretMessage('Binance', secretInput), 'error');
      return;
    }

    if (shouldSaveBybitCredentials && (!bybitKey || !bybitSecret)) {
      showStatus(statusEl, missingSecretMessage('Bybit', bybitSecretInput), 'error');
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
  el.className = `modal-status modal-status--${type}`;
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
  openModal(getOrCreateModal());
}

export function onApiConfigChange(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener('binance-config-change', handler);
  return () => window.removeEventListener('binance-config-change', handler);
}
