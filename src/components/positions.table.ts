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

export function renderPositionGroup(title: string, positions: DualPosition[]): string {
  const isBuyLow = positions[0]?.direction !== 'sell-high';
  const safeTitle = escapeHtml(title);
  const groupSummary = `${positions.length} posicion${positions.length > 1 ? 'es' : ''}`;
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
            <col class="col-pos-asset">
            <col class="col-pos-amount">
            <col class="col-pos-apr">
            ${isBuyLow ? '' : '<col class="col-pos-usd">'}
            <col class="col-pos-target">
            <col class="col-pos-outcome">
            <col class="col-pos-subscription">
            <col class="col-pos-settlement">
            <col class="col-pos-earnings">
            <col class="col-pos-remaining">
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Activo</th>
              <th scope="col">Monto</th>
              <th scope="col">APR</th>
              ${isBuyLow ? '' : '<th scope="col">Valor USD</th>'}
              <th scope="col">Target</th>
              <th scope="col">Resultado</th>
              <th scope="col">Suscripcion</th>
              <th scope="col">Liquidacion</th>
              <th scope="col">Ganancia</th>
              <th scope="col">Restante</th>
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

function renderPositionRow(p: DualPosition, options: { showUsdColumn: boolean }): string {
  const isDerivative = p.positionKind === 'derivative';
  const daysDisplay = isDerivative
    ? '<span class="mono pos-remaining-value pos-remaining-value--accent">Abierta</span>'
    : formatRemainingTime(p);
  const projectedEarned = isDerivative
    ? (p.unrealizedPnlUsd ?? 0)
    : calculateDualProjectedProfit(p);
  const projectedEarnedStr = isDerivative
    ? formatUSDCompact(projectedEarned)
    : formatAmount(projectedEarned, p.subscriptionAsset);
  const hasComponents = p.components && p.components.length > 1;

  const entryHint = getDateTimeHint(p, 'entry');
  const settlementHint = getDateTimeHint(p, 'settlement');

  const mainRow = `
    <tr data-id="${p.id}" ${hasComponents ? 'class="pos-row-grouped"' : ''}>
      <td data-label="Activo">
        <span class="pos-product-label">${productLabelHtml(p)}</span>
      </td>
      <td class="mono" data-label="Monto">${formatAmount(p.amount, p.subscriptionAsset)}</td>
      <td class="mono pos-emphasis" data-label="APR">${isDerivative ? '---' : `${p.apr.toFixed(2)}%`}</td>
      ${
        options.showUsdColumn
          ? `<td class="mono pos-usd-cell" id="position-usd-${p.id}" data-label="Valor USD">${initialUsdCellHtml(p)}</td>`
          : ''
      }
      <td class="mono" data-label="Target">${p.targetPrice > 0 ? formatCompactNumber(p.targetPrice) : '---'}</td>
      <td class="pos-outcome-cell" data-label="Resultado">${renderOutcomeCell(p)}</td>
      <td class="pos-datetime-cell" data-label="Suscripcion">${renderDateTimeCell(p.entryDate, entryHint)}</td>
      <td class="pos-datetime-cell" data-label="Liquidacion">${isDerivative ? '<span class="pos-date-value">---</span>' : renderDateTimeCell(p.settlementDate, settlementHint)}</td>
      <td class="mono pos-earn-cell" data-label="Ganancia">${isDerivative && projectedEarned < 0 ? '' : '+'}${projectedEarnedStr}</td>
      <td class="pos-row-tail${hasComponents ? ' pos-row-tail-grouped' : ''}" data-label="Restante">
        <span class="pos-row-tail-content">
          <span id="position-remaining-${p.id}">${daysDisplay}</span>
          ${
            hasComponents
              ? `
            <button type="button" class="pos-components-summary" data-toggle-components aria-expanded="false" aria-label="Ver desglose de la posicion">
              <span class="pos-components-chevron" aria-hidden="true">▸</span>
              Ver desglose (${p.components!.length})
            </button>
          `
              : ''
          }
        </span>
      </td>
    </tr>
  `;

  if (!hasComponents) return mainRow;

  const componentRows = renderComponentRows(p, options);
  return mainRow + componentRows;
}

function renderComponentRows(parent: DualPosition, options: { showUsdColumn: boolean }): string {
  const components = parent.components!;
  const subscriptionAsset = parent.subscriptionAsset;
  const sorted = [...components].sort((a, b) => {
    const aKey = `${a.entryDate} ${normalizeTime(a.entryTime) ?? '00:00'}`;
    const bKey = `${b.entryDate} ${normalizeTime(b.entryTime) ?? '00:00'}`;
    return bKey.localeCompare(aKey);
  });

  const subRows = sorted
    .map((c) => {
      const tempPos: DualPosition = { ...parent, ...c };
      const cDaysDisplay = formatRemainingTime(tempPos);
      const cEarned = calculateDualProjectedProfit(tempPos);
      const cEarnedStr = formatAmount(cEarned, subscriptionAsset);

      return `
    <tr class="pos-sub-row" hidden data-ignore-row-edit="true">
      <td></td>
      <td class="mono">${formatAmount(c.amount, subscriptionAsset)}</td>
      <td class="mono pos-emphasis">${c.apr.toFixed(2)}%</td>
      ${
        options.showUsdColumn
          ? `<td class="mono pos-usd-cell" id="position-usd-${parent.id}-comp-${c.id}"></td>`
          : ''
      }
      <td class="mono">${c.targetPrice > 0 ? formatCompactNumber(c.targetPrice) : '---'}</td>
      <td class="pos-outcome-cell">${renderOutcomeCell(tempPos)}</td>
      <td class="pos-datetime-cell">${renderDateTimeCell(c.entryDate)}</td>
      <td class="pos-datetime-cell">${renderDateTimeCell(c.settlementDate)}</td>
      <td class="mono pos-earn-cell">+${cEarnedStr}</td>
      <td class="pos-row-tail">
        <span id="position-remaining-${parent.id}-comp-${c.id}">${cDaysDisplay}</span>
      </td>
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

  const rows = resolveOutcomeRows(position);
  return `
    <span class="pos-outcome-stack">
      ${rows
        .map(
          (row) => `
            <span class="pos-outcome-line ${row.changed ? 'pos-outcome-line--change' : ''}">
              <span class="mono pos-outcome-value">${formatAmount(row.amount, row.asset)}</span>
            </span>
          `,
        )
        .join('')}
    </span>
  `;
}

function resolveOutcomeRows(
  position: DualPosition,
): Array<{ label: string; amount: number; asset: string; changed: boolean }> {
  const projectedProfit =
    Number.isFinite(position.projectedProfit) && (position.projectedProfit as number) > 0
      ? (position.projectedProfit as number)
      : calculateDualProjectedProfit(position);

  if (
    position.expectedSettlementAsset &&
    Number.isFinite(position.expectedSettlementAmount) &&
    (position.expectedSettlementAmount as number) > 0
  ) {
    return [
      {
        label: 'Reporta',
        amount: position.expectedSettlementAmount as number,
        asset: position.expectedSettlementAsset,
        changed: position.expectedSettlementAsset !== position.subscriptionAsset,
      },
    ];
  }

  if (position.direction === 'buy-low') {
    const executedAmount = position.targetPrice > 0 ? position.amount / position.targetPrice : 0;
    return [
      { label: 'Ejecuta', amount: executedAmount, asset: position.asset, changed: true },
      {
        label: 'No ejec.',
        amount: position.amount + projectedProfit,
        asset: position.subscriptionAsset,
        changed: false,
      },
    ];
  }

  return [
    {
      label: 'Ejecuta',
      amount: position.amount * position.targetPrice + projectedProfit,
      asset: 'USDT',
      changed: true,
    },
    {
      label: 'No ejec.',
      amount: position.amount + projectedProfit,
      asset: position.subscriptionAsset,
      changed: false,
    },
  ];
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
  if (asset === 'USDT' || asset === 'USDC') {
    return formatUSDCompact(amount).replace('$', '') + ' ' + asset;
  }
  return amount.toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + asset;
}

function formatCompactNumber(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function productLabel(position: DualPosition): string {
  if (position.positionKind === 'derivative' && position.displaySymbol) {
    const side = position.side === 'short' ? 'Short' : 'Long';
    return `${position.displaySymbol} ${side}`;
  }

  if (position.direction === 'sell-high') {
    return `${position.subscriptionAsset}/USDT`;
  }
  return `${position.asset}/${position.subscriptionAsset}`;
}

function productLabelHtml(position: DualPosition): string {
  const label = escapeHtml(productLabel(position));
  const logoAsset =
    position.direction === 'sell-high' ? position.subscriptionAsset : position.asset;

  const sources = resolveAssetLogoSources(logoAsset);
  const monogram = createAssetMonogram(logoAsset);

  const safePrimarySrc = escapeHtml(sources.primarySrc);
  const safeFallbackAttr = sources.fallbackSrc
    ? `data-fallback="${escapeHtml(sources.fallbackSrc)}"`
    : '';
  const safeAlt = escapeHtml(sources.alt);
  const safeMonogram = escapeHtml(monogram);
  return `<span class="pos-pair-cell"><span class="pos-pair-logo-wrap" data-asset-logo-root><img class="pos-pair-logo" data-asset-logo-img src="${safePrimarySrc}" ${safeFallbackAttr} alt="${safeAlt}" loading="lazy" decoding="async"><span class="pos-pair-fallback" data-asset-logo-fallback>${safeMonogram}</span></span>${label}</span>`;
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
      const remainingEl = container.querySelector(
        `#position-remaining-${position.id}`,
      ) as HTMLElement | null;
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

        const cRemainingEl = container.querySelector(
          `#position-remaining-${position.id}-comp-${c.id}`,
        ) as HTMLElement | null;
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
