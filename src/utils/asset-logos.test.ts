import { describe, expect, it } from '#test';
import {
  bindAssetLogoFallbacks,
  createAssetMonogram,
  resolveAssetLogoSources,
} from './asset-logos';

describe('asset logos', () => {
  it('returns local primary and CoinMarketCap fallback chain for known assets', () => {
    const logo = resolveAssetLogoSources('eth');

    expect(logo.primarySrc).toBe('/assets/crypto/eth.svg');
    expect(logo.fallbackSrc).toBe('/assets/crypto/coinmarketcap/eth.png');
    expect(logo.fallbackSrcs).toEqual([
      '/assets/crypto/coinmarketcap/eth.png',
      'https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png',
    ]);
    expect(logo.alt).toBe('ETH logo');
  });

  it('returns no image sources for unknown assets so the monogram is used', () => {
    const logo = resolveAssetLogoSources('XRP');

    expect(logo.primarySrc).toBe('');
    expect(logo.fallbackSrc).toBeNull();
    expect(logo.fallbackSrcs).toEqual([]);
    expect(logo.alt).toBe('XRP logo');
  });

  it('uses CoinMarketCap as SOL fallback instead of the legacy green CDN logo', () => {
    const logo = resolveAssetLogoSources('SOL');

    expect(logo.primarySrc).toBe('/assets/crypto/sol.svg');
    expect(logo.fallbackSrcs).toEqual([
      '/assets/crypto/coinmarketcap/sol.png',
      'https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png',
    ]);
    expect(logo.fallbackSrcs.join(' ')).not.toContain('spothq');
  });

  it('builds monograms consistently', () => {
    expect(createAssetMonogram('ETH')).toBe('ETH');
    expect(createAssetMonogram('usdt')).toBe('USD');
    expect(createAssetMonogram('  bnb  ')).toBe('BNB');
    expect(createAssetMonogram('')).toBe('?');
  });

  it('uses CoinMarketCap IDs for every bundled logo fallback', () => {
    expect(resolveAssetLogoSources('BTC').fallbackSrcs[1]).toBe(
      'https://s2.coinmarketcap.com/static/img/coins/64x64/1.png',
    );
    expect(resolveAssetLogoSources('BNB').fallbackSrcs[1]).toBe(
      'https://s2.coinmarketcap.com/static/img/coins/64x64/1839.png',
    );
    expect(resolveAssetLogoSources('USDT').fallbackSrcs[1]).toBe(
      'https://s2.coinmarketcap.com/static/img/coins/64x64/825.png',
    );
    expect(resolveAssetLogoSources('USDC').fallbackSrcs[1]).toBe(
      'https://s2.coinmarketcap.com/static/img/coins/64x64/3408.png',
    );
  });

  it('does not use the stale spothq CDN for any source', () => {
    const logo = resolveAssetLogoSources('btc');
    expect([logo.primarySrc, ...logo.fallbackSrcs].join(' ')).not.toContain('spothq');
    expect([logo.primarySrc, ...logo.fallbackSrcs].join(' ')).not.toContain('cdn.jsdelivr.net');
  });

  it('tries every declared fallback before showing the monogram', () => {
    document.body.innerHTML = `
      <span data-asset-logo-root>
        <img data-asset-logo-img src="/assets/crypto/eth.svg" data-fallbacks='["/assets/crypto/coinmarketcap/eth.png","https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png"]'>
        <span data-asset-logo-fallback style="display:none">ETH</span>
      </span>
    `;
    const img = document.querySelector('[data-asset-logo-img]') as HTMLImageElement;
    const fallback = document.querySelector('[data-asset-logo-fallback]') as HTMLElement;

    bindAssetLogoFallbacks(document);

    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe('/assets/crypto/coinmarketcap/eth.png');
    expect(fallback.style.display).toBe('none');

    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe(
      'https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png',
    );
    expect(fallback.style.display).toBe('none');

    img.dispatchEvent(new Event('error'));
    expect(img.style.display).toBe('none');
    expect(fallback.style.display).toBe('inline-flex');
  });

  it('shows the monogram immediately when no primary logo source exists', () => {
    document.body.innerHTML = `
      <span data-asset-logo-root>
        <img data-asset-logo-img>
        <span data-asset-logo-fallback style="display:none">XRP</span>
      </span>
    `;
    const img = document.querySelector('[data-asset-logo-img]') as HTMLImageElement;
    const fallback = document.querySelector('[data-asset-logo-fallback]') as HTMLElement;

    bindAssetLogoFallbacks(document);

    expect(img.style.display).toBe('none');
    expect(fallback.style.display).toBe('inline-flex');
  });
});
