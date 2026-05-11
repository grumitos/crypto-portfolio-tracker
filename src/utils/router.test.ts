import { beforeEach, describe, expect, it, vi } from '#test';

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockImplementation(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
    configurable: true,
    writable: true,
  });
}

function setRect(el: HTMLElement, left: number, top: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      x: left,
      y: top,
      left,
      top,
      right: left + 100,
      bottom: top + 40,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    }),
    configurable: true,
  });
}

async function loadRouterModule() {
  const router = await import('./router');
  router.resetRouterForTests();
  return router;
}

describe('router', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.location.hash = '';
    mockMatchMedia(false);
    Reflect.deleteProperty(document, 'startViewTransition');
  });

  it('initializes from hash and navigates only for valid hash routes', async () => {
    window.location.hash = '#positions';
    const router = await loadRouterModule();
    const onNavigate = vi.fn();

    router.initRouter(onNavigate);
    expect(router.getCurrentView()).toBe('positions');

    window.location.hash = '#simulator';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(onNavigate).toHaveBeenCalledWith('simulator');

    const before = onNavigate.mock.calls.length;
    window.location.hash = '#invalid';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(onNavigate.mock.calls.length).toBe(before);
  });

  it('skips navigation when target view is already active', async () => {
    const router = await loadRouterModule();
    const onNavigate = vi.fn();

    router.navigateTo('dashboard', onNavigate);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('uses View Transitions API when available and motion is enabled', async () => {
    const router = await loadRouterModule();
    const onNavigate = vi.fn();
    const transitionSpy = vi.fn((callback: () => void) => callback());
    Object.defineProperty(document, 'startViewTransition', {
      value: transitionSpy,
      configurable: true,
      writable: true,
    });

    router.navigateTo('positions', onNavigate);

    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('positions');
  });

  it('absorbs aborted View Transition promises', async () => {
    const router = await loadRouterModule();
    const onNavigate = vi.fn();
    const ready = Promise.reject(new DOMException('aborted', 'InvalidStateError'));
    const updateCallbackDone = Promise.reject(new DOMException('aborted', 'InvalidStateError'));
    const finished = Promise.reject(new DOMException('aborted', 'InvalidStateError'));
    const readyCatch = vi.spyOn(ready, 'catch');
    const updateCatch = vi.spyOn(updateCallbackDone, 'catch');
    const finishedCatch = vi.spyOn(finished, 'catch');

    Object.defineProperty(document, 'startViewTransition', {
      value: vi.fn((callback: () => void) => {
        callback();
        return { ready, updateCallbackDone, finished };
      }),
      configurable: true,
      writable: true,
    });

    router.navigateTo('positions', onNavigate);

    expect(onNavigate).toHaveBeenCalledWith('positions');
    expect(readyCatch).toHaveBeenCalledTimes(1);
    expect(updateCatch).toHaveBeenCalledTimes(1);
    expect(finishedCatch).toHaveBeenCalledTimes(1);
    await Promise.allSettled([ready, updateCallbackDone, finished]);
  });

  it('falls back to direct navigation when reduced motion is enabled', async () => {
    mockMatchMedia(true);
    const router = await loadRouterModule();
    const onNavigate = vi.fn();

    router.navigateTo('positions', onNavigate);

    expect(onNavigate).toHaveBeenCalledWith('positions');
  });

  it('animates shared cards and fades non-shared cards on view entry', async () => {
    const router = await loadRouterModule();
    const container = document.createElement('div');
    container.id = 'view-container';
    document.body.appendChild(container);

    const oldShared = document.createElement('div');
    oldShared.className = 'card';
    oldShared.dataset.sharedCard = 'apr';
    setRect(oldShared, 120, 80);

    const oldRegular = document.createElement('div');
    oldRegular.className = 'card';
    setRect(oldRegular, 10, 10);

    container.append(oldShared, oldRegular);

    const animateMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      value: animateMock,
      configurable: true,
      writable: true,
    });

    router.navigateTo('positions', () => {
      container.innerHTML = '';
      const movedShared = document.createElement('div');
      movedShared.className = 'card';
      movedShared.dataset.sharedCard = 'apr';
      setRect(movedShared, 40, 20);

      const newRegular = document.createElement('div');
      newRegular.className = 'card';
      setRect(newRegular, 5, 5);

      container.append(movedShared, newRegular);
    });

    router.handleTransitionEntry(container);

    expect(animateMock).toHaveBeenCalled();
    const callsAfterFirstEntry = animateMock.mock.calls.length;
    router.handleTransitionEntry(container);
    expect(animateMock.mock.calls.length).toBe(callsAfterFirstEntry);
  });

  it('skips entry animations when reduced motion is enabled', async () => {
    mockMatchMedia(true);
    const router = await loadRouterModule();
    const container = document.createElement('div');
    container.id = 'view-container';
    container.innerHTML = `<div class="card"></div>`;
    document.body.appendChild(container);

    const animateMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      value: animateMock,
      configurable: true,
      writable: true,
    });

    router.navigateTo('positions', () => {});
    router.handleTransitionEntry(container);

    expect(animateMock).not.toHaveBeenCalled();
  });
});
