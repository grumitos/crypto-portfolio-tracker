import { iconRefreshCw, iconTarget } from '../utils/icons';
import { escapeHtml } from '../utils/ui-helpers';
import {
  PROJECTION_CHART,
  SIMULATOR_COPY,
  SIMULATOR_FREQUENCY_OPTIONS,
} from './simulator.constants';
import type { AutoState, SimulatorViewState } from './simulator.state';
import type { ProjectionRow } from '../types';

function renderAutoTag(id: string, isAuto: boolean): string {
  return `<span class="auto-tag ${isAuto ? 'is-auto' : 'is-manual'}" id="${id}">${isAuto ? 'AUTO' : 'MANUAL'}</span>`;
}

function renderResultSkeleton(width: string): string {
  return `<span class="skeleton skeleton-number" style="width:${width}"></span>`;
}

export function formatAutoAprHint(apr: number | null): string {
  if (Number.isFinite(apr) && (apr as number) > 0) {
    return `${SIMULATOR_COPY.autoAprHintPrefix} ${(apr as number).toFixed(2)}%`;
  }
  return `${SIMULATOR_COPY.autoAprHintPrefix} N/D`;
}

export function projectionChartSkeletonHtml(): string {
  return `<span class="skeleton" id="sim-projection-chart-skeleton" style="display:block;width:100%;height:${PROJECTION_CHART.height}px;border-radius:var(--radius-md)"></span>`;
}

export function projectionTableSkeletonHtml(): string {
  return `
    <div class="sim-projection-skeleton" aria-hidden="true">
      ${Array.from(
        { length: 5 },
        () => `
          <div class="sim-projection-skeleton-row">
            <span class="skeleton skeleton-text"></span>
            <span class="skeleton skeleton-text"></span>
            <span class="skeleton skeleton-text"></span>
            <span class="skeleton skeleton-text"></span>
            <span class="skeleton skeleton-text"></span>
          </div>
        `,
      ).join('')}
    </div>
  `;
}

export function renderProjectionMilestone(rowClass: string): string {
  const hitBe = rowClass.includes('sim-row-cross-be');
  const hitGoal = rowClass.includes('sim-row-cross-goal');
  const beChip = `<span class="chip chip-warn"><span class="chip-dot"></span>${SIMULATOR_COPY.milestoneBeLabel}</span>`;
  const goalChip = `<span class="chip chip-gain"><span class="chip-dot"></span>${SIMULATOR_COPY.milestoneGoalLabel}</span>`;
  if (hitBe && hitGoal)
    return `<span class="row sim-projection-badges">${beChip}${goalChip}</span>`;
  if (hitBe) return beChip;
  if (hitGoal) return goalChip;
  return '<span class="muted">&mdash;</span>';
}

/**
 * La celda de "ganado en el mes" es un incremento, no un saldo: el signo lo
 * distingue de la columna de balance que tiene al lado.
 */
export function formatProjectionEarned(
  value: number,
  formatCurrency: (amount: number) => string,
): string {
  return value > 0 ? `+${formatCurrency(value)}` : formatCurrency(value);
}

export function renderProjectionTable(
  rows: Array<{ month: number; date: string; balance: number; earned: number; rowClass: string }>,
  formatDate: (value: string) => string,
  formatCurrency: (value: number) => string,
): string {
  return `
    <table class="tbl tbl-fixed sim-projection-table">
      <colgroup>
        ${SIMULATOR_COPY.projectionColumnWidths.map((width) => (width ? `<col style="width:${width}">` : '<col>')).join('')}
      </colgroup>
      <caption class="visually-hidden">${SIMULATOR_COPY.projectionCaption}</caption>
      <thead>
        <tr>
          ${SIMULATOR_COPY.projectionHeaders
            .map(
              (header, index) =>
                `<th scope="col"${index === 0 || index >= 2 ? ' class="r"' : ''}>${header}</th>`,
            )
            .join('')}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr data-projection-row="${row.month}"${row.rowClass ? ` class="${row.rowClass}"` : ''}>
                <td class="r num muted" data-projection-cell="month">${row.month}</td>
                <td class="num" data-projection-cell="date">${formatDate(row.date)}</td>
                <td class="r num ${row.balance > 0 ? 'sim-projection-value-positive' : ''}" data-projection-cell="balance">${formatCurrency(row.balance)}</td>
                <td class="r num ${row.earned > 0 ? 'text-gain' : ''}" data-projection-cell="earned">${formatProjectionEarned(row.earned, formatCurrency)}</td>
                <td class="r" data-projection-cell="milestone">${renderProjectionMilestone(row.rowClass)}</td>
              </tr>
            `,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

export interface ProjectionChartMilestone {
  /** Nombre del hito tal cual se muestra en la leyenda. */
  label: string;
  /** Importe objetivo ya formateado. */
  amount: string;
  /** Fecha proyectada ya formateada, o null si la curva no llega a cruzarla. */
  date: string | null;
}

interface ProjectionChartInput {
  /** Filas de la proyeccion incluyendo el mes 0 (hoy). */
  rows: ProjectionRow[];
  invested: number;
  goal: number;
  breakEvenMilestone: ProjectionChartMilestone | null;
  goalMilestone: ProjectionChartMilestone | null;
  formatDate: (value: string) => string;
}

interface ChartPoint {
  x: number;
  y: number;
  value: number;
}

function buildScale(values: number[]): (value: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const top = PROJECTION_CHART.paddingTop;
  const bottom = PROJECTION_CHART.height - PROJECTION_CHART.paddingBottom;
  return (value: number) => bottom - ((value - min) / span) * (bottom - top);
}

/**
 * Los hitos se rotulan fuera del SVG: dentro competian por la misma `y` cuando
 * las guias caian juntas y acababan superpuestos sobre la curva. Como leyenda
 * HTML no pueden solaparse con ningun juego de datos, heredan la tipografia del
 * sistema y son seleccionables y legibles por lectores de pantalla.
 */
function renderChartLegend(
  items: Array<{ tone: 'warn' | 'gain'; milestone: ProjectionChartMilestone | null }>,
): string {
  const rendered = items
    .filter(
      (item): item is { tone: 'warn' | 'gain'; milestone: ProjectionChartMilestone } =>
        item.milestone !== null,
    )
    .map(({ tone, milestone }) => {
      const date = milestone.date
        ? ` · <span class="num">${escapeHtml(milestone.date)}</span>`
        : '';
      return `
        <span class="chart-legend-item">
          <span class="chip chip-${tone}"><span class="chip-dot"></span>${escapeHtml(milestone.label)}</span>
          <span class="label"><span class="num">${escapeHtml(milestone.amount)}</span>${date}</span>
        </span>
      `;
    });

  return rendered.length ? `<div class="chart-legend">${rendered.join('')}</div>` : '';
}

/** X interpolado donde la curva cruza `target`, o null si nunca lo alcanza. */
function crossingX(points: ChartPoint[], target: number): number | null {
  if (!Number.isFinite(target) || target <= 0) return null;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous.value < target && current.value >= target) {
      const span = current.value - previous.value || 1;
      const ratio = (target - previous.value) / span;
      return previous.x + (current.x - previous.x) * ratio;
    }
  }
  return points[0].value >= target ? points[0].x : null;
}

export function renderProjectionChart(input: ProjectionChartInput): string {
  const { width, height, paddingBottom } = PROJECTION_CHART;
  const values = input.rows.map((row) => row.balance);
  const reference = [...values, input.invested, input.goal].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  const toY = buildScale(reference);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points: ChartPoint[] = values.map((value, index) => ({
    x: Number((index * step).toFixed(1)),
    y: Number(toY(value).toFixed(1)),
    value,
  }));

  const line = points.map((point) => `${point.x},${point.y}`).join(' L');
  const baseline = height - paddingBottom;
  const area = `M${line} L${width},${baseline} L0,${baseline} Z`;

  const beY = Number(toY(input.invested).toFixed(1));
  const goalY = input.goal > 0 ? Number(toY(input.goal).toFixed(1)) : null;
  const beX = crossingX(points, input.invested);
  const goalX = input.goal > 0 ? crossingX(points, input.goal) : null;

  const guides = [
    `<line class="ch-guide" x1="0" y1="${beY}" x2="${width}" y2="${beY}"/>`,
    goalY === null
      ? ''
      : `<line class="ch-guide" x1="0" y1="${goalY}" x2="${width}" y2="${goalY}"/>`,
  ].join('');

  const dots = [
    beX === null
      ? ''
      : `<circle class="ch-dot ch-dot-be" cx="${beX.toFixed(1)}" cy="${beY}" r="4"/>`,
    goalX === null || goalY === null
      ? ''
      : `<circle class="ch-dot ch-dot-goal" cx="${goalX.toFixed(1)}" cy="${goalY}" r="4"/>`,
  ].join('');

  const legend = renderChartLegend([
    { tone: 'warn', milestone: input.breakEvenMilestone },
    { tone: 'gain', milestone: goalY === null ? null : input.goalMilestone },
  ]);

  const firstRow = input.rows[0];
  const lastRow = input.rows[input.rows.length - 1];

  return `
    ${legend}
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${SIMULATOR_COPY.chartAriaLabel}">
      <path class="ch-area" d="${area}"/>
      ${guides}
      <path class="ch-line" d="M${line}"/>
      ${dots}
    </svg>
    <div class="chart-foot">
      <span class="label">${SIMULATOR_COPY.chartStartLabel} · <span class="num">${escapeHtml(firstRow ? input.formatDate(firstRow.date) : '---')}</span></span>
      <span class="label">${SIMULATOR_COPY.chartEndLabel} · <span class="num">${escapeHtml(lastRow ? input.formatDate(lastRow.date) : '---')}</span></span>
    </div>
  `;
}

export function renderSimulatorTemplate(
  viewState: SimulatorViewState,
  autoState: AutoState,
  dashboardGoal: number,
): string {
  return `
    <section class="simulator-view" aria-labelledby="simulator-heading">
      <h2 class="visually-hidden" id="simulator-heading">${SIMULATOR_COPY.title}</h2>

      <div class="context">
        <div class="context-left">
          <span class="context-title">${SIMULATOR_COPY.contextTitle}</span>
          <span class="context-sep"></span>
          <span class="context-meta">${SIMULATOR_COPY.contextMeta}</span>
        </div>
        <div class="context-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="btn-sim-reset">${iconRefreshCw(13)} ${SIMULATOR_COPY.resetAutoLabel}</button>
          <button type="button" class="btn btn-primary btn-sm" id="btn-simulate">${iconTarget(13)} ${SIMULATOR_COPY.simulateLabel}</button>
        </div>
      </div>

      <section class="hero sim-hero">
        <div class="stack-sm" aria-label="${SIMULATOR_COPY.parametersTitle}">
          <div class="field">
            <label class="field-label" for="sim-capital">
              ${SIMULATOR_COPY.capitalLabel}
              ${renderAutoTag('sim-capital-tag', autoState.capital)}
            </label>
            <input class="input" type="number" id="sim-capital" step="1" value="${autoState.capital ? '' : viewState.capital.toFixed(2)}">
            <span class="field-hint" id="sim-capital-hint">
              ${autoState.capital ? SIMULATOR_COPY.autoCapitalHint : SIMULATOR_COPY.manualHint}
            </span>
          </div>
          <div class="field">
            <label class="field-label" for="sim-apr">
              ${SIMULATOR_COPY.aprLabel}
              ${renderAutoTag('sim-apr-tag', autoState.apr)}
            </label>
            <input class="input" type="number" id="sim-apr" step="1" value="${autoState.apr ? '' : viewState.apr.toFixed(2)}">
            <span class="field-hint" id="sim-apr-hint">
              ${autoState.apr ? formatAutoAprHint(null) : SIMULATOR_COPY.manualHint}
            </span>
          </div>
          <div class="field">
            <label class="field-label" for="sim-frequency">${SIMULATOR_COPY.frequencyLabel}</label>
            <select class="input" id="sim-frequency">
              ${SIMULATOR_FREQUENCY_OPTIONS.map(
                (option) =>
                  `<option value="${option.value}" ${viewState.frequency === option.value ? 'selected' : ''}>${option.label}</option>`,
              ).join('')}
            </select>
            <span class="field-hint">${SIMULATOR_COPY.frequencyHint}</span>
          </div>
          <div class="field">
            <label class="field-label" for="sim-goal">
              ${SIMULATOR_COPY.goalLabel}
              ${renderAutoTag('sim-goal-tag', autoState.goal)}
            </label>
            <input class="input" type="number" id="sim-goal" step="1" value="${(autoState.goal ? dashboardGoal : viewState.goal).toFixed(2)}">
            <span class="field-hint" id="sim-goal-hint">
              ${autoState.goal ? SIMULATOR_COPY.autoGoalHint : SIMULATOR_COPY.manualHint}
            </span>
          </div>
        </div>

        <div class="stack">
          <div class="hero-main">
            <span class="label">${SIMULATOR_COPY.goalHeroLabel}</span>
            <output class="hero-figure sm" id="sim-out-goal-date" aria-live="polite">${renderResultSkeleton('220px')}</output>
            <div class="hero-delta">
              <output class="gain" id="sim-out-goal-time" aria-live="polite">${renderResultSkeleton('110px')}</output>
              <span class="hero-delta-sep"></span>
              <span class="muted">${SIMULATOR_COPY.goalHeroContext}</span>
            </div>
          </div>

          <div class="rule"></div>

          <div class="row row-between">
            <span class="chip chip-warn"><span class="chip-dot"></span>${SIMULATOR_COPY.breakEvenLabel}</span>
            <span class="row">
              <output class="num" id="sim-out-be-date" aria-live="polite">${renderResultSkeleton('120px')}</output>
              <span class="context-sep"></span>
              <output class="num muted" id="sim-out-be-time" aria-live="polite">${renderResultSkeleton('90px')}</output>
            </span>
          </div>

          <div class="rule"></div>

          <div id="sim-chart-block">
            <div class="table-head">
              <span class="table-title">${SIMULATOR_COPY.chartTitle}</span>
              <span class="block-note">${SIMULATOR_COPY.chartNote}</span>
            </div>
            <div id="projection-chart">${projectionChartSkeletonHtml()}</div>
          </div>
        </div>
      </section>

      <div class="rail rail-4" aria-label="Resultados de la simulación">
        <div class="rail-item">
          <span class="label">${SIMULATOR_COPY.dailyRunRateLabel}</span>
          <output class="rail-value gain" id="sim-out-daily" aria-live="polite">${renderResultSkeleton('100px')}</output>
          <span class="rail-sub">${SIMULATOR_COPY.dailyRunRateSub}</span>
        </div>
        <div class="rail-item">
          <span class="label">${SIMULATOR_COPY.monthlyRunRateLabel}</span>
          <output class="rail-value gain" id="sim-out-monthly" aria-live="polite">${renderResultSkeleton('100px')}</output>
          <span class="rail-sub">${SIMULATOR_COPY.monthlyRunRateSub}</span>
        </div>
        <div class="rail-item">
          <span class="label">${SIMULATOR_COPY.rateLabel}</span>
          <output class="rail-value" id="sim-out-rate" aria-live="polite">${renderResultSkeleton('90px')}</output>
          <span class="rail-sub">${SIMULATOR_COPY.rateSub}</span>
        </div>
        <div class="rail-item">
          <span class="label">${SIMULATOR_COPY.finalBalanceLabel}</span>
          <output class="rail-value" id="sim-out-final" aria-live="polite">${renderResultSkeleton('110px')}</output>
          <span class="rail-sub">${SIMULATOR_COPY.finalBalanceSub}</span>
        </div>
      </div>

      <section class="block" id="sim-table-container">
        <div class="table-head">
          <span class="table-title">${SIMULATOR_COPY.projectionTitle}</span>
          <span class="block-note">${SIMULATOR_COPY.projectionContext}</span>
        </div>
        <div class="table-scroll" id="sim-table"></div>
      </section>
    </section>
  `;
}
