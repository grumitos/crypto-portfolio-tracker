import { describe, expect, it } from '#test';
import { providerName, skeletonSpan } from './ui-helpers';

describe('ui helpers', () => {
  it('renders skeleton span with default and custom width', () => {
    expect(skeletonSpan()).toContain('width:80px');
    expect(skeletonSpan('120px')).toContain('width:120px');
    expect(skeletonSpan('120px')).toContain('skeleton-number');
  });

  it('precedes each known provider with its brand dot and keeps the text color', () => {
    for (const [name, brand] of [
      ['Binance', 'binance'],
      ['Bybit', 'bybit'],
      ['Hyperliquid', 'hyperliquid'],
    ]) {
      expect(providerName(name)).toBe(
        `<span class="provider-name"><span class="provider-dot provider-dot--${brand}" aria-hidden="true"></span>${name}</span>`,
      );
    }
  });

  it('uses a custom label and escapes it', () => {
    expect(providerName('Hyperliquid', 'Conexión <Hyperliquid>')).toContain(
      'provider-dot--hyperliquid" aria-hidden="true"></span>Conexión &lt;Hyperliquid&gt;</span>',
    );
  });

  it('renders an unknown provider as plain escaped text', () => {
    expect(providerName('Otro & Co')).toBe('Otro &amp; Co');
  });
});
