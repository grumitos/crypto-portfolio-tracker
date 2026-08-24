import { beforeEach, describe, expect, it, vi } from '#test';
import { createMemoryStorage } from '../test/test-utils';
import { clearAllCaches } from './binance-client';

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

function errorResponse(status: number, payload: unknown): Response {
  return {
    ok: false,
    status,
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
    vi.unstubAllGlobals();
    clearAllCaches();

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
          {
            id: '4',
            investCoin: 'LDUSDC',
            exercisedCoin: 'BTC',
            subscriptionAmount: '250',
            strikePrice: '45000',
            duration: 2,
            settleDate: 1708416000000,
            purchaseStatus: 'PURCHASE_SUCCESS',
            apr: '0.12',
            optionType: 'PUT',
          },
        ],
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./binance-client');
    const positions = await client.fetchDualPositions(true);

    // Settled positions are dropped; LD wrappers map to their underlying asset.
    expect(positions).toHaveLength(3);
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
    expect(positions[2]).toMatchObject({
      id: '4',
      investCoin: 'USDC',
      exercisedCoin: 'BTC',
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
    const { balances } = await client.fetchAccountBalances(true);

    expect(balances).toEqual([
      { asset: 'USDC', free: 19.75, locked: 1.25 },
      { asset: 'BTC', free: 0.03, locked: 0.005 },
    ]);
  });

  it('includes funding and Simple Earn balances without double-counting LD wrappers', async () => {
    await seedCredentials();
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
      if (url.includes('/binance-api/v3/account')) {
        return Promise.resolve(
          jsonResponse({
            balances: [
              { asset: 'USDT', free: '5.00000000', locked: '0.00000000' },
              { asset: 'LDUSDT', free: '1022.55825975', locked: '0.00000000' },
              { asset: 'BTC', free: '0.01000000', locked: '0.00000000' },
            ],
          }),
        );
      }
      if (url.includes('/asset/get-funding-asset')) {
        return Promise.resolve(
          jsonResponse([
            {
              asset: 'USDT',
              free: '10.00000000',
              locked: '1.00000000',
              freeze: '2.00000000',
              withdrawing: '3.00000000',
            },
          ]),
        );
      }
      if (url.includes('/simple-earn/flexible/position')) {
        return Promise.resolve(
          jsonResponse({
            rows: [{ asset: 'USDT', totalAmount: '1155.76825916' }],
            total: 1,
          }),
        );
      }
      if (url.includes('/simple-earn/locked/position')) {
        return Promise.resolve(
          jsonResponse({
            rows: [{ asset: 'ETH', amount: '0.25000000', status: 'HOLDING' }],
            total: 1,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./binance-client');
    const { balances } = await client.fetchAccountBalances(true);

    // Flexible (1155.76825916) suma a libre; solo funding aporta bloqueado
    // (locked 1 + freeze 2 + withdrawing 3), y Locked Earn mantiene su plazo.
    expect(balances).toEqual([
      { asset: 'USDT', free: 1170.76825916, locked: 6 },
      { asset: 'BTC', free: 0.01, locked: 0 },
      { asset: 'ETH', free: 0, locked: 0.25 },
    ]);
  });

  it('distinguishes a missing API-key permission from an unavailable wallet', async () => {
    await seedCredentials();
    const buildMock = (fundingStatus: number, fundingCode: number | null) =>
      vi.fn((url: string) => {
        if (url.includes('/account/apiRestrictions')) {
          return Promise.resolve(jsonResponse({ enableReading: true }));
        }
        if (url.includes('/binance-api/v3/account')) {
          return Promise.resolve(
            jsonResponse({ balances: [{ asset: 'USDC', free: '5', locked: '0' }] }),
          );
        }
        if (url.includes('/asset/get-funding-asset')) {
          return Promise.resolve(
            errorResponse(fundingStatus, fundingCode === null ? {} : { code: fundingCode }),
          );
        }
        return Promise.resolve(jsonResponse({ rows: [], total: 0 }));
      });

    const client = await import('./binance-client');

    // -2015 es el codigo con el que Binance rechaza por clave, IP o permiso.
    vi.stubGlobal('fetch', buildMock(401, -2015));
    const denied = await client.fetchAccountBalances(true);
    expect(denied.issues).toEqual([{ wallet: 'funding', reason: 'permission' }]);
    // El saldo que si se pudo leer sigue llegando: el aviso no lo reemplaza.
    expect(denied.balances).toEqual([{ asset: 'USDC', free: 5, locked: 0 }]);

    vi.stubGlobal('fetch', buildMock(503, null));
    const down = await client.fetchAccountBalances(true);
    expect(down.issues).toEqual([{ wallet: 'funding', reason: 'unavailable' }]);
  });

  it('tests explicit credentials without reading persisted credentials', async () => {
    localStorage.clear();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/time')) {
        return Promise.resolve(jsonResponse({ serverTime: 2_000_000 }));
      }
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

  it('refreshes Binance server time and retries when the local clock is out of sync', async () => {
    await seedCredentials();
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/time')) {
        return Promise.resolve(jsonResponse({ serverTime: 1_600_000 }));
      }
      if (url.includes('timestamp=1000000')) {
        return Promise.resolve(
          errorResponse(400, {
            code: -1021,
            msg: 'Timestamp for this request is outside of the recvWindow.',
          }),
        );
      }
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
      return Promise.resolve(jsonResponse({ balances: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./binance-client');
    const { balances } = await client.fetchAccountBalances(true);

    expect(balances).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/binance-api/v3/time',
      expect.objectContaining({ cache: 'no-store' }),
    );
    const signedUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => !url.includes('/time'));
    expect(signedUrls.some((url) => url.includes('timestamp=1000000'))).toBe(true);
    signedUrls
      .filter((url) => !url.includes('timestamp=1000000'))
      .forEach((url) => {
        expect(url).toContain('timestamp=1600000');
      });
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
