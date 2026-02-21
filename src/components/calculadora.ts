import { loadCalcState, saveCalcState } from '../utils/storage';
import { formatUSD } from '../utils/calculator';
import { iconPlus, iconX, iconRefreshCw, iconTrash } from '../utils/icons';
import type { CalculadoraState, Purchase, PurchaseTotals, AchievedResults, StrategyResults, FeePreset } from '../types';

// ── Fee presets ──

const FEE_PRESETS: Record<FeePreset, { maker: number; label: string }> = {
  spot: { maker: 0.075, label: 'Spot' },
  futures: { maker: 0, label: 'Futuros' },
};

// ── Math helpers ──

function parseNum(value: string): number {
  const normalized = String(value).replace(/[\s,]+/g, '').replace(/[^\d.-]+/g, '').trim();
  return parseFloat(normalized);
}

function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return NaN;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function fmtNum(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '-';
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function computePurchaseTotals(purchases: Purchase[]): PurchaseTotals {
  let totalQty = 0;
  let totalUsd = 0;
  let validCount = 0;

  for (const p of purchases) {
    const qty = parseNum(p.qty);
    const priceRaw = parseNum(p.price);
    if (Number.isFinite(qty) && qty > 0 && Number.isFinite(priceRaw) && priceRaw > 0) {
      const price = roundTo(priceRaw, 2);
      totalQty += qty;
      totalUsd += roundTo(qty * price, 2);
      validCount++;
    }
  }

  totalUsd = roundTo(totalUsd, 2);
  const avgPrice = totalQty > 0 ? roundTo(totalUsd / totalQty, 2) : NaN;
  return { totalQty, totalUsd, avgPrice, validCount };
}

function computeFeeMultiplier(makerPct: number, sides = 2): number {
  const maker = Number.isFinite(makerPct) ? makerPct / 100 : 0;
  return Math.pow(1 - maker, sides);
}

function computeAchievedResults(
  sellPriceActual: number, trades: number, capital: number, basePrice: number, makerFeePct: number,
): AchievedResults {
  const achievedR = Number.isFinite(sellPriceActual) && Number.isFinite(basePrice) && basePrice > 0
    ? sellPriceActual / basePrice - 1 : NaN;
  const achievedMovement = Number.isFinite(achievedR) ? achievedR * 100 : NaN;
  const feeMultiplier = computeFeeMultiplier(makerFeePct, 2);
  const achievedProfitPerTrade = Number.isFinite(achievedR) && Number.isFinite(capital) && capital > 0
    ? capital * ((1 + achievedR) * feeMultiplier - 1) : NaN;
  const achievedAnnualProfit = Number.isFinite(achievedProfitPerTrade) && Number.isFinite(trades) && trades > 0
    ? achievedProfitPerTrade * trades : NaN;
  const achievedApr = Number.isFinite(achievedAnnualProfit) && Number.isFinite(capital) && capital > 0
    ? (achievedAnnualProfit / capital) * 100 : NaN;
  return { achievedR, achievedMovement, achievedProfitPerTrade, achievedAnnualProfit, achievedApr };
}

function computeStrategyResults(
  basePrice: number, capital: number, sellPct: number, rebuyPct: number, makerFeePct: number,
): StrategyResults {
  const sell = Number.isFinite(sellPct) ? sellPct / 100 : NaN;
  const rebuy = Number.isFinite(rebuyPct) ? rebuyPct / 100 : NaN;
  const feeTotalPct = Number.isFinite(makerFeePct) ? makerFeePct * 2 : NaN;
  const feeMultiplier = computeFeeMultiplier(makerFeePct, 2);

  const validBase = Number.isFinite(basePrice) && basePrice > 0;
  const sellPrice = validBase && Number.isFinite(sell) ? basePrice * (1 + sell) : NaN;
  const rebuyPrice = Number.isFinite(sellPrice) && Number.isFinite(rebuy) ? sellPrice * (1 - rebuy) : NaN;

  const netPct = Number.isFinite(sell) && Number.isFinite(feeMultiplier)
    ? ((1 + sell) * feeMultiplier - 1) * 100 : NaN;
  const netUsd = Number.isFinite(netPct) && Number.isFinite(capital) && capital > 0
    ? (capital * netPct) / 100 : NaN;

  const cycleMultiplier = Number.isFinite(rebuy) && rebuy < 1 && Number.isFinite(feeMultiplier)
    ? feeMultiplier / (1 - rebuy) : NaN;
  const netPctCycle = Number.isFinite(cycleMultiplier) ? (cycleMultiplier - 1) * 100 : NaN;
  const netUsdCycle = Number.isFinite(netPctCycle) && Number.isFinite(capital) && capital > 0
    ? (capital * netPctCycle) / 100 : NaN;

  return { sellPrice, rebuyPrice, netPct, netUsd, netPctCycle, netUsdCycle, feeTotalPct };
}

// ── State management ──

let state: CalculadoraState;
let purchaseIdCounter = 1;
let lastValidPrice = NaN;

function inferSellSyncSource(): 'price' | 'percent' | null {
  const sellPrice = parseNum(state.sellPrice);
  if (Number.isFinite(sellPrice)) return 'price';
  const sellPct = parseNum(state.sellPct);
  if (Number.isFinite(sellPct)) return 'percent';
  return null;
}

function loadAndInit(): void {
  state = loadCalcState();
  if (state.purchases.length > 0) {
    const maxId = state.purchases.reduce((max, purchase) => {
      return Number.isFinite(purchase.id) && purchase.id > max ? purchase.id : max;
    }, 0);
    purchaseIdCounter = maxId + 1;
  } else {
    purchaseIdCounter = 1;
  }

  if (!state.sellSyncSource) {
    state.sellSyncSource = inferSellSyncSource();
  }

  const parsedPrice = roundTo(parseNum(state.price), 2);
  lastValidPrice = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : NaN;
}

function save(): void {
  saveCalcState(state);
}

function getEffectiveFee(): { maker: number; label: string } {
  const preset = FEE_PRESETS[state.feePreset] || FEE_PRESETS.spot;
  if (state.feePreset === 'spot' && state.fdusdEnabled) {
    return { maker: 0, label: preset.label };
  }
  return preset;
}

// ── Render ──

export function renderCalculadora(container: HTMLElement): void {
  loadAndInit();

  container.innerHTML = `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">Calculadora Swing Trade</h2>
      </div>

      <!-- Config bar -->
      <div class="card">
        <div class="calc-config-bar">
          <div class="form-group" style="margin-bottom:0">
            <label for="calc-price">Precio activo</label>
            <div class="calc-input-wrap">
              <span class="calc-prefix">$</span>
              <input type="text" id="calc-price" class="calc-has-prefix" placeholder="600" inputmode="decimal" value="${state.price}">
            </div>
            <span class="auto-tag is-auto" id="calc-price-lock" style="display:none;margin-top:2px">AUTO</span>
          </div>

          <div class="form-group" style="margin-bottom:0">
            <label for="calc-capital">Capital</label>
            <div class="calc-input-wrap">
              <span class="calc-prefix">$</span>
              <input type="text" id="calc-capital" class="calc-has-prefix" inputmode="decimal" value="${state.capital}">
            </div>
          </div>

          <div class="form-group" style="margin-bottom:0">
            <label for="calc-trades">Trades/Ano</label>
            <input type="text" id="calc-trades" inputmode="decimal" value="${state.trades}">
          </div>

          <div class="form-group" style="margin-bottom:0">
            <label>Comision</label>
            <div class="calc-fee-row">
              <button type="button" class="preset-btn ${state.feePreset === 'spot' && !state.fdusdEnabled ? 'active' : ''}" id="calc-fee-spot">Spot</button>
              <button type="button" class="preset-btn ${state.feePreset === 'futures' ? 'active' : ''}" id="calc-fee-futures">Futuros</button>
              <button type="button" class="preset-btn ${state.feePreset === 'spot' && state.fdusdEnabled ? 'active' : ''}" id="calc-fee-fdusd" ${state.feePreset !== 'spot' ? 'disabled' : ''}>FDUSD</button>
            </div>
            <div class="text-muted" style="font-size:0.72rem;margin-top:2px">
              Fee: <span id="calc-fee-display" class="mono">${getEffectiveFee().maker.toFixed(3)}%</span>
              <span style="margin:0 4px">·</span>
              Total: <span id="calc-fee-total" class="mono">-</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Main layout -->
      <div class="grid-2">
        <!-- Left: Inputs -->
        <div>
          <!-- Execution -->
          <div class="card mb-md">
            <div class="card-title flex-between" style="margin-bottom:var(--space-md)">
              Ejecucion
              <button class="btn btn-sm" id="calc-reset-exec" title="Resetear valores">${iconRefreshCw(14)} Reset</button>
            </div>
            <div class="grid-3">
              <div class="form-group">
                <label for="calc-sell-price">Precio ejecutado</label>
                <div class="calc-input-wrap">
                  <span class="calc-prefix">$</span>
                  <input type="text" id="calc-sell-price" class="calc-has-prefix" placeholder="615" inputmode="decimal" value="${state.sellPrice}">
                </div>
              </div>
              <div class="form-group">
                <label for="calc-sell-pct">Venta obj. (%)</label>
                <input type="text" id="calc-sell-pct" inputmode="decimal" value="${state.sellPct}">
              </div>
              <div class="form-group">
                <label for="calc-rebuy-pct">Recompra obj. (%)</label>
                <input type="text" id="calc-rebuy-pct" inputmode="decimal" value="${state.rebuyPct}">
              </div>
            </div>
          </div>

          <!-- Purchases -->
          <div class="card">
            <div class="card-title flex-between" style="margin-bottom:var(--space-md)">
              Posiciones
              <div style="display:flex;gap:var(--space-xs)">
                <button class="btn btn-sm btn-danger" id="calc-clear-purchases" ${state.purchases.length === 0 ? 'disabled' : ''}>${iconTrash(14)} Borrar</button>
                <button class="btn btn-sm btn-primary" id="calc-add-purchase">${iconPlus(14)} Agregar</button>
              </div>
            </div>

            ${state.purchases.length > 0 ? `
              <div class="calc-purchase-header">
                <span>Cantidad</span>
                <span>Precio (USD)</span>
                <span>Total (USD)</span>
                <span></span>
              </div>
            ` : ''}

            <div id="calc-purchases-list"></div>

            <div class="text-muted" style="font-size:0.78rem;margin-top:var(--space-sm)" id="calc-purchase-summary">
              ${state.purchases.length === 0 ? 'Agrega compras para calcular precio promedio ponderado.' : ''}
            </div>
          </div>
        </div>

        <!-- Right: Metrics -->
        <div class="card">
          <div class="card-title" style="margin-bottom:var(--space-md)">Senal Actual</div>
          <div class="calc-metrics-grid">
            <div class="calc-metric-card calc-hero">
              <span class="calc-metric-label">APR real</span>
              <div class="calc-metric-value mono" id="calc-out-apr">-</div>
            </div>
            <div class="calc-metric-card calc-hero">
              <span class="calc-metric-label">Neto % ciclo</span>
              <div class="calc-metric-value mono" id="calc-out-net-cycle-pct">-</div>
            </div>
            <div class="calc-metric-card">
              <span class="calc-metric-label">Movimiento</span>
              <div class="calc-metric-value mono" id="calc-out-movement">-</div>
            </div>
            <div class="calc-metric-card">
              <span class="calc-metric-label">Ganancia/Trade</span>
              <div class="calc-metric-value mono" id="calc-out-profit-trade">-</div>
            </div>
            <div class="calc-metric-card">
              <span class="calc-metric-label">Precio venta</span>
              <div class="calc-metric-value mono" id="calc-out-sell-price">-</div>
            </div>
            <div class="calc-metric-card">
              <span class="calc-metric-label">Precio recompra</span>
              <div class="calc-metric-value mono" id="calc-out-rebuy-price">-</div>
            </div>
            <div class="calc-metric-card calc-wide calc-hero">
              <span class="calc-metric-label">Neto USD ciclo</span>
              <div class="calc-metric-value mono" id="calc-out-net-cycle-usd">-</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  renderPurchaseRows(container);
  bindEvents(container);
  recalculate(container);
}

// ── Purchase rows ──

function renderPurchaseRows(container: HTMLElement): void {
  const list = container.querySelector('#calc-purchases-list') as HTMLElement;
  if (!list) return;
  list.innerHTML = '';

  for (const purchase of state.purchases) {
    const qty = parseNum(purchase.qty);
    const price = roundTo(parseNum(purchase.price), 2);
    const total = Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0
      ? roundTo(qty * price, 2) : NaN;

    const row = document.createElement('div');
    row.className = 'calc-purchase-row';
    row.innerHTML = `
      <div class="form-group" style="margin-bottom:0">
        <input type="text" data-purchase-id="${purchase.id}" data-field="qty" placeholder="0.00" inputmode="decimal" value="${purchase.qty}">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <div class="calc-input-wrap">
          <span class="calc-prefix">$</span>
          <input type="text" data-purchase-id="${purchase.id}" data-field="price" class="calc-has-prefix" placeholder="0.00" inputmode="decimal" value="${purchase.price}">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <input type="text" readonly tabindex="-1" class="calc-locked" value="${Number.isFinite(total) ? fmtNum(total, 2) : '-'}">
      </div>
      <button type="button" class="btn btn-sm btn-danger calc-remove-btn" data-remove-id="${purchase.id}">${iconX(14)}</button>
    `;
    list.appendChild(row);
  }

  // Header visibility
  const header = container.querySelector('.calc-purchase-header') as HTMLElement | null;
  if (header) header.style.display = state.purchases.length > 0 ? '' : 'none';
}

// ── Events ──

function bindEvents(container: HTMLElement): void {
  const priceInput = container.querySelector('#calc-price') as HTMLInputElement;
  const capitalInput = container.querySelector('#calc-capital') as HTMLInputElement;
  const tradesInput = container.querySelector('#calc-trades') as HTMLInputElement;
  const sellPriceInput = container.querySelector('#calc-sell-price') as HTMLInputElement;
  const sellPctInput = container.querySelector('#calc-sell-pct') as HTMLInputElement;
  const rebuyPctInput = container.querySelector('#calc-rebuy-pct') as HTMLInputElement;

  // Input sync → state
  type StringStateKey = 'price' | 'capital' | 'trades' | 'rebuyPct';
  const inputMap: Array<[HTMLInputElement, StringStateKey]> = [
    [priceInput, 'price'],
    [capitalInput, 'capital'],
    [tradesInput, 'trades'],
    [rebuyPctInput, 'rebuyPct'],
  ];

  for (const [el, key] of inputMap) {
    el.addEventListener('input', () => {
      state[key] = el.value;
      recalculate(container);
      scheduleSave();
    });
  }

  // Sell price ↔ sell % bidirectional sync
  sellPriceInput.addEventListener('focus', () => {
    state.sellSyncSource = 'price';
    sellPriceInput.readOnly = false;
    sellPctInput.readOnly = true;
    sellPctInput.classList.add('calc-locked');
    sellPriceInput.classList.remove('calc-locked');
    recalculate(container);
  });

  sellPctInput.addEventListener('focus', () => {
    state.sellSyncSource = 'percent';
    sellPctInput.readOnly = false;
    sellPriceInput.readOnly = true;
    sellPriceInput.classList.add('calc-locked');
    sellPctInput.classList.remove('calc-locked');
    recalculate(container);
  });

  sellPriceInput.addEventListener('input', () => {
    state.sellPrice = sellPriceInput.value;
    state.sellSyncSource = 'price';
    recalculate(container);
    scheduleSave();
  });

  sellPctInput.addEventListener('input', () => {
    state.sellPct = sellPctInput.value;
    state.sellSyncSource = 'percent';
    recalculate(container);
    scheduleSave();
  });

  // Fee preset buttons
  container.querySelector('#calc-fee-spot')?.addEventListener('click', () => {
    state.feePreset = 'spot';
    state.fdusdEnabled = false;
    updateFeeUI(container);
    recalculate(container);
    save();
  });

  container.querySelector('#calc-fee-futures')?.addEventListener('click', () => {
    state.feePreset = 'futures';
    state.fdusdEnabled = false;
    updateFeeUI(container);
    recalculate(container);
    save();
  });

  container.querySelector('#calc-fee-fdusd')?.addEventListener('click', () => {
    if (state.feePreset !== 'spot') return;
    state.fdusdEnabled = !state.fdusdEnabled;
    updateFeeUI(container);
    recalculate(container);
    save();
  });

  // Reset execution
  container.querySelector('#calc-reset-exec')?.addEventListener('click', () => {
    state.sellPrice = '';
    state.sellPct = '0.98';
    state.rebuyPct = '0.85';
    state.sellSyncSource = 'percent';
    sellPriceInput.value = '';
    sellPctInput.value = '0.98';
    rebuyPctInput.value = '0.85';
    sellPriceInput.readOnly = true;
    sellPriceInput.classList.add('calc-locked');
    sellPctInput.readOnly = false;
    sellPctInput.classList.remove('calc-locked');
    recalculate(container);
    save();
  });

  // Add purchase
  container.querySelector('#calc-add-purchase')?.addEventListener('click', () => {
    state.purchases.push({ id: purchaseIdCounter++, qty: '', price: '' });
    renderPurchaseRows(container);
    bindPurchaseEvents(container);
    recalculate(container);
    save();
  });

  // Clear purchases
  container.querySelector('#calc-clear-purchases')?.addEventListener('click', () => {
    if (state.purchases.length === 0) return;
    if (confirm('Borrar todas las posiciones?')) {
      state.purchases = [];
      renderPurchaseRows(container);
      recalculate(container);
      save();
      const clearBtn = container.querySelector('#calc-clear-purchases') as HTMLButtonElement | null;
      if (clearBtn) clearBtn.disabled = true;
    }
  });

  bindPurchaseEvents(container);
}

function bindPurchaseEvents(container: HTMLElement): void {
  const list = container.querySelector('#calc-purchases-list') as HTMLElement;
  if (!list) return;

  // Remove existing listeners by cloning
  const inputs = list.querySelectorAll('input[data-purchase-id]');
  inputs.forEach(input => {
    const el = input as HTMLInputElement;
    el.addEventListener('input', () => {
      const id = parseInt(el.dataset.purchaseId || '0', 10);
      const field = el.dataset.field as 'qty' | 'price';
      const purchase = state.purchases.find(p => p.id === id);
      if (purchase && field) {
        purchase[field] = el.value;
        // Update total in same row
        const row = el.closest('.calc-purchase-row') as HTMLElement;
        if (row) {
          const totalInput = row.querySelector('.calc-locked') as HTMLInputElement;
          if (totalInput) {
            const qty = parseNum(purchase.qty);
            const price = roundTo(parseNum(purchase.price), 2);
            const total = Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0
              ? roundTo(qty * price, 2) : NaN;
            totalInput.value = Number.isFinite(total) ? fmtNum(total, 2) : '-';
          }
        }
        recalculate(container);
        scheduleSave();
      }
    });
  });

  // Remove buttons
  const removeBtns = list.querySelectorAll('[data-remove-id]');
  removeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt((btn as HTMLElement).dataset.removeId || '0', 10);
      state.purchases = state.purchases.filter(p => p.id !== id);
      renderPurchaseRows(container);
      bindPurchaseEvents(container);
      recalculate(container);
      save();
      const clearBtn = container.querySelector('#calc-clear-purchases') as HTMLButtonElement | null;
      if (clearBtn) clearBtn.disabled = state.purchases.length === 0;
    });
  });
}

// ── Fee UI update ──

function updateFeeUI(container: HTMLElement): void {
  const fee = getEffectiveFee();
  const spotBtn = container.querySelector('#calc-fee-spot') as HTMLElement;
  const futuresBtn = container.querySelector('#calc-fee-futures') as HTMLElement;
  const fdusdBtn = container.querySelector('#calc-fee-fdusd') as HTMLButtonElement;
  const feeDisplay = container.querySelector('#calc-fee-display') as HTMLElement;

  spotBtn?.classList.toggle('active', state.feePreset === 'spot' && !state.fdusdEnabled);
  futuresBtn?.classList.toggle('active', state.feePreset === 'futures');
  fdusdBtn?.classList.toggle('active', state.feePreset === 'spot' && state.fdusdEnabled);
  if (fdusdBtn) fdusdBtn.disabled = state.feePreset !== 'spot';
  if (feeDisplay) feeDisplay.textContent = `${fee.maker.toFixed(3)}%`;
}

// ── Recalculation ──

function recalculate(container: HTMLElement): void {
  const fee = getEffectiveFee();
  const makerPct = fee.maker;
  const trades = parseNum(state.trades);

  // Purchase totals → auto-lock capital & price
  const totals = computePurchaseTotals(state.purchases);
  updatePurchaseSummary(container, totals);

  const priceInput = container.querySelector('#calc-price') as HTMLInputElement;
  const capitalInput = container.querySelector('#calc-capital') as HTMLInputElement;
  const priceLock = container.querySelector('#calc-price-lock') as HTMLElement;

  let capital: number;
  if (Number.isFinite(totals.totalUsd) && totals.totalUsd > 0) {
    capitalInput.value = totals.totalUsd.toFixed(2);
    capitalInput.readOnly = true;
    capitalInput.classList.add('calc-locked');
    capital = totals.totalUsd;
  } else {
    capitalInput.readOnly = false;
    capitalInput.classList.remove('calc-locked');
    capital = roundTo(parseNum(capitalInput.value), 2);
  }

  let basePrice: number;
  if (Number.isFinite(totals.avgPrice) && totals.validCount > 0) {
    priceInput.value = totals.avgPrice.toFixed(2);
    priceInput.readOnly = true;
    priceInput.classList.add('calc-locked');
    if (priceLock) priceLock.style.display = 'inline-flex';
    basePrice = totals.avgPrice;
  } else {
    priceInput.readOnly = false;
    priceInput.classList.remove('calc-locked');
    if (priceLock) priceLock.style.display = 'none';
    basePrice = roundTo(parseNum(priceInput.value), 2);
  }

  if (Number.isFinite(basePrice) && basePrice > 0) {
    lastValidPrice = basePrice;
  } else if (Number.isFinite(lastValidPrice) && lastValidPrice > 0) {
    basePrice = lastValidPrice;
  }

  // Sell sync
  syncSellInputs(container, basePrice);

  // Resolve actual sell price for achieved calc
  const sellPriceInput = container.querySelector('#calc-sell-price') as HTMLInputElement;
  let sellPriceActual = roundTo(parseNum(sellPriceInput.value), 2);
  const currentSellPct = parseNum(state.sellPct);
  if (state.sellSyncSource === 'percent' && Number.isFinite(currentSellPct) && Number.isFinite(basePrice) && basePrice > 0) {
    const synced = roundTo(basePrice * (1 + currentSellPct / 100), 2);
    if (Number.isFinite(synced)) sellPriceActual = synced;
  }

  // Achieved results
  const achieved = computeAchievedResults(sellPriceActual, trades, capital, basePrice, makerPct);
  renderAchieved(container, achieved);

  // Strategy results
  const optSellPct = parseNum(state.sellPct);
  const optRebuyPct = parseNum(state.rebuyPct);
  const strategy = computeStrategyResults(basePrice, capital, optSellPct, optRebuyPct, makerPct);
  renderStrategy(container, strategy);

  // Fee total display
  const feeMultiplier = computeFeeMultiplier(makerPct, 2);
  let feeUsd: number;
  if (Number.isFinite(capital) && capital > 0 && Number.isFinite(achieved.achievedR) && Number.isFinite(feeMultiplier)) {
    feeUsd = capital * (1 + achieved.achievedR) * (1 - feeMultiplier);
  } else {
    feeUsd = Number.isFinite(capital) ? capital * (makerPct * 2 / 100) : NaN;
  }
  const feeTotalEl = container.querySelector('#calc-fee-total') as HTMLElement;
  if (feeTotalEl) {
    feeTotalEl.textContent = Number.isFinite(feeUsd) ? formatUSD(feeUsd) : '-';
  }
}

// ── Sell sync ──

function syncSellInputs(container: HTMLElement, basePrice: number): void {
  const sellPriceInput = container.querySelector('#calc-sell-price') as HTMLInputElement;
  const sellPctInput = container.querySelector('#calc-sell-pct') as HTMLInputElement;
  if (!sellPriceInput || !sellPctInput) return;

  const baseValid = Number.isFinite(basePrice) && basePrice > 0;

  if (state.sellSyncSource === 'price') {
    const priceValue = roundTo(parseNum(sellPriceInput.value), 2);
    if (Number.isFinite(priceValue) && baseValid) {
      const pct = (priceValue / basePrice - 1) * 100;
      if (Number.isFinite(pct)) sellPctInput.value = pct.toFixed(4);
    }
    sellPctInput.readOnly = true;
    sellPctInput.classList.add('calc-locked');
    sellPriceInput.readOnly = false;
    sellPriceInput.classList.remove('calc-locked');
  } else if (state.sellSyncSource === 'percent') {
    const pctValue = parseNum(sellPctInput.value);
    if (Number.isFinite(pctValue) && baseValid) {
      const price = roundTo(basePrice * (1 + pctValue / 100), 2);
      if (Number.isFinite(price)) sellPriceInput.value = price.toFixed(2);
    }
    sellPriceInput.readOnly = true;
    sellPriceInput.classList.add('calc-locked');
    sellPctInput.readOnly = false;
    sellPctInput.classList.remove('calc-locked');
  } else {
    sellPriceInput.readOnly = false;
    sellPriceInput.classList.remove('calc-locked');
    sellPctInput.readOnly = false;
    sellPctInput.classList.remove('calc-locked');
  }
}

// ── Render metrics ──

function setTone(el: HTMLElement, value: number): void {
  el.classList.remove('text-gain', 'text-loss', 'text-muted');
  if (!Number.isFinite(value) || value === 0) {
    el.classList.add('text-muted');
  } else {
    el.classList.add(value > 0 ? 'text-gain' : 'text-loss');
  }
}

function renderAchieved(container: HTMLElement, achieved: AchievedResults): void {
  const aprEl = container.querySelector('#calc-out-apr') as HTMLElement;
  const moveEl = container.querySelector('#calc-out-movement') as HTMLElement;
  const profitEl = container.querySelector('#calc-out-profit-trade') as HTMLElement;

  if (aprEl) {
    aprEl.textContent = Number.isFinite(achieved.achievedApr) ? `${fmtNum(achieved.achievedApr, 2)} %` : '-';
    setTone(aprEl, achieved.achievedApr);
  }
  if (moveEl) {
    moveEl.textContent = Number.isFinite(achieved.achievedMovement) ? `${fmtNum(achieved.achievedMovement, 3)} %` : '-';
    setTone(moveEl, achieved.achievedMovement);
  }
  if (profitEl) {
    profitEl.textContent = Number.isFinite(achieved.achievedProfitPerTrade) ? `$ ${fmtNum(achieved.achievedProfitPerTrade, 2)}` : '-';
    setTone(profitEl, achieved.achievedProfitPerTrade);
  }
}

function renderStrategy(container: HTMLElement, strategy: StrategyResults): void {
  const sellEl = container.querySelector('#calc-out-sell-price') as HTMLElement;
  const rebuyEl = container.querySelector('#calc-out-rebuy-price') as HTMLElement;
  const cyclePctEl = container.querySelector('#calc-out-net-cycle-pct') as HTMLElement;
  const cycleUsdEl = container.querySelector('#calc-out-net-cycle-usd') as HTMLElement;

  if (sellEl) {
    sellEl.textContent = Number.isFinite(strategy.sellPrice) ? `$ ${fmtNum(strategy.sellPrice, 2)}` : '-';
    setTone(sellEl, strategy.sellPrice);
  }
  if (rebuyEl) {
    rebuyEl.textContent = Number.isFinite(strategy.rebuyPrice) ? `$ ${fmtNum(strategy.rebuyPrice, 2)}` : '-';
    setTone(rebuyEl, strategy.rebuyPrice);
  }
  if (cyclePctEl) {
    cyclePctEl.textContent = Number.isFinite(strategy.netPctCycle) ? `${fmtNum(strategy.netPctCycle, 4)} %` : '-';
    setTone(cyclePctEl, strategy.netPctCycle);
  }
  if (cycleUsdEl) {
    cycleUsdEl.textContent = Number.isFinite(strategy.netUsdCycle) ? `$ ${fmtNum(strategy.netUsdCycle, 2)}` : '-';
    setTone(cycleUsdEl, strategy.netUsdCycle);
  }
}

function updatePurchaseSummary(container: HTMLElement, totals: PurchaseTotals): void {
  const el = container.querySelector('#calc-purchase-summary') as HTMLElement;
  if (!el) return;

  if (state.purchases.length === 0) {
    el.textContent = 'Agrega compras para calcular precio promedio ponderado.';
    return;
  }
  if (!totals.validCount) {
    el.textContent = 'Completa cantidad y precio para cada compra.';
    return;
  }
  el.textContent = `Total ${fmtNum(totals.totalQty, 6)} | Costo $ ${fmtNum(totals.totalUsd, 2)} | Promedio $ ${fmtNum(totals.avgPrice, 4)}`;
}

// ── Debounced save ──

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { save(); saveTimer = null; }, 200);
}
