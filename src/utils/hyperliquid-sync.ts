import type {
  CapitalLedgerDiscoveredVault,
  CapitalLedgerSyncSnapshot,
  CapitalLedgerTransaction,
  CapitalLedgerVault,
  CapitalLedgerVaultConfig,
  CapitalLedgerVaultUser,
} from '../types';

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const HYPERLIQUID_APP_URL = 'https://app.hyperliquid.xyz';
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_DISCOVERED_VAULTS = 10;

export class HyperliquidSyncError extends Error {
  status: number;
  code: string;
  publicMessage: string;

  constructor(status: number, code: string, publicMessage: string) {
    super(publicMessage);
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export interface HyperliquidSyncInput {
  vaultAddress?: unknown;
  userAddress?: unknown;
}

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function syncHyperliquidVaults(
  input: HyperliquidSyncInput,
  fetchImpl: FetchImpl = fetch,
): Promise<CapitalLedgerSyncSnapshot> {
  if (typeof fetchImpl !== 'function') {
    throw new HyperliquidSyncError(
      500,
      'FETCH_UNAVAILABLE',
      'Fetch no esta disponible en este runtime.',
    );
  }

  const config = normalizeSyncInput(input);
  let discoveredVaults: CapitalLedgerDiscoveredVault[] = [];
  let vaultAddresses = config.vaultAddress ? [config.vaultAddress] : [];

  if (vaultAddresses.length === 0 && config.userAddress) {
    const equities = await fetchInfo(fetchImpl, 'userVaultEquities', { user: config.userAddress });
    discoveredVaults = normalizeUserVaultEquities(equities).slice(0, MAX_DISCOVERED_VAULTS);
    vaultAddresses = discoveredVaults.map((vault) => vault.vaultAddress);
  }

  const discoveredByVault = new Map(
    discoveredVaults.map((vault) => [vault.vaultAddress, vault] as const),
  );
  const vaults: CapitalLedgerVault[] = [];

  for (const vaultAddress of vaultAddresses) {
    const detailPayload: Record<string, string> = { vaultAddress };
    if (config.userAddress) detailPayload.user = config.userAddress;

    const details = await fetchInfo(fetchImpl, 'vaultDetails', detailPayload);
    vaults.push(
      normalizeVaultDetails(
        details,
        vaultAddress,
        config.userAddress,
        discoveredByVault.get(vaultAddress),
      ),
    );
  }

  const movements = config.userAddress
    ? normalizeVaultMovements(
        await fetchInfo(fetchImpl, 'userNonFundingLedgerUpdates', { user: config.userAddress }),
        new Set(vaultAddresses),
      )
    : [];
  const userVaults = vaults
    .map((vault) => vault.user)
    .filter((user): user is CapitalLedgerVaultUser => Boolean(user));
  const activeValue = sumDecimalStrings(userVaults.map((user) => user.vaultEquity));
  const pnlTotal =
    sumDecimalStrings(userVaults.map((user) => user.allTimePnl)) ||
    sumDecimalStrings(userVaults.map((user) => user.pnl));

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    config,
    summary: {
      activeValue,
      pnlTotal,
      vaultCount: vaults.length,
      movementCount: movements.length,
    },
    discoveredVaults,
    vaults,
    movements,
  };
}

export function normalizeHyperliquidAddress(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') return '';
  const address = value.trim().toLowerCase();
  return ADDRESS_RE.test(address) ? address : '';
}

function normalizeSyncInput(input: HyperliquidSyncInput): CapitalLedgerVaultConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HyperliquidSyncError(400, 'INVALID_REQUEST', 'Payload invalido.');
  }

  const vaultAddress = normalizeHyperliquidAddress(input.vaultAddress);
  const userAddress = normalizeHyperliquidAddress(input.userAddress);

  if (input.vaultAddress && !vaultAddress) {
    throw new HyperliquidSyncError(
      400,
      'INVALID_ADDRESS',
      'Ingresa una direccion Hyperliquid valida.',
    );
  }

  if (input.userAddress && !userAddress) {
    throw new HyperliquidSyncError(
      400,
      'INVALID_ADDRESS',
      'Ingresa una direccion Hyperliquid valida.',
    );
  }

  if (!vaultAddress && !userAddress) {
    throw new HyperliquidSyncError(400, 'MISSING_ADDRESS', 'Ingresa una wallet o un vault.');
  }

  return { vaultAddress, userAddress };
}

async function fetchInfo(
  fetchImpl: FetchImpl,
  type: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 12_000) : null;

  try {
    const response = await fetchImpl(HYPERLIQUID_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...payload }),
      signal: controller ? controller.signal : undefined,
    });

    if (!response || typeof response.json !== 'function') {
      throw new HyperliquidSyncError(
        502,
        'HYPERLIQUID_BAD_RESPONSE',
        'Hyperliquid devolvio una respuesta invalida.',
      );
    }

    const data = await response.json();
    if (!response.ok) {
      throw new HyperliquidSyncError(502, 'HYPERLIQUID_ERROR', 'Hyperliquid rechazo la consulta.');
    }
    return data;
  } catch (error) {
    if (error instanceof HyperliquidSyncError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HyperliquidSyncError(
        504,
        'HYPERLIQUID_TIMEOUT',
        'Hyperliquid no respondio a tiempo.',
      );
    }
    throw new HyperliquidSyncError(
      502,
      'HYPERLIQUID_UNAVAILABLE',
      'No se pudo consultar Hyperliquid.',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeUserVaultEquities(data: unknown): CapitalLedgerDiscoveredVault[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row): CapitalLedgerDiscoveredVault | null => {
      if (!isRecord(row)) return null;
      const vaultAddress = normalizeHyperliquidAddress(row.vaultAddress);
      if (!vaultAddress) return null;
      return {
        vaultAddress,
        equity: stringValue(row.equity),
        lockedUntilTimestamp: numberOrNull(row.lockedUntilTimestamp),
      };
    })
    .filter((row): row is CapitalLedgerDiscoveredVault => Boolean(row));
}

function normalizeVaultDetails(
  details: unknown,
  vaultAddress: string,
  userAddress: string,
  discoveredVault: CapitalLedgerDiscoveredVault | undefined,
): CapitalLedgerVault {
  const record = isRecord(details) ? details : {};
  const user =
    normalizeFollowerState(record.followerState, userAddress) ||
    findFollower(record.followers, userAddress) ||
    fallbackFollower(discoveredVault, userAddress);

  return {
    vaultAddress,
    url: vaultUrl(vaultAddress),
    name: boundedText(record.name, 120),
    apr: numberOrNull(record.apr),
    user,
    maxWithdrawable: stringValue(record.maxWithdrawable),
    isClosed: Boolean(record.isClosed),
    allowDeposits: typeof record.allowDeposits === 'boolean' ? record.allowDeposits : null,
  };
}

function normalizeFollowerState(row: unknown, userAddress: string): CapitalLedgerVaultUser | null {
  if (!isRecord(row)) return null;
  const rowUserAddress = normalizeHyperliquidAddress(row.user) || userAddress || '';
  return {
    userAddress: rowUserAddress,
    vaultEquity: stringValue(row.vaultEquity),
    pnl: stringValue(row.pnl),
    allTimePnl: stringValue(row.allTimePnl),
    daysFollowing: numberOrNull(row.daysFollowing),
    vaultEntryTime: numberOrNull(row.vaultEntryTime),
    lockupUntil: numberOrNull(row.lockupUntil),
  };
}

function findFollower(followers: unknown, userAddress: string): CapitalLedgerVaultUser | null {
  if (!userAddress || !Array.isArray(followers)) return null;
  const follower = followers.find(
    (row) => isRecord(row) && normalizeHyperliquidAddress(row.user) === userAddress,
  );
  return normalizeFollowerState(follower, userAddress);
}

function fallbackFollower(
  discoveredVault: CapitalLedgerDiscoveredVault | undefined,
  userAddress: string,
): CapitalLedgerVaultUser | null {
  if (!discoveredVault || !userAddress) return null;
  return {
    userAddress,
    vaultEquity: discoveredVault.equity,
    pnl: '',
    allTimePnl: '',
    daysFollowing: null,
    vaultEntryTime: null,
    lockupUntil: discoveredVault.lockedUntilTimestamp,
  };
}

function normalizeVaultMovements(
  data: unknown,
  vaultAddressSet: Set<string>,
): CapitalLedgerTransaction[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => normalizeVaultMovement(row, vaultAddressSet))
    .filter((row): row is CapitalLedgerTransaction & { time: number } => Boolean(row))
    .sort((a, b) => b.time - a.time);
}

function normalizeVaultMovement(
  row: unknown,
  vaultAddressSet: Set<string>,
): (CapitalLedgerTransaction & { time: number }) | null {
  if (!isRecord(row) || !isRecord(row.delta)) return null;
  const delta = row.delta;

  const vaultAddress = normalizeHyperliquidAddress(delta.vault);
  if (!vaultAddress || (vaultAddressSet.size > 0 && !vaultAddressSet.has(vaultAddress))) {
    return null;
  }

  const time = numberOrNull(row.time);
  const hash = boundedText(row.hash, 90);
  const isWithdrawal = delta.type === 'vaultWithdraw';
  if (delta.type !== 'vaultDeposit' && !isWithdrawal) return null;

  const amountSource = isWithdrawal
    ? firstPresent(delta.netWithdrawnUsd, delta.requestedUsd)
    : delta.usdc;
  const amount = numberOrNull(amountSource);
  if (amount === null || amount <= 0) return null;

  return {
    id: [hash || time || 'ledger', delta.type, vaultAddress].join('-'),
    at: time ? dateString(time) : '',
    time: time || 0,
    type: isWithdrawal ? 'withdrawal' : 'deposit',
    amount: trimNumber(amount),
    vaultAddress,
    hash,
    url: hash ? txUrl(hash) : '',
  };
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function vaultUrl(address: string): string {
  return `${HYPERLIQUID_APP_URL}/vaults/${address}`;
}

function txUrl(hash: string): string {
  return `${HYPERLIQUID_APP_URL}/explorer/tx/${hash}`;
}

function dateString(time: number): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function boundedText(value: unknown, maxLength: number): string {
  const text = stringValue(value).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumDecimalStrings(values: string[]): string {
  let hasValue = false;
  let total = 0;

  values.forEach((value) => {
    if (value.trim() === '') return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    total += number;
    hasValue = true;
  });

  if (!hasValue) return '';
  return trimNumber(total);
}

function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(12).replace(/\.?0+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
