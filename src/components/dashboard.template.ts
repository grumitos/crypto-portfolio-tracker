import { formatDateLatin, formatPct, formatUSD } from '../utils/calculator';
import { escapeHtml, skeletonSpan } from '../utils/ui-helpers';
import { iconWallet } from '../utils/icons';
import {
  bindAssetLogoFallbacks,
  createAssetMonogram,
  resolveAssetLogoSources,
} from '../utils/asset-logos';
import type { BinanceAccountBalance } from '../types';
import {
  DASHBOARD_BALANCE_DECIMALS_LARGE,
  DASHBOARD_BALANCE_DECIMALS_MEDIUM,
  DASHBOARD_BALANCE_DECIMALS_SMALL,
  DASHBOARD_BALANCE_LOADING_CARD_COUNT,
  DASHBOARD_COPY,
} from './dashboard.constants';

export interface DashboardTemplateInput {
  balance: number;
  goalAmount: number;
  invested: number;
  lastUpdatedIso: string;
  positionsCount: number;
  autoModeEnabled: boolean;
  hasApiCredentials: boolean;
  firstMilestonePct: number;
  secondMilestonePct: number;
  progressFill: number;
}

export function formatBalanceAmount(amount: number): string {
  if (amount < 1) return amount.toFixed(DASHBOARD_BALANCE_DECIMALS_SMALL);
  if (amount < 100) return amount.toFixed(DASHBOARD_BALANCE_DECIMALS_MEDIUM);
  return amount.toFixed(DASHBOARD_BALANCE_DECIMALS_LARGE);
}

export function getDashboardBalanceKey(
  balance: Pick<BinanceAccountBalance, 'asset' | 'source'>,
): string {
  return `${balance.asset.trim().toUpperCase()}:${balance.source?.trim() ?? ''}`;
}

function renderBalanceItem(balance: BinanceAccountBalance): string {
  const total = balance.free + balance.locked;
  const safeBalanceKey = escapeHtml(getDashboardBalanceKey(balance));
  const sources = resolveAssetLogoSources(balance.asset);
  const monogram = createAssetMonogram(balance.asset);
  const safePrimaryAttr = sources.primarySrc ? `src="${escapeHtml(sources.primarySrc)}"` : '';
  const safeFallbackAttr = sources.fallbackSrcs.length
    ? `data-fallbacks="${escapeHtml(JSON.stringify(sources.fallbackSrcs))}"`
    : '';
  const safeAlt = escapeHtml(sources.alt);
  const safeMonogram = escapeHtml(monogram);
  const safeAsset = escapeHtml(balance.asset);
  const safeSource = balance.source ? escapeHtml(balance.source) : '';

  return `
    <article class="dashboard-balance-entry" data-balance-key="${safeBalanceKey}">
      <div class="dashboard-balance-entry-top">
        <div class="dashboard-balance-entry-main">
          <span class="dashboard-balance-logo-wrap" data-asset-logo-root>
            <img class="dashboard-balance-logo" data-asset-logo-img ${safePrimaryAttr} ${safeFallbackAttr} alt="${safeAlt}" loading="lazy" decoding="async">
            <span class="dashboard-balance-fallback" data-asset-logo-fallback>${safeMonogram}</span>
          </span>
          <span class="dashboard-balance-card-meta">
            <span class="dashboard-balance-asset">${safeAsset}</span>
            ${safeSource ? `<span class="dashboard-balance-source">${safeSource}</span>` : ''}
          </span>
        </div>
        <div class="dashboard-balance-total">
          <span class="dashboard-balance-total-label">Total</span>
          <span class="dashboard-balance-total-value mono">${formatBalanceAmount(total)} ${safeAsset}</span>
        </div>
      </div>
      <dl class="dashboard-balance-breakdown">
        <div class="dashboard-balance-breakdown-row">
          <dt class="dashboard-balance-breakdown-label">${DASHBOARD_COPY.freeLabel}</dt>
          <dd class="dashboard-balance-breakdown-value mono">${formatBalanceAmount(balance.free)}</dd>
        </div>
        <div class="dashboard-balance-breakdown-row${balance.locked > 0 ? ' is-locked' : ''}">
          <dt class="dashboard-balance-breakdown-label">${DASHBOARD_COPY.lockedLabel}</dt>
          <dd class="dashboard-balance-breakdown-value mono">${formatBalanceAmount(balance.locked)}</dd>
        </div>
      </dl>
    </article>
  `;
}

export function renderBalanceLoadingCards(count = DASHBOARD_BALANCE_LOADING_CARD_COUNT): string {
  return Array.from(
    { length: count },
    () => `
    <article class="dashboard-balance-entry is-loading" aria-hidden="true">
      <div class="dashboard-balance-entry-top">
        <div class="dashboard-balance-entry-main">
          <span class="dashboard-balance-logo-wrap">
            <span class="dashboard-balance-fallback skeleton" style="display:inline-flex;width:24px;height:24px"></span>
          </span>
          <span class="dashboard-balance-card-meta">
            <span class="skeleton skeleton-text" style="width:44px"></span>
          </span>
        </div>
        <div class="dashboard-balance-total">
          <span class="skeleton skeleton-text" style="width:34px"></span>
          <span class="skeleton skeleton-number" style="width:110px"></span>
        </div>
      </div>
      <div class="dashboard-balance-breakdown">
        <span class="dashboard-balance-breakdown-row">
          <span class="skeleton skeleton-text" style="width:36px"></span>
          <span class="skeleton skeleton-text" style="width:76px"></span>
        </span>
        <span class="dashboard-balance-breakdown-row">
          <span class="skeleton skeleton-text" style="width:36px"></span>
          <span class="skeleton skeleton-text" style="width:76px"></span>
        </span>
      </div>
    </article>
  `,
  ).join('');
}

export function renderBalanceEmptyState(): string {
  return `
    <div class="dashboard-balance-empty" role="status">
      <span class="dashboard-balance-empty-title">${DASHBOARD_COPY.emptyBalancesTitle}</span>
      <span class="dashboard-balance-empty-copy">${DASHBOARD_COPY.emptyBalancesCopy}</span>
    </div>
  `;
}

export function renderBalanceDetailCards(
  container: HTMLElement,
  balances: BinanceAccountBalance[],
): void {
  container.innerHTML = balances.map((balance) => renderBalanceItem(balance)).join('');
  bindAssetLogoFallbacks(container);
}

export function renderDashboardTemplate(input: DashboardTemplateInput): string {
  const loss = input.balance - input.invested;
  const lossPct = input.invested > 0 ? (loss / input.invested) * 100 : 0;
  const remaining = Math.max(0, input.goalAmount - input.balance);

  return `
    <section class="section dashboard-section" aria-labelledby="dashboard-heading">
      <h2 class="visually-hidden" id="dashboard-heading">${DASHBOARD_COPY.sectionTitle}</h2>

      <div class="grid-3 dashboard-summary-grid">
        <article class="card dashboard-card" aria-labelledby="dash-invested-title">
          <div class="card-title" id="dash-invested-title">${DASHBOARD_COPY.investedTitle}</div>
          <output class="big-number" id="dash-invested" aria-live="polite">${formatUSD(input.invested)}</output>
        </article>
        <article class="card dashboard-card" aria-labelledby="dash-balance-title">
          <div class="card-title" id="dash-balance-title">${DASHBOARD_COPY.balanceTitle}</div>
          <output class="big-number accent" id="dash-balance" aria-live="polite">${formatUSD(input.balance)}</output>
          <div class="mono text-muted sub-text" id="dash-balance-date">${formatDateLatin(input.lastUpdatedIso)}</div>
        </article>
        <article class="card dashboard-card" aria-labelledby="dash-pnl-title">
          <div class="card-title" id="dash-pnl-title">${DASHBOARD_COPY.pnlTitle}</div>
          <output class="big-number ${loss >= 0 ? 'gain' : 'loss'}" id="dash-pnl" aria-live="polite">${formatUSD(loss)}</output>
          <div id="dash-pnl-pct" class="mono sub-text ${loss >= 0 ? 'text-gain' : 'text-loss'}">${formatPct(lossPct)}</div>
        </article>
      </div>

      <article class="card dashboard-card dashboard-goal-card" aria-labelledby="dashboard-goal-title">
        <div class="card-title" id="dashboard-goal-title">${DASHBOARD_COPY.goalTitle}</div>
        <div class="goal-progress-head">
          <output class="mono goal-progress-value" id="dash-prog-current" aria-live="polite">${formatUSD(input.balance)}</output>
          <span class="text-secondary goal-progress-value goal-progress-target" id="dash-prog-target">
            <span class="goal-progress-target-label" id="dash-prog-target-label">${DASHBOARD_COPY.defaultGoalLabel}</span>
            <output class="mono goal-progress-target-amount" id="dash-prog-target-amount" aria-live="polite">${formatUSD(input.goalAmount)}</output>
          </span>
        </div>
        <div
          class="progress-bar goal-progress-bar mode-both"
          id="dash-goal-progress-bar"
          role="progressbar"
          aria-label="${DASHBOARD_COPY.progressRegionLabel}"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${Math.round(input.progressFill)}"
        >
          <div class="goal-progress-zone-muted breakeven zone-first" id="dash-prog-muted-first" style="width:${input.firstMilestonePct}%"></div>
          <div class="goal-progress-zone-muted goal zone-second" id="dash-prog-muted-second" style="left:${input.firstMilestonePct}%;width:${Math.max(0, input.secondMilestonePct - input.firstMilestonePct)}%"></div>
          <div class="goal-progress-zone breakeven zone-first" id="dash-prog-solid-first" style="width:${Math.min(input.progressFill, input.firstMilestonePct)}%"></div>
          <div class="goal-progress-zone goal zone-second" id="dash-prog-solid-second" style="left:${input.firstMilestonePct}%;width:${Math.max(0, Math.min(input.progressFill, input.secondMilestonePct) - input.firstMilestonePct)}%"></div>
        </div>
        <div class="goal-progress-foot">
          <div class="text-secondary goal-progress-remaining" id="dash-prog-remaining" aria-live="polite">
            <span id="dash-prog-remaining-text">${DASHBOARD_COPY.remainingText}</span>
            <output class="mono" id="dash-prog-remaining-amount">${formatUSD(remaining)}</output>
            <span id="dash-prog-remaining-prefix">${DASHBOARD_COPY.remainingPrefix}</span>
            <span id="dash-prog-remaining-target">${DASHBOARD_COPY.goalTargetText}</span>
          </div>
          <div class="goal-progress-meta" aria-label="Controles de progreso">
            <button type="button" class="goal-progress-legend is-active" id="dashboard-legend-be" data-legend="be" aria-pressed="true" aria-controls="dash-goal-progress-bar">
              <span class="goal-progress-dot breakeven" aria-hidden="true"></span>${DASHBOARD_COPY.breakEvenLegend}
            </button>
            <button type="button" class="goal-progress-legend is-active" id="dashboard-legend-goal" data-legend="goal" aria-pressed="true" aria-controls="dash-goal-progress-bar">
              <span class="goal-progress-dot goal" aria-hidden="true"></span>${DASHBOARD_COPY.goalLegend}
            </button>
            <span class="text-muted goal-progress-sep" id="dashboard-days-sep">/</span>
            <output class="mono" id="dashboard-days" aria-live="polite" aria-label="${DASHBOARD_COPY.etaLabel}">${skeletonSpan('72px')}</output>
          </div>
        </div>
      </article>

      <div class="grid-4 dashboard-metrics-grid" aria-label="Métricas del portfolio">
        <article class="stat-card dashboard-stat-card" data-shared-card="apr">
          <div class="card-title">${DASHBOARD_COPY.averageAprTitle}</div>
          <output class="stat-value" id="dashboard-apr" aria-live="polite">${skeletonSpan('70px')}</output>
        </article>
        <article class="stat-card dashboard-stat-card" data-shared-card="capital">
          <div class="card-title">${DASHBOARD_COPY.capitalTitle}</div>
          <output class="stat-value" id="dashboard-capital" aria-live="polite">${skeletonSpan('90px')}</output>
        </article>
        <article class="stat-card dashboard-stat-card" data-shared-card="daily">
          <div class="card-title">${DASHBOARD_COPY.dailyRunRateTitle}</div>
          <output class="stat-value" id="dashboard-daily" aria-live="polite">${skeletonSpan('70px')}</output>
        </article>
        <article class="stat-card dashboard-stat-card" data-shared-card="positions">
          <div class="card-title">${DASHBOARD_COPY.activePositionsTitle}</div>
          <output class="stat-value">${input.positionsCount}</output>
        </article>
      </div>

      ${
        input.autoModeEnabled && input.hasApiCredentials
          ? `
      <section class="dashboard-balance-panel" id="dashboard-balance-strip" hidden aria-labelledby="dashboard-balance-strip-title">
        <div class="dashboard-balance-panel-head">
          <div>
            <span class="dashboard-balance-panel-title" id="dashboard-balance-strip-title">${iconWallet(14)} ${DASHBOARD_COPY.accountBalanceTitle}</span>
            <p class="dashboard-balance-panel-copy">${DASHBOARD_COPY.accountBalanceCopy}</p>
          </div>
          <span class="dashboard-balance-panel-badge">${DASHBOARD_COPY.accountBalanceBadge}</span>
        </div>
        <div class="dashboard-balance-panel-grid" id="dashboard-balance-strip-items" aria-live="polite">
          ${renderBalanceLoadingCards()}
        </div>
      </section>
      `
          : ''
      }
    </section>
  `;
}
