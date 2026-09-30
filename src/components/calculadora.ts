import {
  DEFAULT_CALC_REBUY,
  DEFAULT_CALC_SELL,
  loadCalcState,
  saveCalcState,
} from '../utils/storage';
import { formatUSD } from '../utils/calculator';
import type { CalculadoraState, CycleResults, PriceUnit, PurchaseTotals } from '../types';
import {
  computeCycle,
  computePurchaseTotals,
  parseNum,
  resolveRebuyPrice,
  resolveSellPrice,
  roundTo,
} from './calculadora.math';
import { setAnimatedNumber, setAnimatedText, stopValueAnimation } from '../utils/animation';
import { showConfirmDialog } from '../utils/dialogs';
import {
  CALC_INPUT_DEBOUNCE_MS,
  CALC_REBUY_HINT_PCT,
  CALC_RESULT_ANIM_MS,
  CALC_SELL_HINT_PCT,
  CALCULADORA_COPY,
  FDUSD_MAKER_FEE_PCT,
  SPOT_MAKER_FEE_PCT,
} from './calculadora.constants';
import { renderCalculadoraTemplate, renderPurchaseRow } from './calculadora.template';

/**
 * Decimales que necesita un precio para no perder informacion util: dos bastan
 * para ETH, pero un activo de $0.004 se veria como 0.00. Los importes en USD no
 * usan esto; ahi el centavo es la unidad real.
 */
function priceDecimals(value: number): number {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs) || abs === 0) return 2;
  if (abs < 1) return 6;
  if (abs < 100) return 4;
  return 2;
}

function fmtPrice(value: number): string {
  return fmtNum(value, priceDecimals(value));
}

function fmtNum(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '-';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── State management ──

let state: CalculadoraState;
let purchaseIdCounter = 1;
let recalcTimer: ReturnType<typeof setTimeout> | null = null;
const calcValueAnimationByElement = new WeakMap<HTMLElement, number>();
const calcTextAnimationByElement = new WeakMap<HTMLElement, number>();

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
}

function save(): void {
  saveCalcState(state);
}

function getEffectiveMakerFee(): number {
  return state.fdusdEnabled ? FDUSD_MAKER_FEE_PCT : SPOT_MAKER_FEE_PCT;
}

// ── Render ──

export function renderCalculadora(container: HTMLElement): () => void {
  const eventController = new AbortController();
  cancelScheduledRecalculate();
  loadAndInit();

  container.innerHTML = renderCalculadoraTemplate(state, getEffectiveMakerFee());

  renderPurchaseRows(container);
  bindEvents(container, eventController.signal);
  cancelScheduledRecalculate();
  recalculate(container, { animate: false });

  return () => {
    eventController.abort();
    cancelScheduledRecalculate();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };
}

// ── Purchase rows ──

function renderPurchaseRows(container: HTMLElement): void {
  const list = container.querySelector('#calc-purchases-list') as HTMLElement;
  if (!list) return;
  list.innerHTML = '';

  for (const purchase of state.purchases) {
    const qty = parseNum(purchase.qty);
    const price = roundTo(parseNum(purchase.price), 2);
    const total =
      Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0
        ? roundTo(qty * price, 2)
        : NaN;

    const row = document.createElement('tr');
    row.className = 'calc-purchase-row';
    row.innerHTML = renderPurchaseRow(
      purchase.id,
      purchase.qty,
      purchase.price,
      Number.isFinite(total) ? fmtNum(total, 2) : '-',
    );
    list.appendChild(row);
  }

  // Header visibility
  const header = container.querySelector('.calc-purchase-header') as HTMLElement | null;
  if (header) header.style.display = state.purchases.length > 0 ? '' : 'none';
}

// ── Events ──

function bindEvents(container: HTMLElement, signal: AbortSignal): void {
  const priceInput = container.querySelector('#calc-price') as HTMLInputElement;
  const capitalInput = container.querySelector('#calc-capital') as HTMLInputElement;
  const tradesInput = container.querySelector('#calc-trades') as HTMLInputElement;
  const sellInput = container.querySelector('#calc-sell') as HTMLInputElement;
  const rebuyInput = container.querySelector('#calc-rebuy') as HTMLInputElement;

  // Input sync -> state
  type StringStateKey = 'price' | 'capital' | 'trades' | 'sell' | 'rebuy';
  const inputMap: Array<[HTMLInputElement, StringStateKey]> = [
    [priceInput, 'price'],
    [capitalInput, 'capital'],
    [tradesInput, 'trades'],
    [sellInput, 'sell'],
    [rebuyInput, 'rebuy'],
  ];

  for (const [el, key] of inputMap) {
    el.addEventListener(
      'input',
      () => {
        state[key] = el.value;
        scheduleRecalculate(container);
        scheduleSave();
      },
      { signal },
    );
  }

  // Selectores de unidad: $ o % para cada precio del ciclo
  for (const key of ['sell', 'rebuy'] as const) {
    for (const unit of ['usd', 'pct'] as const) {
      container.querySelector(`#calc-${key}-unit-${unit}`)?.addEventListener(
        'click',
        () => {
          changeUnit(container, key, unit);
        },
        { signal },
      );
    }
  }

  // Fee preset buttons
  const setFdusd = (enabled: boolean) => {
    state.fdusdEnabled = enabled;
    updateFeeUI(container);
    cancelScheduledRecalculate();
    recalculate(container, { animate: true });
    save();
  };

  container.querySelector('#calc-fee-spot')?.addEventListener('click', () => setFdusd(false), {
    signal,
  });

  container.querySelector('#calc-fee-fdusd')?.addEventListener('click', () => setFdusd(true), {
    signal,
  });

  // Reset execution
  container.querySelector('#calc-reset-exec')?.addEventListener(
    'click',
    () => {
      state.sell = DEFAULT_CALC_SELL;
      state.sellUnit = 'pct';
      state.rebuy = DEFAULT_CALC_REBUY;
      state.rebuyUnit = 'pct';
      sellInput.value = DEFAULT_CALC_SELL;
      rebuyInput.value = DEFAULT_CALC_REBUY;
      applyUnitUI(container, 'sell', 'pct');
      applyUnitUI(container, 'rebuy', 'pct');
      cancelScheduledRecalculate();
      recalculate(container, { animate: true });
      save();
    },
    { signal },
  );

  // Add purchase
  container.querySelector('#calc-add-purchase')?.addEventListener(
    'click',
    () => {
      state.purchases.push({ id: purchaseIdCounter++, qty: '', price: '' });
      renderPurchaseRows(container);
      cancelScheduledRecalculate();
      recalculate(container, { animate: true });
      save();
      const clearBtn = container.querySelector('#calc-clear-purchases') as HTMLButtonElement | null;
      if (clearBtn) clearBtn.disabled = false;
    },
    { signal },
  );

  // Clear purchases
  container.querySelector('#calc-clear-purchases')?.addEventListener(
    'click',
    async () => {
      if (state.purchases.length === 0) return;
      const shouldClear = await showConfirmDialog('Borrar todas las posiciones?', {
        title: 'Confirmar borrado',
        confirmLabel: 'Borrar',
        destructive: true,
      });
      if (!shouldClear) return;

      state.purchases = [];
      renderPurchaseRows(container);
      cancelScheduledRecalculate();
      recalculate(container, { animate: true });
      save();
      const clearBtn = container.querySelector('#calc-clear-purchases') as HTMLButtonElement | null;
      if (clearBtn) clearBtn.disabled = true;
    },
    { signal },
  );

  bindPurchaseListEvents(container, signal);
}

function bindPurchaseListEvents(container: HTMLElement, signal: AbortSignal): void {
  const list = container.querySelector('#calc-purchases-list') as HTMLElement;
  if (!list) return;

  list.addEventListener(
    'input',
    (e) => {
      const el = e.target as HTMLInputElement;
      if (!el.dataset.purchaseId || !el.dataset.field) return;
      const id = parseInt(el.dataset.purchaseId, 10);
      const field = el.dataset.field as 'qty' | 'price';
      const purchase = state.purchases.find((p) => p.id === id);
      if (purchase && field) {
        purchase[field] = el.value;
        const row = el.closest('.calc-purchase-row') as HTMLElement;
        if (row) {
          const totalCell = row.querySelector('.calc-row-total') as HTMLElement | null;
          if (totalCell) {
            const qty = parseNum(purchase.qty);
            const price = roundTo(parseNum(purchase.price), 2);
            const total =
              Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0
                ? roundTo(qty * price, 2)
                : NaN;
            totalCell.textContent = Number.isFinite(total) ? fmtNum(total, 2) : '-';
          }
        }
        scheduleRecalculate(container);
        scheduleSave();
      }
    },
    { signal },
  );

  list.addEventListener(
    'click',
    (e) => {
      const btn = (e.target as HTMLElement).closest('[data-remove-id]') as HTMLElement | null;
      if (!btn) return;
      const id = parseInt(btn.dataset.removeId || '0', 10);
      state.purchases = state.purchases.filter((p) => p.id !== id);
      renderPurchaseRows(container);
      cancelScheduledRecalculate();
      recalculate(container, { animate: true });
      save();
      const clearBtn = container.querySelector('#calc-clear-purchases') as HTMLButtonElement | null;
      if (clearBtn) clearBtn.disabled = state.purchases.length === 0;
    },
    { signal },
  );
}

// ── Fee UI update ──

function updateFeeUI(container: HTMLElement): void {
  const spotBtn = container.querySelector('#calc-fee-spot') as HTMLElement;
  const fdusdBtn = container.querySelector('#calc-fee-fdusd') as HTMLElement;
  const feeDisplay = container.querySelector('#calc-fee-display') as HTMLElement;

  spotBtn?.classList.toggle('active', !state.fdusdEnabled);
  fdusdBtn?.classList.toggle('active', state.fdusdEnabled);
  if (feeDisplay) feeDisplay.textContent = `${getEffectiveMakerFee().toFixed(3)}%`;
}

function setCalcMetricText(el: HTMLElement | null, text: string, animate: boolean): void {
  if (!el) return;
  stopValueAnimation(calcValueAnimationByElement, el);
  delete el.dataset.numericValue;
  setAnimatedText(calcTextAnimationByElement, el, text, {
    enabled: animate,
    mode: 'scramble',
    className: 'text-swap',
    durationMs: 240,
  });
}

function setCalcMetricNumber(
  el: HTMLElement | null,
  value: number,
  formatter: (next: number) => string,
  animate: boolean,
): void {
  if (!el) return;
  stopValueAnimation(calcTextAnimationByElement, el);
  setAnimatedNumber(calcValueAnimationByElement, el, value, formatter, {
    enabled: animate,
    durationMs: CALC_RESULT_ANIM_MS,
  });
}

function cancelScheduledRecalculate(): void {
  if (!recalcTimer) return;
  clearTimeout(recalcTimer);
  recalcTimer = null;
}

function scheduleRecalculate(container: HTMLElement): void {
  cancelScheduledRecalculate();
  recalcTimer = setTimeout(() => {
    recalculate(container, { animate: true });
    recalcTimer = null;
  }, CALC_INPUT_DEBOUNCE_MS);
}

// ── Recalculation ──

/**
 * Resuelve un campo que las compras pueden calcular solas. Cuando lo hacen, el
 * input muestra el derivado y queda bloqueado, pero `state` conserva intacto lo
 * que el usuario escribio a mano: al vaciar la tabla su valor vuelve tal cual.
 * Por eso el valor de calculo sale de aqui y no de leer el DOM, que en ese rato
 * esta ocupado por el derivado.
 */
function applyDerivedField(
  container: HTMLElement,
  key: 'price' | 'capital',
  derived: number,
): number {
  const input = container.querySelector(`#calc-${key}`) as HTMLInputElement | null;
  const lock = container.querySelector(`#calc-${key}-lock`) as HTMLElement | null;
  const isDerived = Number.isFinite(derived) && derived > 0;

  if (input) {
    // Solo se reescribe si difiere: asignar mientras el usuario teclea le
    // moveria el cursor al final.
    const next = isDerived ? derived.toFixed(priceDecimals(derived)) : state[key];
    if (input.value !== next) input.value = next;
    input.readOnly = isDerived;
    input.classList.toggle('calc-locked', isDerived);
  }
  if (lock) lock.hidden = !isDerived;

  if (isDerived) return derived;
  const manual = parseNum(state[key]);
  return Number.isFinite(manual) && manual > 0 ? manual : NaN;
}

function recalculate(container: HTMLElement, options: { animate?: boolean } = {}): void {
  const animate = options.animate === true;
  const makerPct = getEffectiveMakerFee();
  const trades = parseNum(state.trades);

  // Purchase totals → auto-lock capital & price
  const totals = computePurchaseTotals(state.purchases);
  updatePurchaseSummary(container, totals);

  const capital = applyDerivedField(container, 'capital', totals.totalUsd);
  const basePrice = applyDerivedField(container, 'price', totals.avgPrice);

  const cycle = computeCycle({
    basePrice,
    capital,
    trades,
    makerFeePct: makerPct,
    sellValue: parseNum(state.sell),
    sellUnit: state.sellUnit,
    rebuyValue: parseNum(state.rebuy),
    rebuyUnit: state.rebuyUnit,
  });

  updateSignalContext(container, trades, capital);
  updateCycleHints(container, basePrice, cycle);
  renderCycle(container, cycle, animate);
}

// ── Unidades de captura ──

/** Refleja la unidad activa en el afijo del input y en el segmentado. */
function applyUnitUI(container: HTMLElement, key: 'sell' | 'rebuy', unit: PriceUnit): void {
  const input = container.querySelector(`#calc-${key}`) as HTMLInputElement | null;
  const prefix = container.querySelector(`#calc-${key}-prefix`) as HTMLElement | null;
  const suffix = container.querySelector(`#calc-${key}-suffix`) as HTMLElement | null;
  const usdBtn = container.querySelector(`#calc-${key}-unit-usd`) as HTMLElement | null;
  const pctBtn = container.querySelector(`#calc-${key}-unit-pct`) as HTMLElement | null;
  const isUsd = unit === 'usd';

  if (prefix) prefix.hidden = !isUsd;
  if (suffix) suffix.hidden = isUsd;
  if (input) {
    input.classList.toggle('has-prefix', isUsd);
    input.classList.toggle('has-suffix', !isUsd);
  }
  usdBtn?.classList.toggle('active', isUsd);
  pctBtn?.classList.toggle('active', !isUsd);
}

/**
 * Cambia la unidad conservando el precio que el campo ya representaba: pasar de
 * $2515 a % con base 2490 debe dar 1.0040, no interpretar 2515 como porcentaje.
 */
function changeUnit(container: HTMLElement, key: 'sell' | 'rebuy', unit: PriceUnit): void {
  const currentUnit = key === 'sell' ? state.sellUnit : state.rebuyUnit;
  if (currentUnit === unit) return;

  const input = container.querySelector(`#calc-${key}`) as HTMLInputElement | null;
  const basePrice = resolveBasePrice();
  const sellPrice = resolveSellPrice(parseNum(state.sell), state.sellUnit, basePrice);
  const reference = key === 'sell' ? basePrice : sellPrice;

  const currentPrice =
    key === 'sell'
      ? sellPrice
      : resolveRebuyPrice(parseNum(state.rebuy), state.rebuyUnit, sellPrice);

  let converted = '';
  if (Number.isFinite(currentPrice) && Number.isFinite(reference) && reference > 0) {
    if (unit === 'usd') {
      converted = currentPrice.toFixed(priceDecimals(currentPrice));
    } else {
      const pct =
        key === 'sell'
          ? (currentPrice / reference - 1) * 100
          : (1 - currentPrice / reference) * 100;
      converted = pct.toFixed(4);
    }
  }

  // Sin referencia no hay conversion posible: se vacia en vez de dejar un
  // numero que pasaria a significar otra cosa al cambiar la unidad.
  if (key === 'sell') {
    state.sellUnit = unit;
    state.sell = converted;
  } else {
    state.rebuyUnit = unit;
    state.rebuy = converted;
  }
  if (input) input.value = converted;

  applyUnitUI(container, key, unit);
  cancelScheduledRecalculate();
  recalculate(container, { animate: true });
  save();
}

/** El precio de compra vigente: promedio de la tabla si la hay, si no el capturado. */
function resolveBasePrice(): number {
  const totals = computePurchaseTotals(state.purchases);
  if (Number.isFinite(totals.avgPrice) && totals.validCount > 0) return totals.avgPrice;
  const parsed = parseNum(state.price);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
}

/** Pista bajo cada campo: el mismo precio expresado en la unidad contraria. */
function updateCycleHints(container: HTMLElement, basePrice: number, cycle: CycleResults): void {
  const sellHint = container.querySelector('#calc-sell-hint') as HTMLElement | null;
  const rebuyHint = container.querySelector('#calc-rebuy-hint') as HTMLElement | null;
  const baseValid = Number.isFinite(basePrice) && basePrice > 0;

  if (sellHint) {
    if (state.sellUnit === 'usd') {
      sellHint.textContent =
        baseValid && Number.isFinite(cycle.sellMovePct)
          ? `${signed(cycle.sellMovePct, 4)} % ${CALC_SELL_HINT_PCT}`
          : CALCULADORA_COPY.sellHintFallback;
    } else {
      sellHint.textContent = Number.isFinite(cycle.sellPrice)
        ? `$ ${fmtPrice(cycle.sellPrice)}`
        : CALCULADORA_COPY.sellHintFallback;
    }
  }

  if (rebuyHint) {
    if (state.rebuyUnit === 'usd') {
      rebuyHint.textContent = Number.isFinite(cycle.rebuyDipPct)
        ? `${signed(cycle.rebuyDipPct, 4)} % ${CALC_REBUY_HINT_PCT}`
        : CALCULADORA_COPY.rebuyHintFallback;
    } else {
      rebuyHint.textContent = Number.isFinite(cycle.rebuyPrice)
        ? `$ ${fmtPrice(cycle.rebuyPrice)}`
        : CALCULADORA_COPY.rebuyHintFallback;
    }
  }
}

function signed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${fmtNum(value, decimals)}`;
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

/** Pinta una metrica numerica con su tono, o un guion si no hay dato. */
function renderMetric(
  container: HTMLElement,
  selector: string,
  value: number,
  formatter: (next: number) => string,
  animate: boolean,
  tone = true,
): void {
  const el = container.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  if (tone) setTone(el, value);
  if (Number.isFinite(value)) {
    setCalcMetricNumber(el, value, formatter, animate);
  } else {
    setCalcMetricText(el, '-', animate);
  }
}

function renderCycle(container: HTMLElement, cycle: CycleResults, animate: boolean): void {
  updateSignalStatus(container, cycle);

  const pct = (decimals: number) => (next: number) => `${fmtNum(next, decimals)} %`;
  const usd = (next: number) => `$ ${fmtNum(next, 2)}`;

  renderMetric(container, '#calc-out-apr', cycle.apr, pct(2), animate);
  // Un APR en verde sobre una venta que realiza perdida se lee como luz verde.
  // El numero sigue siendo cierto (describe el ciclo), pero pierde el tono.
  const aprEl = container.querySelector('#calc-out-apr') as HTMLElement | null;
  if (aprEl && Number.isFinite(cycle.saleNetUsd) && cycle.saleNetUsd < 0) {
    aprEl.classList.remove('text-gain', 'text-loss');
    aprEl.classList.add('text-muted');
  }
  renderMetric(container, '#calc-out-net-cycle-pct', cycle.cycleNetPct, pct(4), animate);
  renderMetric(container, '#calc-out-net-cycle-usd', cycle.cycleNetUsd, usd, animate);
  renderMetric(container, '#calc-out-movement', cycle.sellMovePct, pct(3), animate);
  renderMetric(container, '#calc-out-sale-net', cycle.saleNetUsd, usd, animate);
  renderMetric(container, '#calc-fee-total', cycle.feeUsd, usd, animate, false);
  const price = (next: number) => `$ ${fmtPrice(next)}`;
  renderMetric(container, '#calc-out-sell-price', cycle.sellPrice, price, animate, false);
  renderMetric(container, '#calc-out-rebuy-price', cycle.rebuyPrice, price, animate, false);
}

function updateSignalContext(container: HTMLElement, trades: number, capital: number): void {
  const el = container.querySelector('#calc-signal-context') as HTMLElement | null;
  if (!el) return;

  const hasTrades = Number.isFinite(trades) && trades > 0;
  const hasCapital = Number.isFinite(capital) && capital > 0;
  if (!hasTrades || !hasCapital) {
    el.textContent = '';
    return;
  }
  const cycles = fmtNum(trades, Number.isInteger(trades) ? 0 : 2);
  el.textContent = `${cycles} ciclos por año sobre ${formatUSD(capital)}`;
}

/**
 * La senal mira las dos patas. El ciclo repetible puede rendir aunque la venta
 * se ejecute muy por debajo de la compra (vender a 2 y recomprar a 1.97 sigue
 * engordando la bolsa), y anunciar eso como "neto positivo" esconderia que la
 * operacion realiza una perdida contra el coste de entrada.
 */
function updateSignalStatus(container: HTMLElement, cycle: CycleResults): void {
  const el = container.querySelector('#calc-signal-status') as HTMLElement | null;
  if (!el) return;

  // Cuelga del %, no de los dolares: el ciclo es computable sin posicion, y un
  // APR en verde junto a un chip "Sin senal" se contradicen.
  const cycleValid = Number.isFinite(cycle.cycleNetPct) && cycle.cycleNetPct !== 0;
  const saleLoss = Number.isFinite(cycle.saleNetUsd) && cycle.saleNetUsd < 0;

  let tone = '';
  let label = CALCULADORA_COPY.signalFlat;
  if (cycleValid && cycle.cycleNetPct < 0) {
    tone = ' chip-loss';
    label = CALCULADORA_COPY.signalNegative;
  } else if (saleLoss) {
    tone = ' chip-loss';
    label = CALCULADORA_COPY.signalSaleLoss;
  } else if (cycleValid) {
    tone = ' chip-gain';
    label = CALCULADORA_COPY.signalPositive;
  }

  el.className = `chip${tone}`;
  el.innerHTML = `<span class="chip-dot"></span>${label}`;
}

function updatePurchaseSummary(container: HTMLElement, totals: PurchaseTotals): void {
  const el = container.querySelector('#calc-purchase-summary') as HTMLElement;
  if (!el) return;

  if (state.purchases.length === 0) {
    el.textContent = CALCULADORA_COPY.purchasesEmpty;
    return;
  }
  if (!totals.validCount) {
    el.textContent = CALCULADORA_COPY.purchasesIncomplete;
    return;
  }
  // Va en la linea del desplegable: tiene que caber plegado.
  const rows = `${totals.validCount} ${totals.validCount === 1 ? 'compra' : 'compras'}`;
  el.textContent = `${rows} · medio $ ${fmtPrice(totals.avgPrice)} · $ ${fmtNum(totals.totalUsd, 2)}`;
}

// ── Debounced save ──

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    save();
    saveTimer = null;
  }, 200);
}
