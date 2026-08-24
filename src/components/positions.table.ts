import { formatUSDCompact } from '../utils/calculator';
import {
  calculateDualElapsedBilledDays,
  calculateDualProjectedBilledDays,
  calculateDualProjectedProfit,
  isDualSettlementReached,
  normalizeTime,
  resolveDualEntryAt,
  resolveDualSettlementAt,
} from '../utils/dual-yield';
import { ONE_DAY_MS, ONE_MINUTE_MS, ONE_SECOND_MS } from '../utils/constants';
import { formatTimeHHMMLocal } from '../utils/date';
import { resolveAssetLogoSources, createAssetMonogram } from '../utils/asset-logos';
import { escapeHtml } from '../utils/ui-helpers';
import { POSITIONS_COPY } from './positions.constants';
import type { DualPosition } from '../types';

type PositionFieldId =
  | 'asset'
  | 'amount'
  | 'apr'
  | 'usd'
  | 'target'
  | 'outcome'
  | 'window'
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

interface OutcomeRow {
  label: string;
  amount: number;
  asset: string;
}

interface PositionField {
  id: PositionFieldId;
  heading: string;
  label: string;
  /** Anchos del <colgroup> por direccion; la tabla es table-layout: fixed. */
  width: { buyLow: string; sellHigh: string };
  align?: 'right';
  include?: (context: { showUsdColumn: boolean }) => boolean;
  cellClass?: string | ((context: PositionRenderContext) => string);
  render: (context: PositionRenderContext) => PositionCellRender;
}

export function renderPositionGroup(title: string, positions: DualPosition[]): string {
  const isBuyLow = positions[0]?.direction !== 'sell-high';
  const safeTitle = escapeHtml(title);
  const groupSummary = `${positions.length} posicion${positions.length > 1 ? 'es' : ''}`;
  const fields = getPositionFields(!isBuyLow);
  const note = isBuyLow ? POSITIONS_COPY.buyLowNote : POSITIONS_COPY.sellHighNote;
  return `
    <section class="block positions-group">
      <div class="table-head">
        <span class="table-title">
          <span class="chip ${isBuyLow ? 'chip-buy' : 'chip-sell'}"><span class="chip-dot"></span>${safeTitle}</span>
          ${groupSummary}
        </span>
        <span class="block-note">${note}</span>
      </div>
      <div class="table-scroll">
        <table class="tbl tbl-dense tbl-fixed positions-table" aria-label="Tabla de posiciones ${safeTitle}">
          <caption class="visually-hidden">
            ${safeTitle}: ${groupSummary}
          </caption>
          <colgroup>
            ${fields.map((field) => `<col style="width:${isBuyLow ? field.width.buyLow : field.width.sellHigh}" data-field="${field.id}">`).join('')}
          </colgroup>
          <thead>
            <tr>
              ${fields
                .map(
                  (field) =>
                    `<th scope="col"${field.align === 'right' ? ' class="r"' : ''} data-field="${field.id}">${field.heading}</th>`,
                )
                .join('')}
            </tr>
          </thead>
          <tbody>
            ${positions.map((p) => renderPositionRow(p, { showUsdColumn: !isBuyLow })).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

// Single source of truth for every rendered position field.
const POSITION_FIELDS: PositionField[] = [
  {
    id: 'asset',
    heading: 'Activo',
    label: 'Activo',
    width: { buyLow: '16%', sellHigh: '15%' },
    render: ({ position, rowKind }) => ({
      html: rowKind === 'component' ? '' : productLabelHtml(position),
    }),
  },
  {
    id: 'amount',
    heading: 'Monto',
    label: 'Monto',
    width: { buyLow: '13%', sellHigh: '12%' },
    align: 'right',
    cellClass: 'r num',
    render: ({ position }) => ({
      html: formatAmount(position.amount, position.subscriptionAsset),
    }),
  },
  {
    id: 'apr',
    heading: 'APR',
    label: 'APR',
    width: { buyLow: '9%', sellHigh: '8%' },
    align: 'right',
    render: ({ position, rowKind }) => renderAprCell(position, rowKind),
  },
  {
    id: 'usd',
    heading: 'Valor USD',
    label: 'Valor USD',
    width: { buyLow: '0%', sellHigh: '10%' },
    align: 'right',
    include: ({ showUsdColumn }) => showUsdColumn,
    cellClass: 'r num',
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
    width: { buyLow: '13%', sellHigh: '10%' },
    align: 'right',
    cellClass: 'r num',
    render: ({ position }) => ({
      html: position.targetPrice > 0 ? formatTargetPrice(position.targetPrice) : '---',
    }),
  },
  {
    id: 'outcome',
    heading: 'Resultado',
    label: 'Resultado',
    width: { buyLow: '17%', sellHigh: '15%' },
    align: 'right',
    cellClass: 'r',
    render: ({ position }) => ({ html: renderOutcomeCell(position) }),
  },
  {
    id: 'window',
    heading: 'Ventana',
    label: 'Ventana',
    width: { buyLow: '13%', sellHigh: '12%' },
    render: ({ position, rowKind }) => ({
      html: renderWindowCell(position, rowKind === 'main'),
    }),
  },
  {
    id: 'earnings',
    heading: 'Ganancia',
    label: 'Ganancia',
    width: { buyLow: '12%', sellHigh: '11%' },
    align: 'right',
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
    heading: 'Restante',
    label: 'Restante',
    width: { buyLow: '7%', sellHigh: '7%' },
    align: 'right',
    cellClass: 'r',
    render: ({ position, parent, componentId, rowKind, hasComponents }) => {
      const remainingId =
        rowKind === 'component'
          ? `position-remaining-${parent!.id}-comp-${componentId}`
          : `position-remaining-${position.id}`;
      const toggle =
        rowKind === 'main' && hasComponents
          ? `
            <button type="button" class="btn btn-ghost btn-sm pos-components-summary" data-toggle-components aria-expanded="false" aria-label="Ver desglose de la posicion">
              <span class="pos-components-chevron" aria-hidden="true">▸</span>
              Desglose (${position.components!.length})
            </button>
          `
          : '';
      return {
        html: `
        <span class="cell-stack r">
          <span id="${escapeHtml(remainingId)}">${formatRemainingTime(position)}</span>
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
  return classNames(`pos-cell--${field.id}`, fieldClass);
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
    return { className: 'r num', html: '---' };
  }

  if (position.positionKind === 'discount-buy') {
    return {
      className: 'r num muted',
      id,
      html: '<span class="skeleton skeleton-number" style="width:64px"></span>',
    };
  }

  return {
    className: 'r num',
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
      className: 'r num muted',
      html: '<span class="skeleton skeleton-number" style="width:72px"></span>',
    };
  }

  const isDerivative = position.positionKind === 'derivative';
  const projectedEarnedStr = isDerivative
    ? formatUSDCompact(projectedEarned)
    : formatPositionEarnings(position, projectedEarned);
  return {
    className: 'r num gain',
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
    return '<span class="muted">---</span>';
  }
  if (position.positionKind === 'derivative' && Number.isFinite(position.notionalUsd)) {
    return formatUSDCompact(position.notionalUsd ?? 0);
  }
  return '<span class="skeleton skeleton-number" style="width:60px"></span>';
}

function renderOutcomeCell(position: DualPosition): string {
  if (position.positionKind === 'derivative') {
    return '<span class="muted">Mercado abierto</span>';
  }

  if (position.positionKind === 'discount-buy') {
    return renderDiscountBuyOutcomeCell(position);
  }

  return renderOutcomeRows(resolveOutcomeRows(position));
}

function renderDiscountBuyOutcomeCell(position: DualPosition): string {
  const purchaseAmount = position.targetPrice > 0 ? position.amount / position.targetPrice : 0;

  return renderOutcomeRows([
    { label: 'Compra', amount: purchaseAmount, asset: position.asset },
  ]);
}

/**
 * Los desenlaces de una posicion (ejecutado / no ejecutado) son datos pares:
 * dos hipotesis excluyentes, ninguna mas cierta que la otra. Comparten color,
 * cuerpo y familia mono; lo unico que las separa es su etiqueta. La rejilla
 * reparte etiqueta, importe y unidad en columnas propias para que las cifras
 * queden a plomo aunque los tickers midan distinto.
 */
function renderOutcomeRows(rows: OutcomeRow[]): string {
  return `
    <span class="pos-outcome">
      ${rows
        .map((row) => {
          const amount = formatAmountParts(row.amount, row.asset);
          return `
            <span class="pos-outcome-row">
              <span class="muted pos-outcome-label">${escapeHtml(row.label)}</span>
              <span class="num pos-outcome-amount">${amount.value}</span>
              <span class="pos-outcome-asset">${amount.asset}</span>
            </span>
          `;
        })
        .join('')}
    </span>
  `;
}

function resolveOutcomeRows(position: DualPosition): OutcomeRow[] {
  const projectedProfit = calculateDualProjectedProfit(position);

  if (position.direction === 'buy-low') {
    const executedAmount =
      position.targetPrice > 0 ? (position.amount + projectedProfit) / position.targetPrice : 0;
    return applyExpectedSettlementRow(position, [
      { label: 'Ejec.', amount: executedAmount, asset: position.asset },
      {
        label: 'No ej.',
        amount: position.amount + projectedProfit,
        asset: position.subscriptionAsset,
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
    },
    {
      label: 'No ej.',
      amount: position.amount + projectedProfit,
      asset: position.subscriptionAsset,
    },
  ]);
}

function applyExpectedSettlementRow(position: DualPosition, rows: OutcomeRow[]): OutcomeRow[] {
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
    return { ...row, amount: position.expectedSettlementAmount as number };
  });
}

/**
 * Fraccion de la ventana ya transcurrida (0-100), en tiempo de reloj.
 *
 * No sirven aqui los dias facturados que alimentan la ganancia: Binance los
 * cuenta enteros y solo pasan de largo al cruzar el corte diario, asi que en una
 * posicion de un dia el contador vale 0 durante toda la espera y salta a 1 de
 * golpe. La barra mide cuanto falta, no cuanto se cobra.
 */
function elapsedWindowPct(position: DualPosition): number {
  const entryAt = resolveDualEntryAt(position);
  const settlementAt = resolveDualSettlementAt(position);
  if (!entryAt || !settlementAt) return 0;

  const total = settlementAt.getTime() - entryAt.getTime();
  if (!Number.isFinite(total) || total <= 0) return 0;

  const elapsed = Date.now() - entryAt.getTime();
  return Math.max(0, Math.min(100, (elapsed / total) * 100));
}

function renderMiniBar(position: DualPosition): string {
  const pct = elapsedWindowPct(position);
  const isClosing = pct >= 70;
  return `<span class="mini-bar" aria-hidden="true"><span${isClosing ? ' class="is-warn"' : ''} style="width:${pct.toFixed(1)}%"></span></span>`;
}

function formatRemainingTime(position: DualPosition): string {
  if (position.positionKind === 'derivative') {
    return '<span class="num soft">Abierta</span>';
  }

  const remainingMs = getRemainingMsToSettlement(position);
  const isSettled = isDualSettlementReached(position);

  if (isSettled) {
    return '<span class="num muted">Liquidada</span>';
  }

  const bar = renderMiniBar(position);

  if (Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs < ONE_MINUTE_MS) {
    const totalSecondsRemaining = Math.max(1, Math.ceil(remainingMs / ONE_SECOND_MS));
    return `<span class="num warn">${totalSecondsRemaining}s</span>${bar}`;
  }

  if (Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs < ONE_DAY_MS) {
    const totalMinutesRemaining = Math.max(1, Math.ceil(remainingMs / ONE_MINUTE_MS));
    const hours = Math.floor(totalMinutesRemaining / 60);
    const minutes = totalMinutesRemaining % 60;
    const minutesLabel = String(minutes).padStart(2, '0');
    return `<span class="num warn">${hours}h ${minutesLabel}m</span>${bar}`;
  }

  if (Number.isFinite(remainingMs) && remainingMs > 0) {
    const totalHours = Math.floor(remainingMs / (60 * ONE_MINUTE_MS));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const toneClass = days < 1 ? 'num warn' : 'num';
    const label = hours > 0 ? `${days}d ${hours}h` : `${days > 0 ? days : 1}d`;
    return `<span class="${toneClass}">${label}</span>${bar}`;
  }

  // Fallback for edge cases where settlement timestamp cannot be resolved.
  const totalDaysRaw = calculateDualProjectedBilledDays(position);
  const elapsedRaw = calculateDualElapsedBilledDays(position);
  const remainingDaysFallback = Math.max(0, totalDaysRaw - elapsedRaw);
  if (remainingDaysFallback > 0) {
    const roundedRemainingDays = Math.max(1, Math.ceil(remainingDaysFallback));
    const toneClass = roundedRemainingDays <= 1 ? 'num warn' : 'num';
    return `<span class="${toneClass}">${roundedRemainingDays}d</span>${bar}`;
  }

  return '<span class="num muted">---</span>';
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

/** dd/mm sin año: la ventana muestra dos fechas en una sola linea. */
function formatShortDate(value: string): string {
  const [year, month, day] = value.split('-');
  if (year && month && day) return `${day}/${month}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function renderWindowCell(position: DualPosition, withHint: boolean): string {
  if (position.positionKind === 'derivative') {
    return `<span class="cell-stack"><span class="num">${escapeHtml(formatShortDate(position.entryDate))} &rarr; ---</span></span>`;
  }

  const settlementAt = resolveDualSettlementAt(position);
  const entryTime = normalizeTime(position.entryTime) ?? '--:--';
  const settlementTime = settlementAt ? formatTimeHHMMLocal(settlementAt) : '--:--';

  const hints = withHint
    ? [getDateTimeHint(position, 'entry'), getDateTimeHint(position, 'settlement')]
        .filter(Boolean)
        .join(' ')
    : '';
  const titleAttr = hints ? ` title="${escapeHtml(hints)}"` : '';

  return `
    <span class="cell-stack"${titleAttr}>
      <span class="num">${escapeHtml(formatShortDate(position.entryDate))} &rarr; ${escapeHtml(formatShortDate(position.settlementDate))}</span>
      <span class="cell-sub">${escapeHtml(entryTime)} &middot; ${escapeHtml(settlementTime)}</span>
    </span>
  `;
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

/** Importe y unidad por separado para poder alinearlos en columnas propias. */
function formatAmountParts(amount: number, asset: string): { value: string; asset: string } {
  const isStable = asset === 'USDT' || asset === 'USDC';
  return {
    value: isStable
      ? formatUSDCompact(amount).replace('$', '')
      : amount.toLocaleString('en-US', { maximumFractionDigits: 6 }),
    asset: escapeHtml(asset),
  };
}

function formatAmount(amount: number, asset: string): string {
  const { value, asset: safeAsset } = formatAmountParts(amount, asset);
  return `${value} <span class="muted">${safeAsset}</span>`;
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

function productLabelParts(position: DualPosition): { base: string; quote: string | null } {
  if (position.positionKind === 'derivative' && position.displaySymbol) {
    const side = position.side === 'short' ? 'Short' : 'Long';
    return { base: `${position.displaySymbol} ${side}`, quote: null };
  }

  if (position.direction === 'sell-high' && position.positionKind !== 'discount-buy') {
    return { base: position.subscriptionAsset, quote: getQuoteAsset(position) };
  }

  return { base: position.asset, quote: position.subscriptionAsset };
}

function productLabelHtml(position: DualPosition): string {
  const { base, quote } = productLabelParts(position);
  const safeBase = escapeHtml(base);
  const safeQuote = quote ? `<span class="quote">/${escapeHtml(quote)}</span>` : '';
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
  return `<span class="asset"><span class="asset-logo-wrap" data-asset-logo-root><img class="asset-logo" data-asset-logo-img ${safePrimaryAttr} ${safeFallbackAttr} alt="${safeAlt}" loading="lazy" decoding="async"><span class="asset-fallback" data-asset-logo-fallback>${safeMonogram}</span></span><span class="asset-pair">${safeBase}${safeQuote}</span></span>`;
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
          `position-remaining-${position.id}-comp-${c.id}`,
        );
        if (!cRemainingEl) return;
        const cNextHtml = formatRemainingTime(tempPos);
        if (cRemainingEl.innerHTML !== cNextHtml) cRemainingEl.innerHTML = cNextHtml;
      });
    }
  });
  return hasSubMinuteCountdown;
}
