import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import index from './index.html';

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
const LOCAL_VAULT_PATH = resolve(process.cwd(), '.local', 'credentials.dpapi.json');
const PUBLIC_DIR = resolve(process.cwd(), 'public');

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
        $protected = [Convert]::FromBase64String([string]$secretDpapi)
        $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
          $protected,
          $null,
          [Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        $plain += [Text.Encoding]::UTF8.GetString($bytes)
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
    const parsed = (await Bun.file(LOCAL_VAULT_PATH).json()) as LocalVaultStoredPayload;
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
  await mkdir(dirname(LOCAL_VAULT_PATH), { recursive: true });
  await Bun.write(LOCAL_VAULT_PATH, `${JSON.stringify(stored, null, 2)}\n`);
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
      return sendJson(200, { available: true, ...(await readPlainLocalVault()) });
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
        const file = Bun.file(LOCAL_VAULT_PATH);
        if (await file.exists()) await file.delete();
      } else {
        await writePlainLocalVault(current);
      }
      return sendJson(200, { available: true, deleted: exchange });
    }

    return sendJson(405, { available: true, error: 'Metodo no permitido.' });
  } catch (err) {
    return sendJson(500, {
      available: true,
      error: err instanceof Error ? err.message : 'Error de vault local.',
    });
  }
}

function publicFile(path: string, contentType: string): Response {
  return new Response(Bun.file(resolve(PUBLIC_DIR, path)), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
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

async function proxyRequest(req: Request, prefix: string, targetBase: string): Promise<Response> {
  const upstream = await fetch(proxyTargetUrl(req, prefix, targetBase), {
    method: req.method,
    headers: copyProxyHeaders(req),
    body: hasRequestBody(req.method) ? req.body : undefined,
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
    hostname: Bun.env.HOST ?? 'localhost',
    port: resolvePort(),
    development: Bun.env.NODE_ENV !== 'production',
    routes: {
      '/': index,
      '/public/manifest.json': () =>
        publicFile('manifest.json', 'application/manifest+json; charset=utf-8'),
      '/public/icon-192.svg': () => publicFile('icon-192.svg', 'image/svg+xml; charset=utf-8'),
      '/public/icon-512.svg': () => publicFile('icon-512.svg', 'image/svg+xml; charset=utf-8'),
      '/public/sw.js': () => publicFile('sw.js', 'text/javascript; charset=utf-8'),
      '/manifest.json': () =>
        publicFile('manifest.json', 'application/manifest+json; charset=utf-8'),
      '/icon-192.svg': () => publicFile('icon-192.svg', 'image/svg+xml; charset=utf-8'),
      '/icon-512.svg': () => publicFile('icon-512.svg', 'image/svg+xml; charset=utf-8'),
      '/sw.js': () => publicFile('sw.js', 'text/javascript; charset=utf-8'),
      '/local-vault/credentials': handleLocalVaultCredentials,
      '/binance-api/*': (req: Request) =>
        proxyRequest(req, '/binance-api', 'https://api.binance.com/api'),
      '/binance-sapi/*': (req: Request) =>
        proxyRequest(req, '/binance-sapi', 'https://api.binance.com/sapi'),
      '/bybit-api/*': (req: Request) => proxyRequest(req, '/bybit-api', 'https://api.bybit.com'),
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
