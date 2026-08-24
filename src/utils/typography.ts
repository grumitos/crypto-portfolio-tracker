const FONT_LINK_ID = 'app-font-stylesheet';
const FONT_PRECONNECT_ATTR = 'data-app-font-preconnect';

interface TypographyConfig {
  stylesheetHref: string;
  preconnectHosts: string[];
  fontSans: string;
  fontSerif: string;
  fontMono: string;
}

const DEFAULT_TYPOGRAPHY: TypographyConfig = {
  stylesheetHref:
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap',
  preconnectHosts: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
  fontSans: "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSerif: "'Newsreader', 'Iowan Old Style', Georgia, serif",
  fontMono: "'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace",
};

function ensurePreconnect(host: string, crossOrigin = false): void {
  const existing = document.head.querySelector<HTMLLinkElement>(
    `link[rel="preconnect"][href="${host}"]`,
  );
  if (existing) return;

  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = host;
  link.setAttribute(FONT_PRECONNECT_ATTR, 'true');
  if (crossOrigin) {
    link.crossOrigin = 'anonymous';
  }
  document.head.appendChild(link);
}

export function applyTypographyConfig(config: TypographyConfig = DEFAULT_TYPOGRAPHY): void {
  if (typeof document === 'undefined') return;

  config.preconnectHosts.forEach((host, index) => ensurePreconnect(host, index > 0));

  const existingLink = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (!existingLink) {
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = config.stylesheetHref;
    document.head.appendChild(link);
  } else if (existingLink.href !== config.stylesheetHref) {
    existingLink.href = config.stylesheetHref;
  }

  const root = document.documentElement;
  root.style.setProperty('--sans', config.fontSans);
  root.style.setProperty('--serif', config.fontSerif);
  root.style.setProperty('--mono', config.fontMono);
}
