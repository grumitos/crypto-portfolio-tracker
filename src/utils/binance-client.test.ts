import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../test/test-utils';

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => null,
    } as unknown as Headers,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function createCryptoStub(): Crypto {
  return {
    subtle: {
      importKey: vi.fn().mockResolvedValue({}),
      sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
    },
  } as unknown as Crypto;
}

describe('binance client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();

    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, 'crypto', {
      value: createCryptoStub(),
      configurable: true,
      writable: true,
    });
  });

  async function seedCredentials(): Promise<void> {
    const { saveApiCredentials } = await import('./binance-auth');
    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
  }

  it('maps dual positions using the current Binance response fields', async () => {
    await seedCredentials();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        total: 3,
        list: [
          {
            id: '1',
            investCoin: 'USDT',
            exercisedCoin: 'BNB',
            subscriptionAmount: '0.5',
            strikePrice: '330',
            duration: 4,
            settleDate: 1708416000000,
            purchaseStatus: 'PURCHASE_SUCCESS',
            apr: '0.0365',
            orderId: 7973677530,
            purchaseEndTime: 1708329600000,
            optionType: 'PUT',
          },
          {
            id: '2',
            investCoin: 'BNB',
            exercisedCoin: 'USDT',
            subscriptionAmount: '0.1',
            strikePrice: '380',
            duration: 4,
            settleDate: 1709020800000,
            purchaseStatus: 'SETTLING',
            apr: '0.7397',
            orderId: 8259117597,
            purchaseEndTime: 1708934400000,
            optionType: 'CALL',
          },
          {
            id: '3',
            investCoin: 'USDT',
            exercisedCoin: 'BTC',
            subscriptionAmount: '100',
            strikePrice: '45000',
            duration: 2,
            settleDate: 1709107200000,
            purchaseStatus: 'SETTLED',
            apr: '0.10',
            optionType: 'PUT',
          },
        ],
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./binance-client');
    const positions = await client.fetchDualPositions(true);

    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({
      id: '1',
      amount: 0.5,
      apr: 3.65,
      status: 'PURCHASE_SUCCESS',
      orderId: '7973677530',
      optionType: 'PUT',
    });
    expect(positions[1]).toMatchObject({
      id: '2',
      amount: 0.1,
      apr: 73.97,
      status: 'SETTLING',
      orderId: '8259117597',
      optionType: 'CALL',
    });
  });

  it('normalizes Binance LD asset wrappers and merges balances by underlying asset', async () => {
    await seedCredentials();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        balances: [
          { asset: 'USDC', free: '12.5', locked: '0' },
          { asset: 'LDUSDC', free: '7.25', locked: '1.25' },
          { asset: 'LDBTC', free: '0.010000', locked: '0' },
          { asset: 'BTC', free: '0.020000', locked: '0.005000' },
          { asset: 'USDT', free: '0', locked: '0' },
        ],
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./binance-client');
    const balances = await client.fetchAccountBalances(true);

    expect(balances).toEqual([
      { asset: 'USDC', free: 19.75, locked: 1.25 },
      { asset: 'BTC', free: 0.03, locked: 0.005 },
    ]);
  });

  it('normalizes LD assets in dual positions to their underlying symbol', async () => {
    await seedCredentials();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        total: 1,
        list: [
          {
            id: '1',
            investCoin: 'LDUSDC',
            exercisedCoin: 'BTC',
            subscriptionAmount: '250',
            strikePrice: '45000',
            duration: 2,
            settleDate: 1708416000000,
            purchaseStatus: 'PURCHASE_SUCCESS',
            apr: '0.12',
            orderId: 7973677530,
            purchaseEndTime: 1708329600000,
            optionType: 'PUT',
          },
        ],
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./binance-client');
    const positions = await client.fetchDualPositions(true);

    expect(positions[0]).toMatchObject({
      investCoin: 'USDC',
      exercisedCoin: 'BTC',
    });
  });

  it('tests explicit credentials without reading persisted credentials', async () => {
    localStorage.clear();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/account/apiRestrictions')) {
        return Promise.resolve(
          jsonResponse({
            enableReading: true,
            enableWithdrawals: false,
            enableInternalTransfer: false,
            enableMargin: false,
            enableFutures: false,
            permitsUniversalTransfer: false,
            enableVanillaOptions: false,
            enableFixApiTrade: false,
            enableSpotAndMarginTrading: false,
            enablePortfolioMarginTrading: false,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ permissions: ['SPOT'] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./binance-client');
    const result = await client.testApiConnection({
      apiKey: 'direct-key',
      apiSecret: 'direct-secret',
    });

    expect(result).toEqual({
      success: true,
      permissions: ['SPOT'],
      readOnly: true,
      permissionWarnings: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('crypto-binance-api')).toBeNull();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-MBX-APIKEY']).toBe('direct-key');
    expect(init.cache).toBe('no-store');
  });

  it('flags Binance keys with execution or movement permissions as not read-only', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/account/apiRestrictions')) {
        return Promise.resolve(
          jsonResponse({
            enableReading: true,
            enableWithdrawals: true,
            enableSpotAndMarginTrading: true,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ permissions: ['SPOT'] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./binance-client');
    const result = await client.testApiConnection({
      apiKey: 'direct-key',
      apiSecret: 'direct-secret',
    });

    expect(result.success).toBe(true);
    expect(result.readOnly).toBe(false);
    expect(result.permissionWarnings).toEqual([
      'Permiso de escritura activo: WITHDRAW',
      'Permiso de escritura activo: SPOT_MARGIN_TRADING',
    ]);
  });

  it('blocks private reads when stored Binance credentials are not read-only', async () => {
    await seedCredentials();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/account/apiRestrictions')) {
        return Promise.resolve(
          jsonResponse({
            enableWithdrawals: true,
            enableSpotAndMarginTrading: true,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ balances: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./binance-client');
    await expect(client.fetchAccountBalances(true)).rejects.toThrow('not read-only');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
