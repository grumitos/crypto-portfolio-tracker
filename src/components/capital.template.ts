import { CAPITAL_COPY } from './capital.constants';
import { formatUSD } from '../utils/calculator';
import { escapeHtml, joinContextMeta, providerName } from '../utils/ui-helpers';
import {
  calculateCapitalLedgerSummary,
  calculateVaultPositionMetrics,
  currentCapitalLedgerValuationDate,
  getCapitalLedgerPortfolioContribution,
  parseCapitalLedgerDate,
  vaultPositionTransactions,
} from '../utils/capital-ledger';
import { iconRefreshCw } from '../utils/icons';
import type { CapitalLedgerState, CapitalLedgerTransaction, CapitalLedgerVault } from '../types';

export interface CapitalTemplateInput {
  ledger: CapitalLedgerState;
  statusText: string;
  isSyncing: boolean;
}

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactPercentFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

function formatNumber(value: number | null | undefined): string {
  return Number.isFinite(value) ? numberFormatter.format(value as number) : '-';
}

function formatSignedUSD(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '-';
  const amount = value as number;
  if (amount === 0) return formatUSD(0);
  return `${amount > 0 ? '+' : '-'}${formatUSD(Math.abs(amount))}`;
}

function formatPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '-';
  const amount = value as number;
  if (Math.abs(amount) >= 1_000_000) return `${compactPercentFormatter.format(amount)}%`;
  return `${numberFormatter.format(amount)}%`;
}

function resolveDateParts(value: string | number | null | undefined): {
  date: string;
  time: string;
} {
  const date = typeof value === 'number' ? new Date(value) : parseCapitalLedgerDate(value ?? '');
  if (!date || Number.isNaN(date.getTime())) {
    return { date: String(value ?? '').trim() || '-', time: '' };
  }
  const pad = (part: number): string => String(part).padStart(2, '0');
  return {
    date: `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function shortAddress(address: string): string {
  if (!address || address.length < 12) return address || '-';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function renderLink(label: string, url: string): string {
  const safeLabel = escapeHtml(label || '-');
  if (!url) return safeLabel;
  const safeUrl = escapeHtml(url);
  return `<a class="lnk" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
}

function renderDateStack(value: string | number | null | undefined, url = ''): string {
  const { date, time } = resolveDateParts(value);
  const head = url ? renderLink(date, url) : escapeHtml(date);
  return `
    <span class="cell-stack">
      <span class="num">${head}</span>
      ${time ? `<span class="cell-sub">${escapeHtml(time)}</span>` : ''}
    </span>
  `;
}

function renderVaultRow(ledger: CapitalLedgerState, vault: CapitalLedgerVault): string {
  const user = vault.user;
  const valuation = currentCapitalLedgerValuationDate(ledger);
  const metrics = calculateVaultPositionMetrics(
    user,
    vaultPositionTransactions(ledger, vault),
    valuation,
  );
  const pnl = metrics?.activePnl ?? null;
  const pnlTone = Number.isFinite(pnl) && (pnl as number) < 0 ? 'loss' : 'gain';

  return `
    <tr>
      <td>${renderLink(vault.name || shortAddress(vault.vaultAddress), vault.url)}</td>
      <td class="r num">${formatNumber(metrics?.activeValue)}</td>
      <td class="r num soft">${formatNumber(metrics?.activeCapital)}</td>
      <td class="r num ${pnlTone}">${formatSignedUSD(pnl)}</td>
      <td class="r num">${formatPercent(metrics?.activeApr)}</td>
      <td>${renderDateStack(user?.lockupUntil)}</td>
    </tr>
  `;
}

function renderMovementRow(row: CapitalLedgerTransaction): string {
  const isWithdrawal = row.type === 'withdrawal';
  const amount = Number(row.amount);
  const signedAmount = Number.isFinite(amount) ? (isWithdrawal ? amount : -amount) : null;

  return `
    <tr>
      <td>${renderDateStack(row.at, row.url ?? '')}</td>
      <td>
        <span class="chip ${isWithdrawal ? 'chip-sell' : 'chip-buy'}">
          <span class="chip-dot"></span>${isWithdrawal ? CAPITAL_COPY.withdrawalLabel : CAPITAL_COPY.depositLabel}
        </span>
      </td>
      <td class="r num ${isWithdrawal ? 'gain' : 'loss'}">${formatSignedUSD(signedAmount)}</td>
    </tr>
  `;
}

function renderVaultRows(ledger: CapitalLedgerState): string {
  const vaults = [...(ledger.lastSync?.vaults ?? [])].sort((left, right) => {
    const leftEquity = Number(left.user?.vaultEquity ?? 0);
    const rightEquity = Number(right.user?.vaultEquity ?? 0);
    return rightEquity - leftEquity;
  });

  if (vaults.length === 0) {
    return `<tr><td class="empty-row" colspan="6">${CAPITAL_COPY.emptyVaults}</td></tr>`;
  }

  return vaults.map((vault) => renderVaultRow(ledger, vault)).join('');
}

function renderMovementRows(ledger: CapitalLedgerState): string {
  const rows = [...ledger.transactions].sort((left, right) => {
    const leftDate = parseCapitalLedgerDate(left.at)?.getTime() ?? 0;
    const rightDate = parseCapitalLedgerDate(right.at)?.getTime() ?? 0;
    return rightDate - leftDate;
  });

  if (rows.length === 0) {
    return `<tr><td class="empty-row" colspan="3">${CAPITAL_COPY.emptyMovements}</td></tr>`;
  }

  return rows.map(renderMovementRow).join('');
}

function renderColumns(widths: readonly string[]): string {
  return widths.map((width) => `<col style="width:${width}">`).join('');
}

function renderHeaderRow(headers: readonly string[], alignRight: readonly boolean[]): string {
  return headers
    .map(
      (header, index) => `<th scope="col"${alignRight[index] ? ' class="r"' : ''}>${header}</th>`,
    )
    .join('');
}

export function renderCapitalTemplate(input: CapitalTemplateInput): string {
  const { ledger } = input;
  const summary = calculateCapitalLedgerSummary(ledger, {
    pnlSourceOfTruth: true,
    useValuationDate: true,
  });
  const contribution = getCapitalLedgerPortfolioContribution(ledger);
  const pnlTone = contribution.pnl < 0 ? 'loss' : 'gain';
  const userValue = escapeHtml(ledger.hyperliquid.userAddress);
  const vaultValue = escapeHtml(ledger.hyperliquid.vaultAddress);
  const vaultWord = contribution.vaultCount === 1 ? 'vault suscrito' : 'vaults suscritos';

  return `
    <section class="capital-view" aria-labelledby="capital-heading">
      <h2 class="visually-hidden" id="capital-heading">${CAPITAL_COPY.title}</h2>

      <div class="context">
        <div class="context-left">
          <span class="context-title">${CAPITAL_COPY.contextTitle}</span>
          <span class="context-sep"></span>
          <span class="context-meta">${joinContextMeta([providerName(CAPITAL_COPY.contextMetaPrefix), `${contribution.vaultCount} ${vaultWord}`])}</span>
        </div>
        <div class="context-actions">
          <span class="chip">
            <span class="chip-dot" style="background:var(--gain)"></span>
            <span id="capital-status" role="status" aria-live="polite">${escapeHtml(input.statusText)}</span>
          </span>
        </div>
      </div>

      <section class="hero hero-solo">
        <div class="hero-main">
          <span class="label">${CAPITAL_COPY.activeValueTitle}</span>
          <output class="hero-figure" id="capital-active-value" aria-live="polite">${formatUSD(summary.activeValue)}</output>
          <div class="hero-delta">
            <output class="${pnlTone}" id="capital-pnl" aria-live="polite">${formatSignedUSD(contribution.pnl)}</output>
            <span class="hero-delta-sep"></span>
            <span class="muted">${CAPITAL_COPY.pnlContext}</span>
          </div>
        </div>
      </section>

      <div class="rail rail-4" aria-label="Resumen de capital">
        <div class="rail-item">
          <span class="label">${CAPITAL_COPY.netCapitalTitle}</span>
          <span class="rail-value" id="capital-net-capital">${formatUSD(contribution.investedCapital)}</span>
          <span class="rail-sub">${CAPITAL_COPY.netCapitalSub}</span>
        </div>
        <div class="rail-item">
          <span class="label">${CAPITAL_COPY.aprTitle}</span>
          <span class="rail-value" id="capital-apr">${formatPercent(contribution.apr)}</span>
          <span class="rail-sub">${CAPITAL_COPY.aprSub}</span>
        </div>
        <div class="rail-item">
          <span class="label">${CAPITAL_COPY.vaultsTitle}</span>
          <span class="rail-value" id="capital-vault-count">${contribution.vaultCount}</span>
          <span class="rail-sub">${CAPITAL_COPY.vaultsSub}</span>
        </div>
        <div class="rail-item">
          <span class="label">${CAPITAL_COPY.movementsCountTitle}</span>
          <span class="rail-value" id="capital-movement-count">${contribution.movementCount}</span>
          <span class="rail-sub">${CAPITAL_COPY.movementsCountSub}</span>
        </div>
      </div>

      <section class="block split">
        <div>
          <div class="table-head">
            <span class="table-title" id="capital-vaults-title">${CAPITAL_COPY.subscribedVaultsTitle}</span>
            <span class="block-note">${CAPITAL_COPY.subscribedVaultsNote}</span>
          </div>
          <div class="table-scroll">
            <table class="tbl tbl-dense tbl-fixed capital-vaults-table" aria-labelledby="capital-vaults-title">
              <colgroup>${renderColumns(CAPITAL_COPY.vaultColumnWidths)}</colgroup>
              <thead>
                <tr>${renderHeaderRow(CAPITAL_COPY.vaultHeaders, CAPITAL_COPY.vaultHeaderAlign)}</tr>
              </thead>
              <tbody id="capital-vaults">${renderVaultRows(ledger)}</tbody>
            </table>
          </div>
        </div>

        <div>
          <div class="table-head">
            <span class="table-title" id="capital-movements-title">${CAPITAL_COPY.movementsTitle}</span>
            <span class="block-note">${contribution.movementCount} registros · capital neto <span class="num">${formatUSD(contribution.investedCapital)}</span></span>
          </div>
          <div class="table-scroll">
            <table class="tbl tbl-dense tbl-fixed" aria-labelledby="capital-movements-title">
              <colgroup>${renderColumns(CAPITAL_COPY.movementColumnWidths)}</colgroup>
              <thead>
                <tr>${renderHeaderRow(CAPITAL_COPY.movementHeaders, CAPITAL_COPY.movementHeaderAlign)}</tr>
              </thead>
              <tbody id="capital-movements">${renderMovementRows(ledger)}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="block" aria-labelledby="capital-settings-title">
        <div class="table-head">
          <span class="table-title" id="capital-settings-title">${providerName('Hyperliquid', CAPITAL_COPY.connectionTitle)}</span>
          <span class="block-note">${CAPITAL_COPY.connectionNote}</span>
        </div>
        <div class="rule"></div>
        <div class="connbar">
          <div class="field">
            <label class="field-label" for="capital-user-address">${CAPITAL_COPY.walletLabel}</label>
            <input class="input" id="capital-user-address" type="text" autocomplete="off" spellcheck="false" placeholder="0x..." value="${userValue}">
          </div>
          <div class="field">
            <label class="field-label" for="capital-vault-address">
              ${CAPITAL_COPY.vaultLabel} <span class="muted capital-optional">${CAPITAL_COPY.vaultLabelOptional}</span>
            </label>
            <input class="input" id="capital-vault-address" type="text" autocomplete="off" spellcheck="false" placeholder="${CAPITAL_COPY.vaultPlaceholder}" value="${vaultValue}">
          </div>
          <button class="btn btn-sm" id="capital-sync" type="button" ${input.isSyncing ? 'disabled aria-busy="true"' : ''}>
            ${iconRefreshCw(13)} ${input.isSyncing ? CAPITAL_COPY.statusSyncing : CAPITAL_COPY.syncLabel}
          </button>
        </div>
      </section>
    </section>
  `;
}
