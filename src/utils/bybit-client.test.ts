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
      sign: vi.fn().mockResolvedValue(new Uint8Array([10, 11, 12, 13]).buffer),
    },
  } as unknown as Crypto;
}

describe('bybit client', () => {
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
    const { saveBybitApiCredentials } = await import('./bybit-auth');
    saveBybitApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
  }

  it('checks Bybit read-only status without persisting explicit credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        retCode: 0,
        retMsg: 'OK',
        result: {
          readOnly: 1,
          permissions: {
            Earn: ['Earn'],
            Wallet: [],
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const result = await client.testBybitApiConnection({
      apiKey: 'direct-key',
      apiSecret: 'direct-secret',
    });

    expect(result).toEqual({
      success: true,
      readOnly: true,
      permissions: {
        Earn: ['Earn'],
        Wallet: [],
      },
    });
    expect(localStorage.getItem('crypto-bybit-api')).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bybit-api/v5/user/query-api');
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>)['X-BAPI-API-KEY']).toBe('direct-key');
  });

  it('flags Bybit read/write keys as not read-only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        retCode: 0,
        retMsg: 'OK',
        result: {
          readOnly: 0,
          permissions: {
            ContractTrade: ['Order', 'Position'],
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const result = await client.testBybitApiConnection({
      apiKey: 'direct-key',
      apiSecret: 'direct-secret',
    });

    expect(result.success).toBe(true);
    expect(result.readOnly).toBe(false);
    expect(result.permissions.ContractTrade).toEqual(['Order', 'Position']);
  });

  it('reports Bybit connection errors without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        retCode: 10004,
        retMsg: 'invalid sign',
        result: {},
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const result = await client.testBybitApiConnection({
      apiKey: 'direct-key',
      apiSecret: 'bad-secret',
    });

    expect(result.success).toBe(false);
    expect(result.readOnly).toBe(false);
    expect(result.permissions).toEqual({});
    expect(result.error).toContain('invalid sign');
  });

  it('fetches wallet balances only through a signed GET endpoint', async () => {
    await seedCredentials();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            readOnly: 1,
            permissions: { Earn: ['Earn'] },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            list: [
              {
                accountType: 'UNIFIED',
                coin: [
                  {
                    coin: 'BTC',
                    walletBalance: '0.02',
                    locked: '0.005',
                    usdValue: '1500.25',
                  },
                  {
                    coin: 'USDT',
                    walletBalance: '0',
                    locked: '0',
                    usdValue: '0',
                  },
                ],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: { list: [] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: { list: [] },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const balances = await client.fetchBybitWalletBalances();

    expect(balances).toEqual([
      {
        asset: 'BTC',
        walletBalance: 0.02,
        locked: 0.005,
        usdValue: 1500.25,
      },
    ]);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/bybit-api/v5/account/wallet-balance?accountType=UNIFIED');
    expect(init.method).toBe('GET');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('fetches funding asset balances through the asset read endpoint', async () => {
    await seedCredentials();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            readOnly: 1,
            permissions: { Wallet: ['AccountTransfer'] },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'success',
          result: {
            accountType: 'FUND',
            balance: [
              { coin: 'USDT', walletBalance: '25', transferBalance: '20', bonus: '' },
              { coin: 'BTC', walletBalance: '0', transferBalance: '0', bonus: '' },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const balances = await client.fetchBybitAssetBalances();

    expect(balances).toEqual([
      {
        asset: 'USDT',
        walletBalance: 25,
        locked: 5,
        usdValue: 0,
      },
    ]);
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      '/bybit-api/v5/asset/transfer/query-account-coins-balance?accountType=FUND',
    );
  });

  it('reuses the Bybit read-only permission cache for repeated asset reads', async () => {
    await seedCredentials();
    const assetPayload = jsonResponse({
      retCode: 0,
      retMsg: 'success',
      result: {
        accountType: 'FUND',
        balance: [{ coin: 'USDT', walletBalance: '10', transferBalance: '10', bonus: '' }],
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            readOnly: 1,
            permissions: { Wallet: ['AccountTransfer'] },
          },
        }),
      )
      .mockResolvedValueOnce(assetPayload)
      .mockResolvedValueOnce(assetPayload);
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');

    await client.fetchBybitAssetBalances();
    await client.fetchBybitAssetBalances();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      '/bybit-api/v5/user/query-api',
    );
    expect((fetchMock.mock.calls[2] as [string, RequestInit])[0]).toBe(
      '/bybit-api/v5/asset/transfer/query-account-coins-balance?accountType=FUND',
    );
  });

  it('fetches open derivative positions through signed GET endpoints', async () => {
    await seedCredentials();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            readOnly: 1,
            permissions: { ContractTrade: ['Position'] },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            list: [
              {
                symbol: 'BTCUSDT',
                side: 'Buy',
                size: '0.05',
                avgPrice: '70000',
                markPrice: '71000',
                positionValue: '3550',
                unrealisedPnl: '50',
                updatedTime: '1773487800000',
              },
            ],
          },
        }),
      )
      .mockResolvedValue(jsonResponse({ retCode: 0, retMsg: 'OK', result: { list: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const positions = await client.fetchBybitOpenPositions();

    expect(positions).toEqual([
      {
        id: 'bybit_BTCUSDT_Buy',
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        side: 'Buy',
        size: 0.05,
        avgPrice: 70000,
        markPrice: 71000,
        positionValue: 3550,
        unrealizedPnl: 50,
        updatedTime: 1773487800000,
        createdTime: undefined,
      },
    ]);
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toContain(
      '/bybit-api/v5/position/list?category=linear&settleCoin=USDT',
    );
  });

  it('skips derivative positions when the Bybit key lacks Contract Position permission', async () => {
    await seedCredentials();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        retCode: 0,
        retMsg: 'OK',
        result: {
          readOnly: 1,
          permissions: { Earn: ['Earn'] },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const positions = await client.fetchBybitOpenPositions();

    expect(positions).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      '/bybit-api/v5/user/query-api',
    );
  });

  it('fetches active Dual Asset positions through the Earn read endpoint', async () => {
    await seedCredentials();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            readOnly: 1,
            permissions: { Earn: ['Earn'] },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            category: 'DualAssets',
            nextPageCursor: '',
            list: [
              {
                positionId: '19035',
                productId: '36320',
                baseCoin: 'ETH',
                quoteCoin: 'USDT',
                investCoin: 'USDT',
                amount: '20',
                apyE8: '902700000',
                direction: 'BuyLow',
                targetPrice: '2325',
                settlementTime: '1774079999000',
                status: 'Active',
                orderId: 'order-1',
                duration: '3d',
                yieldStartAt: '1773820799000',
                yieldEndAt: '1774079999000',
              },
              {
                positionId: '19036',
                productId: '36321',
                baseCoin: 'BTC',
                quoteCoin: 'USDT',
                investCoin: 'BTC',
                amount: '0',
                apyE8: '100000000',
                direction: 'SellHigh',
                targetPrice: '95000',
                settlementTime: '1774079999000',
                status: 'Active',
              },
              {
                positionId: '19037',
                productId: '36322',
                baseCoin: 'SOL',
                quoteCoin: 'USDT',
                investCoin: 'USDT',
                amount: '15',
                apyE8: '100000000',
                direction: 'Sideways',
                targetPrice: '100',
                settlementTime: '1774079999000',
                status: 'Active',
              },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const positions = await client.fetchBybitDualAssetPositions();

    expect(positions).toEqual([
      {
        id: 'bybit_dual_19035',
        productId: '36320',
        baseCoin: 'ETH',
        quoteCoin: 'USDT',
        investCoin: 'USDT',
        amount: 20,
        apr: 902.7,
        direction: 'BuyLow',
        targetPrice: 2325,
        settlementTime: 1774079999000,
        status: 'Active',
        orderId: 'order-1',
        duration: '3d',
        yieldStartAt: 1773820799000,
        yieldEndAt: 1774079999000,
      },
    ]);
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      '/bybit-api/v5/earn/advance/position?category=DualAssets&limit=20',
    );
  });

  it('adjusts Bybit Dual Asset APR when actual locked time exceeds the advertised duration', async () => {
    await seedCredentials();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            readOnly: 1,
            permissions: { Earn: ['Earn'] },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            category: 'DualAssets',
            nextPageCursor: '',
            list: [
              {
                positionId: '19038',
                productId: '36323',
                baseCoin: 'ETH',
                quoteCoin: 'USDT',
                investCoin: 'USDT',
                amount: '100',
                apyE8: '100000000',
                direction: 'BuyLow',
                targetPrice: '2300',
                settlementTime: String(Date.parse('2026-03-18T00:00:00.000Z')),
                status: 'Active',
                duration: '3d',
                yieldStartAt: String(Date.parse('2026-03-14T00:00:00.000Z')),
                yieldEndAt: String(Date.parse('2026-03-18T00:00:00.000Z')),
              },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const positions = await client.fetchBybitDualAssetPositions();

    expect(positions[0]?.apr).toBeCloseTo(75, 8);
  });

  it('adjusts Bybit Dual Asset APR for hourly products locked through the next day', async () => {
    await seedCredentials();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            readOnly: 1,
            permissions: { Earn: ['Earn'] },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            category: 'DualAssets',
            nextPageCursor: '',
            list: [
              {
                positionId: '19039',
                productId: '36324',
                baseCoin: 'ETH',
                quoteCoin: 'USDT',
                investCoin: 'USDT',
                amount: '42508.8428',
                apyE8: '432860000',
                direction: 'BuyLow',
                targetPrice: '2316.5',
                settlementTime: String(Date.parse('2026-04-26T08:00:00.000Z')),
                status: 'Active',
                duration: '8h',
                expectReturnCoin: 'ETH',
                expectReturnAmount: '18.42300215',
                yieldStartAt: String(Date.parse('2026-04-25T08:00:00.000Z')),
              },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const positions = await client.fetchBybitDualAssetPositions();

    expect(positions[0]?.apr).toBeCloseTo(144.2881276772, 8);
    expect(positions[0]?.expectedSettlementAsset).toBe('ETH');
    expect(positions[0]?.expectedSettlementAmount).toBe(18.42300215);
    expect(positions[0]?.projectedProfit).toBeCloseTo(168.041680475, 8);
  });

  it('fetches active Discount Buy positions through the Earn read endpoint', async () => {
    await seedCredentials();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            readOnly: 1,
            permissions: { Earn: ['Earn'] },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          result: {
            category: '',
            nextPageCursor: '',
            list: [
              {
                positionId: '11959',
                productId: '7037',
                category: 'DiscountBuy',
                coin: 'USDT',
                underlyingAsset: 'BTC',
                amount: '200',
                purchasePrice: '74019',
                knockoutPrice: '76050',
                knockoutCouponE8: '1000000',
                status: 'Active',
                orderId: '38f6f5ce-57e2-4d69-b4d3-c39464389ccb',
                duration: '1d',
                settlementTime: '1776240000000',
                accountType: 'FUND',
                toAccountType: 'FUND',
                settleType: 'Base',
                expectReceiveAt: '1776240900000',
              },
              {
                positionId: '11960',
                productId: '7038',
                category: 'DiscountBuy',
                coin: 'USDT',
                underlyingAsset: 'ETH',
                amount: '0',
                purchasePrice: '2000',
                knockoutPrice: '2100',
                knockoutCouponE8: '1000000',
                status: 'Active',
                settlementTime: '1776240000000',
              },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const positions = await client.fetchBybitDiscountBuyPositions();

    expect(positions).toEqual([
      {
        id: 'bybit_discount_buy_11959',
        productId: '7037',
        coin: 'USDT',
        underlyingAsset: 'BTC',
        amount: 200,
        apr: 1,
        purchasePrice: 74019,
        knockoutPrice: 76050,
        settlementTime: 1776240000000,
        status: 'Active',
        orderId: '38f6f5ce-57e2-4d69-b4d3-c39464389ccb',
        duration: '1d',
        accountType: 'FUND',
        toAccountType: 'FUND',
        settleType: 'Base',
        expectReceiveAt: 1776240900000,
        yieldStartAt: 1776153600000,
        projectedProfit: 0.005479452054794521,
      },
    ]);
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      '/bybit-api/v5/earn/advance/position?category=DiscountBuy&limit=20',
    );
  });

  it('skips Dual Asset positions when the Bybit key lacks Earn permission', async () => {
    await seedCredentials();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        retCode: 0,
        retMsg: 'OK',
        result: {
          readOnly: 1,
          permissions: { Wallet: ['AccountTransfer'] },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const positions = await client.fetchBybitDualAssetPositions();

    expect(positions).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      '/bybit-api/v5/user/query-api',
    );
  });

  it('blocks wallet balance reads when the stored Bybit key is not read-only', async () => {
    await seedCredentials();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        retCode: 0,
        retMsg: 'OK',
        result: {
          readOnly: 0,
          permissions: { ContractTrade: ['Order'] },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    await expect(client.fetchBybitWalletBalances()).rejects.toThrow('read-only');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches spot tickers through the public GET whitelist', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        retCode: 0,
        retMsg: 'OK',
        result: {
          category: 'spot',
          list: [{ symbol: 'BTCUSDT', lastPrice: '75000', price24hPcnt: '0.01' }],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');
    const ticker = await client.fetchBybitSpotTicker('btcusdt');

    expect(ticker).toEqual({ symbol: 'BTCUSDT', lastPrice: '75000', price24hPcnt: '0.01' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/bybit-api/v5/market/tickers?category=spot&symbol=BTCUSDT');
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
  });

  it('throws when a Bybit public ticker is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        retCode: 0,
        retMsg: 'OK',
        result: {
          category: 'spot',
          list: [],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./bybit-client');

    await expect(client.fetchBybitSpotTicker('missingusdt')).rejects.toThrow(
      'Bybit ticker not found',
    );
  });
});
