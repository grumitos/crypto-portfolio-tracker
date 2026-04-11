import { escapeHtml } from '../utils/ui-helpers';

interface PageLeadInput {
  id: string;
  kicker?: string;
  title: string;
  intro?: string;
  contextHtml?: string;
}

interface SectionHeadInput {
  id?: string;
  title: string;
  copy?: string;
  actionsHtml?: string;
  titleTag?: 'h2' | 'h3';
}

interface PageContextTag {
  label: string;
  tone?: 'neutral' | 'accent' | 'success';
}

export function renderPageLead(input: PageLeadInput): string {
  const safeId = escapeHtml(input.id);
  const safeTitle = escapeHtml(input.title);
  const safeKicker = input.kicker?.trim() ? escapeHtml(input.kicker) : '';
  const safeIntro = input.intro?.trim() ? escapeHtml(input.intro) : '';

  return `
    <header class="page-lead" aria-labelledby="${safeId}">
      <div class="page-lead-copy">
        ${safeKicker ? `<span class="page-kicker">${safeKicker}</span>` : ''}
        <div class="page-lead-title-row">
          <h2 class="page-title" id="${safeId}">${safeTitle}</h2>
          ${input.contextHtml ?? ''}
        </div>
        ${safeIntro ? `<p class="page-intro">${safeIntro}</p>` : ''}
      </div>
    </header>
  `;
}

export function renderInlineStatusRegion(): string {
  return '<div class="page-status-region" data-inline-status-region></div>';
}

export function renderPageContextTags(tags: PageContextTag[]): string {
  const markup = tags
    .filter((tag) => tag.label.trim().length > 0)
    .map((tag) => {
      const safeLabel = escapeHtml(tag.label);
      const tone = tag.tone ?? 'neutral';
      return `<span class="page-context-tag page-context-tag--${tone}">${safeLabel}</span>`;
    })
    .join('');

  if (!markup) return '';

  return `<div class="page-context-meta" aria-label="Contexto de la vista">${markup}</div>`;
}

export function renderSectionHead(input: SectionHeadInput): string {
  const safeTitle = escapeHtml(input.title);
  const safeCopy = input.copy ? escapeHtml(input.copy) : '';
  const titleTag = input.titleTag ?? 'h3';
  const idAttr = input.id ? ` id="${escapeHtml(input.id)}"` : '';

  return `
    <div class="section-head">
      <div class="section-head-copy">
        <${titleTag} class="section-head-title"${idAttr}>${safeTitle}</${titleTag}>
        ${safeCopy ? `<p class="section-head-copy-text">${safeCopy}</p>` : ''}
      </div>
      ${input.actionsHtml ? `<div class="section-head-actions">${input.actionsHtml}</div>` : ''}
    </div>
  `;
}
