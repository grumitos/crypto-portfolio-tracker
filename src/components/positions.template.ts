import { escapeHtml, providerName, skeletonSpan } from '../utils/ui-helpers';
import type { ExchangeSource } from '../types';
import {
  POSITIONS_COPY,
  SPOT_CHANGE_SKELETON_WIDTH,
  SPOT_VALUE_SKELETON_WIDTH,
} from './positions.constants';

interface PositionsTemplateInput {
  connectedExchanges: ExchangeSource[];
  activeCount: number;
  buyLowMarkup: string;
  sellHighMarkup: string;
  hasPositions: boolean;
}

export function renderPositionsEmptyState(hasApi: boolean): string {
  return `
    <div class="empty positions-empty-state">
      <p class="empty-title">${hasApi ? POSITIONS_COPY.emptyTitle : POSITIONS_COPY.apiMissingTitle}</p>
      <p class="empty-copy">${hasApi ? POSITIONS_COPY.emptyBody : POSITIONS_COPY.apiMissingBody}</p>
      ${hasApi ? `<p class="empty-copy muted">${POSITIONS_COPY.emptyHint}</p>` : ''}
    </div>
  `;
}

/**
 * Cierra la linea de contexto con la fuente de los datos. Sin exchanges el
 * segmento simplemente no aparece: la vista vacia ya explica que falta conectar
 * uno, y repetir la ausencia aqui solo resta.
 */
function resolveContextMeta(input: PositionsTemplateInput): string {
  const activity = `${input.activeCount} activa${input.activeCount === 1 ? '' : 's'}`;
  const exchanges = input.connectedExchanges.map((name) => providerName(name));
  const segments = [POSITIONS_COPY.contextMetaPrefix, activity, ...exchanges];
  return segments.join(' · ');
}

export function renderPositionsTemplate(input: PositionsTemplateInput): string {
  return `
    <section class="positions-view" aria-labelledby="positions-heading">
      <h2 class="visually-hidden" id="positions-heading">${POSITIONS_COPY.title}</h2>

      <div class="context">
        <div class="context-left">
          <span class="context-title">${POSITIONS_COPY.contextTitle}</span>
          <span class="context-sep"></span>
          <span class="context-meta">${resolveContextMeta(input)}</span>
        </div>
      </div>

      <div class="spot" id="positions-spot-strip" hidden></div>

      <div class="rail rail-4" aria-label="Métricas de posiciones">
        <div class="rail-item" data-shared-card="apr">
          <span class="label">${POSITIONS_COPY.aprTitle}</span>
          <span class="rail-value" id="positions-apr">${skeletonSpan('70px')}</span>
          <span class="rail-sub">${POSITIONS_COPY.aprSub}</span>
        </div>
        <div class="rail-item" data-shared-card="capital">
          <span class="label">${POSITIONS_COPY.capitalTitle}</span>
          <span class="rail-value" id="positions-capital">${skeletonSpan('90px')}</span>
          <span class="rail-sub">${POSITIONS_COPY.capitalSub}</span>
        </div>
        <div class="rail-item" data-shared-card="daily">
          <span class="label">${POSITIONS_COPY.dailyTitle}</span>
          <span class="rail-value" id="positions-daily">${skeletonSpan('70px')}</span>
          <span class="rail-sub">${POSITIONS_COPY.dailySub}</span>
        </div>
        <div class="rail-item" data-shared-card="positions">
          <span class="label">${POSITIONS_COPY.countTitle}</span>
          <span class="rail-value" id="positions-count">${input.activeCount}</span>
          <span class="rail-sub">${POSITIONS_COPY.countSub}</span>
        </div>
      </div>

      <div id="positions-tables-container">
        ${
          input.hasPositions
            ? `${input.buyLowMarkup}${input.sellHighMarkup}`
            : renderPositionsEmptyState(input.connectedExchanges.length > 0)
        }
      </div>
    </section>
  `;
}

export function renderSpotItemTemplate(asset: string): string {
  const safeAsset = escapeHtml(asset);
  return `
    <span class="asset-logo-wrap positions-spot-logo-wrap">
      <img class="asset-logo positions-spot-logo" loading="lazy" decoding="async">
      <span class="asset-fallback positions-spot-fallback"></span>
    </span>
    <span class="spot-body">
      <span class="spot-symbol">${safeAsset}</span>
      <span class="spot-line">
        <span class="spot-price positions-spot-value" id="positions-spot-value-${safeAsset}">${skeletonSpan(SPOT_VALUE_SKELETON_WIDTH)}</span>
        <span class="spot-delta positions-spot-change" id="positions-spot-change-${safeAsset}">${skeletonSpan(SPOT_CHANGE_SKELETON_WIDTH)}</span>
      </span>
    </span>
  `;
}
