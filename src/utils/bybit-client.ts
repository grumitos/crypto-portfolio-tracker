import type {
  BybitAccountBalance,
  BybitApiCredentials,
  BybitDiscountBuyPosition,
  BybitDualAssetPosition,
  BybitPosition,
} from '../types';
import { loadBybitApiCredentials } from './bybit-auth';

const BYBIT_PROXY_BASE = '/bybit-api/v5';
const FETCH_TIMEOUT_MS = 10_000;
const READ_ONLY_CACHE_TTL_MS = 5 * 60 * 1000;
const SERVER_TIME_CACHE_TTL_MS = 5 * 60 * 1000;
const RECV_WINDOW = '5000';
const DAY_MS = 24 * 60 * 60 * 1000;

const ALLOWED_SIGNED_GET_PATHS = new Set([
  '/user/query-api',
  '/account/wallet-balance',
  '/asset/transfer/query-account-coins-balance',
  '/position/list',
  '/earn/advance/position',
]);

const ALLOWED_PUBLIC_GET_PATHS = new Set(['/market/tickers', '/market/time']);

let readOnlyCheckCache: { apiKey: string; ts: number; info: BybitApiKeyInfo } | null = null;
let readOnlyCheckInFlight: { apiKey: string; request: Promise<BybitApiKeyInfo> } | null = null;
let serverTimeOffsetCache: { offsetMs: number; ts: number } | null = null;
let serverTimeOffsetInFlight: Promise<number> | null = null;

async function hmacSign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

interface BybitServerTimeResponse {
  time?: number | string;
  result?: {
    timeSecond?: number | string;
    timeNano?: number | string;
  };
}

function parseBybitServerTime(payload: BybitServerTimeResponse): number {
  const topLevelTime = Number(payload.time);
  if (Number.isFinite(topLevelTime) && topLevelTime > 0) {
    return topLevelTime;
  }

  const timeNano = Number(payload.result?.timeNano);
  if (Number.isFinite(timeNano) && timeNano > 0) {
    return Math.round(timeNano / 1_000_000);
  }

  const timeSecond = Number(payload.result?.timeSecond);
  if (Number.isFinite(timeSecond) && timeSecond > 0) {
    return Math.round(timeSecond * 1000);
  }

  throw new Error('Bybit time API returned an invalid server time.');
}

function clearBybitServerTimeOffset(): void {
  serverTimeOffsetCache = null;
  serverTimeOffsetInFlight = null;
}

async function refreshBybitServerTimeOffset(): Promise<number> {
  if (serverTimeOffsetInFlight) return serverTimeOffsetInFlight;

  const request = (async (): Promise<number> => {
    const startedAt = Date.now();
    const payload = await fetchBybitPublicGet<BybitServerTimeResponse>('/market/time');
    const endedAt = Date.now();
    const serverTime = parseBybitServerTime(payload);
    const localEstimate = startedAt + (endedAt - startedAt) / 2;
    const offsetMs = Math.round(serverTime - localEstimate);
    serverTimeOffsetCache = { offsetMs, ts: endedAt };
    return offsetMs;
  })();

  serverTimeOffsetInFlight = request;
  try {
    return await request;
  } finally {
    if (serverTimeOffsetInFlight === request) {
      serverTimeOffsetInFlight = null;
    }
  }
}

async function getBybitSignedTimestamp(forceRefresh = false): Promise<string> {
  if (
    !forceRefresh &&
    serverTimeOffsetCache &&
    Date.now() - serverTimeOffsetCache.ts < SERVER_TIME_CACHE_TTL_MS
  ) {
    return String(Math.round(Date.now() + serverTimeOffsetCache.offsetMs));
  }

  if (!forceRefresh) {
    return String(Math.round(Date.now()));
  }

  try {
    const offsetMs = await refreshBybitServerTimeOffset();
    return String(Math.round(Date.now() + offsetMs));
  } catch {
    return String(Math.round(Date.now() + (serverTimeOffsetCache?.offsetMs ?? 0)));
  }
}

function isBybitTimestampErrorPayload(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const envelope = payload as { retCode?: unknown; retMsg?: unknown };
  const retCode = Number(envelope.retCode);
  const retMsg = String(envelope.retMsg ?? '').toLowerCase();
  if (retCode === 10002) return true;
  return (
    retCode !== 0 &&
    (retMsg.includes('timestamp') ||
      retMsg.includes('recv_window') ||
      retMsg.includes('recvwindow'))
  );
}

async function fetchBybitSignedGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  credentials?: BybitApiCredentials,
): Promise<T> {
  if (!ALLOWED_SIGNED_GET_PATHS.has(path)) {
    throw new Error(`Blocked non-read-only Bybit endpoint: ${path}`);
  }

  const creds = credentials ?? loadBybitApiCredentials();
  if (!creds) throw new Error('Bybit API credentials not configured');

  const queryString = toQueryString(params);
  const url = queryString
    ? `${BYBIT_PROXY_BASE}${path}?${queryString}`
    : `${BYBIT_PROXY_BASE}${path}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timestamp = await getBybitSignedTimestamp(attempt > 0);
    const signaturePayload = `${timestamp}${creds.apiKey}${RECV_WINDOW}${queryString}`;
    const signature = await hmacSign(creds.apiSecret, signaturePayload);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-BAPI-API-KEY': creds.apiKey,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': RECV_WINDOW,
          'X-BAPI-SIGN': signature,
        },
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        if (
          attempt === 0 &&
          (errorBody.toLowerCase().includes('timestamp') ||
            errorBody.toLowerCase().includes('recv_window'))
        ) {
          clearBybitServerTimeOffset();
          continue;
        }
        throw new Error(`Bybit API error ${response.status}: ${errorBody}`);
      }

      const payload = (await response.json()) as T;
      if (attempt === 0 && isBybitTimestampErrorPayload(payload)) {
        clearBybitServerTimeOffset();
        continue;
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('Bybit API request failed after refreshing server time.');
}

async function fetchBybitPublicGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  if (!ALLOWED_PUBLIC_GET_PATHS.has(path)) {
    throw new Error(`Blocked unsupported Bybit public endpoint: ${path}`);
  }

  const queryString = toQueryString(params);
  const url = queryString
    ? `${BYBIT_PROXY_BASE}${path}?${queryString}`
    : `${BYBIT_PROXY_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Bybit API error ${response.status}: ${errorBody}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
}

interface BybitApiKeyInfo {
  readOnly: number;
  permissions: Record<string, string[]>;
}

interface BybitWalletBalanceResponse {
  list: Array<{
    accountType: string;
    coin: Array<{
      coin: string;
      walletBalance: string;
      locked: string;
      usdValue: string;
    }>;
  }>;
}

interface BybitAllCoinsBalanceResponse {
  accountType: string;
  balance: Array<{
    coin: string;
    walletBalance: string;
    transferBalance?: string;
    bonus?: string;
  }>;
}

interface BybitPositionListResponse {
  list: Array<{
    symbol: string;
    side: string;
    size: string;
    avgPrice?: string;
    markPrice?: string;
    positionValue?: string;
    unrealisedPnl?: string;
    updatedTime?: string;
    createdTime?: string;
  }>;
}

interface BybitDualAssetPositionResponse {
  nextPageCursor?: string;
  list: Array<{
    positionId: string;
    productId: string;
    baseCoin: string;
    quoteCoin: string;
    investCoin: string;
    amount: string;
    apyE8: string;
    direction: string;
    targetPrice: string;
    settlementTime: string;
    status: string;
    orderId?: string;
    duration?: string;
    expectReturnCoin?: string;
    expectReturnAmount?: string;
    accountType?: string;
    toAccountType?: string;
    yieldStartAt?: string;
    yieldEndAt?: string;
  }>;
}

interface BybitDiscountBuyPositionResponse {
  nextPageCursor?: string;
  list: Array<{
    positionId: string;
    productId: string;
    category: string;
    coin: string;
    underlyingAsset: string;
    amount: string;
    purchasePrice: string;
    knockoutPrice: string;
    knockoutCouponE8: string;
    status: string;
    orderId?: string;
    duration?: string;
    settlementTime: string;
    accountType?: string;
    toAccountType?: string;
    settleType?: string;
    expectReceiveAt?: string;
  }>;
}

interface BybitTickerResponse {
  category: string;
  list: Array<{
    symbol: string;
    lastPrice: string;
    price24hPcnt?: string;
  }>;
}

function parseFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalTimestamp(value: unknown): number | undefined {
  const parsed = parseFiniteNumber(value, NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseBybitDurationDays(value: unknown): number | undefined {
  const match = String(value ?? '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*([dh])?$/i);
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();
  const days = unit === 'h' ? amount / 24 : amount;
  return Number.isFinite(days) && days > 0 ? days : undefined;
}

function calculateBybitEffectiveApr(
  apr: number,
  duration: unknown,
  yieldStartAt: number | undefined,
  yieldEndAt: number | undefined,
  settlementTime: number,
): number {
  const advertisedDays = parseBybitDurationDays(duration);
  const endAt = yieldEndAt ?? settlementTime;
  if (
    !Number.isFinite(apr) ||
    !advertisedDays ||
    !yieldStartAt ||
    !Number.isFinite(endAt) ||
    endAt <= yieldStartAt
  ) {
    return apr;
  }

  const lockedDays = Math.max((endAt - yieldStartAt) / DAY_MS, 1);
  if (lockedDays <= advertisedDays) return apr;
  return apr * (advertisedDays / lockedDays);
}

function calculateBybitProjectedProfit(
  row: BybitDualAssetPositionResponse['list'][number],
): number | undefined {
  const amount = parseFiniteNumber(row.amount, NaN);
  const targetPrice = parseFiniteNumber(row.targetPrice, NaN);
  const expectedAmount = parseFiniteNumber(row.expectReturnAmount, NaN);
  const investCoin = row.investCoin?.toUpperCase();
  const expectedCoin = row.expectReturnCoin?.toUpperCase();
  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(expectedAmount) ||
    amount <= 0 ||
    expectedAmount <= 0 ||
    !investCoin ||
    !expectedCoin
  ) {
    return undefined;
  }

  if (expectedCoin === investCoin) {
    return Math.max(expectedAmount - amount, 0);
  }

  if (Number.isFinite(targetPrice) && targetPrice > 0) {
    if (row.direction === 'BuyLow' && expectedCoin === row.baseCoin?.toUpperCase()) {
      return Math.max(expectedAmount * targetPrice - amount, 0);
    }

    if (row.direction === 'SellHigh' && expectedCoin === row.quoteCoin?.toUpperCase()) {
      return Math.max(expectedAmount / targetPrice - amount, 0);
    }
  }

  return undefined;
}

function calculateBybitAprFromProjectedProfit(
  amount: number,
  projectedProfit: number | undefined,
  yieldStartAt: number | undefined,
  yieldEndAt: number | undefined,
  settlementTime: number,
): number | undefined {
  const endAt = yieldEndAt ?? settlementTime;
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isFinite(projectedProfit) ||
    (projectedProfit as number) < 0 ||
    !yieldStartAt ||
    !Number.isFinite(endAt) ||
    endAt <= yieldStartAt
  ) {
    return undefined;
  }

  const lockedDays = Math.max((endAt - yieldStartAt) / DAY_MS, 1);
  return ((projectedProfit as number) / amount) * (365 / lockedDays) * 100;
}

function calculateBybitCouponProjectedProfit(
  amount: number,
  apr: number,
  duration: unknown,
): number | undefined {
  const durationDays = parseBybitDurationDays(duration);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(apr) || !durationDays) {
    return undefined;
  }
  return amount * (apr / 100) * (durationDays / 365);
}

function deriveBybitYieldStartAt(settlementTime: number, duration: unknown): number | undefined {
  const durationDays = parseBybitDurationDays(duration);
  if (!Number.isFinite(settlementTime) || !durationDays) return undefined;
  return settlementTime - durationDays * DAY_MS;
}

function resolveBybitSymbolAssets(symbol: string): { baseAsset: string; quoteAsset: string } {
  const normalized = symbol.toUpperCase();
  const quoteAsset = ['USDT', 'USDC', 'USD', 'BTC', 'ETH'].find((quote) =>
    normalized.endsWith(quote),
  );
  if (!quoteAsset) return { baseAsset: normalized, quoteAsset: 'USDT' };
  return {
    baseAsset: normalized.slice(0, -quoteAsset.length) || normalized,
    quoteAsset,
  };
}

function assertBybitOk<T>(payload: BybitEnvelope<T>): T {
  if (payload.retCode !== 0) {
    throw new Error(`Bybit API error ${payload.retCode}: ${payload.retMsg}`);
  }
  return payload.result;
}

export async function fetchBybitApiKeyInfo(
  credentials?: BybitApiCredentials,
): Promise<BybitApiKeyInfo> {
  const payload = await fetchBybitSignedGet<BybitEnvelope<BybitApiKeyInfo>>(
    '/user/query-api',
    {},
    credentials,
  );
  return assertBybitOk(payload);
}

export async function testBybitApiConnection(credentials?: BybitApiCredentials): Promise<{
  success: boolean;
  readOnly: boolean;
  permissions: Record<string, string[]>;
  error?: string;
}> {
  try {
    const info = await fetchBybitApiKeyInfo(credentials);
    return {
      success: true,
      readOnly: info.readOnly === 1,
      permissions: info.permissions ?? {},
    };
  } catch (err) {
    return {
      success: false,
      readOnly: false,
      permissions: {},
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function assertCurrentBybitCredentialsReadOnly(): Promise<BybitApiCredentials> {
  const creds = loadBybitApiCredentials();
  if (!creds) throw new Error('Bybit API credentials not configured');

  await getCurrentBybitReadOnlyInfo(creds);
  return creds;
}

async function getCurrentBybitReadOnlyInfo(creds: BybitApiCredentials): Promise<BybitApiKeyInfo> {
  if (
    readOnlyCheckCache?.apiKey === creds.apiKey &&
    Date.now() - readOnlyCheckCache.ts < READ_ONLY_CACHE_TTL_MS
  ) {
    return readOnlyCheckCache.info;
  }

  if (readOnlyCheckInFlight?.apiKey === creds.apiKey) {
    return readOnlyCheckInFlight.request;
  }

  const request = (async () => {
    const info = await fetchBybitApiKeyInfo(creds);
    if (info.readOnly !== 1) {
      throw new Error('Bybit API key is not read-only. Expected readOnly: 1.');
    }

    readOnlyCheckCache = { apiKey: creds.apiKey, ts: Date.now(), info };
    return info;
  })();

  readOnlyCheckInFlight = { apiKey: creds.apiKey, request };
  try {
    return await request;
  } finally {
    if (readOnlyCheckInFlight?.request === request) {
      readOnlyCheckInFlight = null;
    }
  }
}

export async function fetchBybitWalletBalances(
  forceAccountType?: 'UNIFIED' | 'CONTRACT' | 'SPOT',
): Promise<BybitAccountBalance[]> {
  const creds = await assertCurrentBybitCredentialsReadOnly();
  const accountTypes = forceAccountType
    ? [forceAccountType]
    : (['UNIFIED', 'CONTRACT', 'SPOT'] as const);
  const settled = await Promise.allSettled(
    accountTypes.map(async (accountType) => {
      const payload = await fetchBybitSignedGet<BybitEnvelope<BybitWalletBalanceResponse>>(
        '/account/wallet-balance',
        { accountType },
        creds,
      );
      return assertBybitOk(payload);
    }),
  );

  const fulfilled = settled
    .filter(
      (result): result is PromiseFulfilledResult<BybitWalletBalanceResponse> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value);

  if (fulfilled.length === 0 && settled.length > 0) {
    const firstRejected = settled.find((result) => result.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    throw firstRejected?.reason instanceof Error
      ? firstRejected.reason
      : new Error('Bybit wallet balance unavailable');
  }

  return fulfilled
    .flatMap((result) => result.list)
    .flatMap((account) => account.coin)
    .map((row) => ({
      asset: row.coin.toUpperCase(),
      walletBalance: parseFiniteNumber(row.walletBalance),
      locked: parseFiniteNumber(row.locked),
      usdValue: parseFiniteNumber(row.usdValue),
    }))
    .filter((row) => row.walletBalance > 0 || row.locked > 0 || row.usdValue > 0);
}

export async function fetchBybitAssetBalances(): Promise<BybitAccountBalance[]> {
  const creds = await assertCurrentBybitCredentialsReadOnly();
  const payload = await fetchBybitSignedGet<BybitEnvelope<BybitAllCoinsBalanceResponse>>(
    '/asset/transfer/query-account-coins-balance',
    { accountType: 'FUND' },
    creds,
  );
  const result = assertBybitOk(payload);

  return result.balance
    .map((row) => {
      const walletBalance = parseFiniteNumber(row.walletBalance);
      const transferBalance = parseFiniteNumber(row.transferBalance, walletBalance);
      return {
        asset: row.coin.toUpperCase(),
        walletBalance,
        locked: Math.max(walletBalance - transferBalance, 0),
        usdValue: 0,
      };
    })
    .filter((row) => row.walletBalance > 0 || row.locked > 0);
}

export async function fetchBybitOpenPositions(): Promise<BybitPosition[]> {
  const creds = loadBybitApiCredentials();
  if (!creds) throw new Error('Bybit API credentials not configured');
  const info = await getCurrentBybitReadOnlyInfo(creds);
  if (!info.permissions?.ContractTrade?.includes('Position')) {
    return [];
  }

  const requests = [
    { category: 'linear', settleCoin: 'USDT' },
    { category: 'linear', settleCoin: 'USDC' },
    { category: 'inverse' },
    { category: 'option' },
  ] as const;

  const settled = await Promise.allSettled(
    requests.map(async (params) => {
      const payload = await fetchBybitSignedGet<BybitEnvelope<BybitPositionListResponse>>(
        '/position/list',
        params,
        creds,
      );
      return assertBybitOk(payload).list;
    }),
  );

  return settled
    .filter(
      (result): result is PromiseFulfilledResult<BybitPositionListResponse['list']> =>
        result.status === 'fulfilled',
    )
    .flatMap((result) => result.value)
    .filter((row) => row.side === 'Buy' || row.side === 'Sell')
    .map((row) => {
      const symbol = row.symbol.toUpperCase();
      const { baseAsset, quoteAsset } = resolveBybitSymbolAssets(symbol);
      const size = parseFiniteNumber(row.size);
      return {
        id: `bybit_${symbol}_${row.side}`,
        symbol,
        baseAsset,
        quoteAsset,
        side: row.side as 'Buy' | 'Sell',
        size,
        avgPrice: parseFiniteNumber(row.avgPrice),
        markPrice: parseFiniteNumber(row.markPrice),
        positionValue: parseFiniteNumber(row.positionValue),
        unrealizedPnl: parseFiniteNumber(row.unrealisedPnl),
        updatedTime: parseOptionalTimestamp(row.updatedTime),
        createdTime: parseOptionalTimestamp(row.createdTime),
      };
    })
    .filter((position) => position.size > 0);
}

export async function fetchBybitDualAssetPositions(): Promise<BybitDualAssetPosition[]> {
  const creds = loadBybitApiCredentials();
  if (!creds) throw new Error('Bybit API credentials not configured');
  const info = await getCurrentBybitReadOnlyInfo(creds);
  if (!info.permissions?.Earn?.includes('Earn')) {
    return [];
  }

  const payload = await fetchBybitSignedGet<BybitEnvelope<BybitDualAssetPositionResponse>>(
    '/earn/advance/position',
    { category: 'DualAssets', limit: 20 },
    creds,
  );
  const result = assertBybitOk(payload);
  return result.list
    .filter((row) => row.direction === 'BuyLow' || row.direction === 'SellHigh')
    .map((row) => {
      const quotedApr = parseFiniteNumber(row.apyE8) / 1_000_000;
      const settlementTime = parseOptionalTimestamp(row.settlementTime) ?? Date.now();
      const yieldStartAt = parseOptionalTimestamp(row.yieldStartAt);
      const yieldEndAt = parseOptionalTimestamp(row.yieldEndAt);
      const amount = parseFiniteNumber(row.amount);
      const projectedProfit = calculateBybitProjectedProfit(row);
      const exactApr = calculateBybitAprFromProjectedProfit(
        amount,
        projectedProfit,
        yieldStartAt,
        yieldEndAt,
        settlementTime,
      );

      return {
        id: `bybit_dual_${row.positionId}`,
        productId: row.productId,
        baseCoin: row.baseCoin.toUpperCase(),
        quoteCoin: row.quoteCoin.toUpperCase(),
        investCoin: row.investCoin.toUpperCase(),
        amount,
        apr:
          exactApr ??
          calculateBybitEffectiveApr(
            quotedApr,
            row.duration,
            yieldStartAt,
            yieldEndAt,
            settlementTime,
          ),
        direction: row.direction as 'BuyLow' | 'SellHigh',
        targetPrice: parseFiniteNumber(row.targetPrice),
        settlementTime,
        status: row.status,
        orderId: row.orderId,
        duration: row.duration,
        yieldStartAt,
        yieldEndAt,
        ...(row.expectReturnCoin
          ? { expectedSettlementAsset: row.expectReturnCoin.toUpperCase() }
          : {}),
        ...(Number.isFinite(parseFiniteNumber(row.expectReturnAmount, NaN))
          ? { expectedSettlementAmount: parseFiniteNumber(row.expectReturnAmount, NaN) }
          : {}),
        ...(Number.isFinite(projectedProfit) ? { projectedProfit } : {}),
      };
    })
    .filter((position) => position.amount > 0);
}

export async function fetchBybitDiscountBuyPositions(): Promise<BybitDiscountBuyPosition[]> {
  const creds = loadBybitApiCredentials();
  if (!creds) throw new Error('Bybit API credentials not configured');
  const info = await getCurrentBybitReadOnlyInfo(creds);
  if (!info.permissions?.Earn?.includes('Earn')) {
    return [];
  }

  const payload = await fetchBybitSignedGet<BybitEnvelope<BybitDiscountBuyPositionResponse>>(
    '/earn/advance/position',
    { category: 'DiscountBuy', limit: 20 },
    creds,
  );
  const result = assertBybitOk(payload);

  return result.list
    .map((row) => {
      const amount = parseFiniteNumber(row.amount);
      const apr = parseFiniteNumber(row.knockoutCouponE8) / 1_000_000;
      const settlementTime = parseOptionalTimestamp(row.settlementTime) ?? Date.now();
      const yieldStartAt = deriveBybitYieldStartAt(settlementTime, row.duration);
      const projectedProfit = calculateBybitCouponProjectedProfit(amount, apr, row.duration);
      const expectReceiveAt = parseOptionalTimestamp(row.expectReceiveAt);

      return {
        id: `bybit_discount_buy_${row.positionId}`,
        productId: row.productId,
        coin: row.coin.toUpperCase(),
        underlyingAsset: row.underlyingAsset.toUpperCase(),
        amount,
        apr,
        purchasePrice: parseFiniteNumber(row.purchasePrice),
        knockoutPrice: parseFiniteNumber(row.knockoutPrice),
        settlementTime,
        status: row.status,
        orderId: row.orderId,
        duration: row.duration,
        accountType: row.accountType,
        toAccountType: row.toAccountType,
        settleType: row.settleType,
        expectReceiveAt,
        yieldStartAt,
        ...(Number.isFinite(projectedProfit) ? { projectedProfit } : {}),
      };
    })
    .filter((position) => position.amount > 0 && position.purchasePrice > 0);
}

export function clearBybitClientCaches(): void {
  readOnlyCheckCache = null;
  readOnlyCheckInFlight = null;
  clearBybitServerTimeOffset();
}

export async function fetchBybitSpotTicker(
  symbol: string,
): Promise<BybitTickerResponse['list'][0]> {
  const payload = await fetchBybitPublicGet<BybitEnvelope<BybitTickerResponse>>('/market/tickers', {
    category: 'spot',
    symbol: symbol.toUpperCase(),
  });
  const result = assertBybitOk(payload);
  const ticker = result.list[0];
  if (!ticker) throw new Error(`Bybit ticker not found: ${symbol}`);
  return ticker;
}
