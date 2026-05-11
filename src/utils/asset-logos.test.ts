import { describe, expect, it } from '#test';
import { createAssetMonogram, resolveAssetLogoSources } from './asset-logos';

describe('asset logos', () => {
  it('returns local primary and remote fallback for known assets', () => {
    const logo = resolveAssetLogoSources('eth');

    expect(
      logo.primarySrc.startsWith('data:image/svg+xml') ||
        logo.primarySrc.includes('/src/assets/crypto/eth.svg'),
    ).toBe(true);
    expect(logo.fallbackSrc).toBe(
      'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/eth.svg',
    );
    expect(logo.alt).toBe('ETH logo');
  });

  it('returns remote primary and no fallback for unknown assets', () => {
    const logo = resolveAssetLogoSources('XRP');

    expect(logo.primarySrc).toBe(
      'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/xrp.svg',
    );
    expect(logo.fallbackSrc).toBeNull();
    expect(logo.alt).toBe('XRP logo');
  });

  it('builds monograms consistently', () => {
    expect(createAssetMonogram('ETH')).toBe('ETH');
    expect(createAssetMonogram('usdt')).toBe('USD');
    expect(createAssetMonogram('  bnb  ')).toBe('BNB');
    expect(createAssetMonogram('')).toBe('?');
  });

  it('uses jsDelivr CDN for remote fallback URLs', () => {
    const logo = resolveAssetLogoSources('btc');
    expect(logo.fallbackSrc).toMatch(/cdn\.jsdelivr\.net.*\/btc\.svg$/);
  });
});
