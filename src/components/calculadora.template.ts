import { iconPlus, iconRefreshCw, iconTrash, iconX } from '../utils/icons';
import type { CalculadoraState } from '../types';
import { CALCULADORA_COPY } from './calculadora.constants';

export function renderCalculadoraTemplate(state: CalculadoraState, feeValue: number): string {
  return `
    <section class="calculadora-view" aria-labelledby="calculadora-heading">
      <h2 class="visually-hidden" id="calculadora-heading">${CALCULADORA_COPY.title}</h2>

      <div class="context">
        <div class="context-left">
          <span class="context-title">${CALCULADORA_COPY.contextTitle}</span>
          <span class="context-sep"></span>
          <span class="context-meta">${CALCULADORA_COPY.contextMeta}</span>
        </div>
        <div class="context-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="calc-reset-exec">
            ${iconRefreshCw(13)} ${CALCULADORA_COPY.resetLabel}
          </button>
        </div>
      </div>

      <div class="rail rail-4" aria-label="Contexto de entrada">
        <div class="rail-item">
          <div class="field">
            <label class="field-label" for="calc-price">
              ${CALCULADORA_COPY.priceLabel}
              <span class="auto-tag is-auto" id="calc-price-lock" hidden>AUTO</span>
            </label>
            <span class="input-affix">
              <span class="input-prefix">$</span>
              <input class="input has-prefix" type="text" id="calc-price" placeholder="${CALCULADORA_COPY.pricePlaceholder}" inputmode="decimal" value="${state.price}">
            </span>
            <span class="field-hint">${CALCULADORA_COPY.priceHint}</span>
          </div>
        </div>
        <div class="rail-item">
          <div class="field">
            <label class="field-label" for="calc-capital">${CALCULADORA_COPY.capitalLabel}</label>
            <span class="input-affix">
              <span class="input-prefix">$</span>
              <input class="input has-prefix" type="text" id="calc-capital" inputmode="decimal" value="${state.capital}">
            </span>
            <span class="field-hint">${CALCULADORA_COPY.capitalHint}</span>
          </div>
        </div>
        <div class="rail-item">
          <div class="field">
            <label class="field-label" for="calc-trades">${CALCULADORA_COPY.tradesLabel}</label>
            <input class="input" type="text" id="calc-trades" inputmode="decimal" value="${state.trades}">
            <span class="field-hint">${CALCULADORA_COPY.tradesHint}</span>
          </div>
        </div>
        <div class="rail-item">
          <div class="field">
            <span class="field-label">${CALCULADORA_COPY.feeLabel}</span>
            <span class="segmented" role="group" aria-label="${CALCULADORA_COPY.feeLabel}">
              <button type="button" class="preset-btn ${state.fdusdEnabled ? '' : 'active'}" id="calc-fee-spot">Spot</button>
              <button type="button" class="preset-btn ${state.fdusdEnabled ? 'active' : ''}" id="calc-fee-fdusd">FDUSD</button>
            </span>
            <span class="field-hint">
              ${CALCULADORA_COPY.feePrefix} <span id="calc-fee-display" class="num">${feeValue.toFixed(3)}%</span> ${CALCULADORA_COPY.feeSuffix}
            </span>
          </div>
        </div>
      </div>

      <section class="block split">
        <div class="stack">
          <div>
            <div class="table-head">
              <span class="table-title">${CALCULADORA_COPY.executionTitle}</span>
              <span class="block-note">${CALCULADORA_COPY.executionNote}</span>
            </div>
            <div class="grid-3">
              <div class="field">
                <label class="field-label" for="calc-sell-price">${CALCULADORA_COPY.sellPriceLabel}</label>
                <span class="input-affix">
                  <span class="input-prefix">$</span>
                  <input class="input has-prefix" type="text" id="calc-sell-price" placeholder="${CALCULADORA_COPY.sellPricePlaceholder}" inputmode="decimal" value="${state.sellPrice}">
                </span>
              </div>
              <div class="field">
                <label class="field-label" for="calc-sell-pct">${CALCULADORA_COPY.sellPctLabel}</label>
                <input class="input" type="text" id="calc-sell-pct" inputmode="decimal" value="${state.sellPct}">
              </div>
              <div class="field">
                <label class="field-label" for="calc-rebuy-pct">${CALCULADORA_COPY.rebuyPctLabel}</label>
                <input class="input" type="text" id="calc-rebuy-pct" inputmode="decimal" value="${state.rebuyPct}">
              </div>
            </div>
          </div>

          <div>
            <div class="table-head">
              <span class="table-title">${CALCULADORA_COPY.positionsTitle}</span>
              <span class="context-actions">
                <button type="button" class="btn btn-danger btn-sm" id="calc-clear-purchases" ${state.purchases.length === 0 ? 'disabled' : ''}>${iconTrash(13)} ${CALCULADORA_COPY.clearLabel}</button>
                <button type="button" class="btn btn-sm" id="calc-add-purchase">${iconPlus(13)} ${CALCULADORA_COPY.addLabel}</button>
              </span>
            </div>
            <table class="tbl calc-purchases-table">
              <caption class="visually-hidden">${CALCULADORA_COPY.positionsTitle}</caption>
              <thead class="calc-purchase-header">
                <tr>
                  ${CALCULADORA_COPY.purchaseHeaders
                    .map(
                      (header, index) =>
                        `<th scope="col"${index === 2 ? ' class="r"' : ''}>${header}</th>`,
                    )
                    .join('')}
                  <th scope="col" style="width:40px"><span class="visually-hidden">Acciones</span></th>
                </tr>
              </thead>
              <tbody id="calc-purchases-list"></tbody>
            </table>
            <p class="muted calc-purchase-summary" id="calc-purchase-summary">
              ${state.purchases.length === 0 ? CALCULADORA_COPY.purchasesEmpty : ''}
            </p>
          </div>
        </div>

        <aside class="panel" aria-labelledby="calc-signal-title">
          <div class="table-head">
            <span class="table-title" id="calc-signal-title">${CALCULADORA_COPY.signalTitle}</span>
            <span class="chip" id="calc-signal-status"><span class="chip-dot"></span>${CALCULADORA_COPY.signalFlat}</span>
          </div>

          <div class="hero-main" style="gap:6px">
            <span class="label">${CALCULADORA_COPY.aprLabel}</span>
            <output class="hero-figure sm" id="calc-out-apr" aria-live="polite">-</output>
            <span class="muted calc-signal-context" id="calc-signal-context"></span>
          </div>

          <div class="rule" style="margin:20px 0 4px"></div>

          <div class="panel-row panel-row-lead">
            <span class="label">${CALCULADORA_COPY.netCyclePctLabel}</span>
            <output class="num" id="calc-out-net-cycle-pct">-</output>
          </div>
          <div class="panel-row panel-row-lead">
            <span class="label">${CALCULADORA_COPY.netCycleUsdLabel}</span>
            <output class="num" id="calc-out-net-cycle-usd">-</output>
          </div>
          <div class="panel-row">
            <span class="label">${CALCULADORA_COPY.movementLabel}</span>
            <output class="num" id="calc-out-movement">-</output>
          </div>
          <div class="panel-row">
            <span class="label">${CALCULADORA_COPY.profitTradeLabel}</span>
            <output class="num" id="calc-out-profit-trade">-</output>
          </div>
          <div class="panel-row">
            <span class="label">${CALCULADORA_COPY.feeTotalLabel}</span>
            <output class="num" id="calc-fee-total">-</output>
          </div>
          <div class="panel-row">
            <span class="label">${CALCULADORA_COPY.sellPriceOutLabel}</span>
            <output class="num" id="calc-out-sell-price">-</output>
          </div>
          <div class="panel-row">
            <span class="label">${CALCULADORA_COPY.rebuyPriceOutLabel}</span>
            <output class="num" id="calc-out-rebuy-price">-</output>
          </div>
        </aside>
      </section>
    </section>
  `;
}

export function renderPurchaseRow(
  purchaseId: number,
  qty: string,
  price: string,
  totalValue: string,
): string {
  return `
    <td>
      <input class="input input-sm" type="text" data-purchase-id="${purchaseId}" data-field="qty" placeholder="${CALCULADORA_COPY.zeroPlaceholder}" inputmode="decimal" value="${qty}" aria-label="Cantidad">
    </td>
    <td>
      <span class="input-affix">
        <span class="input-prefix">$</span>
        <input class="input input-sm has-prefix" type="text" data-purchase-id="${purchaseId}" data-field="price" placeholder="${CALCULADORA_COPY.zeroPlaceholder}" inputmode="decimal" value="${price}" aria-label="Precio unitario">
      </span>
    </td>
    <td class="r"><span class="num calc-row-total">${totalValue}</span></td>
    <td class="r">
      <button type="button" class="icon-btn calc-remove-btn" data-remove-id="${purchaseId}" aria-label="Eliminar posición">${iconX(13)}</button>
    </td>
  `;
}
