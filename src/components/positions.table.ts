import { formatDateLatin, formatUSD } from '../utils/calculator';
import {
  calculateDualElapsedBilledDays,
  calculateDualProjectedBilledDays,
  calculateDualProjectedProfit,
  isDualSettlementReached,
  normalizeTime,
  resolveDualSettlementAt,
} from '../utils/dual-yield';
import { iconTrash } from '../utils/icons';
import { ONE_DAY_MS, ONE_MINUTE_MS, ONE_SECOND_MS } from '../utils/constants';
import { resolveAssetLogoSources, createAssetMonogram } from '../utils/asset-logos';
import { escapeHtml } from '../utils/ui-helpers';
import type { DualPosition } from '../types';

export function renderPositionGroup(title: string, positions: DualPosition[]): string {
  const isBuyLow = title === 'Buy Low';
  const safeTitle = escapeHtml(title);
  const groupSummary = `${positions.length} posicion${positions.length > 1 ? 'es' : ''}`;
  return `
    <div class="card positions-group-card">
      <div class="flex-between positions-group-head">
        <div class="card-title form-group-inline">
          <span class="badge ${isBuyLow ? 'badge-buy' : 'badge-sell'}">${safeTitle}</span>
          <span class="positions-group-count text-muted sub-text">${groupSummary}</span>
        </div>
      </div>
      <div class="table-container">
        <table class="positions-table" aria-label="Tabla de posiciones ${safeTitle}">
          <caption class="visually-hidden">
            ${safeTitle}: ${groupSummary}
          </caption>
          <colgroup>
            <col class="col-pos-asset">
            <col class="col-pos-amount">
            <col class="col-pos-apr">
            <col class="col-pos-usd">
            <col class="col-pos-target">
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
              <th scope="col">Equiv. USD</th>
              <th scope="col">Target</th>
              <th scope="col">Suscripción</th>
              <th scope="col">Liquidación</th>
              <th scope="col">Ganancia (Venc.)</th>
              <th scope="col">Restante</th>
            </tr>
          </thead>
          <tbody>
            ${positions.map((p) => renderPositionRow(p)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPositionRow(p: DualPosition): string {
  const daysDisplay = formatRemainingTime(p);
  const projectedEarned = calculateDualProjectedProfit(p);
  const projectedEarnedStr = formatAmount(projectedEarned, p.subscriptionAsset);
  const hasComponents = p.components && p.components.length > 1;
  const label = productLabel(p);

  const mainRow = `
    <tr data-id="${p.id}" ${hasComponents ? 'class="pos-row-grouped"' : ''}>
      <td data-label="Activo">
        <span class="pos-product-label">${productLabelHtml(p)}</span>
      </td>
      <td class="mono" data-label="Monto">${formatAmount(p.amount, p.subscriptionAsset)}</td>
      <td class="mono pos-emphasis" data-label="APR">${p.apr.toFixed(2)}%</td>
      <td class="mono" id="position-usd-${p.id}" data-label="Equiv. USD">
        <span class="skeleton skeleton-number" style="width:60px"></span>
      </td>
      <td class="mono" data-label="Target">${p.targetPrice > 0 ? p.targetPrice.toLocaleString() : '---'}</td>
      <td class="text-secondary pos-datetime-cell" data-label="Suscripción">${renderDateTimeCell(p.entryDate, p.entryTime)}</td>
      <td class="text-secondary pos-datetime-cell" data-label="Liquidación">${renderDateTimeCell(p.settlementDate, p.settlementTime)}</td>
      <td class="mono text-gain pos-earn-cell" data-label="Ganancia">+${projectedEarnedStr}</td>
      <td class="pos-row-tail${hasComponents ? ' pos-row-tail-grouped' : ''}" data-label="Restante">
        <span class="pos-row-tail-content">
          <span id="position-remaining-${p.id}">${daysDisplay}</span>
          ${
            hasComponents
              ? `
            <button type="button" class="pos-components-summary mono" data-toggle-components aria-expanded="false" aria-label="Ver desglose de ${label}">
              <span class="pos-components-chevron" aria-hidden="true">▸</span>
              Ver desglose (${p.components!.length})
            </button>
          `
              : ''
          }
        </span>
        <span class="pos-row-actions">
          <button type="button" class="btn btn-sm btn-danger btn-del-pos" data-id="${p.id}" title="Eliminar ${label}" aria-label="Eliminar posición ${label}">${iconTrash(13)}</button>
        </span>
      </td>
    </tr>
  `;

  if (!hasComponents) return mainRow;

  const componentRows = renderComponentRows(p);
  return mainRow + componentRows;
}

function renderComponentRows(parent: DualPosition): string {
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
      <td class="mono" id="position-usd-${parent.id}-comp-${c.id}"></td>
      <td class="mono">${c.targetPrice > 0 ? c.targetPrice.toLocaleString() : '---'}</td>
      <td class="text-secondary pos-datetime-cell">${renderDateTimeCell(c.entryDate, c.entryTime)}</td>
      <td class="text-secondary pos-datetime-cell">${renderDateTimeCell(c.settlementDate, c.settlementTime)}</td>
      <td class="mono text-gain pos-earn-cell">+${cEarnedStr}</td>
      <td class="pos-row-tail">
        <span id="position-remaining-${parent.id}-comp-${c.id}">${cDaysDisplay}</span>
      </td>
    </tr>
    `;
    })
    .join('');

  return subRows;
}

function formatRemainingTime(position: DualPosition): string {
  const remainingMs = getRemainingMsToSettlement(position);
  const isSettled = isDualSettlementReached(position);

  if (isSettled) {
    return '<span class="mono text-muted">Liquidada</span>';
  }

  if (Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs < ONE_MINUTE_MS) {
    const totalSecondsRemaining = Math.max(1, Math.ceil(remainingMs / ONE_SECOND_MS));
    return `<span class="mono text-accent">${totalSecondsRemaining}s</span>`;
  }

  if (Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs < ONE_DAY_MS) {
    const totalMinutesRemaining = Math.max(1, Math.ceil(remainingMs / ONE_MINUTE_MS));
    const hours = Math.floor(totalMinutesRemaining / 60);
    const minutes = totalMinutesRemaining % 60;
    const minutesLabel = String(minutes).padStart(2, '0');
    return `<span class="mono text-accent">${hours}h ${minutesLabel}m</span>`;
  }

  if (Number.isFinite(remainingMs) && remainingMs > 0) {
    const totalHours = Math.floor(remainingMs / (60 * ONE_MINUTE_MS));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const colorClass = days < 1 ? 'text-accent' : '';
    const label = hours > 0 ? `${days}d ${hours}h` : `${days > 0 ? days : 1}d`;
    return `<span class="mono ${colorClass}">${label}</span>`;
  }

  // Fallback for edge cases where settlement timestamp cannot be resolved.
  const totalDaysRaw = calculateDualProjectedBilledDays(position);
  const elapsedRaw = calculateDualElapsedBilledDays(position);
  const remainingDaysFallback = Math.max(0, totalDaysRaw - elapsedRaw);
  if (remainingDaysFallback > 0) {
    const roundedRemainingDays = Math.max(1, Math.ceil(remainingDaysFallback));
    const colorClass = roundedRemainingDays <= 1 ? 'text-accent' : '';
    return `<span class="mono ${colorClass}">${roundedRemainingDays}d</span>`;
  }

  return '<span class="mono text-muted">---</span>';
}

function getRemainingMsToSettlement(position: DualPosition): number {
  const settlementAt = resolveDualSettlementAt(position);
  return settlementAt ? settlementAt.getTime() - Date.now() : NaN;
}

function isSubMinuteCountdown(position: DualPosition): boolean {
  const remainingMs = getRemainingMsToSettlement(position);
  return Number.isFinite(remainingMs) && remainingMs > 0 && remainingMs < ONE_MINUTE_MS;
}

function renderDateTimeCell(date: string, time?: string): string {
  const parts = [`<span class="pos-date-value">${escapeHtml(formatDateLatin(date))}</span>`];
  const normalizedTime = normalizeTime(time);
  if (normalizedTime) {
    parts.push(`<span class="pos-time-value mono">${escapeHtml(normalizedTime)}</span>`);
  }
  return parts.join('');
}

function formatAmount(amount: number, asset: string): string {
  if (asset === 'USDT' || asset === 'USDC') {
    return formatUSD(amount).replace('$', '') + ' ' + asset;
  }
  return amount.toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + asset;
}

function productLabel(position: DualPosition): string {
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
  return `<span class="pos-pair-cell"><span class="pos-pair-logo-wrap" data-asset-logo-root><img class="pos-pair-logo" data-asset-logo-img src="${safePrimarySrc}" ${safeFallbackAttr} alt="${safeAlt}" loading="lazy" decoding="async"><span class="pos-pair-fallback mono" data-asset-logo-fallback>${safeMonogram}</span></span>${label}</span>`;
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
