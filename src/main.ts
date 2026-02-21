import './styles/global.css';
import { renderDashboard } from './components/dashboard';
import { renderPositions } from './components/positions';
import { renderSimulator } from './components/simulator';
import { renderCalculadora } from './components/calculadora';
import { exportBackup, importBackup } from './utils/storage';
import { todayISODateLocal } from './utils/date';
import { initTheme, toggleTheme, getResolvedTheme } from './utils/theme';
import { syncApiLastUpdatedLabel } from './utils/api-status';
import { iconDashboard, iconLayers, iconTrendingUp, iconCalculator, iconArchive, iconChevronUp, iconChevronDown, iconDownload, iconUpload, iconSun, iconMoon } from './utils/icons';
import type { View } from './types';

let currentView: View = 'dashboard';

/** Captured bounding rects of shared cards before a view change. */
let snapshotRects: Map<string, DOMRect> | null = null;

/** Whether the next render is a view-switch (vs. an in-view state change). */
let isViewSwitch = false;
let disposeActiveView: (() => void) | null = null;

function init(): void {
  const app = document.getElementById('app');
  if (!app) return;

  initTheme();
  render(app);

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.slice(1) as View;
    if (['dashboard', 'positions', 'simulator', 'calculadora'].includes(hash)) {
      navigateTo(hash, app);
    }
  });

  const hash = window.location.hash.slice(1) as View;
  if (['dashboard', 'positions', 'simulator', 'calculadora'].includes(hash)) {
    currentView = hash;
    render(app);
  }
}

function themeIcon(): string {
  return getResolvedTheme() === 'dark' ? iconSun(15) : iconMoon(15);
}

function render(app: HTMLElement): void {
  disposeActiveView?.();
  disposeActiveView = null;

  app.innerHTML = `
    <header class="app-header">
      <div class="app-brand">
        <div class="app-title">Crypto <span>Portfolio Tracker</span></div>
        <div class="app-last-update" id="app-last-update">Actualizado: pendiente</div>
      </div>
      <nav class="nav">
        <button class="nav-btn ${currentView === 'dashboard' ? 'active' : ''}" data-view="dashboard">${iconDashboard(15)}Dashboard</button>
        <button class="nav-btn ${currentView === 'positions' ? 'active' : ''}" data-view="positions">${iconLayers(15)}Posiciones</button>
        <button class="nav-btn ${currentView === 'simulator' ? 'active' : ''}" data-view="simulator">${iconTrendingUp(15)}Simulador</button>
        <button class="nav-btn ${currentView === 'calculadora' ? 'active' : ''}" data-view="calculadora">${iconCalculator(15)}Calculadora</button>
        <button class="nav-btn" id="btn-backup" title="Exportar/Importar datos">${iconArchive(15)}</button>
        <button class="theme-toggle" id="btn-theme" title="Cambiar tema">${themeIcon()}</button>
      </nav>
    </header>
    <main id="view-container"></main>

    <!-- Backup modal -->
    <div id="modal-backup" class="modal-overlay" style="display:none">
      <div class="modal">
        <h3 class="modal-title">Backup de datos</h3>
        <div style="display:flex;flex-direction:column;gap:var(--space-md)">
          <button class="btn btn-primary" id="btn-export">${iconDownload(15)}Exportar JSON</button>
          <div style="border-top:1px solid var(--border);padding-top:var(--space-md)">
            <label class="text-secondary" style="font-size:0.8rem;display:flex;align-items:center;gap:6px;margin-bottom:var(--space-sm)">
              ${iconUpload(14)}Importar backup JSON
            </label>
            <input type="file" id="backup-file-input" accept=".json" style="font-size:0.8rem;color:var(--text-secondary)">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="btn-close-backup">Cerrar</button>
        </div>
      </div>
    </div>
  `;
  syncApiLastUpdatedLabel();

  const viewContainer = document.getElementById('view-container')!;
  const onStateChange = () => render(app);

  switch (currentView) {
    case 'dashboard':
      disposeActiveView = renderDashboard(viewContainer, onStateChange);
      break;
    case 'positions':
      disposeActiveView = renderPositions(viewContainer, onStateChange);
      break;
    case 'simulator':
      disposeActiveView = renderSimulator(viewContainer);
      break;
    case 'calculadora':
      renderCalculadora(viewContainer);
      break;
  }

  // After rendering, animate shared cards via FLIP + stagger non-shared
  if (isViewSwitch) {
    isViewSwitch = false;
    animateViewEntry(viewContainer);
  }

  // Nav events
  app.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextView = (btn as HTMLElement).dataset.view as View;
      if (nextView === currentView) return;

      if (window.location.hash.slice(1) !== nextView) {
        window.location.hash = nextView;
      } else {
        navigateTo(nextView, app);
      }
    });
  });

  // Theme toggle
  app.querySelector('#btn-theme')?.addEventListener('click', () => {
    toggleTheme();
    render(app);
  });

  bindBackupEvents(app, onStateChange);
  enhanceNumberSteppers(app);
}

function countDecimals(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const text = String(n);
  const dotIndex = text.indexOf('.');
  return dotIndex >= 0 ? text.length - dotIndex - 1 : 0;
}

function stepNumberInput(input: HTMLInputElement, direction: 1 | -1): void {
  if (input.disabled || input.readOnly) return;

  const rawStep = input.step === '' || input.step === 'any' ? NaN : Number(input.step);
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1;
  const min = input.min === '' ? NaN : Number(input.min);
  const max = input.max === '' ? NaN : Number(input.max);

  let current = Number(input.value);
  if (!Number.isFinite(current)) {
    current = Number.isFinite(min) ? min : 0;
  }

  let next = current + direction * step;
  if (Number.isFinite(min)) next = Math.max(min, next);
  if (Number.isFinite(max)) next = Math.min(max, next);

  const decimals = countDecimals(step);
  input.value = decimals > 0 ? next.toFixed(decimals) : String(Math.round(next));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function enhanceNumberSteppers(root: ParentNode): void {
  const inputs = root.querySelectorAll('input[type="number"]');
  inputs.forEach((node) => {
    const input = node as HTMLInputElement;
    if (input.dataset.stepperReady === '1') return;
    if (!input.parentElement) return;

    input.dataset.stepperReady = '1';
    input.classList.add('num-stepper-input');

    const wrapper = document.createElement('div');
    wrapper.className = 'num-stepper-wrap';
    input.parentElement.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const controls = document.createElement('div');
    controls.className = 'num-stepper-controls';

    const btnUp = document.createElement('button');
    btnUp.type = 'button';
    btnUp.className = 'num-stepper-btn';
    btnUp.setAttribute('aria-label', 'Aumentar valor');
    btnUp.innerHTML = iconChevronUp(12);
    btnUp.addEventListener('click', () => stepNumberInput(input, 1));

    const btnDown = document.createElement('button');
    btnDown.type = 'button';
    btnDown.className = 'num-stepper-btn';
    btnDown.setAttribute('aria-label', 'Reducir valor');
    btnDown.innerHTML = iconChevronDown(12);
    btnDown.addEventListener('click', () => stepNumberInput(input, -1));

    controls.appendChild(btnUp);
    controls.appendChild(btnDown);
    wrapper.appendChild(controls);
  });
}

function bindBackupEvents(app: HTMLElement, onStateChange: () => void): void {
  const modal = app.querySelector('#modal-backup') as HTMLElement;

  app.querySelector('#btn-backup')?.addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  app.querySelector('#btn-close-backup')?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  app.querySelector('#btn-export')?.addEventListener('click', () => {
    const json = exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crypto-tracker-backup-${todayISODateLocal()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const fileInput = app.querySelector('#backup-file-input') as HTMLInputElement;
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        importBackup(json);
        modal.style.display = 'none';
        onStateChange();
      } catch {
        alert('Error al importar el archivo. Asegurate de que sea un JSON valido.');
      }
    };
    reader.readAsText(file);
  });
}

// ── View transition orchestration ──

/** Snapshot shared-card positions, flag the switch, and re-render. */
function navigateTo(view: View, app: HTMLElement): void {
  if (view === currentView) return;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1) Capture "First" rects of shared cards
  if (!prefersReduced) {
    const container = document.getElementById('view-container');
    if (container) {
      const rects = new Map<string, DOMRect>();
      container.querySelectorAll<HTMLElement>('[data-shared-card]').forEach(el => {
        const key = el.dataset.sharedCard;
        if (key) rects.set(key, el.getBoundingClientRect());
      });
      snapshotRects = rects.size > 0 ? rects : null;
    }
  }

  isViewSwitch = true;
  currentView = view;

  // 2) Use View Transitions API when available for a smooth crossfade
  if (!prefersReduced && 'startViewTransition' in document) {
    (document as any).startViewTransition(() => render(app));
  } else {
    render(app);
  }
}

/** After a view-switch render, animate shared cards (FLIP) and stagger the rest. */
function animateViewEntry(container: HTMLElement): void {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) { snapshotRects = null; return; }

  const oldRects = snapshotRects;
  snapshotRects = null;
  const movedKeys = new Set<string>();

  // ── FLIP shared cards ──
  if (oldRects && oldRects.size > 0) {
    container.querySelectorAll<HTMLElement>('[data-shared-card]').forEach(el => {
      const key = el.dataset.sharedCard;
      if (!key) return;
      const from = oldRects.get(key);
      if (!from) return;

      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;

      // Only translate — no scale to avoid visual distortion
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      movedKeys.add(key);

      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 1 },
          { transform: 'translate(0, 0)', opacity: 1 },
        ],
        {
          duration: 360,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'none',
        },
      );
    });
  }

  // ── Staggered entrance for non-shared cards ──
  let delay = 0;
  container.querySelectorAll<HTMLElement>('.card, .stat-card').forEach(el => {
    const key = el.dataset.sharedCard;
    if (key && movedKeys.has(key)) return; // already FLIP-animated

    el.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: 320,
        delay,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'backwards',  // keeps opacity:0 during delay
      },
    );
    delay += 40;
  });
}

document.addEventListener('DOMContentLoaded', init);
