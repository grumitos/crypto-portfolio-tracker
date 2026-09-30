import { iconChevronDown, iconPlus, iconRefreshCw, iconTrash, iconX } from '../utils/icons';
import type { CalculadoraState, PriceUnit } from '../types';
import { CALCULADORA_COPY } from './calculadora.constants';

/**
 * Un campo de precio del ciclo: un unico valor editable mas el selector de
 * unidad. La pista de debajo muestra el equivalente en la otra unidad, de solo
 * lectura, para que no haya dos casillas editables representando el mismo dato.
 */
function renderCycleField(
  key: 'sell' | 'rebuy',
  label: string,
  value: string,
  unit: PriceUnit,
  placeholder: string,
): string {
  const isUsd = unit === 'usd';
  return `
    <div class="field">
      <div class="field-label-row">
        <label class="field-label" for="calc-${key}">${label}</label>
        <span class="segmented segmented-xs" role="group" aria-label="Unidad de ${label}">
          <button type="button" class="preset-btn ${isUsd ? 'active' : ''}" id="calc-${key}-unit-usd" title="${CALCULADORA_COPY.unitUsdTitle}">${CALCULADORA_COPY.unitUsdLabel}</button>
          <button type="button" class="preset-btn ${isUsd ? '' : 'active'}" id="calc-${key}-unit-pct" title="${CALCULADORA_COPY.unitPctTitle}">${CALCULADORA_COPY.unitPctLabel}</button>
        </span>
      </div>
      <span class="input-affix">
        <span class="input-prefix" id="calc-${key}-prefix" ${isUsd ? '' : 'hidden'}>$</span>
        <span class="input-suffix" id="calc-${key}-suffix" ${isUsd ? 'hidden' : ''}>%</span>
        <input class="input ${isUsd ? 'has-prefix' : 'has-suffix'}" type="text" id="calc-${key}" placeholder="${placeholder}" inputmode="decimal" value="${value}">
      </span>
      <span class="field-hint" id="calc-${key}-hint"></span>
    </div>
  `;
}

/** Un campo de la posicion; la tabla de compras puede tomarlo y bloquearlo. */
function renderPositionField(
  key: 'price' | 'capital',
  label: string,
  hint: string,
  value: string,
  placeholder: string,
): string {
  return `
    <div class="field">
      <label class="field-label" for="calc-${key}">
        ${label}
        <span class="auto-tag is-auto" id="calc-${key}-lock" hidden>AUTO</span>
      </label>
      <span class="input-affix">
        <span class="input-prefix">$</span>
        <input class="input has-prefix" type="text" id="calc-${key}" placeholder="${placeholder}" inputmode="decimal" value="${value}">
      </span>
      <span class="field-hint">${hint}</span>
    </div>
  `;
}

function renderPanelRow(label: string, outputId: string, lead = false): string {
  return `
    <div class="panel-row${lead ? ' panel-row-lead' : ''}">
      <span class="label">${label}</span>
      <output class="num" id="${outputId}">-</output>
    </div>
  `;
}

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

      <section class="block split">
        <div class="stack">
          <div>
            <div class="table-head">
              <span class="table-title">${CALCULADORA_COPY.positionTitle}</span>
              <span class="block-note">${CALCULADORA_COPY.positionNote}</span>
            </div>
            <div class="grid-2">
              ${renderPositionField('price', CALCULADORA_COPY.priceLabel, CALCULADORA_COPY.priceHint, state.price, CALCULADORA_COPY.pricePlaceholder)}
              ${renderPositionField('capital', CALCULADORA_COPY.capitalLabel, CALCULADORA_COPY.capitalHint, state.capital, CALCULADORA_COPY.zeroPlaceholder)}
            </div>

            <details class="calc-purchases" id="calc-purchases" ${state.purchases.length > 0 ? 'open' : ''}>
              <summary>
                <span class="calc-purchases-title">${iconChevronDown(13)} ${CALCULADORA_COPY.purchasesTitle}</span>
                <span class="calc-purchase-summary" id="calc-purchase-summary"></span>
              </summary>
              <div class="calc-purchases-body">
                <div class="table-head">
                  <span class="block-note">${CALCULADORA_COPY.purchasesNote}</span>
                  <span class="context-actions">
                    <button type="button" class="btn btn-danger btn-sm" id="calc-clear-purchases" ${state.purchases.length === 0 ? 'disabled' : ''}>${iconTrash(13)} ${CALCULADORA_COPY.clearLabel}</button>
                    <button type="button" class="btn btn-sm" id="calc-add-purchase">${iconPlus(13)} ${CALCULADORA_COPY.addLabel}</button>
                  </span>
                </div>
                <table class="tbl calc-purchases-table">
                  <caption class="visually-hidden">${CALCULADORA_COPY.purchasesTitle}</caption>
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
              </div>
            </details>
          </div>

          <div>
            <div class="table-head">
              <span class="table-title">${CALCULADORA_COPY.cycleTitle}</span>
              <span class="block-note">${CALCULADORA_COPY.cycleNote}</span>
            </div>
            <div class="grid-2">
              ${renderCycleField('sell', CALCULADORA_COPY.sellLabel, state.sell, state.sellUnit, CALCULADORA_COPY.sellPricePlaceholder)}
              ${renderCycleField('rebuy', CALCULADORA_COPY.rebuyLabel, state.rebuy, state.rebuyUnit, CALCULADORA_COPY.zeroPlaceholder)}
            </div>

            <div class="rule" style="margin:20px 0"></div>

            <div class="grid-2">
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
              <div class="field">
                <label class="field-label" for="calc-trades">${CALCULADORA_COPY.tradesLabel}</label>
                <input class="input" type="text" id="calc-trades" inputmode="decimal" value="${state.trades}">
                <span class="field-hint">${CALCULADORA_COPY.tradesHint}</span>
              </div>
            </div>
          </div>
        </div>

        <aside class="panel" aria-labelledby="calc-cycle-results-title">
          <div class="table-head">
            <span class="table-title" id="calc-cycle-results-title">${CALCULADORA_COPY.cycleResultsTitle}</span>
            <span class="chip" id="calc-signal-status"><span class="chip-dot"></span>${CALCULADORA_COPY.signalFlat}</span>
          </div>

          <div class="hero-main" style="gap:6px">
            <span class="label">${CALCULADORA_COPY.aprLabel}</span>
            <output class="hero-figure sm" id="calc-out-apr" aria-live="polite">-</output>
            <span class="muted calc-signal-context" id="calc-signal-context"></span>
          </div>

          <div class="rule" style="margin:20px 0 4px"></div>

          ${renderPanelRow(CALCULADORA_COPY.netCyclePctLabel, 'calc-out-net-cycle-pct', true)}
          ${renderPanelRow(CALCULADORA_COPY.netCycleUsdLabel, 'calc-out-net-cycle-usd', true)}
          ${renderPanelRow(CALCULADORA_COPY.feeTotalLabel, 'calc-fee-total')}
          ${renderPanelRow(CALCULADORA_COPY.sellPriceOutLabel, 'calc-out-sell-price')}
          ${renderPanelRow(CALCULADORA_COPY.rebuyPriceOutLabel, 'calc-out-rebuy-price')}

          <div class="calc-panel-section">
            <span class="table-title">${CALCULADORA_COPY.saleResultsTitle}</span>
          </div>

          ${renderPanelRow(CALCULADORA_COPY.movementLabel, 'calc-out-movement')}
          ${renderPanelRow(CALCULADORA_COPY.saleNetLabel, 'calc-out-sale-net')}
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
        <input class="input input-sm has-prefix" type="text" data-purchase-id="${purchaseId}" data-field="price" placeholder="${CALCULADORA_COPY.zeroPlaceholder}" inputmode="decimal" value="${price}" aria-label="Precio">
      </span>
    </td>
    <td class="r"><span class="num calc-row-total">${totalValue}</span></td>
    <td class="r">
      <button type="button" class="icon-btn calc-remove-btn" data-remove-id="${purchaseId}" aria-label="Eliminar compra">${iconX(13)}</button>
    </td>
  `;
}
