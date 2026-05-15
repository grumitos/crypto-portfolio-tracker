import { formatDateLatin, formatUSDCompact } from '../utils/calculator';
import {
  calculateDualElapsedBilledDays,
  calculateDualProjectedBilledDays,
  calculateDualProjectedProfit,
  isDualSettlementReached,
  normalizeTime,
  resolveDualSettlementAt,
} from '../utils/dual-yield';
import { ONE_DAY_MS, ONE_MINUTE_MS, ONE_SECOND_MS } from '../utils/constants';
import { resolveAssetLogoSources, createAssetMonogram } from '../utils/asset-logos';
import { escapeHtml } from '../utils/ui-helpers';
import type { DualPosition } from '../types';

type PositionFieldId =
  | 'asset'
  | 'amount'
  | 'apr'
  | 'usd'
  | 'target'
  | 'outcome'
  | 'subscription'
  | 'settlement'
  | 'earnings'
  | 'remaining';

type PositionRowKind = 'main' | 'component';

interface PositionRenderContext {
  position: DualPosition;
  showUsdColumn: boolean;
  rowKind: PositionRowKind;
  parent?: DualPosition;
  componentId?: string;
  hasComponents?: boolean;
}

interface PositionCellRender {
  className?: string;
  id?: string;
  html: string;
}

interface PositionField {
  id: PositionFieldId;
  heading: string;
  label: string;
  colClass: string;
  include?: (context: { showUsdColumn: boolean }) => boolean;
  cellClass?: string | ((context: PositionRenderContext) => string);
  render: (context: PositionRenderContext) => PositionCellRender;
}

export function renderPositionGroup(title: string, positions: DualPosition[]): string {
  const isBuyLow = positions[0]?.direction !== 'sell-high';
  const safeTitle = escapeHtml(title);
  const groupSummary = `${positions.length} posicion${positions.length > 1 ? 'es' : ''}`;
  const fields = getPositionFields(!isBuyLow);
  return `
    <div class="card positions-group-card">
      <div class="flex-between positions-group-head">
        <div class="card-title form-group-inline">
          <span class="badge ${isBuyLow ? 'badge-buy' : 'badge-sell'}">${safeTitle}</span>
          <span class="positions-group-count">${groupSummary}</span>
        </div>
      </div>
      <div class="table-container">
        <table class="positions-table ${isBuyLow ? 'positions-table--buy-low' : 'positions-table--sell-high'}" aria-label="Tabla de posiciones ${safeTitle}">
          <caption class="visually-hidden">
            ${safeTitle}: ${groupSummary}
          </caption>
          <colgroup>
            ${fields.map((field) => `<col class="${field.colClass}" data-field="${field.id}">`).join('')}
          </colgroup>
          <thead>
            <tr>
              ${fields.map((field) => `<th scope="col" class="pos-head-cell pos-head-cell--${field.id}" data-field="${field.id}">${field.heading}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${positions.map((p) => renderPositionRow(p, { showUsdColumn: !isBuyLow })).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Single source of truth for every rendered position field.
const POSITION_FIELDS: PositionField[] = [
  {
    id: 'asset',
    heading: 'Activo',
    label: 'Activo',
    colClass: 'col-pos-asset',
    cellClass: 'pos-product-cell',
    render: ({ position, rowKind }) => ({
      html:
        rowKind === 'component'
          ? ''
          : `<span class="pos-product-label">${productLabelHtml(position)}</span>`,
    }),
  },
  {
    id: 'amount',
    heading: 'Monto',
    label: 'Monto',
    colClass: 'col-pos-amount',
    cellClass: 'mono',
    render: ({ position }) => ({
      html: formatAmount(position.amount, position.subscriptionAsset),
    }),
  },
  {
    id: 'apr',
    heading: 'APR',
    label: 'APR',
    colClass: 'col-pos-apr',
    render: ({ position, rowKind }) => renderAprCell(position, rowKind),
  },
  {
    id: 'usd',
    heading: 'Valor USD',
    label: 'Valor USD',
    colClass: 'col-pos-usd',
    include: ({ showUsdColumn }) => showUsdColumn,
    cellClass: 'mono pos-usd-cell',
    render: ({ position, parent, componentId, rowKind }) => ({
      id:
        rowKind === 'component'
          ? `position-usd-${parent!.id}-comp-${componentId}`
          : `position-usd-${position.id}`,
      html: rowKind === 'component' ? '' : initialUsdCellHtml(position),
    }),
  },
  {
    id: 'target',
    heading: 'Target',
    label: 'Target',
    colClass: 'col-pos-target',
    cellClass: 'mono',
    render: ({ position }) => ({
      html: position.targetPrice > 0 ? formatTargetPrice(position.targetPrice) : '---',
    }),
  },
  {
    id: 'outcome',
    heading: 'Resultado',
    label: 'Resultado',
    colClass: 'col-pos-outcome',
    cellClass: 'pos-outcome-cell',
    render: ({ position }) => ({ html: renderOutcomeCell(position) }),
  },
  {
    id: 'subscription',
    heading: 'Suscrip.',
    label: 'Suscripción',
    colClass: 'col-pos-subscription',
    cellClass: 'pos-datetime-cell',
    render: ({ position, rowKind }) => ({
      html: renderDateTimeCell(
        position.entryDate,
        rowKind === 'main' ? getDateTimeHint(position, 'entry') : null,
      ),
    }),
  },
  {
    id: 'settlement',
    heading: 'Liq.',
    label: 'Liquidación',
    colClass: 'col-pos-settlement',
    cellClass: 'pos-datetime-cell',
    render: ({ position, rowKind }) => ({
      html:
        position.positionKind === 'derivative'
          ? '<span class="pos-date-value">---</span>'
          : renderDateTimeCell(
              position.settlementDate,
              rowKind === 'main' ? getDateTimeHint(position, 'settlement') : null,
            ),
    }),
  },
  {
    id: 'earnings',
    heading: 'Ganancia',
    label: 'Ganancia',
    colClass: 'col-pos-earnings',
    render: ({ position, rowKind }) => {
      const projectedEarned =
        position.positionKind === 'derivative'
          ? (position.unrealizedPnlUsd ?? 0)
          : calculateDualProjectedProfit(position);
      const earningsCell = renderEarningsCell(position, projectedEarned);
      return {
        ...earningsCell,
        id: rowKind === 'main' ? `position-earn-${position.id}` : undefined,
      };
    },
  },
  {
    id: 'remaining',
    heading: 'Rest.',
    label: 'Restante',
    colClass: 'col-pos-remaining',
    cellClass: ({ hasComponents }) => `pos-row-tail${hasComponents ? ' pos-row-tail-grouped' : ''}`,
    render: ({ position, parent, componentId, rowKind, hasComponents }) => {
      const daysDisplay =
        position.positionKind === 'derivative'
          ? '<span class="mono pos-remaining-value pos-remaining-value--accent">Abierta</span>'
          : formatRemainingTime(position);
      const remainingId =
        rowKind === 'component'
          ? `position-remaining-${parent!.id}-comp-${componentId}`
          : `position-remaining-${position.id}`;
      const toggle =
        rowKind === 'main' && hasComponents
          ? `
            <button type="button" class="pos-components-summary" data-toggle-components aria-expanded="false" aria-label="Ver desglose de la posicion">
              <span class="pos-components-chevron" aria-hidden="true">▸</span>
              Ver desglose (${position.components!.length})
            </button>
          `
          : '';
      return {
        html: `
        <span class="pos-row-tail-content">
          <span id="${escapeHtml(remainingId)}">${daysDisplay}</span>
          ${toggle}
        </span>
      `,
      };
    },
  },
];

function getPositionFields(showUsdColumn: boolean): PositionField[] {
  const context = { showUsdColumn };
  return POSITION_FIELDS.filter((field) => !field.include || field.include(context));
}

function classNames(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(' ');
}

function getCellClass(field: PositionField, context: PositionRenderContext): string {
  const fieldClass =
    typeof field.cellClass === 'function' ? field.cellClass(context) : field.cellClass;
  return classNames('pos-cell', `pos-cell--${field.id}`, fieldClass);
}

function renderPositionCells(context: PositionRenderContext): string {
  return getPositionFields(context.showUsdColumn)
    .map((field) => {
      const rendered = field.render(context);
      const className = classNames(getCellClass(field, context), rendered.className);
      const idAttr = rendered.id ? ` id="${escapeHtml(rendered.id)}"` : '';
      return `<td${idAttr} class="${className}" data-field="${field.id}" data-label="${escapeHtml(field.label)}">${rendered.html}</td>`;
    })
    .join('');
}

function renderPositionRow(p: DualPosition, options: { showUsdColumn: boolean }): string {
  const hasComponents = Boolean(p.components && p.components.length > 1);

  const mainRow = `
    <tr data-id="${escapeHtml(p.id)}" ${hasComponents ? 'class="pos-row-grouped"' : ''}>
      ${renderPositionCells({
        position: p,
        showUsdColumn: options.showUsdColumn,
        rowKind: 'main',
        hasComponents,
      })}
    </tr>
  `;

  if (!hasComponents) return mainRow;

  const componentRows = renderComponentRows(p, options);
  return mainRow + componentRows;
}

function renderAprCell(position: DualPosition, rowKind: PositionRowKind): PositionCellRender {
  const id = rowKind === 'main' ? `position-apr-${position.id}` : undefined;

  if (position.positionKind === 'derivative') {
    return { className: 'mono pos-emphasis', html: '---' };
  }

  if (position.positionKind === 'discount-buy') {
    return {
      className: 'mono pos-emphasis text-muted',
      id,
      html: '<span class="skeleton skeleton-number" style="width:64px"></span>',
    };
  }

  return {
    className: 'mono pos-emphasis',
    id,
    html: `${position.apr.toFixed(2)}%`,
  };
}

function renderEarningsCell(
  position: DualPosition,
  projectedEarned: number,
): { className: string; html: string } {
  if (position.positionKind === 'discount-buy') {
    return {
      className: 'mono pos-earn-cell pos-earn-cell--market text-muted',
      html: '<span class="skeleton skeleton-number" style="width:72px"></span>',
    };
  }

  const isDerivative = position.positionKind === 'derivative';
  const projectedEarnedStr = isDerivative
    ? formatUSDCompact(projectedEarned)
    : formatPositionEarnings(position, projectedEarned);
  return {
    className: 'mono pos-earn-cell',
    html: `${isDerivative && projectedEarned < 0 ? '' : '+'}${projectedEarnedStr}`,
  };
}

function renderComponentRows(parent: DualPosition, options: { showUsdColumn: boolean }): string {
  const components = parent.components!;
  const sorted = [...components].sort((a, b) => {
    const aKey = `${a.entryDate} ${normalizeTime(a.entryTime) ?? '00:00'}`;
    const bKey = `${b.entryDate} ${normalizeTime(b.entryTime) ?? '00:00'}`;
    return bKey.localeCompare(aKey);
  });

  const subRows = sorted
    .map((c) => {
      const tempPos: DualPosition = { ...parent, ...c };

      return `
    <tr class="pos-sub-row" hidden data-ignore-row-edit="true">
      ${renderPositionCells({
        position: tempPos,
        showUsdColumn: options.showUsdColumn,
        rowKind: 'component',
        parent,
        componentId: c.id,
      })}
    </tr>
    `;
    })
    .join('');

  return subRows;
}

function initialUsdCellHtml(position: DualPosition): string {
  if (position.direction === 'buy-low') {
    return '<span class="pos-muted-dash">---</span>';
  }
  if (position.positionKind === 'derivative' && Number.isFinite(position.notionalUsd)) {
    return formatUSDCompact(position.notionalUsd ?? 0);
  }
  return '<span class="skeleton skeleton-number" style="width:60px"></span>';
}

function renderOutcomeCell(position: DualPosition): string {
  if (position.positionKind === 'derivative') {
    return '<span class="pos-outcome-muted">Mercado abierto</span>';
  }

  if (position.positionKind === 'discount-buy') {
    return renderDiscountBuyOutcomeCell(position);
  }

  const rows = resolveOutcomeRows(position);
  return `
    <span class="pos-outcome-stack">
      ${rows
        .map(
          (row) => `
            <span class="pos-outcome-line ${row.changed ? 'pos-outcome-line--change' : ''}">
              <span class="pos-outcome-label">${escapeHtml(row.label)}</span>
              <span class="mono pos-outcome-value">${formatAmount(row.amount, row.asset)}</span>
            </span>
          `,
        )
        .join('')}
    </span>
  `;
}

function renderDiscountBuyOutcomeCell(position: DualPosition): string {
  const purchaseAmount = position.targetPrice > 0 ? position.amount / position.targetPrice : 0;

  return `
    <span class="pos-outcome-stack">
      <span class="pos-outcome-line pos-outcome-line--compact pos-outcome-line--change">
        <span class="pos-outcome-label">Compra</span>
        <span class="mono pos-outcome-value">${formatAmount(purchaseAmount, position.asset)}</span>
      </span>
    </span>
  `;
}

function resolveOutcomeRows(
  position: DualPosition,
): Array<{ label: string; amount: number; asset: string; changed: boolean }> {
  const projectedProfit = calculateDualProjectedProfit(position);

  if (position.direction === 'buy-low') {
    const executedAmount =
      position.targetPrice > 0 ? (position.amount + projectedProfit) / position.targetPrice : 0;
    return applyExpectedSettlementRow(position, [
      { label: 'Ejec.', amount: executedAmount, asset: position.asset, changed: true },
      {
        label: 'No ej.',
        amount: position.amount + projectedProfit,
        asset: position.subscriptionAsset,
        changed: false,
      },
    ]);
  }

  const quoteAsset = getQuoteAsset(position);
  const executedAmount =
    position.targetPrice > 0 ? (position.amount + projectedProfit) * position.targetPrice : 0;

  return applyExpectedSettlementRow(position, [
    {
      label: 'Ejec.',
      amount: executedAmount,
      asset: quoteAsset,
      changed: true,
    },
    {
      label: 'No ej.',
      amount: position.amount + projectedProfit,
      asset: position.subscriptionAsset,
      changed: false,
    },
  ]);
}

function applyExpectedSettlementRow(
  position: DualPosition,
  rows: Array<{ label: string; amount: number; asset: string; changed: boolean }>,
): Array<{ label: string; amount: number; asset: string; changed: boolean }> {
  if (
    !position.expectedSettlementAsset ||
    !Number.isFinite(position.expectedSettlementAmount) ||
    (position.expectedSettlementAmount as number) <= 0
  ) {
    return rows;
  }

  let replaced = false;
  return rows.map((row) => {
    if (replaced || row.asset !== position.expectedSettlementAsset) return row;
    replaced = true;
    return {
      ...row,
      amount: position.expectedSettlementAmount as number,
      changed: position.expectedSettlementAsset !== position.subscriptionAsset,
    };
  });
}

function formatRemainingTime(position: DualPosition): string {
  const remainingMs = getRemainingMsToSettlement(position);
  const isSettled = isDualSettlementReached(position);

  if (isSettled) {
    return '<span class="mono pos-remaining-value pos-remaining-value--muted">Liquidada</span>';
  }

  if (Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs < ONE_MINUTE_MS) {
    const totalSecondsRemaining = Math.max(1, Math.ceil(remainingMs / ONE_SECOND_MS));
    return `<span class="mono pos-remaining-value pos-remaining-value--accent">${totalSecondsRemaining}s</span>`;
  }

  if (Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs < ONE_DAY_MS) {
    const totalMinutesRemaining = Math.max(1, Math.ceil(remainingMs / ONE_MINUTE_MS));
    const hours = Math.floor(totalMinutesRemaining / 60);
    const minutes = totalMinutesRemaining % 60;
    const minutesLabel = String(minutes).padStart(2, '0');
    return `<span class="mono pos-remaining-value pos-remaining-value--accent">${hours}h ${minutesLabel}m</span>`;
  }

  if (Number.isFinite(remainingMs) && remainingMs > 0) {
    const totalHours = Math.floor(remainingMs / (60 * ONE_MINUTE_MS));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const colorClass = days < 1 ? ' pos-remaining-value--accent' : '';
    const label = hours > 0 ? `${days}d ${hours}h` : `${days > 0 ? days : 1}d`;
    return `<span class="mono pos-remaining-value${colorClass}">${label}</span>`;
  }

  // Fallback for edge cases where settlement timestamp cannot be resolved.
  const totalDaysRaw = calculateDualProjectedBilledDays(position);
  const elapsedRaw = calculateDualElapsedBilledDays(position);
  const remainingDaysFallback = Math.max(0, totalDaysRaw - elapsedRaw);
  if (remainingDaysFallback > 0) {
    const roundedRemainingDays = Math.max(1, Math.ceil(remainingDaysFallback));
    const colorClass = roundedRemainingDays <= 1 ? ' pos-remaining-value--accent' : '';
    return `<span class="mono pos-remaining-value${colorClass}">${roundedRemainingDays}d</span>`;
  }

  return '<span class="mono pos-remaining-value pos-remaining-value--muted">---</span>';
}

function getRemainingMsToSettlement(position: DualPosition): number {
  const settlementAt = resolveDualSettlementAt(position);
  return settlementAt ? settlementAt.getTime() - Date.now() : NaN;
}

function isSubMinuteCountdown(position: DualPosition): boolean {
  const remainingMs = getRemainingMsToSettlement(position);
  return Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs < ONE_MINUTE_MS;
}

function getContainedElementById(container: HTMLElement, id: string): HTMLElement | null {
  if (container.id === id) return container;
  return (
    Array.from(container.querySelectorAll<HTMLElement>('[id]')).find((el) => el.id === id) ?? null
  );
}

function renderDateTimeCell(date: string, hint?: string | null): string {
  const titleAttr = hint ? ` title="${escapeHtml(hint)}"` : '';
  return `<span class="pos-datetime-wrap"${titleAttr}><span class="pos-date-value">${escapeHtml(formatDateLatin(date))}</span></span>`;
}

function getDateTimeHint(position: DualPosition, field: 'entry' | 'settlement'): string | null {
  if (field === 'settlement') {
    if (position.settlementTimeSource === 'binance_settle_date_rule') {
      return 'Hora de liquidación calculada desde settleDate con la ventana estándar de Binance.';
    }
    return null;
  }

  switch (position.entryTimeSource) {
    case 'binance_purchase_time':
      return 'Hora de suscripción reportada por Binance.';
    case 'derived_settle_minus_duration':
      return 'Hora de suscripción estimada por la app usando settleDate menos la duración del producto.';
    case 'derived_purchase_end_time':
      return 'Hora de suscripción estimada por la app usando purchaseEndTime.';
    case 'derived_now':
      return 'Hora de suscripción estimada por la app porque Binance no devolvió una marca de tiempo utilizable.';
    default:
      return null;
  }
}

function formatAmount(amount: number, asset: string): string {
  const safeAsset = escapeHtml(asset);
  if (asset === 'USDT' || asset === 'USDC') {
    return formatUSDCompact(amount).replace('$', '') + ' ' + safeAsset;
  }
  return amount.toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + safeAsset;
}

function sameAsset(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toUpperCase() === right.toUpperCase());
}

function resolveSellHighQuoteProfit(
  position: DualPosition,
  projectedProfit: number,
  quoteAsset: string,
): number {
  if (position.targetPrice <= 0) return projectedProfit;

  const expectedAmount = position.expectedSettlementAmount;
  if (
    sameAsset(position.expectedSettlementAsset, quoteAsset) &&
    Number.isFinite(expectedAmount) &&
    (expectedAmount as number) > 0
  ) {
    const principalQuote = position.amount * position.targetPrice;
    const exactQuoteProfit = (expectedAmount as number) - principalQuote;
    if (Number.isFinite(exactQuoteProfit) && exactQuoteProfit >= 0) {
      return exactQuoteProfit;
    }
  }

  return projectedProfit * position.targetPrice;
}

function formatPositionEarnings(position: DualPosition, projectedProfit: number): string {
  if (position.direction !== 'sell-high' || position.targetPrice <= 0) {
    return formatAmount(projectedProfit, position.subscriptionAsset);
  }

  const quoteAsset = getQuoteAsset(position);
  const quoteProfit = resolveSellHighQuoteProfit(position, projectedProfit, quoteAsset);
  return formatAmount(quoteProfit, quoteAsset);
}

function formatTargetPrice(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: value > 0 && value < 1 ? 8 : 2,
  });
}

function getQuoteAsset(position: DualPosition): string {
  if (position.quoteAsset) return position.quoteAsset;
  if (position.direction === 'sell-high') return 'USDT';
  return position.subscriptionAsset;
}

function productLabel(position: DualPosition): string {
  if (position.positionKind === 'derivative' && position.displaySymbol) {
    const side = position.side === 'short' ? 'Short' : 'Long';
    return `${position.displaySymbol} ${side}`;
  }

  if (position.positionKind === 'discount-buy') {
    return `${position.asset}/${position.subscriptionAsset}`;
  }

  if (position.direction === 'sell-high') {
    return `${position.subscriptionAsset}/${getQuoteAsset(position)}`;
  }
  return `${position.asset}/${position.subscriptionAsset}`;
}

function productLabelHtml(position: DualPosition): string {
  const label = escapeHtml(productLabel(position));
  const logoAsset =
    position.direction === 'sell-high' ? position.subscriptionAsset : position.asset;

  const sources = resolveAssetLogoSources(logoAsset);
  const monogram = createAssetMonogram(logoAsset);

  const safePrimaryAttr = sources.primarySrc ? `src="${escapeHtml(sources.primarySrc)}"` : '';
  const safeFallbackAttr = sources.fallbackSrcs.length
    ? `data-fallbacks="${escapeHtml(JSON.stringify(sources.fallbackSrcs))}"`
    : '';
  const safeAlt = escapeHtml(sources.alt);
  const safeMonogram = escapeHtml(monogram);
  return `<span class="pos-pair-cell"><span class="pos-pair-logo-wrap" data-asset-logo-root><img class="pos-pair-logo" data-asset-logo-img ${safePrimaryAttr} ${safeFallbackAttr} alt="${safeAlt}" loading="lazy" decoding="async"><span class="pos-pair-fallback" data-asset-logo-fallback>${safeMonogram}</span></span>${label}</span>`;
}

export function updateRemainingTimesInPlace(
  container: HTMLElement,
  positions: DualPosition[],
  options: { subMinuteOnly?: boolean } = {},
): boolean {
  const subMinuteOnly = options.subMinuteOnly === true;
  let hasSubMinuteCountdown = false;
  positions.forEach((position) => {
    const isMainSubMinute = isSubMinuteCountdown(position);
    if (isMainSubMinute) hasSubMinuteCountdown = true;

    if (!subMinuteOnly || isMainSubMinute) {
      const remainingEl = getContainedElementById(container, `position-remaining-${position.id}`);
      if (!remainingEl) return;
      const nextHtml = formatRemainingTime(position);
      if (remainingEl.innerHTML !== nextHtml) remainingEl.innerHTML = nextHtml;
    }

    if (position.components) {
      position.components.forEach((c) => {
        const tempPos: DualPosition = { ...position, ...c };
        const isComponentSubMinute = isSubMinuteCountdown(tempPos);
        if (isComponentSubMinute) hasSubMinuteCountdown = true;
        if (subMinuteOnly && !isComponentSubMinute) return;

        const cRemainingEl = getContainedElementById(
          container,
          `#position-remaining-${position.id}-comp-${c.id}`,
        );
        if (!cRemainingEl) return;
        const cNextHtml = formatRemainingTime(tempPos);
        if (cRemainingEl.innerHTML !== cNextHtml) cRemainingEl.innerHTML = cNextHtml;
      });
    }
  });
  return hasSubMinuteCountdown;
}

export function formatTimeHHMM(value: Date): string {
  const h = String(value.getHours()).padStart(2, '0');
  const m = String(value.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
