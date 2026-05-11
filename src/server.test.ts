import { describe, expect, it } from '#test';
import { isAllowedLocalVaultRequest, isLocalVaultCredentials } from './server';

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
