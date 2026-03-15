import type { DualProductScored, DualMarketFilters, DualMarketState, Direction } from '../../types';
import {
  fetchAccountBalances,
  fetchDualProducts,
  subscribeDualProduct,
} from '../../utils/binance-client';
import {
  hasApiCredentials,
  isTradingSessionActive,
  activateTradingSession,
  getTradingSessionRemainingMs,
  hasTradingPin,
  deactivateTradingSession,
  isAutoMode,
} from '../../utils/binance-auth';
import {
  scoreDualProducts,
  getTopRecommendations,
  explainScore,
} from '../../utils/dual-recommendation';
import { getAssetPriceSnapshot } from '../../utils/market';
import { formatUSD } from '../../utils/calculator';
import { escapeHtml, skeletonSpan } from '../../utils/ui-helpers';
import { iconInfo, iconLock, iconRefreshCw, iconX } from '../../utils/icons';
import { openModal, closeModal, bindModalEvents } from '../../utils/modal-manager';
import { showConfirmDialog, showAlertDialog } from '../../utils/dialogs';

const DUAL_MARKET_STORAGE_KEY = 'crypto-dual-market';
const SESSION_TICKER_MS = 1000;
const DUAL_MARKET_PAGE_SIZE = 8;
const DUAL_MARKET_ASSETS = ['BTC', 'ETH', 'BNB', 'SOL'] as const;

interface DualMarketContext {
  container: HTMLElement;
  state: DualMarketState;
  products: DualProductScored[];
  topIds: Set<string>;
  loading: boolean;
  error: string | null;
  currentPage: number;
  sessionTickerId: ReturnType<typeof setInterval> | null;
  disposed: boolean;
  onClose: () => void;
}

// ── State persistence ──

function loadMarketState(): DualMarketState {
  try {
    const raw = localStorage.getItem(DUAL_MARKET_STORAGE_KEY);
    if (!raw) return { filters: {} };
    const parsed = JSON.parse(raw) as Partial<DualMarketState>;
    return { filters: parsed.filters ?? {} };
  } catch {
    return { filters: {} };
  }
}

function saveMarketState(state: DualMarketState): void {
  try {
    localStorage.setItem(DUAL_MARKET_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ── Rendering ──

function directionLabel(optionType: 'CALL' | 'PUT'): string {
  return optionType === 'CALL' ? 'Sell High' : 'Buy Low';
}

function safetyClass(distancePercent: number): string {
  if (distancePercent > 10) return 'dm-safety-high';
  if (distancePercent > 5) return 'dm-safety-mid';
  return 'dm-safety-low';
}

function renderProductRow(
  product: DualProductScored,
  isTop: boolean,
  tradingActive: boolean,
  autoMode: boolean,
): string {
  const asset = product.optionType === 'CALL' ? product.investCoin : product.exercisedCoin;
  const dirClass = product.optionType === 'CALL' ? 'dm-dir-sell' : 'dm-dir-buy';
  const distSign = product.distancePercent >= 0 ? '+' : '';
  const safeClass = safetyClass(Math.abs(product.distancePercent));
  const scorePercent = (product.score * 100).toFixed(0);
  const explanation = escapeHtml(explainScore(product));

  return `
    <tr class="dm-product-row${isTop ? ' dm-recommended' : ''}" data-product-id="${escapeHtml(product.id)}">
      <td class="mono">${escapeHtml(asset)}</td>
      <td><span class="dm-dir-badge ${dirClass}">${directionLabel(product.optionType)}</span></td>
      <td class="mono">${formatUSD(product.strikePrice)}</td>
      <td class="mono ${safeClass}">${distSign}${product.distancePercent.toFixed(1)}%</td>
      <td class="mono dm-apr">${product.apr.toFixed(2)}%</td>
      <td class="mono">${product.duration}d</td>
      <td class="mono" title="${explanation}">
        ${isTop ? '<span class="dm-star">★</span>' : ''}${scorePercent}
      </td>
      <td>
        ${autoMode && tradingActive ? `<button class="btn btn-xs btn-primary dm-btn-subscribe" data-product-id="${escapeHtml(product.id)}">Suscribir</button>` : `<button class="btn btn-xs dm-btn-prefill" data-product-id="${escapeHtml(product.id)}">Usar</button>`}
      </td>
    </tr>
  `;
}

function renderFilterBar(filters: DualMarketFilters): string {
  const assetButtons = [
    { value: '', label: 'Todos' },
    ...DUAL_MARKET_ASSETS.map((asset) => ({ value: asset, label: asset })),
  ];
  const directionButtons: Array<{ value: '' | Direction; label: string }> = [
    { value: '', label: 'Ambas' },
    { value: 'buy-low', label: 'Buy Low' },
    { value: 'sell-high', label: 'Sell High' },
  ];

  return `
    <div class="dm-filters">
      <div class="dm-filter-block">
        <span class="dm-filter-label">Par</span>
        <div class="dm-chip-group" id="dm-filter-asset">
          ${assetButtons
            .map(
              (item) =>
                `<button type="button" class="dm-chip${filters.asset === item.value ? ' is-active' : ''}" data-asset="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`,
            )
            .join('')}
        </div>
      </div>
      <div class="dm-filter-block">
        <span class="dm-filter-label">Tipo</span>
        <div class="dm-chip-group" id="dm-filter-direction">
          ${directionButtons
            .map(
              (item) =>
                `<button type="button" class="dm-chip${filters.direction === item.value ? ' is-active' : ''}" data-direction="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`,
            )
            .join('')}
        </div>
      </div>
      <div class="dm-filter-range">
        <input type="number" class="dm-filter-input" id="dm-filter-min-apr" placeholder="APR min %"
               value="${filters.minApr ?? ''}" min="0" step="1">
        <input type="number" class="dm-filter-input" id="dm-filter-max-duration" placeholder="Máx. días"
               value="${filters.maxDuration ?? ''}" min="1" step="1">
      </div>
    </div>
  `;
}

function renderTable(ctx: DualMarketContext): string {
  if (ctx.loading) {
    return `<div class="dm-loading">${skeletonSpan('100%')}<br>${skeletonSpan('100%')}<br>${skeletonSpan('100%')}</div>`;
  }

  if (ctx.error) {
    return `<div class="dm-empty text-loss">Error: ${escapeHtml(ctx.error)}</div>`;
  }

  if (ctx.products.length === 0) {
    return `<div class="dm-empty text-muted">No hay productos disponibles con los filtros actuales.</div>`;
  }

  const tradingActive = isTradingSessionActive();
  const autoMode = isAutoMode();
  const totalPages = Math.max(1, Math.ceil(ctx.products.length / DUAL_MARKET_PAGE_SIZE));
  const currentPage = Math.min(ctx.currentPage, totalPages);
  const startIndex = (currentPage - 1) * DUAL_MARKET_PAGE_SIZE;
  const rows = ctx.products
    .slice(startIndex, startIndex + DUAL_MARKET_PAGE_SIZE)
    .map((p) => renderProductRow(p, ctx.topIds.has(p.id), tradingActive, autoMode))
    .join('');

  const pagination =
    totalPages > 1
      ? `<div class="dm-pagination">
          <button type="button" class="btn btn-xs dm-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>Anterior</button>
          <span class="dm-page-status mono">Página ${currentPage} / ${totalPages}</span>
          <button type="button" class="btn btn-xs dm-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente</button>
        </div>`
      : '';

  return `
    <div class="table-container">
      <table class="dm-table">
        <thead>
          <tr>
            <th>Activo</th>
            <th>Dirección</th>
            <th>Strike</th>
            <th>Distancia</th>
            <th>APR</th>
            <th>Plazo</th>
            <th>Score</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pagination}
  `;
}

function renderTradingSessionBar(_ctx: DualMarketContext): string {
  if (!hasApiCredentials() || !isAutoMode()) return '';

  const hasPinSaved = hasTradingPin();
  const sessionActive = isTradingSessionActive();

  if (sessionActive) {
    const remainMs = getTradingSessionRemainingMs();
    const remainMin = Math.ceil(remainMs / 60_000);
    return `
      <div class="dm-session-bar dm-session-active">
        <div class="dm-session-copy">
          <span class="dm-session-indicator"></span>
          <span>Trading activo — <span id="dm-session-timer">${remainMin} min</span> restante</span>
        </div>
        <div class="dm-session-actions">
          <button class="btn btn-xs btn-danger" id="dm-btn-lock-trading">Bloquear</button>
        </div>
      </div>
    `;
  }

  if (!hasPinSaved) {
    return `
      <div class="dm-session-bar dm-session-locked">
        <span class="text-muted">Configura un PIN desde Config para habilitar suscripciones directas.</span>
      </div>
    `;
  }

  return `
    <div class="dm-session-bar dm-session-locked">
      <div class="dm-session-copy">
        <span class="dm-session-label">${iconLock(14)}Trading bloqueado</span>
        <span class="dm-session-helper">Desbloquea una sesion temporal para suscribir productos.</span>
      </div>
      <div class="dm-session-actions">
        <button class="btn btn-primary" id="dm-btn-unlock-trading">Desbloquear con PIN</button>
      </div>
    </div>
  `;
}

async function showScoreInfoDialog(): Promise<void> {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal">
      <h3 class="modal-title">Como se calcula el score</h3>
      <div class="dm-score-guide">
        <p>El score resume que tan atractivo es cada producto para comparar opciones rapidamente.</p>
        <div class="dm-score-guide-grid">
          <div><strong>Yield</strong><span>APR mas alto suma puntos.</span></div>
          <div><strong>Safety</strong><span>Mas distancia entre spot y strike suele ser mas conservador.</span></div>
          <div><strong>Duration</strong><span>Plazos mas cortos mejoran flexibilidad y rotacion.</span></div>
          <div><strong>Trend</strong><span>Se usa el cambio 24h para contextualizar el momento del mercado.</span></div>
          <div><strong>Compound</strong><span>Favorece productos con mejor potencial de reinversion.</span></div>
        </div>
        <p class="text-muted">La estrella marca recomendaciones destacadas dentro del lote cargado. Usa el detalle del tooltip en cada fila para ver la explicacion puntual.</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="dm-score-close">Cerrar</button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);
  openModal(dialog);
  bindModalEvents(dialog, [dialog.querySelector('#dm-score-close') as HTMLElement]);
  dialog.querySelector('#dm-score-close')?.addEventListener('click', () => {
    closeModal(dialog);
    dialog.remove();
  });
}

// ── Main render ──

export function openDualMarketModal(onPrefillPosition: (product: DualProductScored) => void): void {
  if (!hasApiCredentials()) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'modal-overlay';

  const cleanup = () => {
    ctx.disposed = true;
    if (ctx.sessionTickerId) clearInterval(ctx.sessionTickerId);
    closeModal(dialog);
    dialog.remove();
  };

  const ctx: DualMarketContext = {
    container: dialog,
    state: loadMarketState(),
    products: [],
    topIds: new Set(),
    loading: true,
    error: null,
    currentPage: 1,
    sessionTickerId: null,
    disposed: false,
    onClose: cleanup,
  };

  const wrappedPrefill = (product: DualProductScored): void => {
    cleanup();
    onPrefillPosition(product);
  };

  renderModalContent(ctx, wrappedPrefill);

  document.body.appendChild(dialog);
  openModal(dialog);

  loadProducts(ctx, wrappedPrefill);
}

function refreshModal(
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
): void {
  renderModalContent(ctx, onPrefillPosition);
}

function renderModalContent(
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
): void {
  const hasApi = hasApiCredentials();

  ctx.container.innerHTML = `
    <div class="modal modal--wide">
      <div class="dm-modal-header">
        <h3 class="modal-title" style="margin-bottom:0">Mercado Dual</h3>
        <div class="dm-modal-header-actions">
          <button class="btn btn-xs" id="dm-btn-score-info" title="Como se calcula el score">${iconInfo(13)}Score</button>
          <button class="btn btn-xs" id="dm-btn-refresh" title="Recargar productos">${iconRefreshCw(13)}</button>
          <button class="btn btn-icon" id="dm-btn-close" title="Cerrar">${iconX(16)}</button>
        </div>
      </div>
      ${
        hasApi
          ? `
        ${renderTradingSessionBar(ctx)}
        ${renderFilterBar(ctx.state.filters)}
        <div id="dm-table-container">${renderTable(ctx)}</div>
      `
          : `
        <div class="dm-no-api">
          <p class="text-muted">Configura tu API de Binance desde Config en la barra superior para ver productos disponibles.</p>
        </div>
      `
      }
    </div>
  `;

  bindSectionEvents(ctx, onPrefillPosition);
  bindModalEvents(ctx.container, [ctx.container.querySelector('#dm-btn-close') as HTMLElement]);
  ctx.container.querySelector('#dm-btn-close')?.addEventListener('click', ctx.onClose);
}

function bindSectionEvents(
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
): void {
  ctx.container.querySelector('#dm-btn-score-info')?.addEventListener('click', () => {
    void showScoreInfoDialog();
  });

  ctx.container.querySelector('#dm-btn-refresh')?.addEventListener('click', () => {
    loadProducts(ctx, onPrefillPosition, true);
  });

  // Filter changes
  bindFilterEvents(ctx, onPrefillPosition);

  // Trading session
  bindTradingSessionEvents(ctx, onPrefillPosition);

  // Product action buttons
  bindProductActions(ctx, onPrefillPosition);

  ctx.container.querySelectorAll<HTMLButtonElement>('.dm-page-btn[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page ?? '', 10);
      if (!Number.isFinite(page) || page < 1) return;
      ctx.currentPage = page;
      updateTableView(ctx, onPrefillPosition);
    });
  });
}

function bindFilterEvents(
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
): void {
  const minAprEl = ctx.container.querySelector('#dm-filter-min-apr') as HTMLInputElement | null;
  const maxDurEl = ctx.container.querySelector(
    '#dm-filter-max-duration',
  ) as HTMLInputElement | null;

  const applyFilters = () => {
    const minApr = parseFloat(minAprEl?.value ?? '');
    ctx.state.filters.minApr = Number.isFinite(minApr) ? minApr : undefined;
    const maxDur = parseInt(maxDurEl?.value ?? '', 10);
    ctx.state.filters.maxDuration = Number.isFinite(maxDur) ? maxDur : undefined;
    ctx.currentPage = 1;
    saveMarketState(ctx.state);
    updateTableView(ctx, onPrefillPosition);
  };

  ctx.container.querySelectorAll<HTMLButtonElement>('.dm-chip[data-asset]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextAsset = button.dataset.asset || undefined;
      ctx.state.filters.asset = nextAsset || undefined;
      applyFilters();
    });
  });

  ctx.container
    .querySelectorAll<HTMLButtonElement>('.dm-chip[data-direction]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const nextDirection = (button.dataset.direction as Direction | '') || undefined;
        ctx.state.filters.direction = nextDirection;
        applyFilters();
      });
    });

  minAprEl?.addEventListener('input', applyFilters);
  maxDurEl?.addEventListener('input', applyFilters);
}

function bindTradingSessionEvents(
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
): void {
  ctx.container.querySelector('#dm-btn-unlock-trading')?.addEventListener('click', () => {
    showPinDialog(ctx, onPrefillPosition);
  });

  ctx.container.querySelector('#dm-btn-lock-trading')?.addEventListener('click', () => {
    deactivateTradingSession();
    refreshModal(ctx, onPrefillPosition);
  });

  // Start session timer if active
  if (isTradingSessionActive()) {
    startSessionTicker(ctx, onPrefillPosition);
  }
}

function startSessionTicker(
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
): void {
  if (ctx.sessionTickerId) clearInterval(ctx.sessionTickerId);

  ctx.sessionTickerId = setInterval(() => {
    if (ctx.disposed) {
      if (ctx.sessionTickerId) clearInterval(ctx.sessionTickerId);
      return;
    }

    const timerEl = ctx.container.querySelector('#dm-session-timer');
    if (!timerEl) return;

    if (!isTradingSessionActive()) {
      if (ctx.sessionTickerId) clearInterval(ctx.sessionTickerId);
      ctx.sessionTickerId = null;
      refreshModal(ctx, onPrefillPosition);
      return;
    }

    const remainMs = getTradingSessionRemainingMs();
    const remainSec = Math.ceil(remainMs / 1000);
    if (remainSec > 60) {
      timerEl.textContent = `${Math.ceil(remainSec / 60)} min`;
    } else {
      timerEl.textContent = `${remainSec}s`;
    }
  }, SESSION_TICKER_MS);
}

async function showPinDialog(
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
): Promise<void> {
  // Create a temporary PIN input dialog
  const dialog = document.createElement('dialog');
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal">
      <h3 class="modal-title">Desbloquear Trading</h3>
      <div class="form-group">
        <label for="dm-pin-input">Ingresa tu PIN</label>
        <input type="password" id="dm-pin-input" maxlength="6" pattern="[0-9]{4,6}"
               inputmode="numeric" autocomplete="off" placeholder="••••">
      </div>
      <div id="dm-pin-error" class="text-loss" style="display:none;margin-bottom:var(--space-sm)"></div>
      <div class="modal-actions">
        <button class="btn" id="dm-pin-cancel">Cancelar</button>
        <button class="btn btn-primary" id="dm-pin-confirm">Desbloquear</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  openModal(dialog);

  const pinInput = dialog.querySelector('#dm-pin-input') as HTMLInputElement;
  const errorEl = dialog.querySelector('#dm-pin-error') as HTMLElement;
  pinInput.focus();

  const cleanup = () => {
    closeModal(dialog);
    dialog.remove();
  };

  bindModalEvents(dialog, [dialog.querySelector('#dm-pin-cancel') as HTMLElement]);

  dialog.querySelector('#dm-pin-cancel')?.addEventListener('click', cleanup);

  dialog.querySelector('#dm-pin-confirm')?.addEventListener('click', async () => {
    const pin = pinInput.value.trim();
    if (!pin) {
      errorEl.textContent = 'Ingresa el PIN';
      errorEl.style.display = '';
      return;
    }

    const success = await activateTradingSession(pin);
    if (success) {
      cleanup();
      refreshModal(ctx, onPrefillPosition);
    } else {
      errorEl.textContent = 'PIN incorrecto';
      errorEl.style.display = '';
      pinInput.value = '';
      pinInput.focus();
    }
  });

  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      dialog.querySelector<HTMLButtonElement>('#dm-pin-confirm')?.click();
    }
  });
}

function bindProductActions(
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
): void {
  // Prefill buttons
  ctx.container.querySelectorAll('.dm-btn-prefill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.productId;
      const product = ctx.products.find((p) => p.id === id);
      if (product) onPrefillPosition(product);
    });
  });

  // Subscribe buttons (Level 2)
  ctx.container.querySelectorAll('.dm-btn-subscribe').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.productId;
      const product = ctx.products.find((p) => p.id === id);
      if (!product) return;

      if (!isTradingSessionActive()) {
        await showAlertDialog('La sesion de trading ha expirado. Desbloquea con tu PIN.');
        refreshModal(ctx, onPrefillPosition);
        return;
      }

      // Show subscribe confirmation dialog
      await showSubscribeDialog(product, ctx, onPrefillPosition);
    });
  });
}

async function showSubscribeDialog(
  product: DualProductScored,
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
): Promise<void> {
  const asset = product.optionType === 'CALL' ? product.investCoin : product.exercisedCoin;
  const dir = directionLabel(product.optionType);
  const balanceInfo = await loadAssetBalance(product.investCoin);
  const effectiveMax =
    balanceInfo.available === null
      ? product.maxAmount
      : Math.max(0, Math.min(product.maxAmount, balanceInfo.available));

  const dialog = document.createElement('dialog');
  dialog.className = 'modal-overlay';
  dialog.innerHTML = `
    <div class="modal">
      <h3 class="modal-title">Suscribir Dual Investment</h3>
      <div class="dm-subscribe-summary">
        <div class="dm-subscribe-row"><span>Activo</span><strong>${escapeHtml(asset)}</strong></div>
        <div class="dm-subscribe-row"><span>Dirección</span><strong>${escapeHtml(dir)}</strong></div>
        <div class="dm-subscribe-row"><span>Strike</span><strong>${formatUSD(product.strikePrice)}</strong></div>
        <div class="dm-subscribe-row"><span>APR</span><strong>${product.apr.toFixed(2)}%</strong></div>
        <div class="dm-subscribe-row"><span>Plazo</span><strong>${product.duration} dias</strong></div>
      </div>
      <div class="form-group" style="margin-top:var(--space-md)">
        <div class="dm-subscribe-label-row">
          <label for="dm-subscribe-amount">Monto (${escapeHtml(product.investCoin)})</label>
          <button type="button" class="btn btn-xs" id="dm-subscribe-max" ${effectiveMax <= 0 ? 'disabled' : ''}>Max</button>
        </div>
        <div class="dm-subscribe-balance ${balanceInfo.available !== null && balanceInfo.available < product.minAmount ? 'text-loss' : 'text-muted'}">
          ${balanceInfo.label}
        </div>
        <div class="dm-subscribe-input-row">
          <input type="number" id="dm-subscribe-amount"
                 min="${product.minAmount}" max="${effectiveMax > 0 ? effectiveMax : product.maxAmount}"
                 step="${Math.pow(10, -product.purchaseDecimal)}"
                 placeholder="Min: ${product.minAmount}">
        </div>
        <div class="text-muted hint-text">Min: ${product.minAmount} — Max producto: ${product.maxAmount}${balanceInfo.available !== null ? ` — Max usable: ${formatAssetAmount(effectiveMax, product.investCoin)}` : ''}</div>
      </div>
      <div id="dm-subscribe-error" class="text-loss" style="display:none;margin-bottom:var(--space-sm)"></div>
      <div class="modal-actions">
        <button class="btn" id="dm-subscribe-cancel">Cancelar</button>
        <button class="btn btn-primary" id="dm-subscribe-confirm">Confirmar suscripción</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  openModal(dialog);

  const amountInput = dialog.querySelector('#dm-subscribe-amount') as HTMLInputElement;
  const errorEl = dialog.querySelector('#dm-subscribe-error') as HTMLElement;
  const maxBtn = dialog.querySelector('#dm-subscribe-max') as HTMLButtonElement | null;

  const cleanup = () => {
    closeModal(dialog);
    dialog.remove();
  };

  bindModalEvents(dialog, [dialog.querySelector('#dm-subscribe-cancel') as HTMLElement]);
  dialog.querySelector('#dm-subscribe-cancel')?.addEventListener('click', cleanup);
  maxBtn?.addEventListener('click', () => {
    if (effectiveMax <= 0) return;
    amountInput.value = String(effectiveMax);
  });

  dialog.querySelector('#dm-subscribe-confirm')?.addEventListener('click', async () => {
    const amount = parseFloat(amountInput.value);
    if (!Number.isFinite(amount) || amount < product.minAmount || amount > product.maxAmount) {
      errorEl.textContent = `Monto invalido. Rango: ${product.minAmount} - ${product.maxAmount}`;
      errorEl.style.display = '';
      return;
    }

    if (balanceInfo.available !== null && amount > balanceInfo.available) {
      errorEl.textContent = `Supera tu saldo disponible en ${product.investCoin}. Disponible: ${formatAssetAmount(balanceInfo.available, product.investCoin)}`;
      errorEl.style.display = '';
      return;
    }

    if (!isTradingSessionActive()) {
      errorEl.textContent = 'Sesion de trading expirada. Vuelve a desbloquear.';
      errorEl.style.display = '';
      return;
    }

    const confirmed = await showConfirmDialog(
      `¿Suscribir ${amount} ${product.investCoin} a Dual Investment ${directionLabel(product.optionType)} con strike ${formatUSD(product.strikePrice)}?`,
      { title: 'Confirmar suscripción', confirmLabel: 'Suscribir', destructive: false },
    );

    if (!confirmed) return;

    try {
      const btn = dialog.querySelector('#dm-subscribe-confirm') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Procesando...';

      if (!product.orderId) {
        throw new Error('Producto sin orderId. Actualiza el mercado e intenta otra vez.');
      }

      await subscribeDualProduct(product.id, product.orderId, amount);

      cleanup();
      await showAlertDialog('Suscripción exitosa. La posición aparecerá en tu listado.');
      // Refresh products and positions
      loadProducts(ctx, onPrefillPosition, true);
    } catch (err) {
      errorEl.textContent = `Error: ${err instanceof Error ? err.message : 'Error desconocido'}`;
      errorEl.style.display = '';
      const btn = dialog.querySelector('#dm-subscribe-confirm') as HTMLButtonElement;
      btn.disabled = false;
      btn.textContent = 'Confirmar suscripción';
    }
  });
}

// ── Data loading ──

async function loadProducts(
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
  forceRefresh = false,
): Promise<void> {
  if (ctx.disposed || !hasApiCredentials()) return;

  ctx.loading = true;
  ctx.error = null;
  updateTableView(ctx, onPrefillPosition);

  try {
    const rawProducts = await fetchDualProducts(forceRefresh);

    // Get spot prices for scoring
    const assets = Array.from(new Set(rawProducts.flatMap((p) => [p.investCoin, p.exercisedCoin])));
    const snapshot = await getAssetPriceSnapshot(assets, {
      forceRefresh,
      includeChangePercent24h: true,
    });

    const scored = scoreDualProducts(
      rawProducts,
      snapshot.priceByAsset,
      snapshot.changePercent24hByAsset ?? {},
    );

    const top = getTopRecommendations(scored);
    ctx.topIds = new Set(top.map((p) => p.id));

    // Apply filters and sort
    ctx.products = applyFilters(scored, ctx.state.filters);
    ctx.currentPage = Math.min(
      ctx.currentPage,
      Math.max(1, Math.ceil(ctx.products.length / DUAL_MARKET_PAGE_SIZE)),
    );
    ctx.loading = false;
    ctx.error = null;
    updateTableView(ctx, onPrefillPosition);
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[dual-market] Failed to load products:', err);
    ctx.loading = false;
    ctx.products = [];
    ctx.error = err instanceof Error ? err.message : 'Error al cargar productos';
    updateTableView(ctx, onPrefillPosition);
  }
}

function applyFilters(
  products: DualProductScored[],
  filters: DualMarketFilters,
): DualProductScored[] {
  let filtered = [...products];

  if (filters.asset) {
    const asset = filters.asset;
    filtered = filtered.filter((p) => p.investCoin === asset || p.exercisedCoin === asset);
  }

  if (filters.direction) {
    const optionType = filters.direction === 'sell-high' ? 'CALL' : 'PUT';
    filtered = filtered.filter((p) => p.optionType === optionType);
  }

  if (filters.minApr !== undefined && Number.isFinite(filters.minApr)) {
    const min = filters.minApr;
    filtered = filtered.filter((p) => p.apr >= min);
  }

  if (filters.maxDuration !== undefined && Number.isFinite(filters.maxDuration)) {
    const max = filters.maxDuration;
    filtered = filtered.filter((p) => p.duration <= max);
  }

  // Sort by score descending
  filtered.sort((a, b) => b.score - a.score);

  return filtered;
}

function updateTableView(
  ctx: DualMarketContext,
  onPrefillPosition: (product: DualProductScored) => void,
): void {
  const tableContainer = ctx.container.querySelector('#dm-table-container');
  if (!tableContainer) return;
  ctx.currentPage = Math.max(
    1,
    Math.min(ctx.currentPage, Math.max(1, Math.ceil(ctx.products.length / DUAL_MARKET_PAGE_SIZE))),
  );
  tableContainer.innerHTML = renderTable(ctx);
  bindProductActions(ctx, onPrefillPosition);
  ctx.container.querySelectorAll<HTMLButtonElement>('.dm-page-btn[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page ?? '', 10);
      if (!Number.isFinite(page) || page < 1) return;
      ctx.currentPage = page;
      updateTableView(ctx, onPrefillPosition);
    });
  });
}

function formatAssetAmount(amount: number, asset: string): string {
  return `${amount.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${asset}`;
}

async function loadAssetBalance(
  asset: string,
): Promise<{ available: number | null; label: string }> {
  try {
    const balances = await fetchAccountBalances(false);
    const match = balances.find((balance) => balance.asset === asset) ?? null;
    const available = match ? match.free : 0;
    const locked = match ? match.locked : 0;
    return {
      available,
      label:
        match !== null
          ? `Disponible: ${formatAssetAmount(available, asset)}${locked > 0 ? ` · Bloqueado: ${formatAssetAmount(locked, asset)}` : ''}`
          : `Disponible: 0 ${asset}`,
    };
  } catch {
    return {
      available: null,
      label: `No se pudo cargar tu saldo actual en ${asset}.`,
    };
  }
}
