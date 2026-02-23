const LOCAL_LOGO_ASSETS = new Set(['BTC', 'ETH', 'BNB', 'SOL', 'USDT', 'USDC']);

function normalizeAsset(asset: string): string {
  return asset.toUpperCase().trim();
}

function localLogoUrl(asset: string): string {
  return new URL(`../assets/crypto/${asset.toLowerCase()}.svg`, import.meta.url).href;
}

/**
 * Remote fallback logo URL.
 * Source: spothq/cryptocurrency-icons (MIT license) via jsDelivr CDN.
 * https://github.com/spothq/cryptocurrency-icons
 */
function remoteLogoUrl(asset: string): string {
  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${asset.toLowerCase()}.svg`;
}

export function createAssetMonogram(asset: string): string {
  const normalized = normalizeAsset(asset).replace(/[^A-Z0-9]/g, '');
  if (!normalized) return '?';
  if (normalized.length <= 3) return normalized;
  return normalized.slice(0, 3);
}

export function resolveAssetLogoSources(asset: string): {
  primarySrc: string;
  fallbackSrc: string | null;
  alt: string;
} {
  const normalized = normalizeAsset(asset);
  if (!normalized) {
    return {
      primarySrc: '',
      fallbackSrc: null,
      alt: 'Crypto logo',
    };
  }

  if (LOCAL_LOGO_ASSETS.has(normalized)) {
    return {
      primarySrc: localLogoUrl(normalized),
      fallbackSrc: remoteLogoUrl(normalized),
      alt: `${normalized} logo`,
    };
  }

  return {
    primarySrc: remoteLogoUrl(normalized),
    fallbackSrc: null,
    alt: `${normalized} logo`,
  };
}
