import { loadState, addPosition, updatePosition, deletePosition, generateId, replacePositions } from '../utils/storage';
import { formatUSD } from '../utils/calculator';
import { formatISODateLocal, parseISODateLocal } from '../utils/date';
import { calculatePositionMetrics } from '../utils/market';
import { registerApiFailure, registerApiLastUpdatedAt } from '../utils/api-status';
import { showApiErrorBanner } from '../utils/notifications';
import { normalizeTime } from '../utils/dual-yield';
import { iconPlus, iconPencil, iconUpload } from '../utils/icons';
import { parseBinancePositions as parseBinancePositionsFromText, DEFAULT_ASSET_POOL } from './positions.parser';
import { formatTimeHHMM, renderPositionGroup, updateRemainingTimesInPlace } from './positions.table';
import type { DualPosition, Direction } from '../types';
import { ONE_SECOND_MS, MARKET_POLL_INTERVAL_MS } from '../utils/constants';
import { skeletonSpan } from '../utils/ui-helpers';

// ── Duration presets in days ──

const DURATION_PRESETS = [
  { label: '1D', days: 1 },
  { label: '2D', days: 2 },
  { label: '3D', days: 3 },
  { label: '5D', days: 5 },
  { label: '1S', days: 7 },
  { label: '2S', days: 14 },
  { label: '1M', days: 30 },
];

const ASSET_POOL: string[] = [...DEFAULT_ASSET_POOL];
const SUBSCRIPTION_ASSETS = [...ASSET_POOL];
const ALLOWED_ASSETS = new Set<string>(ASSET_POOL);

export function renderPositions(container: HTMLElement, onStateChange: () => void): () => void {
  const state = loadState();
  const { positions } = state;
  const activeCount = positions.length;

  // Separate by direction
  const buyLow = positions.filter(p => p.direction === 'buy-low');
  const sellHigh = positions.filter(p => p.direction === 'sell-high');

  container.innerHTML = `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">Dual Investment</h2>
        <div class="section-actions">
          <button class="btn btn-sm" id="btn-toggle-edit">${iconPencil(13)}Editar</button>
          <button class="btn btn-sm" id="btn-bulk-import">${iconUpload(13)}Pegar y reemplazar</button>
          <button class="btn btn-primary btn-sm" id="btn-add-position">${iconPlus(14)}Nueva posicion</button>
        </div>
      </div>

      <!-- Summary cards -->
      <div class="grid-4">
        <div class="stat-card" data-shared-card="apr">
          <div class="card-title">APR promedio</div>
          <div class="stat-value lg" id="positions-apr">
            ${skeletonSpan('70px')}
          </div>
        </div>
        <div class="stat-card" data-shared-card="capital">
          <div class="card-title">En posiciones</div>
          <div class="stat-value lg" id="positions-capital">
            ${skeletonSpan('90px')}
          </div>
        </div>
        <div class="stat-card" data-shared-card="daily">
          <div class="card-title">Run-rate diario est.</div>
          <div class="stat-value lg" id="positions-daily">
            ${skeletonSpan('70px')}
          </div>
        </div>
        <div class="stat-card" data-shared-card="positions">
          <div class="card-title">Posiciones activas</div>
          <div class="stat-value lg">${activeCount}</div>
        </div>
      </div>

      <!-- Positions table -->
      ${positions.length > 0 ? `
        ${buyLow.length > 0 ? renderPositionGroup('Buy Low', buyLow) : ''}
        ${sellHigh.length > 0 ? renderPositionGroup('Sell High', sellHigh) : ''}
      ` : `
        <div class="card empty-state">
          <p>No tienes posiciones registradas.</p>
          <p>Agrega tus posiciones activas de Dual Investment.</p>
        </div>
      `}
    </div>

    <!-- Add/Edit modal -->
    <div id="modal-position" class="modal-overlay" style="display:none">
      <div class="modal">
        <h3 class="modal-title" id="modal-position-title">Nueva posicion</h3>
        <input type="hidden" id="input-position-id" value="">

        <!-- Direction toggle -->
        <div class="form-group">
          <label>Direccion</label>
          <div class="direction-toggle">
            <button class="dir-btn active" data-dir="buy-low" id="dir-buy-low">Buy Low</button>
            <button class="dir-btn" data-dir="sell-high" id="dir-sell-high">Sell High</button>
          </div>
          <input type="hidden" id="input-direction" value="buy-low">
        </div>

        <!-- Asset -->
        <div class="grid-2">
          <div class="form-group">
            <label>Activo</label>
            <select id="input-asset">
              ${ASSET_POOL.map(a => `<option value="${a}" ${a === 'ETH' ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Moneda de suscripcion</label>
            <select id="input-sub-asset">
              ${SUBSCRIPTION_ASSETS.map(a => `<option value="${a}" ${a === 'USDT' ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Amount and APR -->
        <div class="grid-2">
          <div class="form-group">
            <label>Monto suscrito</label>
            <input type="number" id="input-amount" step="1" placeholder="0.00">
          </div>
          <div class="form-group">
            <label>APR (%)</label>
            <input type="number" id="input-apr" step="1" placeholder="0.00">
          </div>
        </div>

        <!-- Target price -->
        <div class="form-group">
          <label>Precio objetivo</label>
          <input type="number" id="input-target" step="1" placeholder="0.00">
        </div>

        <!-- Dates with presets -->
        <div class="form-group">
          <label>Fecha de suscripcion</label>
          <div class="grid-2 position-datetime-inputs">
            <input type="date" id="input-entry-date">
            <input type="time" id="input-entry-time" step="60" placeholder="HH:MM">
          </div>
        </div>

        <div class="form-group">
          <label>Fecha de liquidacion</label>
          <div class="duration-presets">
            ${DURATION_PRESETS.map(p => `<button class="preset-btn" data-days="${p.days}">${p.label}</button>`).join('')}
          </div>
          <div class="grid-2 position-datetime-inputs" style="margin-top:var(--space-xs)">
            <input type="date" id="input-settlement-date">
            <input type="time" id="input-settlement-time" step="60" placeholder="HH:MM">
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn" id="btn-cancel-position">Cancelar</button>
          <button class="btn btn-primary" id="btn-save-position">Guardar</button>
        </div>
      </div>
    </div>

    <div id="modal-bulk-import" class="modal-overlay" style="display:none">
      <div class="modal">
        <h3 class="modal-title">Pegar posiciones de Binance</h3>
        <div class="form-group">
          <label>Pega el bloque completo copiado desde Binance</label>
          <textarea id="input-bulk-import" rows="14" placeholder="USDC-ETH&#10;Buy-low&#10;2026-02-19 14:29&#10;100 USDC&#10;..."></textarea>
          <div class="text-muted" style="font-size:0.72rem;margin-top:6px">
            Reemplazara todas las posiciones actuales.
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="btn-cancel-bulk-import">Cancelar</button>
          <button class="btn btn-primary" id="btn-apply-bulk-import">Reemplazar</button>
        </div>
      </div>
    </div>
  `;

  bindPositionEvents(container, onStateChange);

  let disposed = false;
  let isHydrating = false;
  let latestKnownPositions = positions;
  let remainingTicker: ReturnType<typeof setInterval> | null = null;

  const syncRemainingTicker = (hasSubMinuteCountdown: boolean): void => {
    if (hasSubMinuteCountdown) {
      if (remainingTicker) return;
      remainingTicker = setInterval(() => {
        if (disposed || !container.isConnected) return;
        const stillHasSubMinute = updateRemainingTimesInPlace(container, latestKnownPositions);
        if (!stillHasSubMinute && remainingTicker) {
          clearInterval(remainingTicker);
          remainingTicker = null;
        }
      }, ONE_SECOND_MS);
      return;
    }

    if (!remainingTicker) return;
    clearInterval(remainingTicker);
    remainingTicker = null;
  };

  const hydrateMarketData = async (forceRefresh = false): Promise<void> => {
    if (disposed || isHydrating || !container.isConnected) return;
    isHydrating = true;
    try {
      const { positions: latestPositions } = loadState();
      latestKnownPositions = latestPositions;
      const hasSubMinuteCountdown = await hydratePositionMarketData(container, latestPositions, forceRefresh);
      syncRemainingTicker(hasSubMinuteCountdown);
    } finally {
      isHydrating = false;
    }
  };

  void hydrateMarketData();
  const pollTimer = setInterval(() => {
    void hydrateMarketData(true);
  }, MARKET_POLL_INTERVAL_MS);

  return () => {
    disposed = true;
    clearInterval(pollTimer);
    if (remainingTicker) clearInterval(remainingTicker);
  };
}

async function hydratePositionMarketData(
  container: HTMLElement,
  positions: DualPosition[],
  forceRefresh = false,
): Promise<boolean> {
  const aprEl = container.querySelector('#positions-apr') as HTMLElement | null;
  const capitalEl = container.querySelector('#positions-capital') as HTMLElement | null;
  const dailyEl = container.querySelector('#positions-daily') as HTMLElement | null;
  if (!aprEl || !capitalEl || !dailyEl) return false;

  if (positions.length === 0) {
    aprEl.textContent = '---';
    capitalEl.textContent = '---';
    dailyEl.textContent = '---';
    return false;
  }

  const hasSubMinuteCountdown = updateRemainingTimesInPlace(container, positions);

  try {
    const metrics = await calculatePositionMetrics(positions, { forceRefresh });
    registerApiLastUpdatedAt(metrics.marketLastUpdatedAt);

    aprEl.classList.add('fade-in');
    capitalEl.classList.add('fade-in');
    dailyEl.classList.add('fade-in');

    aprEl.textContent = metrics.weightedApr > 0 ? `${metrics.weightedApr.toFixed(2)}%` : '---';
    aprEl.style.color = metrics.weightedApr > 0 ? 'var(--text-primary)' : 'var(--text-muted)';

    capitalEl.textContent = metrics.totalUsd > 0 ? formatUSD(metrics.totalUsd) : '---';

    dailyEl.textContent = metrics.dailyEarningsUsd > 0 ? formatUSD(metrics.dailyEarningsUsd) : '---';
    dailyEl.style.color = metrics.dailyEarningsUsd > 0 ? 'var(--color-gain)' : 'var(--text-muted)';
    if (metrics.hasStalePrices || metrics.hasUnavailablePrices) {
      registerApiFailure();
      showApiErrorBanner('No se pudo actualizar precios de mercado.');
    }

    positions.forEach((position) => {
      const rowEl = container.querySelector(`#position-usd-${position.id}`) as HTMLElement | null;
      if (!rowEl) return;
      const usdValue = metrics.usdByPositionId[position.id] ?? 0;
      rowEl.classList.add('fade-in');
      rowEl.textContent = usdValue > 0 ? formatUSD(usdValue) : 'N/D';
    });
  } catch {
    registerApiFailure();
    showApiErrorBanner('No se pudo actualizar precios de mercado.');
  }

  return hasSubMinuteCountdown;
}

/** Today at local midnight. */
function todayLocal(base: Date = new Date()): Date {
  const n = base;
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function parseBinancePositions(raw: string): DualPosition[] {
  return parseBinancePositionsFromText(raw, ALLOWED_ASSETS);
}

function bindPositionEvents(container: HTMLElement, onStateChange: () => void): void {
  const modal = container.querySelector('#modal-position') as HTMLElement;
  const bulkImportModal = container.querySelector('#modal-bulk-import') as HTMLElement;
  const bulkImportInput = container.querySelector('#input-bulk-import') as HTMLTextAreaElement;

  // ── Direction toggle ──
  const dirBtns = container.querySelectorAll('.dir-btn');
  const dirInput = container.querySelector('#input-direction') as HTMLInputElement;
  dirBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      dirBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      dirInput.value = (btn as HTMLElement).dataset.dir!;
    });
  });

  const assetInput = container.querySelector('#input-asset') as HTMLSelectElement;

  // ── Duration presets ──
  const entryInput = container.querySelector('#input-entry-date') as HTMLInputElement;
  const entryTimeInput = container.querySelector('#input-entry-time') as HTMLInputElement;
  const settlementInput = container.querySelector('#input-settlement-date') as HTMLInputElement;
  const settlementTimeInput = container.querySelector('#input-settlement-time') as HTMLInputElement;

  container.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt((btn as HTMLElement).dataset.days!, 10);
      const entryDate = parseISODateLocal(entryInput.value) ?? todayLocal();
      const settlement = new Date(entryDate);
      settlement.setDate(settlement.getDate() + days);
      settlementInput.value = formatISODateLocal(settlement);

      container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  entryInput.addEventListener('change', () => {
    container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  });

  // ── Edit-mode toggle ──
  const sectionEl = container.querySelector('.section') as HTMLElement;
  const toggleBtn = container.querySelector('#btn-toggle-edit') as HTMLElement;
  toggleBtn.addEventListener('click', () => {
    const active = sectionEl.classList.toggle('editing-mode');
    toggleBtn.innerHTML = active ? `${iconPencil(13)}Listo` : `${iconPencil(13)}Editar`;
  });

  // ── Helper: open edit modal for a position ──
  const openEditModal = (id: string): void => {
    const state = loadState();
    const pos = state.positions.find(p => p.id === id);
    if (!pos) return;

    (container.querySelector('#modal-position-title') as HTMLElement).textContent = 'Editar posicion';
    (container.querySelector('#input-position-id') as HTMLInputElement).value = pos.id;

    dirInput.value = pos.direction;
    dirBtns.forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.dir === pos.direction);
    });

    assetInput.value = pos.asset;
    (container.querySelector('#input-sub-asset') as HTMLSelectElement).value = pos.subscriptionAsset;
    (container.querySelector('#input-amount') as HTMLInputElement).value = pos.amount.toString();
    (container.querySelector('#input-apr') as HTMLInputElement).value = pos.apr.toString();
    (container.querySelector('#input-target') as HTMLInputElement).value = pos.targetPrice.toString();
    entryInput.value = pos.entryDate;
    entryTimeInput.value = pos.entryTime ?? '';
    settlementInput.value = pos.settlementDate;
    settlementTimeInput.value = pos.settlementTime ?? '';

    modal.style.display = 'flex';
  };

  // ── Open add modal ──
  container.querySelector('#btn-add-position')?.addEventListener('click', () => {
    clearPositionForm(container);
    (container.querySelector('#modal-position-title') as HTMLElement).textContent = 'Nueva posicion';
    const today = formatISODateLocal(todayLocal());
    entryInput.value = today;
    entryTimeInput.value = formatTimeHHMM(new Date());
    settlementTimeInput.value = '03:00';
    modal.style.display = 'flex';
  });

  container.querySelector('#btn-bulk-import')?.addEventListener('click', () => {
    bulkImportInput.value = '';
    bulkImportModal.style.display = 'flex';
    bulkImportInput.focus();
  });

  // ── Row click in edit-mode ──
  container.querySelectorAll<HTMLElement>('tr[data-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.btn-del-pos')) return;
      if (!sectionEl.classList.contains('editing-mode')) return;
      const id = row.dataset.id!;
      openEditModal(id);
    });
  });

  // ── Delete buttons ──
  container.querySelectorAll('.btn-del-pos').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id!;
      if (confirm('Eliminar esta posicion?')) {
        deletePosition(id);
        onStateChange();
      }
    });
  });

  // ── Cancel ──
  container.querySelector('#btn-cancel-position')?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  container.querySelector('#btn-cancel-bulk-import')?.addEventListener('click', () => {
    bulkImportModal.style.display = 'none';
  });

  bulkImportModal.addEventListener('click', (e) => {
    if (e.target === bulkImportModal) bulkImportModal.style.display = 'none';
  });

  container.querySelector('#btn-apply-bulk-import')?.addEventListener('click', () => {
    const parsed = parseBinancePositions(bulkImportInput.value);
    if (parsed.length === 0) {
      alert('No se detectaron posiciones validas en el texto pegado.');
      return;
    }
    if (!confirm(`Reemplazar todas las posiciones actuales por ${parsed.length} importadas?`)) {
      return;
    }

    replacePositions(parsed);
    bulkImportModal.style.display = 'none';
    onStateChange();
  });

  // ── Save ──
  container.querySelector('#btn-save-position')?.addEventListener('click', () => {
    const id = (container.querySelector('#input-position-id') as HTMLInputElement).value;
    const direction = dirInput.value as Direction;
    const asset = assetInput.value.toUpperCase().trim();
    const subscriptionAsset = (container.querySelector('#input-sub-asset') as HTMLSelectElement).value;
    const amount = parseFloat((container.querySelector('#input-amount') as HTMLInputElement).value);
    const apr = parseFloat((container.querySelector('#input-apr') as HTMLInputElement).value);
    const targetPrice = parseFloat((container.querySelector('#input-target') as HTMLInputElement).value) || 0;
    const entryDate = entryInput.value;
    const entryTime = normalizeTime(entryTimeInput.value);
    const settlementDate = settlementInput.value;
    const settlementTime = normalizeTime(settlementTimeInput.value);

    if (!asset || !Number.isFinite(amount) || !Number.isFinite(apr) || !entryDate || !settlementDate) {
      alert('Completa todos los campos requeridos.');
      return;
    }
    if (!ALLOWED_ASSETS.has(asset)) {
      alert('Activo invalido. Solo BTC, ETH, BNB, SOL, USDT y USDC.');
      return;
    }

    const data: DualPosition = {
      id: id || generateId(),
      asset,
      direction,
      subscriptionAsset,
      amount,
      targetPrice,
      entryDate,
      entryTime,
      settlementDate,
      settlementTime,
      apr,
    };

    if (id) {
      updatePosition(id, data);
    } else {
      addPosition(data);
    }

    modal.style.display = 'none';
    onStateChange();
  });
}

function clearPositionForm(container: HTMLElement): void {
  (container.querySelector('#input-position-id') as HTMLInputElement).value = '';
  (container.querySelector('#input-direction') as HTMLInputElement).value = 'buy-low';
  container.querySelectorAll('.dir-btn').forEach(b => {
    b.classList.toggle('active', (b as HTMLElement).dataset.dir === 'buy-low');
  });
  (container.querySelector('#input-asset') as HTMLSelectElement).value = 'ETH';
  (container.querySelector('#input-sub-asset') as HTMLSelectElement).value = 'USDT';
  (container.querySelector('#input-amount') as HTMLInputElement).value = '';
  (container.querySelector('#input-apr') as HTMLInputElement).value = '';
  (container.querySelector('#input-target') as HTMLInputElement).value = '';
  (container.querySelector('#input-entry-date') as HTMLInputElement).value = '';
  (container.querySelector('#input-entry-time') as HTMLInputElement).value = '';
  (container.querySelector('#input-settlement-date') as HTMLInputElement).value = '';
  (container.querySelector('#input-settlement-time') as HTMLInputElement).value = '';
  container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
}
