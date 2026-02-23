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
import type { DualPosition } from '../types';

export function renderPositionGroup(title: string, positions: DualPosition[]): string {
  const isBuyLow = title === 'Buy Low';
  return `
    <div class="card">
      <div class="flex-between" style="margin-bottom:var(--space-md)">
        <div class="card-title" style="margin-bottom:0">
          <span class="badge ${isBuyLow ? 'badge-buy' : 'badge-sell'}">${title}</span>
          <span class="text-muted" style="margin-left:var(--space-sm);font-size:0.75rem">${positions.length} posicion${positions.length > 1 ? 'es' : ''}</span>
        </div>
      </div>
      <div class="table-container">
        <table class="positions-table">
          <colgroup>
            <col style="width:11%">
            <col style="width:15%">
            <col style="width:8%">
            <col style="width:11%">
            <col style="width:8%">
            <col style="width:11%">
            <col style="width:11%">
            <col style="width:14%">
            <col style="width:11%">
          </colgroup>
          <thead>
            <tr>
              <th>Activo</th>
              <th>Monto</th>
              <th>APR</th>
              <th>Equiv. USD</th>
              <th>Target</th>
              <th>Suscripcion</th>
              <th>Liquidación</th>
              <th>Ganancia (Venc.)</th>
              <th>Restante</th>
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

  return `
    <tr data-id="${p.id}">
      <td data-label="Activo">
        <span style="font-weight:500;color:var(--text-primary)">${productLabelHtml(p)}</span>
      </td>
      <td class="mono" data-label="Monto">${formatAmount(p.amount, p.subscriptionAsset)}</td>
      <td class="mono" style="font-weight:500" data-label="APR">${p.apr.toFixed(2)}%</td>
      <td class="mono" id="position-usd-${p.id}" data-label="Equiv. USD">
        <span class="skeleton skeleton-number" style="width:60px"></span>
      </td>
      <td class="mono" data-label="Target">${p.targetPrice > 0 ? p.targetPrice.toLocaleString() : '---'}</td>
      <td class="text-secondary pos-datetime-cell" data-label="Suscripcion">${renderDateTimeCell(p.entryDate, p.entryTime)}</td>
      <td class="text-secondary pos-datetime-cell" data-label="Liquidación">${renderDateTimeCell(p.settlementDate, p.settlementTime)}</td>
      <td class="mono text-gain pos-earn-cell" data-label="Ganancia">+${projectedEarnedStr}</td>
      <td class="pos-row-tail" data-label="Restante">
        <span id="position-remaining-${p.id}">${daysDisplay}</span>
        <span class="pos-row-actions">
          <button class="btn btn-sm btn-danger btn-del-pos" data-id="${p.id}" title="Eliminar">${iconTrash(13)}</button>
        </span>
      </td>
    </tr>
  `;
}

function formatRemainingTime(position: DualPosition): string {
  const remainingMs = getRemainingMsToSettlement(position);
  const isSettled = isDualSettlementReached(position);
  const totalDays = calculateDualProjectedBilledDays(position);
  const elapsed = calculateDualElapsedBilledDays(position);
  const remaining = Math.max(0, totalDays - elapsed);

  if (isSettled) {
    return `<span class="mono text-muted">Liquidada</span>`;
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

  const dayNum = Math.max(0, Math.min(elapsed, totalDays));
  const colorClass = remaining <= 1 ? 'text-accent' : '';
  return `<span class="mono ${colorClass}">${dayNum}d</span><span class="text-muted" style="font-size:0.7rem;margin-left:2px">/ ${totalDays}d</span>`;
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
  const parts = [`<span class="pos-date-value">${formatDateLatin(date)}</span>`];
  const normalizedTime = normalizeTime(time);
  if (normalizedTime) {
    parts.push(`<span class="pos-time-value mono">${normalizedTime}</span>`);
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
  const label = productLabel(position);
  const logoAsset = position.direction === 'sell-high'
    ? position.subscriptionAsset
    : position.asset;

  const sources = resolveAssetLogoSources(logoAsset);
  const monogram = createAssetMonogram(logoAsset);

  return `<span class="pos-pair-cell"><span class="pos-pair-logo-wrap"><img class="pos-pair-logo" src="${sources.primarySrc}" ${sources.fallbackSrc ? `data-fallback="${sources.fallbackSrc}"` : ''} alt="${sources.alt}" loading="lazy" decoding="async" onerror="this.dataset.fallback?(this.src=this.dataset.fallback,delete this.dataset.fallback):(this.style.display='none',this.nextElementSibling.style.display='inline-flex')"><span class="pos-pair-fallback mono" style="display:none">${monogram}</span></span>${label}</span>`;
}

export function updateRemainingTimesInPlace(container: HTMLElement, positions: DualPosition[]): boolean {
  let hasSubMinuteCountdown = false;
  positions.forEach((position) => {
    const remainingEl = container.querySelector(`#position-remaining-${position.id}`) as HTMLElement | null;
    if (!remainingEl) return;
    if (isSubMinuteCountdown(position)) hasSubMinuteCountdown = true;
    const nextHtml = formatRemainingTime(position);
    if (remainingEl.innerHTML === nextHtml) return;
    remainingEl.innerHTML = nextHtml;
  });
  return hasSubMinuteCountdown;
}

export function formatTimeHHMM(value: Date): string {
  const h = String(value.getHours()).padStart(2, '0');
  const m = String(value.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
