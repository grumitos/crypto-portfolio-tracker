import { describe, expect, it } from '#test';
import {
  copyProxyHeaders,
  copyProxyResponseHeaders,
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
});
