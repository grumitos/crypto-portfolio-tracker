import {
  DEFAULT_CALC_REBUY_PCT,
  DEFAULT_CALC_SELL_PCT,
  loadCalcState,
  saveCalcState,
} from '../utils/storage';
import { formatUSD } from '../utils/calculator';
import type { AchievedResults, CalculadoraState, PurchaseTotals, StrategyResults } from '../types';
import {
  computeAchievedResults,
  computeFeeMultiplier,
  computePurchaseTotals,
  computeStrategyResults,
  parseNum,
  roundTo,
} from './calculadora.math';
import { setAnimatedNumber, setAnimatedText, stopValueAnimation } from '../utils/animation';
import { showConfirmDialog } from '../utils/dialogs';
import {
  CALC_INPUT_DEBOUNCE_MS,
  CALC_RESULT_ANIM_MS,
  CALCULADORA_COPY,
  FDUSD_MAKER_FEE_PCT,
  SPOT_MAKER_FEE_PCT,
} from './calculadora.constants';
import { renderCalculadoraTemplate, renderPurchaseRow } from './calculadora.template';

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
let lastValidPrice = NaN;
let recalcTimer: ReturnType<typeof setTimeout> | null = null;
const calcValueAnimationByElement = new WeakMap<HTMLElement, number>();
const calcTextAnimationByElement = new WeakMap<HTMLElement, number>();

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

  // Sell price ↔ sell % bidirectional sync
  sellPriceInput.addEventListener(
    'focus',
    () => {
      state.sellSyncSource = 'price';
      sellPriceInput.readOnly = false;
      sellPctInput.readOnly = true;
      sellPctInput.classList.add('calc-locked');
      sellPriceInput.classList.remove('calc-locked');
      cancelScheduledRecalculate();
      recalculate(container, { animate: false });
    },
    { signal },
  );

  sellPctInput.addEventListener(
    'focus',
    () => {
      state.sellSyncSource = 'percent';
      sellPctInput.readOnly = false;
      sellPriceInput.readOnly = true;
      sellPriceInput.classList.add('calc-locked');
      sellPctInput.classList.remove('calc-locked');
      cancelScheduledRecalculate();
      recalculate(container, { animate: false });
    },
    { signal },
  );

  sellPriceInput.addEventListener(
    'input',
    () => {
      state.sellPrice = sellPriceInput.value;
      state.sellSyncSource = 'price';
      scheduleRecalculate(container);
      scheduleSave();
    },
    { signal },
  );

  sellPctInput.addEventListener(
    'input',
    () => {
      state.sellPct = sellPctInput.value;
      state.sellSyncSource = 'percent';
      scheduleRecalculate(container);
      scheduleSave();
    },
    { signal },
  );

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
      state.sellPrice = '';
      state.sellPct = DEFAULT_CALC_SELL_PCT;
      state.rebuyPct = DEFAULT_CALC_REBUY_PCT;
      state.sellSyncSource = 'percent';
      sellPriceInput.value = '';
      sellPctInput.value = DEFAULT_CALC_SELL_PCT;
      rebuyPctInput.value = DEFAULT_CALC_REBUY_PCT;
      sellPriceInput.readOnly = true;
      sellPriceInput.classList.add('calc-locked');
      sellPctInput.readOnly = false;
      sellPctInput.classList.remove('calc-locked');
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

function recalculate(container: HTMLElement, options: { animate?: boolean } = {}): void {
  const animate = options.animate === true;
  const makerPct = getEffectiveMakerFee();
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
    if (priceLock) priceLock.hidden = false;
    basePrice = totals.avgPrice;
  } else {
    priceInput.readOnly = false;
    priceInput.classList.remove('calc-locked');
    if (priceLock) priceLock.hidden = true;
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
  if (
    state.sellSyncSource === 'percent' &&
    Number.isFinite(currentSellPct) &&
    Number.isFinite(basePrice) &&
    basePrice > 0
  ) {
    const synced = roundTo(basePrice * (1 + currentSellPct / 100), 2);
    if (Number.isFinite(synced)) sellPriceActual = synced;
  }

  updateSignalContext(container, trades, capital);

  // Achieved results
  const achieved = computeAchievedResults(sellPriceActual, trades, capital, basePrice, makerPct);
  renderAchieved(container, achieved, animate);

  // Strategy results
  const optSellPct = parseNum(state.sellPct);
  const optRebuyPct = parseNum(state.rebuyPct);
  const strategy = computeStrategyResults(basePrice, capital, optSellPct, optRebuyPct, makerPct);
  renderStrategy(container, strategy, animate);

  // Fee total display
  const feeMultiplier = computeFeeMultiplier(makerPct, 2);
  let feeUsd: number;
  if (
    Number.isFinite(capital) &&
    capital > 0 &&
    Number.isFinite(achieved.achievedR) &&
    Number.isFinite(feeMultiplier)
  ) {
    feeUsd = capital * (1 + achieved.achievedR) * (1 - feeMultiplier);
  } else {
    feeUsd = Number.isFinite(capital) ? capital * ((makerPct * 2) / 100) : NaN;
  }
  const feeTotalEl = container.querySelector('#calc-fee-total') as HTMLElement;
  if (feeTotalEl) {
    if (Number.isFinite(feeUsd)) {
      setCalcMetricNumber(feeTotalEl, feeUsd, (next) => formatUSD(next), animate);
    } else {
      setCalcMetricText(feeTotalEl, '-', animate);
    }
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

function renderAchieved(container: HTMLElement, achieved: AchievedResults, animate: boolean): void {
  const aprEl = container.querySelector('#calc-out-apr') as HTMLElement;
  const moveEl = container.querySelector('#calc-out-movement') as HTMLElement;
  const profitEl = container.querySelector('#calc-out-profit-trade') as HTMLElement;

  if (aprEl) {
    setTone(aprEl, achieved.achievedApr);
    if (Number.isFinite(achieved.achievedApr)) {
      setCalcMetricNumber(aprEl, achieved.achievedApr, (next) => `${fmtNum(next, 2)} %`, animate);
    } else {
      setCalcMetricText(aprEl, '-', animate);
    }
  }
  if (moveEl) {
    setTone(moveEl, achieved.achievedMovement);
    if (Number.isFinite(achieved.achievedMovement)) {
      setCalcMetricNumber(
        moveEl,
        achieved.achievedMovement,
        (next) => `${fmtNum(next, 3)} %`,
        animate,
      );
    } else {
      setCalcMetricText(moveEl, '-', animate);
    }
  }
  if (profitEl) {
    setTone(profitEl, achieved.achievedProfitPerTrade);
    if (Number.isFinite(achieved.achievedProfitPerTrade)) {
      setCalcMetricNumber(
        profitEl,
        achieved.achievedProfitPerTrade,
        (next) => `$ ${fmtNum(next, 2)}`,
        animate,
      );
    } else {
      setCalcMetricText(profitEl, '-', animate);
    }
  }
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
  const cycles = fmtNum(trades, 0);
  el.textContent = `${cycles} ciclos por año sobre ${formatUSD(capital)}`;
}

function updateSignalStatus(container: HTMLElement, netUsdCycle: number): void {
  const el = container.querySelector('#calc-signal-status') as HTMLElement | null;
  if (!el) return;

  const isValid = Number.isFinite(netUsdCycle) && netUsdCycle !== 0;
  const tone = !isValid ? '' : netUsdCycle > 0 ? ' chip-gain' : ' chip-loss';
  const label = !isValid
    ? CALCULADORA_COPY.signalFlat
    : netUsdCycle > 0
      ? CALCULADORA_COPY.signalPositive
      : CALCULADORA_COPY.signalNegative;
  el.className = `chip${tone}`;
  el.innerHTML = `<span class="chip-dot"></span>${label}`;
}

function renderStrategy(container: HTMLElement, strategy: StrategyResults, animate: boolean): void {
  const sellEl = container.querySelector('#calc-out-sell-price') as HTMLElement;
  const rebuyEl = container.querySelector('#calc-out-rebuy-price') as HTMLElement;
  const cyclePctEl = container.querySelector('#calc-out-net-cycle-pct') as HTMLElement;
  const cycleUsdEl = container.querySelector('#calc-out-net-cycle-usd') as HTMLElement;

  updateSignalStatus(container, strategy.netUsdCycle);

  if (sellEl) {
    setTone(sellEl, strategy.sellPrice);
    if (Number.isFinite(strategy.sellPrice)) {
      setCalcMetricNumber(sellEl, strategy.sellPrice, (next) => `$ ${fmtNum(next, 2)}`, animate);
    } else {
      setCalcMetricText(sellEl, '-', animate);
    }
  }
  if (rebuyEl) {
    setTone(rebuyEl, strategy.rebuyPrice);
    if (Number.isFinite(strategy.rebuyPrice)) {
      setCalcMetricNumber(rebuyEl, strategy.rebuyPrice, (next) => `$ ${fmtNum(next, 2)}`, animate);
    } else {
      setCalcMetricText(rebuyEl, '-', animate);
    }
  }
  if (cyclePctEl) {
    setTone(cyclePctEl, strategy.netPctCycle);
    if (Number.isFinite(strategy.netPctCycle)) {
      setCalcMetricNumber(
        cyclePctEl,
        strategy.netPctCycle,
        (next) => `${fmtNum(next, 4)} %`,
        animate,
      );
    } else {
      setCalcMetricText(cyclePctEl, '-', animate);
    }
  }
  if (cycleUsdEl) {
    setTone(cycleUsdEl, strategy.netUsdCycle);
    if (Number.isFinite(strategy.netUsdCycle)) {
      setCalcMetricNumber(
        cycleUsdEl,
        strategy.netUsdCycle,
        (next) => `$ ${fmtNum(next, 2)}`,
        animate,
      );
    } else {
      setCalcMetricText(cycleUsdEl, '-', animate);
    }
  }
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
  el.textContent = `Total ${fmtNum(totals.totalQty, 6)} | Costo $ ${fmtNum(totals.totalUsd, 2)} | Promedio $ ${fmtNum(totals.avgPrice, 4)}`;
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
