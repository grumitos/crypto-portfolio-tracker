import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../test/test-utils';
import { saveApiCredentials } from './binance-auth';

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

    saveApiCredentials({ apiKey: 'key', apiSecret: 'secret' });
  });

  it('maps dual positions using the current Binance response fields', async () => {
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

  it('requests dual market products with required invest and exercised coins', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL) => {
      const url = new URL(String(input), 'https://example.test');
      const optionType = url.searchParams.get('optionType');
      const investCoin = url.searchParams.get('investCoin');
      const exercisedCoin = url.searchParams.get('exercisedCoin');

      if (
        url.pathname.includes('/sapi/v1/dci/product/list') &&
        optionType &&
        investCoin &&
        exercisedCoin
      ) {
        return jsonResponse({
          total: 1,
          list: [
            {
              id: '741590',
              investCoin: 'USDT',
              exercisedCoin: 'BNB',
              strikePrice: '380',
              duration: 4,
              settleDate: 1709020800000,
              purchaseDecimal: 8,
              purchaseEndTime: 1708934400000,
              canPurchase: true,
              apr: '0.6076',
              orderId: 8257205859,
              minAmount: '0.1',
              maxAmount: '25265.7',
              optionType: 'PUT',
            },
          ],
        });
      }

      return jsonResponse({ total: 0, list: [] });
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = await import('./binance-client');
    await client.fetchDualProducts(true);

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(
      urls.some((rawUrl) => {
        const url = new URL(rawUrl, 'https://example.test');
        return (
          url.searchParams.get('optionType') === 'PUT' &&
          url.searchParams.get('investCoin') === 'USDT' &&
          url.searchParams.get('exercisedCoin') === 'BNB'
        );
      }),
    ).toBe(true);
  });
});
