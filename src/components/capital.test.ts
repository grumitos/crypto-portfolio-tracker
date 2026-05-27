import { beforeEach, describe, expect, it, vi } from '#test';
import { renderCapital } from './capital';
import { getDefaultCapitalLedgerState, loadState, saveState } from '../utils/storage';
import { createMemoryStorage, flushMicrotasks, resetDom } from '../test/test-utils';
import type { CapitalLedgerState } from '../types';

const USER = '0x1111111111111111111111111111111111111111';
const VAULT = '0x2222222222222222222222222222222222222222';

function seedCapitalLedger(ledger: CapitalLedgerState): void {
  const state = loadState();
  state.capitalLedger = ledger;
  saveState(state);
}

describe('capital tab', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    resetDom();
  });

  it('renders capital ledger summary, vault rows and movement rows', () => {
    const ledger = getDefaultCapitalLedgerState();
    ledger.vault = {
      activeValue: '110',
      activeValueAt: '2026-05-02T00:00:00.000Z',
      pnlTotal: '',
    };
    ledger.lastSync = {
      ok: true,
      fetchedAt: '2026-05-02T00:00:00.000Z',
      config: { userAddress: USER, vaultAddress: VAULT },
      summary: { activeValue: '110', pnlTotal: '10', vaultCount: 1, movementCount: 1 },
      discoveredVaults: [],
      vaults: [
        {
          vaultAddress: VAULT,
          url: `https://app.hyperliquid.xyz/vaults/${VAULT}`,
          name: 'Main vault',
          apr: 42,
          user: {
            userAddress: USER,
            vaultEquity: '110',
            pnl: '10',
            allTimePnl: '10',
            daysFollowing: 1,
            vaultEntryTime: null,
            lockupUntil: null,
          },
        },
      ],
      movements: [{ at: '2026-05-01T00:00:00.000Z', type: 'deposit', amount: '100' }],
    };
    ledger.transactions = ledger.lastSync.movements;
    seedCapitalLedger(ledger);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderCapital(container);

    expect(container.querySelector('#capital-active-value')?.textContent).toContain('$110.00');
    expect(container.querySelector('#capital-pnl')?.textContent).toContain('$10.00');
    expect(container.querySelector('#capital-vaults')?.textContent).toContain('Main vault');
    expect(container.querySelector('#capital-movements')?.textContent).toContain('$100.00');

    dispose();
    container.remove();
  });

  it('syncs Hyperliquid data and persists the ledger in app state', async () => {
    vi.stubGlobal(
      'fetch',
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        expect(String(init?.body)).toContain(USER);
        return Response.json({
          ok: true,
          fetchedAt: '2026-05-02T00:00:00.000Z',
          config: { userAddress: USER, vaultAddress: VAULT },
          summary: { activeValue: '105', pnlTotal: '6', vaultCount: 1, movementCount: 1 },
          discoveredVaults: [],
          vaults: [
            {
              vaultAddress: VAULT,
              url: `https://app.hyperliquid.xyz/vaults/${VAULT}`,
              name: 'Main vault',
              apr: null,
              user: {
                userAddress: USER,
                vaultEquity: '105',
                pnl: '5',
                allTimePnl: '6',
                daysFollowing: 1,
                vaultEntryTime: null,
                lockupUntil: null,
              },
            },
          ],
          movements: [{ at: '2026-05-01T00:00:00.000Z', type: 'deposit', amount: '100' }],
        });
      },
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = renderCapital(container);

    const userInput = container.querySelector('#capital-user-address') as HTMLInputElement;
    const vaultInput = container.querySelector('#capital-vault-address') as HTMLInputElement;
    userInput.value = USER;
    userInput.dispatchEvent(new Event('input', { bubbles: true }));
    vaultInput.value = VAULT;
    vaultInput.dispatchEvent(new Event('input', { bubbles: true }));
    (container.querySelector('#capital-sync') as HTMLButtonElement).click();
    await flushMicrotasks();
    await flushMicrotasks();

    const saved = loadState().capitalLedger;
    expect(saved.hyperliquid.userAddress).toBe(USER);
    expect(saved.hyperliquid.vaultAddress).toBe(VAULT);
    expect(saved.vault.activeValue).toBe('105');
    expect(saved.vault.pnlTotal).toBe('6');
    expect(container.querySelector('#capital-status')?.textContent).toContain('Actualizado');

    dispose();
    container.remove();
  });
});
