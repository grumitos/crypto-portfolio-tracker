import type { BinanceApiCredentials, BybitApiCredentials } from '../types';

const LOCAL_VAULT_ENDPOINT = '/local-vault/credentials';

export interface LocalVaultCredentials {
  binance?: BinanceApiCredentials;
  bybit?: BybitApiCredentials;
}

interface LocalVaultResponse extends LocalVaultCredentials {
  available?: boolean;
  error?: string;
}

function canUseLocalVault(): boolean {
  return typeof fetch === 'function' && typeof window !== 'undefined';
}

export async function loadLocalVaultCredentials(): Promise<LocalVaultCredentials | null> {
  if (!canUseLocalVault()) return null;

  try {
    const response = await fetch(LOCAL_VAULT_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = (await response.json()) as LocalVaultResponse;
    if (payload.available === false) return null;
    return {
      ...(payload.binance ? { binance: payload.binance } : {}),
      ...(payload.bybit ? { bybit: payload.bybit } : {}),
    };
  } catch {
    return null;
  }
}

export async function saveLocalVaultCredential(
  exchange: 'binance' | 'bybit',
  credentials: BinanceApiCredentials | BybitApiCredentials,
): Promise<boolean> {
  if (!canUseLocalVault()) return false;

  try {
    const response = await fetch(LOCAL_VAULT_ENDPOINT, {
      method: 'PUT',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exchange, credentials }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function clearLocalVaultCredential(exchange: 'binance' | 'bybit'): Promise<void> {
  if (!canUseLocalVault()) return;

  try {
    await fetch(`${LOCAL_VAULT_ENDPOINT}?exchange=${encodeURIComponent(exchange)}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
  } catch {
    // Local vault is an optional dev-only persistence layer.
  }
}
