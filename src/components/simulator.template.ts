import { iconRefreshCw, iconTarget } from '../utils/icons';
import { SIMULATOR_COPY, SIMULATOR_FREQUENCY_OPTIONS } from './simulator.constants';
import {
  renderInlineStatusRegion,
  renderPageContextTags,
  renderPageLead,
  renderSectionHead,
} from './page-layout.template';
import type { AutoState, SimulatorViewState } from './simulator.state';

function renderAutoTag(id: string, isAuto: boolean): string {
  return `<span class="auto-tag ${isAuto ? 'is-auto' : 'is-manual'}" id="${id}">${isAuto ? 'AUTO' : 'MANUAL'}</span>`;
}

function renderResultSkeleton(className: string): string {
  return `<span class="skeleton ${className}"></span>`;
}

export function formatAutoAprHint(apr: number | null): string {
  if (Number.isFinite(apr) && (apr as number) > 0) {
    return `${SIMULATOR_COPY.autoAprHintPrefix} ${(apr as number).toFixed(2)}%`;
  }
  return `${SIMULATOR_COPY.autoAprHintPrefix} N/D`;
}

export function projectionTableSkeletonHtml(): string {
  return `
    <div class="sim-projection-table-skeleton">
      <div class="sim-projection-table-head">
        <span class="skeleton sim-skeleton-w-36 sim-skeleton-h-xs"></span>
        <span class="skeleton sim-skeleton-w-72 sim-skeleton-h-xs"></span>
        <span class="skeleton sim-skeleton-w-74 sim-skeleton-h-xs"></span>
        <span class="skeleton sim-skeleton-w-116 sim-skeleton-h-xs"></span>
      </div>
      ${Array.from(
        { length: 4 },
        () => `
          <div class="sim-projection-table-row">
            <span class="skeleton sim-skeleton-w-22 sim-skeleton-h-sm"></span>
            <span class="skeleton sim-skeleton-w-84 sim-skeleton-h-sm"></span>
            <span class="skeleton sim-skeleton-w-94 sim-skeleton-h-sm"></span>
            <span class="skeleton sim-skeleton-w-108 sim-skeleton-h-sm"></span>
          </div>
        `,
      ).join('')}
    </div>
  `;
}

export function renderProjectionTable(
  rows: Array<{ month: number; date: string; balance: number; earned: number; rowClass: string }>,
  formatDate: (value: string) => string,
  formatCurrency: (value: number) => string,
): string {
  return `
    <table class="sim-projection-table">
      <colgroup>
        <col class="sim-projection-col-month">
        <col class="sim-projection-col-date">
        <col class="sim-projection-col-balance">
        <col class="sim-projection-col-earned">
      </colgroup>
      <thead>
        <tr>
          ${SIMULATOR_COPY.projectionHeaders.map((header) => `<th scope="col">${header}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr${row.rowClass ? ` class="${row.rowClass}"` : ''}>
                <td class="mono sim-projection-cell-month">${row.month}</td>
                <td class="mono sim-projection-cell-date">${formatDate(row.date)}</td>
                <td class="mono sim-projection-cell-balance">${formatCurrency(row.balance)}</td>
                <td class="mono sim-projection-cell-earned ${row.earned > 0 ? 'text-gain' : ''}">${formatCurrency(row.earned)}</td>
              </tr>
            `,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

export function renderSimulatorTemplate(
  viewState: SimulatorViewState,
  autoState: AutoState,
  dashboardGoal: number,
): string {
  const frequencyLabel =
    SIMULATOR_FREQUENCY_OPTIONS.find((option) => option.value === viewState.frequency)?.label ??
    viewState.frequency;
  const hasAutoInputs = autoState.capital || autoState.apr || autoState.goal;
  const contextHtml = renderPageContextTags([
    {
      label: hasAutoInputs ? 'Con datos AUTO' : 'Manual',
      tone: hasAutoInputs ? 'accent' : 'neutral',
    },
    {
      label: frequencyLabel,
      tone: 'neutral',
    },
  ]);

  return `
    <section class="section simulator-section" aria-labelledby="simulator-heading">
      ${renderPageLead({
        id: 'simulator-heading',
        title: SIMULATOR_COPY.title,
        contextHtml,
      })}
      ${renderInlineStatusRegion()}

      <div class="grid-2 simulator-shell">
        <section class="page-panel sim-parameters-card" aria-labelledby="sim-parameters-title">
          ${renderSectionHead({
            id: 'sim-parameters-title',
            title: SIMULATOR_COPY.parametersTitle,
            titleTag: 'h3',
          })}
          <div class="form-group">
            <label class="label-with-badge">
              ${SIMULATOR_COPY.capitalLabel}
              ${renderAutoTag('sim-capital-tag', autoState.capital)}
            </label>
            <input type="number" id="sim-capital" step="1" value="${autoState.capital ? '' : viewState.capital.toFixed(2)}">
            <div class="text-muted hint-text" id="sim-capital-hint">
              ${autoState.capital ? SIMULATOR_COPY.autoCapitalHint : SIMULATOR_COPY.manualHint}
            </div>
          </div>
          <div class="form-group">
            <label class="label-with-badge">
              ${SIMULATOR_COPY.aprLabel}
              ${renderAutoTag('sim-apr-tag', autoState.apr)}
            </label>
            <input type="number" id="sim-apr" step="1" value="${autoState.apr ? '' : viewState.apr.toFixed(2)}">
            <div class="text-muted hint-text" id="sim-apr-hint">
              ${autoState.apr ? formatAutoAprHint(null) : SIMULATOR_COPY.manualHint}
            </div>
          </div>
          <div class="form-group">
            <label for="sim-frequency">${SIMULATOR_COPY.frequencyLabel}</label>
            <select id="sim-frequency">
              ${SIMULATOR_FREQUENCY_OPTIONS.map(
                (option) =>
                  `<option value="${option.value}" ${viewState.frequency === option.value ? 'selected' : ''}>${option.label}</option>`,
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="label-with-badge">
              ${SIMULATOR_COPY.goalLabel}
              ${renderAutoTag('sim-goal-tag', autoState.goal)}
            </label>
            <input type="number" id="sim-goal" step="1" value="${(autoState.goal ? dashboardGoal : viewState.goal).toFixed(2)}">
            <div class="text-muted hint-text" id="sim-goal-hint">
              ${autoState.goal ? SIMULATOR_COPY.autoGoalHint : SIMULATOR_COPY.manualHint}
            </div>
          </div>
          <div class="flex-row gap-sm sim-actions">
            <button class="btn btn-sm flex-1" id="btn-sim-reset">${iconRefreshCw(14)} ${SIMULATOR_COPY.resetAutoLabel}</button>
            <button class="btn btn-primary flex-2" id="btn-simulate">${iconTarget(14)} ${SIMULATOR_COPY.simulateLabel}</button>
          </div>
        </section>

        <section class="page-panel page-panel--accent sim-results-card" id="sim-results" aria-labelledby="sim-results-title">
          ${renderSectionHead({
            id: 'sim-results-title',
            title: SIMULATOR_COPY.resultsTitle,
            titleTag: 'h3',
          })}
          <div class="sim-results-container">
            <div class="sim-milestones-grid">
              <div class="sim-milestone-col">
                <div class="sim-result-label">${SIMULATOR_COPY.breakEvenLabel}</div>
                <div class="sim-result-item">
                  <div class="sim-result-label">${SIMULATOR_COPY.estimatedDateLabel}</div>
                  <div class="sim-result-value medium mono text-accent" id="sim-out-be-date">${renderResultSkeleton('sim-skeleton-w-140 sim-skeleton-h-md')}</div>
                </div>
                <div class="sim-result-item">
                  <div class="sim-result-label">${SIMULATOR_COPY.remainingTimeLabel}</div>
                  <div class="sim-result-value medium mono" id="sim-out-be-time">${renderResultSkeleton('sim-skeleton-w-92 sim-skeleton-h-md')}</div>
                </div>
              </div>
              <div class="sim-milestone-col">
                <div class="sim-result-label">${SIMULATOR_COPY.goalMilestoneLabel}</div>
                <div class="sim-result-item">
                  <div class="sim-result-label">${SIMULATOR_COPY.estimatedDateLabel}</div>
                  <div class="sim-result-value medium mono text-accent" id="sim-out-goal-date">${renderResultSkeleton('sim-skeleton-w-140 sim-skeleton-h-md')}</div>
                </div>
                <div class="sim-result-item">
                  <div class="sim-result-label">${SIMULATOR_COPY.remainingTimeLabel}</div>
                  <div class="sim-result-value medium mono" id="sim-out-goal-time">${renderResultSkeleton('sim-skeleton-w-92 sim-skeleton-h-md')}</div>
                </div>
              </div>
            </div>
            <div class="sim-result-item">
              <div class="sim-result-label">${SIMULATOR_COPY.dailyRunRateLabel}</div>
              <div class="sim-result-value medium text-gain mono" id="sim-out-daily">${renderResultSkeleton('sim-skeleton-w-100 sim-skeleton-h-md')}</div>
            </div>
            <div class="sim-result-item">
              <div class="sim-result-label">${SIMULATOR_COPY.monthlyRunRateLabel}</div>
              <div class="sim-result-value medium text-gain mono" id="sim-out-monthly">${renderResultSkeleton('sim-skeleton-w-100 sim-skeleton-h-md')}</div>
            </div>
            <div class="sim-result-item">
              <div class="sim-result-label">${SIMULATOR_COPY.rateLabel}</div>
              <div class="sim-result-value small mono" id="sim-out-rate">${renderResultSkeleton('sim-skeleton-w-60 sim-skeleton-h-sm')}</div>
            </div>
            <div class="sim-result-item">
              <div class="sim-result-label">${SIMULATOR_COPY.finalBalanceLabel}</div>
              <div class="sim-result-value medium mono" id="sim-out-final">${renderResultSkeleton('sim-skeleton-w-100 sim-skeleton-h-md')}</div>
            </div>
          </div>
        </section>
      </div>

      <section class="page-section data-section sim-projection-card" id="sim-table-container" aria-labelledby="sim-projection-title">
        ${renderSectionHead({
          id: 'sim-projection-title',
          title: SIMULATOR_COPY.projectionTitle,
          titleTag: 'h3',
        })}
        <div class="chart-container mb-lg">
          <canvas id="projection-chart" hidden></canvas>
          <div class="sim-projection-chart-skeleton" id="sim-projection-chart-skeleton">
            <span class="skeleton sim-skeleton-chart"></span>
          </div>
        </div>
        <div class="table-container" id="sim-table"></div>
      </section>
    </section>
  `;
}
