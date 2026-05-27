import { CAPITAL_COPY } from './capital.constants';
import { formatUSD } from '../utils/calculator';
import { escapeHtml } from '../utils/ui-helpers';
import {
  calculateCapitalLedgerSummary,
  calculateVaultPositionMetrics,
  currentCapitalLedgerValuationDate,
  getCapitalLedgerPortfolioContribution,
  parseCapitalLedgerDate,
  vaultPositionTransactions,
} from '../utils/capital-ledger';
import { iconRefreshCw, iconWallet } from '../utils/icons';
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

function formatDateTime(value: string | number | null | undefined): string {
  const date = typeof value === 'number' ? new Date(value) : parseCapitalLedgerDate(value ?? '');
  if (!date || Number.isNaN(date.getTime())) return String(value ?? '').trim() || '-';
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(
    date.getMonth() + 1,
  )}/${date.getFullYear()}`;
}

function shortAddress(address: string): string {
  if (!address || address.length < 12) return address || '-';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function renderMetric(
  id: string,
  title: string,
  value: string,
  sub: string,
  tone: 'neutral' | 'gain' | 'loss' | 'accent' = 'neutral',
): string {
  const toneClass = tone === 'neutral' ? '' : ` ${tone}`;
  return `
    <article class="stat-card capital-stat-card">
      <div class="card-title">${title}</div>
      <output class="stat-value lg${toneClass}" id="${id}" aria-live="polite">${value}</output>
      <div class="mono text-muted sub-text">${sub}</div>
    </article>
  `;
}

function renderLink(label: string, url: string, className = ''): string {
  const safeLabel = escapeHtml(label || '-');
  if (!url) return `<span class="${className}">${safeLabel}</span>`;
  const safeUrl = escapeHtml(url);
  return `<a class="inline-link ${className}" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
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
  const pnlTone = Number.isFinite(pnl) && (pnl as number) < 0 ? 'text-loss' : 'text-gain';

  return `
    <tr>
      <td>${renderLink(vault.name || shortAddress(vault.vaultAddress), vault.url, 'capital-vault-link')}</td>
      <td class="td-amount mono">${formatNumber(metrics?.activeValue)}</td>
      <td class="td-amount mono">${formatNumber(metrics?.activeCapital)}</td>
      <td class="td-amount mono ${pnlTone}">${formatSignedUSD(pnl)}</td>
      <td class="td-amount mono">${formatPercent(metrics?.activeApr)}</td>
      <td class="td-date mono">${formatDateTime(user?.lockupUntil)}</td>
    </tr>
  `;
}

function renderMovementRow(row: CapitalLedgerTransaction): string {
  const isWithdrawal = row.type === 'withdrawal';
  const amount = Number(row.amount);
  const signedAmount = Number.isFinite(amount) ? (isWithdrawal ? amount : -amount) : null;

  return `
    <tr>
      <td class="td-date mono">${renderLink(formatDateTime(row.at), row.url ?? '')}</td>
      <td>
        <span class="badge ${isWithdrawal ? 'capital-badge-withdrawal' : 'capital-badge-deposit'}">
          ${isWithdrawal ? CAPITAL_COPY.withdrawalLabel : CAPITAL_COPY.depositLabel}
        </span>
      </td>
      <td class="td-amount mono ${isWithdrawal ? 'text-gain' : 'text-loss'}">${formatSignedUSD(signedAmount)}</td>
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

export function renderCapitalTemplate(input: CapitalTemplateInput): string {
  const { ledger } = input;
  const summary = calculateCapitalLedgerSummary(ledger, {
    pnlSourceOfTruth: true,
    useValuationDate: true,
  });
  const contribution = getCapitalLedgerPortfolioContribution(ledger);
  const pnlTone = contribution.pnl < 0 ? 'loss' : contribution.pnl > 0 ? 'gain' : 'neutral';
  const aprTone = contribution.apr === null ? 'neutral' : contribution.apr < 0 ? 'loss' : 'accent';
  const userValue = escapeHtml(ledger.hyperliquid.userAddress);
  const vaultValue = escapeHtml(ledger.hyperliquid.vaultAddress);

  return `
    <section class="section capital-section" aria-labelledby="capital-heading">
      <div class="section-header">
        <div>
          <h2 class="section-title" id="capital-heading">${iconWallet(18)} ${CAPITAL_COPY.title}</h2>
        </div>
        <div class="capital-status" id="capital-status" role="status" aria-live="polite">${escapeHtml(input.statusText)}</div>
      </div>

      <div class="capital-metrics-grid" aria-label="Resumen de capital">
        ${renderMetric('capital-active-value', CAPITAL_COPY.activeValueTitle, formatUSD(summary.activeValue), 'USDC', 'accent')}
        ${renderMetric('capital-net-capital', CAPITAL_COPY.netCapitalTitle, formatUSD(contribution.investedCapital), 'USDC')}
        ${renderMetric('capital-pnl', CAPITAL_COPY.pnlTitle, formatSignedUSD(contribution.pnl), 'USDC', pnlTone)}
        ${renderMetric('capital-apr', CAPITAL_COPY.aprTitle, formatPercent(contribution.apr), 'XIRR anual', aprTone)}
        ${renderMetric('capital-vault-count', CAPITAL_COPY.vaultsTitle, String(contribution.vaultCount), `${contribution.movementCount} mov.`)}
      </div>

      <article class="card capital-controls-card" aria-labelledby="capital-settings-title">
        <div class="card-title mb-md" id="capital-settings-title">${CAPITAL_COPY.settingsTitle}</div>
        <div class="capital-controls-grid">
          <label class="form-group form-group-inline" for="capital-user-address">
            <span>${CAPITAL_COPY.walletLabel}</span>
            <input id="capital-user-address" type="text" autocomplete="off" spellcheck="false" placeholder="0x..." value="${userValue}">
          </label>
          <label class="form-group form-group-inline" for="capital-vault-address">
            <span>${CAPITAL_COPY.vaultLabel}</span>
            <input id="capital-vault-address" type="text" autocomplete="off" spellcheck="false" placeholder="${CAPITAL_COPY.vaultPlaceholder}" value="${vaultValue}">
          </label>
          <button class="btn btn-primary capital-sync-btn" id="capital-sync" type="button" ${input.isSyncing ? 'disabled aria-busy="true"' : ''}>
            ${iconRefreshCw(14)} ${input.isSyncing ? CAPITAL_COPY.statusSyncing : CAPITAL_COPY.syncLabel}
          </button>
        </div>
      </article>

      <article class="card capital-table-card" aria-labelledby="capital-vaults-title">
        <div class="capital-card-head">
          <div class="card-title" id="capital-vaults-title">${CAPITAL_COPY.subscribedVaultsTitle}</div>
          <span class="text-muted mono">${contribution.vaultCount}</span>
        </div>
        <div class="table-container capital-table-wrap">
          <table class="capital-table">
            <thead>
              <tr>${CAPITAL_COPY.vaultHeaders.map((header) => `<th>${header}</th>`).join('')}</tr>
            </thead>
            <tbody id="capital-vaults">${renderVaultRows(ledger)}</tbody>
          </table>
        </div>
      </article>

      <article class="card capital-table-card" aria-labelledby="capital-movements-title">
        <div class="capital-card-head">
          <div class="card-title" id="capital-movements-title">${CAPITAL_COPY.movementsTitle}</div>
          <span class="text-muted mono">${contribution.movementCount}</span>
        </div>
        <div class="table-container capital-table-wrap">
          <table class="capital-table">
            <thead>
              <tr>${CAPITAL_COPY.movementHeaders.map((header) => `<th>${header}</th>`).join('')}</tr>
            </thead>
            <tbody id="capital-movements">${renderMovementRows(ledger)}</tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}
