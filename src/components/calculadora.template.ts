import { iconPlus, iconRefreshCw, iconTrash, iconX } from '../utils/icons';
import type { CalculadoraState } from '../types';
import { CALCULADORA_COPY } from './calculadora.constants';

export function renderCalculadoraTemplate(
  state: CalculadoraState,
  feeValue: number,
): string {
  return `
    <div class="section">
      <h2 class="visually-hidden">${CALCULADORA_COPY.title}</h2>

      <div class="card calc-config-card">
        <div class="card-title mb-md">${CALCULADORA_COPY.configTitle}</div>
        <div class="calc-config-bar">
          <div class="form-group form-group-inline">
            <label for="calc-price">${CALCULADORA_COPY.priceLabel}</label>
            <div class="calc-input-wrap">
              <span class="calc-prefix">$</span>
              <input type="text" id="calc-price" class="calc-has-prefix" placeholder="${CALCULADORA_COPY.pricePlaceholder}" inputmode="decimal" value="${state.price}">
            </div>
            <span class="auto-tag is-auto hint-text" id="calc-price-lock" hidden>AUTO</span>
          </div>

          <div class="form-group form-group-inline">
            <label for="calc-capital">${CALCULADORA_COPY.capitalLabel}</label>
            <div class="calc-input-wrap">
              <span class="calc-prefix">$</span>
              <input type="text" id="calc-capital" class="calc-has-prefix" inputmode="decimal" value="${state.capital}">
            </div>
          </div>

          <div class="form-group form-group-inline">
            <label for="calc-trades">${CALCULADORA_COPY.tradesLabel}</label>
            <input type="text" id="calc-trades" inputmode="decimal" value="${state.trades}">
          </div>

          <div class="form-group form-group-inline">
            <label>${CALCULADORA_COPY.feeLabel}</label>
            <div class="calc-fee-row">
              <button type="button" class="preset-btn ${state.feePreset === 'spot' && !state.fdusdEnabled ? 'active' : ''}" id="calc-fee-spot">Spot</button>
              <button type="button" class="preset-btn ${state.feePreset === 'futures' ? 'active' : ''}" id="calc-fee-futures">Futuros</button>
              <button type="button" class="preset-btn ${state.feePreset === 'spot' && state.fdusdEnabled ? 'active' : ''}" id="calc-fee-fdusd" ${state.feePreset !== 'spot' ? 'disabled' : ''}>FDUSD</button>
            </div>
            <div class="text-muted hint-text">
              ${CALCULADORA_COPY.feePrefix} <span id="calc-fee-display" class="mono">${feeValue.toFixed(3)}%</span>
              <span class="calc-fee-sep">&middot;</span>
              ${CALCULADORA_COPY.feeTotalPrefix} <span id="calc-fee-total" class="mono">-</span>
            </div>
          </div>
        </div>
      </div>

      <div class="grid-2 calc-shell">
        <div>
          <div class="card mb-md">
            <div class="card-title flex-between mb-md">
              ${CALCULADORA_COPY.executionTitle}
              <button type="button" class="btn btn-sm" id="calc-reset-exec" title="Resetear valores">${iconRefreshCw(14)} ${CALCULADORA_COPY.resetLabel}</button>
            </div>
            <div class="grid-3">
              <div class="form-group">
                <label for="calc-sell-price">Precio ejecutado</label>
                <div class="calc-input-wrap">
                  <span class="calc-prefix">$</span>
                  <input type="text" id="calc-sell-price" class="calc-has-prefix" placeholder="${CALCULADORA_COPY.sellPricePlaceholder}" inputmode="decimal" value="${state.sellPrice}">
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

          <div class="card">
            <div class="card-title flex-between mb-md">
              ${CALCULADORA_COPY.positionsTitle}
              <div class="flex-row gap-sm">
                <button type="button" class="btn btn-sm btn-danger" id="calc-clear-purchases" ${state.purchases.length === 0 ? 'disabled' : ''}>${iconTrash(14)} ${CALCULADORA_COPY.clearLabel}</button>
                <button type="button" class="btn btn-sm btn-primary" id="calc-add-purchase">${iconPlus(14)} ${CALCULADORA_COPY.addLabel}</button>
              </div>
            </div>

            ${
              state.purchases.length > 0
                ? `
              <div class="calc-purchase-header">
                <span>Cantidad</span>
                <span>Precio (USD)</span>
                <span>Total (USD)</span>
                <span></span>
              </div>
            `
                : ''
            }

            <div id="calc-purchases-list"></div>

            <div class="text-muted hint-text mt-md" id="calc-purchase-summary">
              ${state.purchases.length === 0 ? CALCULADORA_COPY.purchasesEmpty : ''}
            </div>
          </div>
        </div>

        <div class="card calc-signal-card">
          <div class="card-title mb-md">${CALCULADORA_COPY.signalTitle}</div>
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
}

export function renderPurchaseRow(
  purchaseId: number,
  qty: string,
  price: string,
  totalValue: string,
): string {
  return `
    <div class="form-group form-group-inline">
      <input type="text" data-purchase-id="${purchaseId}" data-field="qty" placeholder="${CALCULADORA_COPY.zeroPlaceholder}" inputmode="decimal" value="${qty}">
    </div>
    <div class="form-group form-group-inline">
      <div class="calc-input-wrap">
        <span class="calc-prefix">$</span>
        <input type="text" data-purchase-id="${purchaseId}" data-field="price" class="calc-has-prefix" placeholder="${CALCULADORA_COPY.zeroPlaceholder}" inputmode="decimal" value="${price}">
      </div>
    </div>
    <div class="form-group form-group-inline">
      <input type="text" readonly class="calc-locked" value="${totalValue}" aria-label="Total calculado">
    </div>
    <button type="button" class="btn btn-sm btn-danger calc-remove-btn" data-remove-id="${purchaseId}" aria-label="Eliminar posición">${iconX(14)}</button>
  `;
}
