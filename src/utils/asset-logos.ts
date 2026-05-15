const COINMARKETCAP_IDS: Record<string, string> = {
  BTC: '1',
  ETH: '1027',
  USDT: '825',
  BNB: '1839',
  SOL: '5426',
  USDC: '3408',
};

const LOCAL_LOGO_ASSETS = new Set(Object.keys(COINMARKETCAP_IDS));

function normalizeAsset(asset: string): string {
  return asset.toUpperCase().trim();
}

function localLogoUrl(asset: string): string {
  return `/assets/crypto/${asset.toLowerCase()}.svg`;
}

function localCoinMarketCapLogoUrl(asset: string): string {
  return `/assets/crypto/coinmarketcap/${asset.toLowerCase()}.png`;
}

function remoteCoinMarketCapLogoUrl(asset: string): string | null {
  const coinMarketCapId = COINMARKETCAP_IDS[asset];
  if (!coinMarketCapId) return null;
  return `https://s2.coinmarketcap.com/static/img/coins/64x64/${coinMarketCapId}.png`;
}

function coinMarketCapFallbackUrls(asset: string): string[] {
  const remoteUrl = remoteCoinMarketCapLogoUrl(asset);
  if (!remoteUrl) return [];
  return [localCoinMarketCapLogoUrl(asset), remoteUrl];
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
  fallbackSrcs: string[];
  alt: string;
} {
  const normalized = normalizeAsset(asset);
  if (!normalized) {
    return {
      primarySrc: '',
      fallbackSrc: null,
      fallbackSrcs: [],
      alt: 'Crypto logo',
    };
  }

  if (LOCAL_LOGO_ASSETS.has(normalized)) {
    const fallbackSrcs = coinMarketCapFallbackUrls(normalized);
    return {
      primarySrc: localLogoUrl(normalized),
      fallbackSrc: fallbackSrcs[0] ?? null,
      fallbackSrcs,
      alt: `${normalized} logo`,
    };
  }

  return {
    primarySrc: '',
    fallbackSrc: null,
    fallbackSrcs: [],
    alt: `${normalized} logo`,
  };
}

function parseFallbackSources(img: HTMLImageElement): string[] {
  const rawFallbacks = img.dataset.fallbacks;
  if (rawFallbacks) {
    try {
      const parsed = JSON.parse(rawFallbacks) as unknown;
      if (Array.isArray(parsed))
        return parsed.filter((value): value is string => typeof value === 'string');
    } catch {
      return [];
    }
  }

  const fallback = img.dataset.fallback;
  return fallback ? [fallback] : [];
}

export function bindAssetLogoFallbacks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-asset-logo-root]').forEach((logoRoot) => {
    if (logoRoot.dataset.logoBound === 'true') return;

    const img = logoRoot.querySelector<HTMLImageElement>('[data-asset-logo-img]');
    const fallback = logoRoot.querySelector<HTMLElement>('[data-asset-logo-fallback]');
    if (!img || !fallback) return;

    const fallbackSrcs = parseFallbackSources(img);
    let fallbackIndex = 0;

    const showFallback = (): void => {
      img.style.display = 'none';
      fallback.style.display = 'inline-flex';
    };

    img.addEventListener('load', () => {
      img.style.display = '';
      fallback.style.display = 'none';
    });

    img.addEventListener('error', () => {
      const fallbackSrc = fallbackSrcs[fallbackIndex];
      if (fallbackSrc) {
        fallbackIndex += 1;
        img.src = fallbackSrc;
        return;
      }
      showFallback();
    });

    if (!img.getAttribute('src')) {
      showFallback();
    }

    logoRoot.dataset.logoBound = 'true';
  });
}
