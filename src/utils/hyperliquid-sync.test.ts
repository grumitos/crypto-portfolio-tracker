import { describe, expect, it } from '#test';
import { syncHyperliquidVaults } from './hyperliquid-sync';

const USER = '0x1111111111111111111111111111111111111111';
const VAULT = '0x2222222222222222222222222222222222222222';

describe('hyperliquid sync normalization', () => {
  it('normalizes vault details, summary and movements from Hyperliquid info API', async () => {
    const calls: unknown[] = [];
    const fetchImpl = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push(body);

      if (body.type === 'vaultDetails') {
        return Response.json({
          name: 'Main vault',
          apr: 42.5,
          followerState: {
            user: USER,
            vaultEquity: '105',
            pnl: '5',
            allTimePnl: '6',
            daysFollowing: 2,
            vaultEntryTime: Date.UTC(2026, 4, 1),
            lockupUntil: Date.UTC(2026, 4, 8),
          },
        });
      }

      if (body.type === 'userNonFundingLedgerUpdates') {
        return Response.json([
          {
            time: Date.UTC(2026, 4, 1),
            hash: '0xabc',
            delta: {
              type: 'vaultDeposit',
              vault: VAULT,
              usdc: '100',
            },
          },
        ]);
      }

      return Response.json([]);
    };

    const snapshot = await syncHyperliquidVaults(
      { userAddress: USER, vaultAddress: VAULT },
      fetchImpl,
    );

    expect(calls).toHaveLength(2);
    expect(snapshot.config).toEqual({ userAddress: USER, vaultAddress: VAULT });
    expect(snapshot.summary.activeValue).toBe('105');
    expect(snapshot.summary.pnlTotal).toBe('6');
    expect(snapshot.summary.vaultCount).toBe(1);
    expect(snapshot.summary.movementCount).toBe(1);
    expect(snapshot.vaults[0].name).toBe('Main vault');
    expect(snapshot.vaults[0].url).toContain(VAULT);
    expect(snapshot.movements[0]).toEqual(
      expect.objectContaining({
        type: 'deposit',
        amount: '100',
        vaultAddress: VAULT,
      }),
    );
  });

  it('rejects invalid sync requests before calling Hyperliquid', async () => {
    let called = false;
    await expect(
      syncHyperliquidVaults({ userAddress: 'not-an-address' }, async (_input) => {
        called = true;
        return Response.json({});
      }),
    ).rejects.toThrow('Ingresa una direccion Hyperliquid valida.');
    expect(called).toBe(false);
  });
});
