import index from './index.html';
import { HyperliquidSyncError, syncHyperliquidVaults } from './utils/hyperliquid-sync';
import type { HyperliquidSyncInput } from './utils/hyperliquid-sync';

interface LocalVaultExchangeCredentials {
  apiKey: string;
  apiSecret: string;
}

interface LocalVaultPlainPayload {
  binance?: LocalVaultExchangeCredentials;
  bybit?: LocalVaultExchangeCredentials;
}

interface LocalVaultStoredExchange {
  apiKeyDpapi: string;
  secretDpapi: string;
}

interface LocalVaultStoredPayload {
  version: 1;
  scope: 'CurrentUser';
  updatedAt: string;
  binance?: LocalVaultStoredExchange;
  bybit?: LocalVaultStoredExchange;
}

const DEFAULT_PORT = 5176;
const LOCAL_VAULT_URL = new URL('../.local/credentials.dpapi.json', import.meta.url);
const PUBLIC_DIR_URL = new URL('../public/', import.meta.url);

const jsonHeaders = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function sendJson(status: number, payload: unknown): Response {
  return Response.json(payload, { status, headers: jsonHeaders });
}

async function runPowerShellJson(script: string, payload: unknown): Promise<string> {
  const proc = Bun.spawn(
    [
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ],
    {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code === 0) return stdout.trim();
  throw new Error(stderr.trim() || `PowerShell exited with code ${code}`);
}

async function dpapiProtect(secret: string): Promise<string> {
  return runPowerShellJson(
    `
      $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
      Add-Type -AssemblyName System.Security
      $bytes = [Text.Encoding]::UTF8.GetBytes([string]$payload.secret)
      $protected = [Security.Cryptography.ProtectedData]::Protect(
        $bytes,
        $null,
        [Security.Cryptography.DataProtectionScope]::CurrentUser
      )
      [Console]::Out.Write([Convert]::ToBase64String($protected))
    `,
    { secret },
  );
}

async function dpapiUnprotectMany(secretDpapiValues: string[]): Promise<string[]> {
  if (secretDpapiValues.length === 0) return [];

  const output = await runPowerShellJson(
    `
      $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
      Add-Type -AssemblyName System.Security
      $plain = @()
      foreach ($secretDpapi in @($payload.secretDpapiValues)) {
        try {
          $protected = [Convert]::FromBase64String([string]$secretDpapi)
          $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
            $protected,
            $null,
            [Security.Cryptography.DataProtectionScope]::CurrentUser
          )
          $plain += [Text.Encoding]::UTF8.GetString($bytes)
        } catch {
          # Blob ilegible (cifrado por otro usuario/equipo o corrupto): se descarta
          # esa credencial en vez de tumbar la lectura completa del vault.
          $plain += ''
        }
      }
      [Console]::Out.Write(($plain | ConvertTo-Json -Compress))
    `,
    { secretDpapiValues },
  );
  const parsed = JSON.parse(output) as unknown;
  if (Array.isArray(parsed)) return parsed.map(String);
  return [String(parsed)];
}

async function readStoredLocalVault(): Promise<LocalVaultStoredPayload | null> {
  try {
    const parsed = (await Bun.file(LOCAL_VAULT_URL).json()) as LocalVaultStoredPayload;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

async function readPlainLocalVault(): Promise<LocalVaultPlainPayload> {
  const stored = await readStoredLocalVault();
  const plain: LocalVaultPlainPayload = {};
  const encrypted: Array<{
    exchange: 'binance' | 'bybit';
    field: keyof LocalVaultExchangeCredentials;
    value: string;
  }> = [];

  if (stored?.binance) {
    encrypted.push(
      { exchange: 'binance', field: 'apiKey', value: stored.binance.apiKeyDpapi },
      { exchange: 'binance', field: 'apiSecret', value: stored.binance.secretDpapi },
    );
  }
  if (stored?.bybit) {
    encrypted.push(
      { exchange: 'bybit', field: 'apiKey', value: stored.bybit.apiKeyDpapi },
      { exchange: 'bybit', field: 'apiSecret', value: stored.bybit.secretDpapi },
    );
  }

  const decrypted = await dpapiUnprotectMany(encrypted.map((item) => item.value));
  encrypted.forEach((item, index) => {
    const exchangeCredentials = (plain[item.exchange] ??= { apiKey: '', apiSecret: '' });
    exchangeCredentials[item.field] = decrypted[index] ?? '';
  });

  if (plain.binance && !isLocalVaultCredentials(plain.binance)) delete plain.binance;
  if (plain.bybit && !isLocalVaultCredentials(plain.bybit)) delete plain.bybit;

  return plain;
}

async function writePlainLocalVault(payload: LocalVaultPlainPayload): Promise<void> {
  const stored: LocalVaultStoredPayload = {
    version: 1,
    scope: 'CurrentUser',
    updatedAt: new Date().toISOString(),
  };
  if (payload.binance) {
    stored.binance = {
      apiKeyDpapi: await dpapiProtect(payload.binance.apiKey),
      secretDpapi: await dpapiProtect(payload.binance.apiSecret),
    };
  }
  if (payload.bybit) {
    stored.bybit = {
      apiKeyDpapi: await dpapiProtect(payload.bybit.apiKey),
      secretDpapi: await dpapiProtect(payload.bybit.apiSecret),
    };
  }
  await Bun.write(LOCAL_VAULT_URL, `${JSON.stringify(stored, null, 2)}\n`);
}

function firstHeader(headers: Headers, name: string): string {
  return headers.get(name) ?? '';
}

function normalizeHost(value: string): string {
  try {
    return new URL(`http://${value}`).host.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function isLocalhostHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

export function isAllowedLocalVaultRequest(req: Pick<Request, 'headers'>): boolean {
  const fetchSite = firstHeader(req.headers, 'sec-fetch-site').toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;

  const origin = firstHeader(req.headers, 'origin');
  if (!origin) return true;

  const host = firstHeader(req.headers, 'host');
  if (!host) return false;

  try {
    const originUrl = new URL(origin);
    return (
      isLocalhostHostname(originUrl.hostname) &&
      originUrl.host.toLowerCase() === normalizeHost(host)
    );
  } catch {
    return false;
  }
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isLocalVaultCredentials(value: unknown): value is LocalVaultExchangeCredentials {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasNonEmptyString((value as LocalVaultExchangeCredentials).apiKey) &&
    hasNonEmptyString((value as LocalVaultExchangeCredentials).apiSecret)
  );
}

async function handleLocalVaultCredentials(req: Request): Promise<Response> {
  if (!isAllowedLocalVaultRequest(req)) {
    return sendJson(403, { available: false, error: 'Origen no permitido.' });
  }

  if (process.platform !== 'win32') {
    return sendJson(503, { available: false, error: 'DPAPI solo esta disponible en Windows.' });
  }

  try {
    if (req.method === 'GET') {
      // Una lectura fallida no debe bloquear el arranque de la app: se responde
      // sin credenciales y el usuario las vuelve a ingresar.
      let stored: LocalVaultPlainPayload = {};
      try {
        stored = await readPlainLocalVault();
      } catch (err) {
        console.error('[local-vault] lectura fallida:', err);
      }
      return sendJson(200, { available: true, ...stored });
    }

    if (req.method === 'PUT') {
      const body = (await req.json()) as {
        exchange?: 'binance' | 'bybit';
        credentials?: unknown;
      };
      if (
        (body.exchange !== 'binance' && body.exchange !== 'bybit') ||
        !isLocalVaultCredentials(body.credentials)
      ) {
        return sendJson(400, { available: true, error: 'Payload invalido.' });
      }
      const current = await readPlainLocalVault();
      current[body.exchange] = body.credentials;
      await writePlainLocalVault(current);
      return sendJson(200, { available: true, saved: body.exchange });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const exchange = url.searchParams.get('exchange');
      if (exchange !== 'binance' && exchange !== 'bybit') {
        return sendJson(400, { available: true, error: 'Exchange invalido.' });
      }
      const current = await readPlainLocalVault();
      delete current[exchange];
      if (!current.binance && !current.bybit) {
        const file = Bun.file(LOCAL_VAULT_URL);
        if (await file.exists()) await file.delete();
      } else {
        await writePlainLocalVault(current);
      }
      return sendJson(200, { available: true, deleted: exchange });
    }

    return sendJson(405, { available: true, error: 'Metodo no permitido.' });
  } catch (err) {
    // El detalle queda en el log del servidor; al cliente solo un mensaje generico.
    console.error('[local-vault] error:', err);
    return sendJson(500, { available: true, error: 'Error de vault local.' });
  }
}

function hyperliquidErrorPayload(error: unknown): { error: { code: string; message: string } } {
  if (error instanceof HyperliquidSyncError) {
    return {
      error: {
        code: error.code,
        message: error.publicMessage,
      },
    };
  }

  return {
    error: {
      code: 'HYPERLIQUID_SYNC_FAILED',
      message: 'No se pudo sincronizar Hyperliquid.',
    },
  };
}

async function handleHyperliquidSync(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return sendJson(405, {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Metodo no permitido.',
      },
    });
  }

  try {
    const body = (await req.json()) as unknown;
    return sendJson(200, await syncHyperliquidVaults(body as HyperliquidSyncInput));
  } catch (error) {
    const status = error instanceof HyperliquidSyncError ? error.status : 502;
    return sendJson(status, hyperliquidErrorPayload(error));
  }
}

function publicFile(path: string, contentType: string): Response {
  return new Response(Bun.file(new URL(path, PUBLIC_DIR_URL)), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const PUBLIC_CRYPTO_ASSET_RE =
  /^\/(?:public\/)?assets\/crypto\/(?:coinmarketcap\/)?[a-z0-9-]+\.(png|svg)$/;

export function isAllowedPublicAssetPath(pathname: string): boolean {
  return PUBLIC_CRYPTO_ASSET_RE.test(pathname);
}

function publicAssetFile(req: Request): Response {
  const pathname = new URL(req.url).pathname;
  if (!isAllowedPublicAssetPath(pathname)) {
    return new Response('Not found', { status: 404 });
  }

  const publicPath = pathname.replace(/^\/public\//, '').slice(1);
  const contentType = publicPath.endsWith('.png') ? 'image/png' : 'image/svg+xml; charset=utf-8';
  return publicFile(publicPath, contentType);
}

const STRIPPED_PROXY_RESPONSE_HEADERS = [
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const;

export function copyProxyHeaders(req: Request): Headers {
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('origin');
  headers.delete('referer');
  headers.delete('connection');
  headers.delete('content-length');
  headers.set('accept-encoding', 'identity');
  return headers;
}

export function copyProxyResponseHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  for (const header of STRIPPED_PROXY_RESPONSE_HEADERS) {
    next.delete(header);
  }
  return next;
}

function proxyTargetUrl(req: Request, prefix: string, targetBase: string): string {
  const url = new URL(req.url);
  const suffix = url.pathname.slice(prefix.length);
  return `${targetBase}${suffix}${url.search}`;
}

function hasRequestBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

export function isReadOnlyExchangeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

/**
 * The exchange proxy is intentionally positive-list only. A GET verb is not
 * enough to prove that a future exchange endpoint is harmless: Binance has
 * legacy GET switches, and a wildcard route would otherwise forward any new
 * path added by accident. Keep this list aligned with the read-only clients.
 */
const READ_ONLY_EXCHANGE_PATHS: Record<string, ReadonlySet<string>> = {
  '/binance-api': new Set(['/v3/time', '/v3/account']),
  '/binance-sapi': new Set([
    '/v1/account/apiRestrictions',
    '/v1/account/info',
    '/v1/asset/assetDividend',
    '/v1/asset/wallet/balance',
    '/v1/capital/deposit/hisrec',
    '/v1/capital/withdraw/history',
    '/v1/dci/product/accounts',
    '/v1/dci/product/positions',
    '/v1/simple-earn/flexible/position',
    '/v1/simple-earn/locked/position',
    '/v1/simple-earn/flexible/history/rewardsRecord',
    '/v1/simple-earn/locked/history/rewardsRecord',
    '/v1/simple-earn/account',
    '/v1/bfusd/account',
    '/v1/bfusd/history/rewardsHistory',
    '/v1/rwusd/account',
    '/v1/rwusd/history/rewardsHistory',
    '/v1/eth-staking/eth/history/wbethRewardsHistory',
    '/v1/sol-staking/account',
    '/v1/sol-staking/sol/history/bnsolRewardsHistory',
    '/v1/sol-staking/sol/history/boostRewardsHistory',
    '/v1/sol-staking/sol/history/unclaimedRewards',
    '/v1/onchain-yields/locked/position',
    '/v1/onchain-yields/locked/history/rewardsRecord',
    '/v1/soft-staking/list',
    '/v1/soft-staking/history/rewardsRecord',
    '/v1/accumulator/product/position/list',
    '/v1/accumulator/product/sum-holding',
    '/v1/loan/ongoing/orders',
    '/v1/loan/income',
    '/v1/loan/vip/ongoing/orders',
    '/v1/loan/vip/repay/history',
    '/v1/loan/vip/collateral/account',
    '/v1/margin/account',
    '/v1/margin/isolated/account',
    '/v1/margin/interestHistory',
    '/v1/rebate/taxQuery',
    '/v1/apiReferral/kickback/recentRecord',
    '/v2/loan/flexible/ongoing/orders',
    '/v2/eth-staking/account',
  ]),
  '/binance-fapi': new Set(['/fapi/v3/account', '/fapi/v3/balance', '/fapi/v1/income']),
  '/binance-dapi': new Set(['/dapi/v1/account', '/dapi/v1/balance', '/dapi/v1/income']),
  '/binance-eapi': new Set([
    '/eapi/v1/marginAccount',
    '/eapi/v1/position',
    '/eapi/v1/userTrades',
    '/eapi/v1/exerciseRecord',
  ]),
  '/binance-papi': new Set([
    '/papi/v1/account',
    '/papi/v1/balance',
    '/papi/v1/um/account',
    '/papi/v1/cm/account',
    '/papi/v1/um/positionRisk',
    '/papi/v1/cm/positionRisk',
    '/papi/v1/um/income',
    '/papi/v1/cm/income',
  ]),
  '/bybit-api': new Set([
    '/v5/user/query-api',
    '/v5/account/wallet-balance',
    '/v5/asset/transfer/query-account-coins-balance',
    '/v5/asset/asset-overview',
    '/v5/earn/advance/position',
    '/v5/market/time',
  ]),
};

function isReadOnlyExchangePath(req: Request, prefix: string): boolean {
  const rawPathname = new URL(req.url).pathname.slice(prefix.length);
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    // A malformed escape must never be forwarded through a read-only guard.
    return false;
  }
  const allowedPaths = READ_ONLY_EXCHANGE_PATHS[prefix];
  if (!allowedPaths?.has(pathname)) return false;

  // Binance documents this legacy GET as a switch that changes the account's
  // Soft Staking setting. It is intentionally not a read, even though its verb
  // is GET and therefore needs an explicit deny in the proxy.
  return !/\/soft-staking\/set$/iu.test(pathname);
}

async function readOnlyProxyRequest(
  req: Request,
  prefix: string,
  targetBase: string,
): Promise<Response> {
  if (!isReadOnlyExchangeMethod(req.method)) {
    return new Response('Exchange proxy is read-only.', {
      status: 405,
      headers: { Allow: 'GET, HEAD', ...jsonHeaders },
    });
  }
  if (!isReadOnlyExchangePath(req, prefix)) {
    return new Response('Exchange proxy path is not read-only.', {
      status: 403,
      headers: jsonHeaders,
    });
  }
  return proxyRequest(req, prefix, targetBase);
}

async function proxyRequest(req: Request, prefix: string, targetBase: string): Promise<Response> {
  const upstream = await fetch(proxyTargetUrl(req, prefix, targetBase), {
    method: req.method,
    headers: copyProxyHeaders(req),
    // duplex: 'half' es obligatorio al reenviar un ReadableStream como body.
    ...(hasRequestBody(req.method) ? { body: req.body, duplex: 'half' } : {}),
    redirect: 'manual',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyProxyResponseHeaders(upstream.headers),
  });
}

function resolvePort(): number {
  const raw = Bun.env.PORT ?? Bun.env.BUN_PORT;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

export function createServerOptions(): Bun.ServeOptions {
  return {
    // Fijo a localhost a proposito: los proxies de exchange y /local-vault/credentials
    // (que devuelve secretos en claro) no deben quedar expuestos en la red.
    hostname: 'localhost',
    port: resolvePort(),
    development: Bun.env.NODE_ENV !== 'production',
    routes: {
      '/': index,
      '/public/manifest.json': () =>
        publicFile('manifest.json', 'application/manifest+json; charset=utf-8'),
      '/public/icon-192.svg': () => publicFile('icon-192.svg', 'image/svg+xml; charset=utf-8'),
      '/public/icon-512.svg': () => publicFile('icon-512.svg', 'image/svg+xml; charset=utf-8'),
      '/public/favicon.svg': () => publicFile('favicon.svg', 'image/svg+xml; charset=utf-8'),
      '/public/sw.js': () => publicFile('sw.js', 'text/javascript; charset=utf-8'),
      '/manifest.json': () =>
        publicFile('manifest.json', 'application/manifest+json; charset=utf-8'),
      '/icon-192.svg': () => publicFile('icon-192.svg', 'image/svg+xml; charset=utf-8'),
      '/icon-512.svg': () => publicFile('icon-512.svg', 'image/svg+xml; charset=utf-8'),
      '/favicon.svg': () => publicFile('favicon.svg', 'image/svg+xml; charset=utf-8'),
      '/sw.js': () => publicFile('sw.js', 'text/javascript; charset=utf-8'),
      '/assets/*': publicAssetFile,
      '/public/assets/*': publicAssetFile,
      '/local-vault/credentials': handleLocalVaultCredentials,
      '/api/hyperliquid/sync': handleHyperliquidSync,
      '/binance-api/*': (req: Request) =>
        readOnlyProxyRequest(req, '/binance-api', 'https://api.binance.com/api'),
      '/binance-sapi/*': (req: Request) =>
        readOnlyProxyRequest(req, '/binance-sapi', 'https://api.binance.com/sapi'),
      '/binance-fapi/*': (req: Request) =>
        readOnlyProxyRequest(req, '/binance-fapi', 'https://fapi.binance.com'),
      '/binance-dapi/*': (req: Request) =>
        readOnlyProxyRequest(req, '/binance-dapi', 'https://dapi.binance.com'),
      '/binance-eapi/*': (req: Request) =>
        readOnlyProxyRequest(req, '/binance-eapi', 'https://eapi.binance.com'),
      '/binance-papi/*': (req: Request) =>
        readOnlyProxyRequest(req, '/binance-papi', 'https://papi.binance.com'),
      '/bybit-api/*': (req: Request) =>
        readOnlyProxyRequest(req, '/bybit-api', 'https://api.bybit.com'),
    },
    fetch() {
      return new Response('Not found', { status: 404 });
    },
  };
}

export function startServer(): ReturnType<typeof Bun.serve> {
  return Bun.serve(createServerOptions());
}

if (import.meta.main) {
  const server = startServer();
  console.log(`Bun dev server listening on http://${server.hostname}:${server.port}`);
}
