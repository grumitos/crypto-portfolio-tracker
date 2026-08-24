import { loadState, saveCapitalLedgerState } from '../utils/storage';
import { showApiErrorBanner } from '../utils/notifications';
import { calculateCapitalLedgerSummary } from '../utils/capital-ledger';
import { normalizeHyperliquidAddress } from '../utils/hyperliquid-sync';
import { CAPITAL_COPY } from './capital.constants';
import { renderCapitalTemplate } from './capital.template';
import type { CapitalLedgerState, CapitalLedgerSyncSnapshot } from '../types';

interface CapitalRenderState {
  isSyncing: boolean;
  statusText: string;
}

function trimAmount(value: number): string {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(12).replace(/\.?0+$/, '');
}

function formatStatusDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(
    date.getMonth() + 1,
  )}/${date.getFullYear()}`;
}

function resolveStatusText(ledger: CapitalLedgerState, override = ''): string {
  if (override) return override;
  const lastSyncAt = ledger.hyperliquid.lastSyncAt || ledger.lastSync?.fetchedAt || '';
  if (lastSyncAt) {
    const formatted = formatStatusDate(lastSyncAt);
    return formatted
      ? `${CAPITAL_COPY.statusUpdatedPrefix} ${formatted}`
      : CAPITAL_COPY.statusReady;
  }
  if (ledger.hyperliquid.userAddress || ledger.hyperliquid.vaultAddress) {
    return CAPITAL_COPY.statusReady;
  }
  return CAPITAL_COPY.statusEmpty;
}

function extractApiError(error: unknown): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const payload = (error as { error?: { message?: unknown } }).error;
    if (typeof payload?.message === 'string' && payload.message.trim()) {
      return payload.message;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return CAPITAL_COPY.statusError;
}

function buildLedgerFromSnapshot(snapshot: CapitalLedgerSyncSnapshot): CapitalLedgerState {
  const ledger: CapitalLedgerState = {
    schemaVersion: 2,
    vault: {
      activeValue: snapshot.summary.activeValue,
      activeValueAt: snapshot.fetchedAt,
      pnlTotal: snapshot.summary.pnlTotal,
    },
    hyperliquid: {
      vaultAddress: snapshot.config.vaultAddress,
      userAddress: snapshot.config.userAddress,
      lastSyncAt: snapshot.fetchedAt,
    },
    lastSync: snapshot,
    transactions: snapshot.movements,
  };
  const summary = calculateCapitalLedgerSummary(ledger, {
    pnlSourceOfTruth: true,
    useValuationDate: true,
  });

  ledger.vault.activeValue = trimAmount(summary.activeValue);
  ledger.vault.activeValueAt = snapshot.fetchedAt;
  ledger.vault.pnlTotal = trimAmount(summary.pnlTotal);
  return ledger;
}

function readSyncPayload(container: HTMLElement): { userAddress: string; vaultAddress: string } {
  const userInput = container.querySelector<HTMLInputElement>('#capital-user-address');
  const vaultInput = container.querySelector<HTMLInputElement>('#capital-vault-address');
  return {
    userAddress: normalizeHyperliquidAddress(userInput?.value),
    vaultAddress: normalizeHyperliquidAddress(vaultInput?.value),
  };
}

function canSync(container: HTMLElement): boolean {
  const { userAddress, vaultAddress } = readSyncPayload(container);
  return Boolean(userAddress || vaultAddress);
}

async function syncHyperliquid(payload: {
  userAddress: string;
  vaultAddress: string;
}): Promise<CapitalLedgerState> {
  if (!payload.userAddress && !payload.vaultAddress) {
    throw new Error('Ingresa una wallet o un vault.');
  }

  const response = await fetch('/api/hyperliquid/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as CapitalLedgerSyncSnapshot | { error?: unknown };
  if (!response.ok) throw data;

  return buildLedgerFromSnapshot(data as CapitalLedgerSyncSnapshot);
}

export function renderCapital(container: HTMLElement): () => void {
  const renderState: CapitalRenderState = {
    isSyncing: false,
    statusText: '',
  };
  let disposed = false;
  let autoSyncTimer: number | null = null;

  const render = (): void => {
    if (disposed) return;
    const ledger = loadState().capitalLedger;
    container.innerHTML = renderCapitalTemplate({
      ledger,
      statusText: renderState.isSyncing
        ? CAPITAL_COPY.statusSyncing
        : resolveStatusText(ledger, renderState.statusText),
      isSyncing: renderState.isSyncing,
    });
    bindEvents();
  };

  const runSync = async (isAuto = false): Promise<void> => {
    if (renderState.isSyncing || !canSync(container)) return;
    const payload = readSyncPayload(container);
    renderState.isSyncing = true;
    renderState.statusText = CAPITAL_COPY.statusSyncing;
    render();

    try {
      const nextLedger = await syncHyperliquid(payload);
      saveCapitalLedgerState(nextLedger);
      renderState.statusText = '';
      render();
    } catch (error) {
      const message = extractApiError(error);
      renderState.statusText = message;
      if (!isAuto) showApiErrorBanner(message);
      render();
    } finally {
      renderState.isSyncing = false;
      render();
    }
  };

  function bindEvents(): void {
    const syncButton = container.querySelector<HTMLButtonElement>('#capital-sync');
    const inputs = container.querySelectorAll<HTMLInputElement>(
      '#capital-user-address, #capital-vault-address',
    );

    if (syncButton) {
      syncButton.disabled = renderState.isSyncing || !canSync(container);
      syncButton.addEventListener('click', () => {
        void runSync(false);
      });
    }

    inputs.forEach((input) => {
      input.addEventListener('input', () => {
        const canSubmit = canSync(container);
        if (syncButton) syncButton.disabled = renderState.isSyncing || !canSubmit;
        renderState.statusText = canSubmit ? CAPITAL_COPY.statusReady : CAPITAL_COPY.statusEmpty;
        const status = container.querySelector<HTMLElement>('#capital-status');
        if (status) status.textContent = renderState.statusText;
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') void runSync(false);
      });
    });
  }

  render();

  autoSyncTimer = window.setInterval(() => {
    if (!disposed && canSync(container)) void runSync(true);
  }, 60_000);

  return () => {
    disposed = true;
    if (autoSyncTimer !== null) window.clearInterval(autoSyncTimer);
  };
}
