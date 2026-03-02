import { MARKET_POLL_INTERVAL_MS } from './constants';

type TickCallback = (forceRefresh: boolean) => void | Promise<void>;

const subscribers = new Set<TickCallback>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let isHydrating = false;

async function runTick(forceRefresh = true): Promise<void> {
    if (isHydrating) return;
    if (subscribers.size === 0) return;

    isHydrating = true;
    try {
        const promises = Array.from(subscribers).map(cb => {
            try {
                return cb(forceRefresh);
            } catch (err) {
                // Individual subscriber errors must not break other subscribers.
                if (import.meta.env.DEV) {
                    console.warn('[market-poller] subscriber failed', err);
                }
            }
        });
        await Promise.all(promises);
    } finally {
        isHydrating = false;
    }
}

function startTimer(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => runTick(true), MARKET_POLL_INTERVAL_MS);
}

function stopTimer(): void {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
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
                void callback(false);
            }
        }, 0);
    }

    return () => {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
            stopTimer();
        }
    };
}
