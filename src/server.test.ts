import { describe, expect, it, vi } from '#test';
import {
  createServerOptions,
  copyProxyHeaders,
  copyProxyResponseHeaders,
  isAllowedPublicAssetPath,
  isAllowedLocalVaultRequest,
  isLocalVaultCredentials,
} from './server';

function requestWith(headers: HeadersInit): Pick<Request, 'headers'> {
  return { headers: new Headers(headers) };
}

describe('local DPAPI vault request guards', () => {
  it('allows same-origin localhost requests', () => {
    expect(
      isAllowedLocalVaultRequest(
        requestWith({
          host: 'localhost:5176',
          origin: 'http://localhost:5176',
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toBe(true);

    expect(
      isAllowedLocalVaultRequest(
        requestWith({
          host: '[::1]:5176',
          origin: 'http://[::1]:5176',
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toBe(true);
  });

  it('blocks cross-origin browser requests before reaching the vault', () => {
    expect(
      isAllowedLocalVaultRequest(
        requestWith({
          host: 'localhost:5176',
          origin: 'https://example.com',
          'sec-fetch-site': 'cross-site',
        }),
      ),
    ).toBe(false);
  });

  it('requires non-empty credential strings', () => {
    expect(isLocalVaultCredentials({ apiKey: 'key', apiSecret: 'secret' })).toBe(true);
    expect(isLocalVaultCredentials({ apiKey: 'key', apiSecret: '   ' })).toBe(false);
    expect(isLocalVaultCredentials({ apiKey: '', apiSecret: 'secret' })).toBe(false);
  });
});

describe('server proxy headers', () => {
  it('forwards exchange requests with identity encoding', () => {
    const req = new Request('http://localhost:5176/binance-api/v3/time', {
      headers: {
        connection: 'keep-alive',
        host: 'localhost:5176',
        origin: 'http://localhost:5176',
        referer: 'http://localhost:5176/',
        'accept-encoding': 'gzip, deflate, br',
        'x-mbx-apikey': 'stored-api-key',
      },
    });

    const headers = copyProxyHeaders(req);

    expect(headers.get('accept-encoding')).toBe('identity');
    expect(headers.get('connection')).toBeNull();
    expect(headers.get('host')).toBeNull();
    expect(headers.get('origin')).toBeNull();
    expect(headers.get('referer')).toBeNull();
    expect(headers.get('x-mbx-apikey')).toBe('stored-api-key');
  });

  it('strips compression and hop-by-hop response headers', () => {
    const headers = copyProxyResponseHeaders(
      new Headers({
        connection: 'keep-alive',
        'content-encoding': 'gzip',
        'content-length': '42',
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
      }),
    );

    expect(headers.get('connection')).toBeNull();
    expect(headers.get('content-encoding')).toBeNull();
    expect(headers.get('content-length')).toBeNull();
    expect(headers.get('transfer-encoding')).toBeNull();
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('rejects mutating methods on every exchange proxy before reaching Binance', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const routes = createServerOptions().routes as Record<string, unknown>;
    const route = routes['/binance-fapi/*'];
    expect(typeof route).toBe('function');

    const response = await (route as (req: Request) => Response | Promise<Response>)(
      new Request('http://localhost:5176/binance-fapi/v1/order', {
        method: 'POST',
        body: 'symbol=BTCUSDT',
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects Binance GET switches that change account state', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const routes = createServerOptions().routes as Record<string, unknown>;
    const route = routes['/binance-sapi/*'];

    const response = await (route as (req: Request) => Response | Promise<Response>)(
      new Request('http://localhost:5176/binance-sapi/v1/soft-staking/set', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects encoded Binance GET switches that change account state', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const routes = createServerOptions().routes as Record<string, unknown>;
    const route = routes['/binance-sapi/*'];

    const response = await (route as (req: Request) => Response | Promise<Response>)(
      new Request('http://localhost:5176/binance-sapi/v1/soft-staking/%73et?softStaking=true', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unknown GET paths on the exchange proxy', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const routes = createServerOptions().routes as Record<string, unknown>;
    const route = routes['/binance-sapi/*'];

    const response = await (route as (req: Request) => Response | Promise<Response>)(
      new Request('http://localhost:5176/binance-sapi/v1/account/unknown', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not duplicate derivative API prefixes when forwarding reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const routes = createServerOptions().routes as Record<string, unknown>;
    const route = routes['/binance-fapi/*'];

    await (route as (req: Request) => Response | Promise<Response>)(
      new Request('http://localhost:5176/binance-fapi/fapi/v3/account?timestamp=1'),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://fapi.binance.com/fapi/v3/account?timestamp=1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('public asset request guards', () => {
  it('allows bundled crypto image assets', () => {
    expect(isAllowedPublicAssetPath('/assets/crypto/sol.svg')).toBe(true);
    expect(isAllowedPublicAssetPath('/assets/crypto/coinmarketcap/sol.png')).toBe(true);
    expect(isAllowedPublicAssetPath('/public/assets/crypto/btc.svg')).toBe(true);
  });

  it('blocks traversal and unsupported public asset paths', () => {
    expect(isAllowedPublicAssetPath('/assets/crypto/../favicon.svg')).toBe(false);
    expect(isAllowedPublicAssetPath('/assets/crypto/sol.html')).toBe(false);
    expect(isAllowedPublicAssetPath('/assets/other/sol.svg')).toBe(false);
  });
});

describe('hyperliquid sync route', () => {
  const user = '0x1111111111111111111111111111111111111111';
  const vault = '0x2222222222222222222222222222222222222222';

  it('normalizes Hyperliquid data through the tracker API route', async () => {
    vi.stubGlobal(
      'fetch',
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;

        if (body.type === 'vaultDetails') {
          return Response.json({
            name: 'Main vault',
            followerState: {
              user,
              vaultEquity: '105',
              pnl: '5',
              allTimePnl: '6',
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
                vault,
                usdc: '100',
              },
            },
          ]);
        }

        return Response.json([]);
      },
    );

    const routes = createServerOptions().routes as Record<string, unknown>;
    const route = routes['/api/hyperliquid/sync'];
    expect(typeof route).toBe('function');

    const response = await (route as (req: Request) => Response | Promise<Response>)(
      new Request('http://localhost:5176/api/hyperliquid/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: user, vaultAddress: vault }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.activeValue).toBe('105');
    expect(data.summary.pnlTotal).toBe('6');
    expect(data.movements[0].amount).toBe('100');
  });
});

describe('favicon asset', () => {
  it('keeps a transparent SVG icon that adapts to browser color scheme', async () => {
    const favicon = await Bun.file(new URL('../public/favicon.svg', import.meta.url)).text();

    expect(favicon).toContain('prefers-color-scheme: dark');
    expect(favicon).toContain('stroke: #121212');
    expect(favicon).toContain('stroke: #f8f8f6');
    expect(favicon).not.toContain('<rect');
  });
});
