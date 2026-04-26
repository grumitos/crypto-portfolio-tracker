import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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

const LOCAL_VAULT_PATH = resolve(process.cwd(), '.local', 'credentials.dpapi.json');

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readRequestJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function runPowerShellJson(script: string, payload: unknown): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolveOutput(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
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

async function dpapiUnprotect(secretDpapi: string): Promise<string> {
  return runPowerShellJson(
    `
      $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
      Add-Type -AssemblyName System.Security
      $protected = [Convert]::FromBase64String([string]$payload.secretDpapi)
      $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $protected,
        $null,
        [Security.Cryptography.DataProtectionScope]::CurrentUser
      )
      [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
    `,
    { secretDpapi },
  );
}

async function readStoredLocalVault(): Promise<LocalVaultStoredPayload | null> {
  try {
    const raw = await readFile(LOCAL_VAULT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as LocalVaultStoredPayload;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

async function readPlainLocalVault(): Promise<LocalVaultPlainPayload> {
  const stored = await readStoredLocalVault();
  const plain: LocalVaultPlainPayload = {};
  if (stored?.binance) {
    plain.binance = {
      apiKey: await dpapiUnprotect(stored.binance.apiKeyDpapi),
      apiSecret: await dpapiUnprotect(stored.binance.secretDpapi),
    };
  }
  if (stored?.bybit) {
    plain.bybit = {
      apiKey: await dpapiUnprotect(stored.bybit.apiKeyDpapi),
      apiSecret: await dpapiUnprotect(stored.bybit.secretDpapi),
    };
  }
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
  await writeFile(LOCAL_VAULT_PATH, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
}

function isLocalVaultCredentials(value: unknown): value is LocalVaultExchangeCredentials {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LocalVaultExchangeCredentials).apiKey === 'string' &&
    typeof (value as LocalVaultExchangeCredentials).apiSecret === 'string'
  );
}

function localDpapiVaultPlugin(): Plugin {
  return {
    name: 'local-dpapi-vault',
    configureServer(server) {
      server.middlewares.use('/local-vault/credentials', async (req, res) => {
        if (process.platform !== 'win32') {
          sendJson(res, 503, { available: false, error: 'DPAPI solo esta disponible en Windows.' });
          return;
        }

        try {
          if (req.method === 'GET') {
            sendJson(res, 200, { available: true, ...(await readPlainLocalVault()) });
            return;
          }

          if (req.method === 'PUT') {
            const body = (await readRequestJson(req)) as {
              exchange?: 'binance' | 'bybit';
              credentials?: unknown;
            };
            if (
              (body.exchange !== 'binance' && body.exchange !== 'bybit') ||
              !isLocalVaultCredentials(body.credentials)
            ) {
              sendJson(res, 400, { available: true, error: 'Payload invalido.' });
              return;
            }
            const current = await readPlainLocalVault();
            current[body.exchange] = body.credentials;
            await writePlainLocalVault(current);
            sendJson(res, 200, { available: true, saved: body.exchange });
            return;
          }

          if (req.method === 'DELETE') {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const exchange = url.searchParams.get('exchange');
            if (exchange !== 'binance' && exchange !== 'bybit') {
              sendJson(res, 400, { available: true, error: 'Exchange invalido.' });
              return;
            }
            const current = await readPlainLocalVault();
            delete current[exchange];
            if (!current.binance && !current.bybit) {
              await rm(LOCAL_VAULT_PATH, { force: true });
            } else {
              await writePlainLocalVault(current);
            }
            sendJson(res, 200, { available: true, deleted: exchange });
            return;
          }

          sendJson(res, 405, { available: true, error: 'Metodo no permitido.' });
        } catch (err) {
          sendJson(res, 500, {
            available: true,
            error: err instanceof Error ? err.message : 'Error de vault local.',
          });
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [localDpapiVaultPlugin()],
  server: {
    host: 'localhost',
    port: 5176,
    strictPort: true,
    proxy: {
      '/binance-api': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/binance-api/, '/api'),
      },
      '/binance-sapi': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/binance-sapi/, '/sapi'),
      },
      '/bybit-api': {
        target: 'https://api.bybit.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bybit-api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/index.ts', 'src/main.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 78,
        branches: 70,
      },
    },
  },
});
