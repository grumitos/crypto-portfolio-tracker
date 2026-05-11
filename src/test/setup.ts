import { afterEach, setSystemTime, vi } from 'bun:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost:5176/',
  pretendToBeVisual: true,
});

const originalGlobalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
const forcedWindowGlobals = [
  'AbortController',
  'AbortSignal',
  'Blob',
  'CloseEvent',
  'CustomEvent',
  'DOMException',
  'DragEvent',
  'ErrorEvent',
  'Event',
  'File',
  'FileList',
  'FileReader',
  'FocusEvent',
  'HashChangeEvent',
  'InputEvent',
  'KeyboardEvent',
  'MouseEvent',
  'PageTransitionEvent',
  'PointerEvent',
  'PopStateEvent',
  'ProgressEvent',
  'StorageEvent',
  'SubmitEvent',
  'UIEvent',
  'WheelEvent',
] as const;

function installWindowGlobals(): void {
  Object.defineProperty(globalThis, 'window', {
    value: dom.window,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: dom.window.document,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  for (const key of Reflect.ownKeys(dom.window)) {
    if (key in globalThis || key === 'undefined') continue;
    const descriptor = Object.getOwnPropertyDescriptor(dom.window, key);
    if (!descriptor) continue;
    Object.defineProperty(globalThis, key, descriptor);
  }

  for (const key of forcedWindowGlobals) {
    const descriptor = Object.getOwnPropertyDescriptor(dom.window, key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  }
}

function rememberGlobal(name: PropertyKey): void {
  if (!originalGlobalDescriptors.has(name)) {
    originalGlobalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
}

function stubGlobal(name: PropertyKey, value: unknown): void {
  rememberGlobal(name);
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

function unstubAllGlobals(): void {
  for (const [name, descriptor] of originalGlobalDescriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
  originalGlobalDescriptors.clear();
}

async function advanceTimersByTimeAsync(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

installWindowGlobals();

Object.assign(vi, {
  advanceTimersByTimeAsync,
  hoisted: <T>(factory: () => T): T => factory(),
  mocked: <T>(value: T): T => value,
  resetModules: () => {},
  setSystemTime: (date?: Date | number | string) =>
    setSystemTime(date ? new Date(date) : undefined),
  stubGlobal,
  unstubAllGlobals,
});

afterEach(() => {
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setSystemTime();
  unstubAllGlobals();
});

export {};
