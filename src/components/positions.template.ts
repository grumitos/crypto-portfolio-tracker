import { iconPencil, iconPlus, iconRefreshCw, iconTarget, iconUpload } from '../utils/icons';
import { escapeHtml, skeletonSpan } from '../utils/ui-helpers';
import {
  DURATION_PRESETS,
  POSITIONS_COPY,
  SPOT_CHANGE_SKELETON_WIDTH,
  SPOT_VALUE_SKELETON_WIDTH,
} from './positions.constants';

interface PositionsTemplateInput {
  autoMode: boolean;
  hasApi: boolean;
  activeCount: number;
  buyLowMarkup: string;
  sellHighMarkup: string;
  hasPositions: boolean;
  marketButtonEnabled: boolean;
  assetOptions: string[];
  subscriptionOptions: string[];
}

function renderHeaderActions(autoMode: boolean, hasApi: boolean, marketButtonEnabled: boolean): string {
  const marketBtn =
    marketButtonEnabled && hasApi
      ? `<button type="button" class="btn btn-sm" id="btn-open-market" title="Explorar productos del Mercado Dual">${iconTarget(13)}Mercado</button>`
      : '';

  if (autoMode) {
    return `
      <div class="section-actions">
        ${marketBtn}
        <button type="button" class="btn btn-sm" id="btn-sync-positions" title="Sincronizar posiciones desde Binance">${iconRefreshCw(13)}Sincronizar</button>
      </div>
    `;
  }

  return `
    <div class="section-actions">
      ${marketBtn}
      <button type="button" class="btn btn-sm" id="btn-toggle-edit">${iconPencil(13)}Editar</button>
      <button type="button" class="btn btn-sm" id="btn-bulk-import">${iconUpload(13)}Pegar y reemplazar</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-add-position">${iconPlus(14)}Nueva posición</button>
    </div>
  `;
}

function renderEmptyState(autoMode: boolean, hasApi: boolean): string {
  if (autoMode) {
    return `
      <div class="card empty-state" id="positions-empty-state">
        <p>${hasApi ? POSITIONS_COPY.autoEmptyTitle : POSITIONS_COPY.apiMissingTitle}</p>
        <p class="text-muted">${hasApi ? POSITIONS_COPY.autoEmptyBody : POSITIONS_COPY.apiMissingBody}</p>
      </div>
    `;
  }

  return `
    <div class="card empty-state">
      <p>${POSITIONS_COPY.manualEmptyTitle}</p>
      <p>${POSITIONS_COPY.manualEmptyBody}</p>
    </div>
  `;
}

function renderOptions(options: string[], selected: string): string {
  return options
    .map((option) => `<option value="${option}" ${option === selected ? 'selected' : ''}>${option}</option>`)
    .join('');
}

export function renderPositionsTemplate(input: PositionsTemplateInput): string {
  return `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">${POSITIONS_COPY.title}</h2>
        ${renderHeaderActions(input.autoMode, input.hasApi, input.marketButtonEnabled)}
      </div>

      <div class="grid-4">
        <div class="stat-card" data-shared-card="apr">
          <div class="card-title">${POSITIONS_COPY.aprTitle}</div>
          <div class="stat-value" id="positions-apr">${skeletonSpan('70px')}</div>
        </div>
        <div class="stat-card" data-shared-card="capital">
          <div class="card-title">${POSITIONS_COPY.capitalTitle}</div>
          <div class="stat-value" id="positions-capital">${skeletonSpan('90px')}</div>
        </div>
        <div class="stat-card" data-shared-card="daily">
          <div class="card-title">${POSITIONS_COPY.dailyTitle}</div>
          <div class="stat-value" id="positions-daily">${skeletonSpan('70px')}</div>
        </div>
        <div class="stat-card" data-shared-card="positions">
          <div class="card-title">${POSITIONS_COPY.countTitle}</div>
          <div class="stat-value" id="positions-count">${input.activeCount}</div>
        </div>
      </div>

      <div class="positions-spot-strip-wrap">
        <div class="positions-spot-strip" id="positions-spot-strip" hidden></div>
      </div>

      <div id="positions-tables-container">
        ${
          input.hasPositions
            ? `${input.buyLowMarkup}${input.sellHighMarkup}`
            : renderEmptyState(input.autoMode, input.hasApi)
        }
      </div>
    </div>

    <dialog id="modal-position" class="modal-overlay">
      <div class="modal">
        <h3 class="modal-title" id="modal-position-title">Nueva posición</h3>
        <input type="hidden" id="input-position-id" value="">

        <div class="form-group">
          <label for="input-direction">Dirección</label>
          <div class="direction-toggle">
            <button type="button" class="dir-btn active" data-dir="buy-low" id="dir-buy-low">Buy Low</button>
            <button type="button" class="dir-btn" data-dir="sell-high" id="dir-sell-high">Sell High</button>
          </div>
          <input type="hidden" id="input-direction" value="buy-low">
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label for="input-asset">Activo</label>
            <select id="input-asset">${renderOptions(input.assetOptions, 'ETH')}</select>
          </div>
          <div class="form-group">
            <label for="input-sub-asset">Moneda de suscripción</label>
            <select id="input-sub-asset">${renderOptions(input.subscriptionOptions, 'USDT')}</select>
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label for="input-amount">Monto suscrito</label>
            <input type="number" id="input-amount" step="1" placeholder="0.00">
          </div>
          <div class="form-group">
            <label for="input-apr">APR (%)</label>
            <input type="number" id="input-apr" step="1" placeholder="0.00">
          </div>
        </div>

        <div class="form-group">
          <label for="input-target">Precio objetivo</label>
          <input type="number" id="input-target" step="1" placeholder="0.00">
        </div>

        <div class="form-group">
          <label for="input-entry-date">Fecha de suscripción</label>
          <div class="grid-2 position-datetime-inputs">
            <input type="date" id="input-entry-date">
            <input type="time" id="input-entry-time" step="60" placeholder="HH:MM">
          </div>
        </div>

        <div class="form-group">
          <label for="input-settlement-date">Fecha de liquidación</label>
          <div class="duration-presets">
            ${DURATION_PRESETS.map((preset) => `<button type="button" class="preset-btn" data-days="${preset.days}">${preset.label}</button>`).join('')}
          </div>
          <div class="grid-2 position-datetime-inputs position-datetime-inputs--settlement">
            <input type="date" id="input-settlement-date">
            <input type="time" id="input-settlement-time" step="60" placeholder="HH:MM">
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn" id="btn-cancel-position">Cancelar</button>
          <button type="button" class="btn btn-primary" id="btn-save-position">Guardar</button>
        </div>
      </div>
    </dialog>

    <dialog id="modal-bulk-import" class="modal-overlay">
      <div class="modal">
        <h3 class="modal-title">Pegar posiciones (Binance)</h3>
        <div class="form-group">
          <label for="input-bulk-import">Pega el bloque completo copiado desde Binance</label>
          <textarea id="input-bulk-import" rows="14" placeholder="USDC-ETH&#10;Buy-low&#10;2026-02-19 14:29&#10;100 USDC&#10;..."></textarea>
          <div class="text-muted hint-text">Reemplazará todas las posiciones actuales.</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" id="btn-cancel-bulk-import">Cancelar</button>
          <button type="button" class="btn btn-primary" id="btn-apply-bulk-import">Reemplazar</button>
        </div>
      </div>
    </dialog>
  `;
}

export function renderSpotCardTemplate(asset: string): string {
  const safeAsset = escapeHtml(asset);
  return `
    <span class="positions-spot-header">
      <span class="positions-spot-logo-wrap">
        <img class="positions-spot-logo" loading="lazy" decoding="async">
        <span class="positions-spot-fallback mono"></span>
      </span>
      <span class="positions-spot-symbol mono">${safeAsset}</span>
    </span>
    <span class="positions-spot-meta">
      <span class="positions-spot-value mono" id="positions-spot-value-${asset}">${skeletonSpan(SPOT_VALUE_SKELETON_WIDTH)}</span>
      <span class="positions-spot-change-row">
        <span class="positions-spot-change mono" id="positions-spot-change-${asset}">${skeletonSpan(SPOT_CHANGE_SKELETON_WIDTH)}</span>
        <span class="positions-spot-change-window mono">24h</span>
      </span>
    </span>
  `;
}
