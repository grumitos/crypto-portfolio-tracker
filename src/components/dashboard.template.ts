import { formatDateLatin, formatPct, formatUSD, formatUSDCompact } from '../utils/calculator';
import { escapeHtml, providerName, skeletonSpan } from '../utils/ui-helpers';
import {
  bindAssetLogoFallbacks,
  createAssetMonogram,
  resolveAssetLogoSources,
} from '../utils/asset-logos';
import type { BinanceAccountBalance, DashboardGoalMode, ExchangeSource } from '../types';
import type { WalletIssue } from '../utils/binance-client';
import {
  DASHBOARD_BALANCE_DECIMALS_LARGE,
  DASHBOARD_BALANCE_DECIMALS_MEDIUM,
  DASHBOARD_BALANCE_DECIMALS_SMALL,
  DASHBOARD_BALANCE_LOADING_ROW_COUNT,
  DASHBOARD_COPY,
  PROGRESS_TICK_EDGE_PCT,
  PROGRESS_TICK_MIN_SEPARATION_PCT,
} from './dashboard.constants';

export interface DashboardTemplateInput {
  balance: number;
  goalAmount: number;
  invested: number;
  lastUpdatedIso: string;
  positionsCount: number;
  connectedExchanges: ExchangeSource[];
  firstMilestonePct: number;
  secondMilestonePct: number;
  progressFill: number;
  isLoading?: boolean;
}

export function formatBalanceAmount(amount: number): string {
  if (amount < 1) return amount.toFixed(DASHBOARD_BALANCE_DECIMALS_SMALL);
  if (amount < 100) return amount.toFixed(DASHBOARD_BALANCE_DECIMALS_MEDIUM);
  return amount.toFixed(DASHBOARD_BALANCE_DECIMALS_LARGE);
}

/** Fuentes que alimentan una fila, deduplicadas y en orden estable. */
export function resolveBalanceSources(
  balance: Pick<BinanceAccountBalance, 'source' | 'sources'>,
): ExchangeSource[] {
  const declared = balance.sources?.length
    ? balance.sources
    : balance.source
      ? [balance.source]
      : [];
  return [...new Set(declared)].sort();
}

/** Etiqueta de la columna "Fuente"; vacia cuando el origen es desconocido. */
export function formatBalanceSourceLabel(
  balance: Pick<BinanceAccountBalance, 'source' | 'sources'>,
): string {
  return resolveBalanceSources(balance).join(' + ');
}

export function getDashboardBalanceKey(
  balance: Pick<BinanceAccountBalance, 'asset' | 'source' | 'sources'>,
): string {
  return `${balance.asset.trim().toUpperCase()}:${formatBalanceSourceLabel(balance)}`;
}

export type ProgressTickAlign = 'before' | 'after';

export interface ProgressTickPlacement {
  hidden: boolean;
  pct: number;
  align: ProgressTickAlign;
  stacked: boolean;
  /** Texto de la marca: nombre del hito mas su importe. */
  label: string;
}

export interface ProgressTickLayout {
  be: ProgressTickPlacement;
  goal: ProgressTickPlacement;
}

export interface ProgressTickLayoutInput {
  mode: DashboardGoalMode;
  invested: number;
  goal: number;
  bePct: number;
  goalPct: number;
  isLoading?: boolean;
}

/**
 * La marca nombra su hito y su importe: sin la cifra repetiria literalmente el
 * texto de los chips de la derecha y dejaria de aportar informacion.
 */
export function formatProgressTickLabel(name: string, amount: number): string {
  return Number.isFinite(amount) && amount > 0 ? `${name} ${formatUSDCompact(amount)}` : name;
}

function hiddenTick(label: string): ProgressTickPlacement {
  return { hidden: true, pct: 0, align: 'before', stacked: false, label };
}

function placeTick(pct: number, label: string): ProgressTickPlacement {
  // Pegada al arranque del track la etiqueta no cabe colgando a la izquierda:
  // se saldria del contenedor y pisaria el titulo de la seccion, asi que pasa
  // al otro lado de la marca.
  const align: ProgressTickAlign = pct < PROGRESS_TICK_EDGE_PCT ? 'after' : 'before';
  return { hidden: false, pct, align, stacked: false, label };
}

/** Marca dentro de la franja izquierda que ocupa el titulo de la seccion. */
function isEdgeTick(placement: ProgressTickPlacement): boolean {
  return !placement.hidden && placement.align === 'after';
}

function isMeaningfulMilestone(amount: number, pct: number): boolean {
  return Number.isFinite(amount) && amount > 0 && Number.isFinite(pct) && pct > 0;
}

/**
 * Coloca las marcas de BE y Meta. Unica fuente de verdad: la usan tanto el
 * render inicial de la plantilla como las actualizaciones en runtime, de modo
 * que ambos no puedan divergir.
 */
export function resolveProgressTickLayout(input: ProgressTickLayoutInput): ProgressTickLayout {
  // Sin datos un hito no significa nada, y con escala degenerada (meta o
  // invertido no positivos) las dos marcas caerian en el mismo 0%.
  const showBe =
    input.isLoading !== true &&
    input.mode !== 'goal' &&
    isMeaningfulMilestone(input.invested, input.bePct);
  const showGoal =
    input.isLoading !== true &&
    input.mode !== 'be' &&
    isMeaningfulMilestone(input.goal, input.goalPct);

  const beLabel = formatProgressTickLabel(DASHBOARD_COPY.breakEvenTickName, input.invested);
  const goalLabel = formatProgressTickLabel(DASHBOARD_COPY.goalTickName, input.goal);
  const be = showBe ? placeTick(input.bePct, beLabel) : hiddenTick(beLabel);
  const goal = showGoal ? placeTick(input.goalPct, goalLabel) : hiddenTick(goalLabel);

  const areTooClose = Math.abs(input.goalPct - input.bePct) < PROGRESS_TICK_MIN_SEPARATION_PCT;
  if (showBe && showGoal && areTooClose) {
    // Demasiado juntas para caber lado a lado: en vez de apostar por el ancho
    // real del texto, la marca mas baja se separa en vertical.
    (input.bePct <= input.goalPct ? be : goal).stacked = true;
  }

  return { be, goal };
}

export function progressTickClassName(placement: ProgressTickPlacement): string {
  const classNames = ['progress-tick', placement.align === 'after' ? 'is-after' : 'is-before'];
  if (placement.stacked) classNames.push('is-stacked');
  return classNames.join(' ');
}

export function progressHeadClassName(layout: ProgressTickLayout): string {
  const classNames = ['progress-head'];
  // Con una marca dentro de su franja, el titulo sube a su propia fila para que
  // ni la etiqueta ni la linea guia de esa marca lo crucen.
  if (isEdgeTick(layout.be) || isEdgeTick(layout.goal)) classNames.push('has-edge-tick');
  if (layout.be.stacked || layout.goal.stacked) classNames.push('has-stacked-tick');
  return classNames.join(' ');
}

function applyProgressTick(el: HTMLElement | null, placement: ProgressTickPlacement): void {
  if (!el) return;
  el.className = progressTickClassName(placement);
  el.hidden = placement.hidden;
  el.style.left = `${placement.pct}%`;
  const text = el.querySelector<HTMLElement>('.progress-tick-text');
  if (text) text.textContent = placement.label;
}

/**
 * Red de seguridad del apilado. El umbral en puntos porcentuales no puede saber
 * cuanto miden las etiquetas ni cuanto mide el track: con importes largos y el
 * contenedor estrecho, dos marcas separadas justo por encima del umbral acaban
 * solapando. Medida la caja real, la marca mas baja sube de fila igual que lo
 * haria por porcentaje.
 */
function labelsCollide(beTick: HTMLElement | null, goalTick: HTMLElement | null): boolean {
  const beLabel = beTick?.querySelector<HTMLElement>('.progress-tick-label');
  const goalLabel = goalTick?.querySelector<HTMLElement>('.progress-tick-label');
  if (!beLabel || !goalLabel) return false;

  const be = beLabel.getBoundingClientRect();
  const goal = goalLabel.getBoundingClientRect();
  // Sin layout medible (marca oculta o entorno sin renderizado) manda el umbral.
  if (be.width === 0 || goal.width === 0) return false;
  return be.right > goal.left && goal.right > be.left;
}

export function applyProgressTickLayout(
  head: HTMLElement | null,
  beTick: HTMLElement | null,
  goalTick: HTMLElement | null,
  layout: ProgressTickLayout,
): void {
  applyProgressTick(beTick, layout.be);
  applyProgressTick(goalTick, layout.goal);

  let resolved = layout;
  const canStack =
    !layout.be.hidden && !layout.goal.hidden && !layout.be.stacked && !layout.goal.stacked;
  if (canStack && labelsCollide(beTick, goalTick)) {
    const lower = layout.be.pct <= layout.goal.pct ? 'be' : 'goal';
    resolved = {
      be: { ...layout.be, stacked: lower === 'be' },
      goal: { ...layout.goal, stacked: lower === 'goal' },
    };
    applyProgressTick(beTick, resolved.be);
    applyProgressTick(goalTick, resolved.goal);
  }

  if (head) head.className = progressHeadClassName(resolved);
}

/**
 * La barra de contexto nombra de donde vienen los datos. Sin exchanges no hay
 * fuente que nombrar y el segmento desaparece entero: anunciar la ausencia no
 * aporta nada que la vista vacia no diga ya, y mejor.
 */
function renderContextMeta(connectedExchanges: ExchangeSource[]): string {
  if (connectedExchanges.length === 0) return '';
  return `
          <span class="context-sep"></span>
          <span class="context-meta">${connectedExchanges.map((name) => providerName(name)).join(' · ')}</span>`;
}

/**
 * Nota del bloque de saldos. Con todo leido describe el contenido; si algun
 * monedero se quedo fuera, lo nombra y dice si fue por permiso de la API key o
 * porque el endpoint no respondio: son dos arreglos distintos.
 */
export function formatBalanceNote(issues: WalletIssue[]): string {
  if (issues.length === 0) return DASHBOARD_COPY.accountBalanceCopy;

  return issues
    .map((issue) => {
      const name = DASHBOARD_COPY.walletNames[issue.wallet];
      const reason =
        issue.reason === 'permission'
          ? DASHBOARD_COPY.walletPermissionNote
          : DASHBOARD_COPY.walletUnavailableNote;
      return `${name} ${reason}`;
    })
    .join(' · ');
}

function renderBalanceRow(balance: BinanceAccountBalance): string {
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
  const balanceSources = resolveBalanceSources(balance);
  const sourceHtml = balanceSources.length
    ? balanceSources.map((name) => providerName(name)).join(' + ')
    : '—';

  return `
    <tr class="dashboard-balance-entry" data-balance-key="${safeBalanceKey}">
      <td>
        <span class="asset">
          <span class="asset-logo-wrap" data-asset-logo-root>
            <img class="asset-logo" data-asset-logo-img ${safePrimaryAttr} ${safeFallbackAttr} alt="${safeAlt}" loading="lazy" decoding="async">
            <span class="asset-fallback" data-asset-logo-fallback>${safeMonogram}</span>
          </span>
          <span class="asset-pair">${safeAsset}</span>
        </span>
      </td>
      <td class="muted dashboard-balance-source">${sourceHtml}</td>
      <td class="r"><span class="num soft dashboard-balance-breakdown-value">${formatBalanceAmount(balance.free)}</span></td>
      <td class="r"><span class="num soft dashboard-balance-breakdown-value dashboard-balance-locked${balance.locked > 0 ? ' is-locked' : ''}">${formatBalanceAmount(balance.locked)}</span></td>
      <td class="r"><span class="num dashboard-balance-total-value">${formatBalanceAmount(total)} ${safeAsset}</span></td>
    </tr>
  `;
}

function renderBalanceLoadingRows(count = DASHBOARD_BALANCE_LOADING_ROW_COUNT): string {
  return Array.from(
    { length: count },
    () => `
    <tr class="dashboard-balance-entry is-loading" aria-hidden="true">
      <td>
        <span class="asset">
          <span class="skeleton" style="width:22px;height:22px;border-radius:50%"></span>
          <span class="skeleton skeleton-text" style="width:44px"></span>
        </span>
      </td>
      <td><span class="skeleton skeleton-text" style="width:56px"></span></td>
      <td class="r"><span class="skeleton skeleton-number" style="width:76px"></span></td>
      <td class="r"><span class="skeleton skeleton-number" style="width:76px"></span></td>
      <td class="r"><span class="skeleton skeleton-number" style="width:110px"></span></td>
    </tr>
  `,
  ).join('');
}

export function renderBalanceEmptyState(): string {
  return `
    <tr>
      <td class="empty-row" colspan="5" role="status">
        <span class="empty-title">${DASHBOARD_COPY.emptyBalancesTitle}</span>
        <span class="empty-copy">${DASHBOARD_COPY.emptyBalancesCopy}</span>
      </td>
    </tr>
  `;
}

export function renderBalanceDetailRows(
  container: HTMLElement,
  balances: BinanceAccountBalance[],
): void {
  container.innerHTML = balances.map((balance) => renderBalanceRow(balance)).join('');
  bindAssetLogoFallbacks(container);
}

export function renderDashboardTemplate(input: DashboardTemplateInput): string {
  const loss = input.balance - input.invested;
  const lossPct = input.invested > 0 ? (loss / input.invested) * 100 : 0;
  const remaining = Math.max(0, input.goalAmount - input.balance);
  const isLoading = input.isLoading === true;
  const investedValue = isLoading ? skeletonSpan('110px') : formatUSD(input.invested);
  const balanceValue = isLoading ? skeletonSpan('180px') : formatUSD(input.balance);
  const balanceDateValue = isLoading ? skeletonSpan('82px') : formatDateLatin(input.lastUpdatedIso);
  const pnlValue = isLoading ? skeletonSpan('110px') : formatUSD(loss);
  const pnlPctValue = isLoading ? skeletonSpan('66px') : formatPct(lossPct);
  const progressTargetValue = isLoading ? skeletonSpan('98px') : formatUSD(input.goalAmount);
  const progressRemainingValue = isLoading ? skeletonSpan('98px') : formatUSD(remaining);
  const positionsValue = isLoading ? skeletonSpan('34px') : String(input.positionsCount);
  const toneClass = loss >= 0 ? 'gain' : 'loss';
  const secondFillPct = Math.max(
    0,
    Math.min(input.progressFill, input.secondMilestonePct) - input.firstMilestonePct,
  );
  const tickLayout = resolveProgressTickLayout({
    mode: 'both',
    invested: input.invested,
    goal: input.goalAmount,
    bePct: input.firstMilestonePct,
    goalPct: input.secondMilestonePct,
    isLoading,
  });

  return `
    <section class="dashboard-view" aria-labelledby="dashboard-heading">
      <h2 class="visually-hidden" id="dashboard-heading">${DASHBOARD_COPY.sectionTitle}</h2>

      <div class="context">
        <div class="context-left">
          <span class="context-title">${DASHBOARD_COPY.contextTitle}</span>${renderContextMeta(input.connectedExchanges)}
        </div>
      </div>

      <section class="hero">
        <div class="hero-main">
          <span class="label">${DASHBOARD_COPY.balanceTitle}</span>
          <output class="hero-figure" id="dash-balance" aria-live="polite">${balanceValue}</output>
          <div class="hero-delta">
            <output class="${toneClass}" id="dash-pnl" aria-live="polite">${pnlValue}</output>
            <span class="${toneClass}" id="dash-pnl-pct">${pnlPctValue}</span>
            <span class="hero-delta-sep"></span>
            <span class="muted">${DASHBOARD_COPY.pnlContext}</span>
          </div>
        </div>
        <div class="hero-side">
          <div class="hero-side-row">
            <span class="label">${DASHBOARD_COPY.investedTitle}</span>
            <output class="num" id="dash-invested" aria-live="polite">${investedValue}</output>
          </div>
          <div class="hero-side-row" id="dash-prog-target">
            <span class="label" id="dash-prog-target-label">${DASHBOARD_COPY.defaultGoalLabel}</span>
            <output class="num" id="dash-prog-target-amount" aria-live="polite">${progressTargetValue}</output>
          </div>
          <div class="hero-side-row">
            <span class="label">${DASHBOARD_COPY.balanceDateTitle}</span>
            <span class="num muted" id="dash-balance-date">${balanceDateValue}</span>
          </div>
        </div>
      </section>

      <section class="progress-block" aria-labelledby="dashboard-goal-title">
        <div class="${progressHeadClassName(tickLayout)}" id="dash-prog-head">
          <span class="label" id="dashboard-goal-title">${DASHBOARD_COPY.goalTitle}</span>
          <div class="progress-scale" aria-hidden="true">
            <span class="${progressTickClassName(tickLayout.be)}" id="dash-prog-tick-be" style="left:${tickLayout.be.pct}%"${tickLayout.be.hidden ? ' hidden' : ''}>
              <span class="progress-tick-label"><span class="chip-dot" style="background:var(--warn)"></span><span class="progress-tick-text">${escapeHtml(tickLayout.be.label)}</span></span>
              <span class="progress-tick-line"></span>
            </span>
            <span class="${progressTickClassName(tickLayout.goal)}" id="dash-prog-tick-goal" style="left:${tickLayout.goal.pct}%"${tickLayout.goal.hidden ? ' hidden' : ''}>
              <span class="progress-tick-label"><span class="chip-dot" style="background:var(--gain)"></span><span class="progress-tick-text">${escapeHtml(tickLayout.goal.label)}</span></span>
              <span class="progress-tick-line"></span>
            </span>
          </div>
        </div>

        <div
          class="progress-track mode-both"
          id="dash-goal-progress-bar"
          role="progressbar"
          aria-label="${DASHBOARD_COPY.progressRegionLabel}"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${Math.round(input.progressFill)}"
        >
          <span class="progress-zone" id="dash-prog-muted-first" style="width:${input.firstMilestonePct}%"></span>
          <span class="progress-zone is-goal" id="dash-prog-muted-second" style="left:${input.firstMilestonePct}%;width:${Math.max(0, input.secondMilestonePct - input.firstMilestonePct)}%"></span>
          <span class="progress-fill" id="dash-prog-solid-first" style="width:${Math.min(input.progressFill, input.firstMilestonePct)}%"></span>
          <span class="progress-fill is-gain" id="dash-prog-solid-second" style="left:${input.firstMilestonePct}%;width:${secondFillPct}%"></span>
        </div>

        <div class="progress-foot">
          <span class="soft" id="dash-prog-remaining" aria-live="polite">
            <span id="dash-prog-remaining-text">${DASHBOARD_COPY.remainingText}</span>
            <output class="num strong" id="dash-prog-remaining-amount">${progressRemainingValue}</output>
            <span id="dash-prog-remaining-prefix">${DASHBOARD_COPY.remainingPrefix}</span>
            <span id="dash-prog-remaining-target">${DASHBOARD_COPY.goalTargetText}</span>
          </span>
          <span class="progress-legend" aria-label="Controles de progreso">
            <span class="muted progress-eta">${DASHBOARD_COPY.etaPrefix}</span>
            <output class="num muted progress-eta" id="dashboard-days" aria-live="polite" aria-label="${DASHBOARD_COPY.etaLabel}">${skeletonSpan('72px')}</output>
            <span class="context-sep" id="dashboard-days-sep"></span>
            <button type="button" class="chip chip-warn goal-progress-legend" id="dashboard-legend-be" data-legend="be" aria-pressed="true" aria-controls="dash-goal-progress-bar">
              <span class="chip-dot" aria-hidden="true"></span>${DASHBOARD_COPY.breakEvenLegend}
            </button>
            <button type="button" class="chip chip-gain goal-progress-legend" id="dashboard-legend-goal" data-legend="goal" aria-pressed="true" aria-controls="dash-goal-progress-bar">
              <span class="chip-dot" aria-hidden="true"></span>${DASHBOARD_COPY.goalLegend}
            </button>
          </span>
        </div>
      </section>

      <div class="rail rail-4" aria-label="Métricas del portfolio">
        <div class="rail-item" data-shared-card="apr">
          <span class="label">${DASHBOARD_COPY.averageAprTitle}</span>
          <output class="rail-value" id="dashboard-apr" aria-live="polite">${skeletonSpan('70px')}</output>
          <span class="rail-sub">${DASHBOARD_COPY.averageAprSub}</span>
        </div>
        <div class="rail-item" data-shared-card="capital">
          <span class="label">${DASHBOARD_COPY.capitalTitle}</span>
          <output class="rail-value" id="dashboard-capital" aria-live="polite">${skeletonSpan('90px')}</output>
          <span class="rail-sub">${DASHBOARD_COPY.capitalSub}</span>
        </div>
        <div class="rail-item" data-shared-card="daily">
          <span class="label">${DASHBOARD_COPY.dailyRunRateTitle}</span>
          <output class="rail-value" id="dashboard-daily" aria-live="polite">${skeletonSpan('70px')}</output>
          <span class="rail-sub">${DASHBOARD_COPY.dailyRunRateSub}</span>
        </div>
        <div class="rail-item" data-shared-card="positions">
          <span class="label">${DASHBOARD_COPY.activePositionsTitle}</span>
          <output class="rail-value" id="dashboard-positions-count" aria-live="polite">${positionsValue}</output>
          <span class="rail-sub">${DASHBOARD_COPY.activePositionsSub}</span>
        </div>
      </div>

      ${
        input.connectedExchanges.length > 0
          ? `
      <section class="block" id="dashboard-balance-strip" hidden aria-labelledby="dashboard-balance-strip-title">
        <div class="table-head">
          <span class="table-title" id="dashboard-balance-strip-title">
            ${DASHBOARD_COPY.accountBalanceTitle}
          </span>
          <span class="block-note" id="dashboard-balance-strip-note">${DASHBOARD_COPY.accountBalanceCopy}</span>
        </div>
        <div class="table-scroll">
          <table class="tbl">
            <caption class="visually-hidden">${DASHBOARD_COPY.accountBalanceTitle}: ${DASHBOARD_COPY.accountBalanceCopy}</caption>
            <thead>
              <tr>
                <th scope="col">${DASHBOARD_COPY.assetLabel}</th>
                <th scope="col">${DASHBOARD_COPY.sourceLabel}</th>
                <th scope="col" class="r">${DASHBOARD_COPY.freeLabel}</th>
                <th scope="col" class="r">${DASHBOARD_COPY.lockedLabel}</th>
                <th scope="col" class="r">${DASHBOARD_COPY.totalLabel}</th>
              </tr>
            </thead>
            <tbody id="dashboard-balance-strip-items" aria-live="polite">
              ${renderBalanceLoadingRows()}
            </tbody>
          </table>
        </div>
      </section>
      `
          : ''
      }
    </section>
  `;
}
