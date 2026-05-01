import { escapeHtml, skeletonSpan } from '../utils/ui-helpers';
import {
  POSITIONS_COPY,
  SPOT_CHANGE_SKELETON_WIDTH,
  SPOT_VALUE_SKELETON_WIDTH,
} from './positions.constants';

interface PositionsTemplateInput {
  autoMode: boolean;
  hasApi: boolean;
  activeCount: number;
  buyLowMarkup: string;
  sellHighMarkup: string;
  hasPositions: boolean;
}

export function renderPositionsEmptyState(autoMode: boolean, hasApi: boolean): string {
  if (autoMode) {
    return `
      <div class="card empty-state positions-empty-state" id="positions-empty-state">
        <p class="positions-empty-title">${hasApi ? POSITIONS_COPY.autoEmptyTitle : POSITIONS_COPY.apiMissingTitle}</p>
        <p class="positions-empty-copy">${hasApi ? POSITIONS_COPY.autoEmptyBody : POSITIONS_COPY.apiMissingBody}</p>
        <p class="positions-empty-hint">${POSITIONS_COPY.emptyHintAuto}</p>
      </div>
    `;
  }

  return `
    <div class="card empty-state positions-empty-state">
      <p class="positions-empty-title">${POSITIONS_COPY.manualEmptyTitle}</p>
      <p class="positions-empty-copy">${POSITIONS_COPY.manualEmptyBody}</p>
      <p class="positions-empty-hint">${POSITIONS_COPY.emptyHintManual}</p>
    </div>
  `;
}

export function renderPositionsTemplate(input: PositionsTemplateInput): string {
  return `
    <div class="section">
      <h2 class="visually-hidden">${POSITIONS_COPY.title}</h2>

      <div class="grid-4 positions-summary-grid">
        <div class="stat-card positions-stat-card" data-shared-card="apr">
          <div class="card-title">${POSITIONS_COPY.aprTitle}</div>
          <div class="stat-value" id="positions-apr">${skeletonSpan('70px')}</div>
        </div>
        <div class="stat-card positions-stat-card" data-shared-card="capital">
          <div class="card-title">${POSITIONS_COPY.capitalTitle}</div>
          <div class="stat-value" id="positions-capital">${skeletonSpan('90px')}</div>
        </div>
        <div class="stat-card positions-stat-card" data-shared-card="daily">
          <div class="card-title">${POSITIONS_COPY.dailyTitle}</div>
          <div class="stat-value" id="positions-daily">${skeletonSpan('70px')}</div>
        </div>
        <div class="stat-card positions-stat-card positions-stat-card--hero" data-shared-card="positions">
          <div class="card-title">${POSITIONS_COPY.countTitle}</div>
          <div class="stat-value" id="positions-count">${input.activeCount}</div>
        </div>
      </div>

      <div class="positions-spot-strip-wrap">
        <div class="positions-spot-strip positions-spot-strip--panel" id="positions-spot-strip" hidden></div>
      </div>

      <div id="positions-tables-container">
        ${
          input.hasPositions
            ? `${input.buyLowMarkup}${input.sellHighMarkup}`
            : renderPositionsEmptyState(input.autoMode, input.hasApi)
        }
      </div>
    </div>
  `;
}

export function renderSpotCardTemplate(asset: string): string {
  const safeAsset = escapeHtml(asset);
  return `
    <span class="positions-spot-header">
      <span class="positions-spot-logo-wrap">
        <img class="positions-spot-logo" loading="lazy" decoding="async">
        <span class="positions-spot-fallback"></span>
      </span>
      <span class="positions-spot-symbol">${safeAsset}</span>
    </span>
    <span class="positions-spot-meta">
      <span class="positions-spot-value mono" id="positions-spot-value-${asset}">${skeletonSpan(SPOT_VALUE_SKELETON_WIDTH)}</span>
      <span class="positions-spot-change-row">
        <span class="positions-spot-change mono" id="positions-spot-change-${asset}">${skeletonSpan(SPOT_CHANGE_SKELETON_WIDTH)}</span>
        <span class="positions-spot-change-window mono">24h</span>
      </span>
    </span>
  `;
}
