import { MARKET_POLL_INTERVAL_MS } from './constants';

type TickCallback = (forceRefresh: boolean) => void | Promise<void>;

const subscribers = new Set<TickCallback>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let isHydrating = false;
let nextTickAt: number | null = null;

async function invokeSubscriber(callback: TickCallback, forceRefresh: boolean): Promise<void> {
  try {
    await callback(forceRefresh);
  } catch (err) {
    // Individual subscriber errors must not break other subscribers.
    if (import.meta.env.DEV) {
      console.warn('[market-poller] subscriber failed', err);
    }
  }
}

async function runTick(forceRefresh = true): Promise<void> {
  if (isHydrating) return;
  if (subscribers.size === 0) return;

  isHydrating = true;
  try {
    const promises = Array.from(subscribers).map((cb) => invokeSubscriber(cb, forceRefresh));
    await Promise.all(promises);
  } finally {
    isHydrating = false;
  }
}

function startTimer(): void {
  if (pollTimer) return;
  nextTickAt = Date.now() + MARKET_POLL_INTERVAL_MS;
  pollTimer = setInterval(() => {
    nextTickAt = Date.now() + MARKET_POLL_INTERVAL_MS;
    void runTick(true);
  }, MARKET_POLL_INTERVAL_MS);
}

/**
 * Subscribes a callback to the central market polling interval.
 * Returns an unsubscribe function.
 */
export function subscribeToMarketTicks(callback: TickCallback, runImmediately = true): () => void {
  subscribers.add(callback);

  if (subscribers.size === 1) {
    startTimer();
  }

  // Si se pide ejecución inicial, no forzamos el caché de red.
  if (runImmediately) {
    // Escapar el loop asíncrono para no bloquear la suscripción
    setTimeout(() => {
      if (subscribers.has(callback)) {
        void invokeSubscriber(callback, false);
      }
    }, 0);
  }

  return () => {
    subscribers.delete(callback);
  };
}

export function getNextMarketPollAt(): number | null {
  return nextTickAt;
}

export function resetMarketPollerForTests(): void {
  subscribers.clear();
  isHydrating = false;
  nextTickAt = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
