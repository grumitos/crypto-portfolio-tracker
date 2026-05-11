import type { View } from '../types';

let currentView: View = 'dashboard';
let snapshotRects: Map<string, DOMRect> | null = null;
let isViewSwitch = false;
let hashChangeHandler: (() => void) | null = null;

export function getCurrentView(): View {
  return currentView;
}

function ignoreViewTransitionAbort(transition: {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
}): void {
  void transition.ready.catch(() => undefined);
  void transition.updateCallbackDone.catch(() => undefined);
  void transition.finished.catch(() => undefined);
}

export function initRouter(onNavigate: (view: View) => void): void {
  if (hashChangeHandler) {
    window.removeEventListener('hashchange', hashChangeHandler);
  }

  hashChangeHandler = () => {
    const hash = window.location.hash.slice(1) as View;
    if (['dashboard', 'positions', 'simulator', 'calculadora'].includes(hash)) {
      navigateTo(hash, onNavigate);
    }
  };

  window.addEventListener('hashchange', hashChangeHandler);

  const hash = window.location.hash.slice(1) as View;
  if (['dashboard', 'positions', 'simulator', 'calculadora'].includes(hash)) {
    currentView = hash;
  }
}

export function resetRouterForTests(): void {
  currentView = 'dashboard';
  snapshotRects = null;
  isViewSwitch = false;
  if (hashChangeHandler) {
    window.removeEventListener('hashchange', hashChangeHandler);
    hashChangeHandler = null;
  }
}

export function navigateTo(view: View, onNavigate: (view: View) => void): void {
  if (view === currentView) return;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!prefersReduced) {
    const container = document.getElementById('view-container');
    if (container) {
      const rects = new Map<string, DOMRect>();
      container.querySelectorAll<HTMLElement>('[data-shared-card]').forEach((el) => {
        const key = el.dataset.sharedCard;
        if (key) rects.set(key, el.getBoundingClientRect());
      });
      snapshotRects = rects.size > 0 ? rects : null;
    }
  }

  isViewSwitch = true;
  currentView = view;

  if (!prefersReduced && 'startViewTransition' in document) {
    let didNavigate = false;
    try {
      ignoreViewTransitionAbort(
        document.startViewTransition!(() => {
          didNavigate = true;
          onNavigate(view);
        }),
      );
    } catch {
      if (!didNavigate) {
        onNavigate(view);
      }
    }
  } else {
    onNavigate(view);
  }
}

export function handleTransitionEntry(container: HTMLElement): void {
  if (!isViewSwitch) return;
  isViewSwitch = false;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    snapshotRects = null;
    return;
  }

  const oldRects = snapshotRects;
  snapshotRects = null;
  const movedKeys = new Set<string>();

  if (oldRects && oldRects.size > 0) {
    container.querySelectorAll<HTMLElement>('[data-shared-card]').forEach((el) => {
      const key = el.dataset.sharedCard;
      if (!key) return;
      const from = oldRects.get(key);
      if (!from) return;

      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;

      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      movedKeys.add(key);

      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 1 },
          { transform: 'translate(0, 0)', opacity: 1 },
        ],
        {
          duration: 180,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'none',
        },
      );
    });
  }

  let delay = 0;
  container
    .querySelectorAll<HTMLElement>('.card, .stat-card, .positions-spot-card')
    .forEach((el) => {
      const key = el.dataset.sharedCard;
      if (key && movedKeys.has(key)) return;

      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 160,
        delay,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'backwards',
      });
      delay += 12;
    });
}
