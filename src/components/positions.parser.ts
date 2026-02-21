import { generateId } from '../utils/storage';
import type { DualPosition, Direction } from '../types';

const DATETIME_GLOBAL_PATTERN = /(\d{4}-\d{2}-\d{2})\s+([01]\d|2[0-3]):([0-5]\d)/g;
const AMOUNT_PATTERN = /([+-]?\d[\d,]*(?:\.\d+)?)\s+([A-Z0-9]{2,10})$/;
const APR_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*%/;

export const DEFAULT_ASSET_POOL = ['BTC', 'ETH', 'BNB', 'SOL', 'USDT', 'USDC'] as const;
const DEFAULT_ALLOWED_ASSETS = new Set<string>(DEFAULT_ASSET_POOL);

export function parseBinancePositions(raw: string, allowedAssets: Set<string> = DEFAULT_ALLOWED_ASSETS): DualPosition[] {
  const lines = raw
    .split(/\r?\n/)
    .map(normalizeImportLine)
    .filter((line) => line.length > 0 && !isIgnoredImportLine(line));

  if (lines.length === 0) return [];

  const startIndexes: number[] = [];
  lines.forEach((line, index) => {
    if (isPairLine(line, allowedAssets)) startIndexes.push(index);
  });
  if (startIndexes.length === 0) return [];

  const parsed: DualPosition[] = [];
  startIndexes.forEach((start, index) => {
    const end = startIndexes[index + 1] ?? lines.length;
    const chunk = lines.slice(start, end);
    const position = parseBinanceChunk(chunk, allowedAssets);
    if (position) parsed.push(position);
  });

  return parsed;
}

function parseBinanceChunk(chunk: string[], allowedAssets: Set<string>): DualPosition | null {
  const pairLine = chunk[0] ?? '';
  const pair = parsePairLine(pairLine, allowedAssets);
  if (!pair) return null;
  const { left: leftRaw, right: rightRaw } = pair;

  const direction = detectDirection(chunk);
  if (!direction) return null;

  const dateTimes = extractDateTimes(chunk);
  if (dateTimes.length < 2) return null;

  const entry = dateTimes[0];
  const settlement = dateTimes[dateTimes.length - 1];

  const amountMatch = chunk
    .map((line) => line.match(AMOUNT_PATTERN))
    .find((match): match is RegExpMatchArray => Boolean(match));
  if (!amountMatch) return null;

  const amount = parseLooseNumber(amountMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const subscriptionAsset = amountMatch[2].toUpperCase();
  if (!allowedAssets.has(subscriptionAsset)) return null;

  const aprMatch = chunk
    .map((line) => line.match(APR_PATTERN))
    .find((match): match is RegExpMatchArray => Boolean(match));
  if (!aprMatch) return null;

  const apr = parseLooseNumber(aprMatch[1]);
  if (!Number.isFinite(apr) || apr < 0) return null;

  const targetPrice = extractTargetPrice(chunk, settlement) ?? 0;
  const baseAsset = direction === 'buy-low' ? rightRaw : leftRaw;

  return {
    id: generateId(),
    asset: baseAsset,
    direction,
    subscriptionAsset,
    amount,
    targetPrice,
    entryDate: entry.date,
    entryTime: entry.time,
    settlementDate: settlement.date,
    settlementTime: settlement.time,
    apr,
  };
}

function detectDirection(chunk: string[]): Direction | null {
  for (const line of chunk) {
    const normalized = line.toLowerCase();
    if (normalized.includes('buy-low') || normalized.includes('buy low')) return 'buy-low';
    if (normalized.includes('sell-high') || normalized.includes('sell high')) return 'sell-high';
  }
  return null;
}

function extractTargetPrice(
  chunk: string[],
  settlement: { date: string; time: string },
): number | null {
  const settlementLinePattern = new RegExp(
    `([+-]?\\d[\\d,]*(?:\\.\\d+)?)\\s+${escapeRegExp(settlement.date)}\\s+${escapeRegExp(settlement.time)}`,
  );

  for (const line of chunk) {
    const withSettlement = line.match(settlementLinePattern);
    if (withSettlement) {
      const target = parseLooseNumber(withSettlement[1]);
      if (Number.isFinite(target) && target >= 0) return target;
    }
  }

  for (const line of chunk) {
    if (!/^[+-]?\d[\d,]*(?:\.\d+)?$/.test(line)) continue;
    const value = parseLooseNumber(line);
    if (Number.isFinite(value) && value >= 0) return value;
  }

  return null;
}

function isPairLine(line: string, allowedAssets: Set<string>): boolean {
  return parsePairLine(line, allowedAssets) !== null;
}

function parsePairLine(line: string, allowedAssets: Set<string>): { left: string; right: string } | null {
  const match = line.toUpperCase().replace(/\s+/g, '').match(/^([A-Z0-9]{2,10})-([A-Z0-9]{2,10})$/);
  if (!match) return null;
  const left = match[1];
  const right = match[2];
  if (!allowedAssets.has(left) || !allowedAssets.has(right)) return null;
  return { left, right };
}

function normalizeImportLine(line: string): string {
  return line
    .replace(/\t+/g, ' ')
    .replace(/[\u00a0\u202f\u2007]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isIgnoredImportLine(line: string): boolean {
  return /^holding$/i.test(line) || /^image$/i.test(line);
}

function parseLooseNumber(value: string): number {
  const clean = value
    .replace(/,/g, '')
    .replace(/[^\d.+-]/g, '');
  return Number.parseFloat(clean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractDateTimes(chunk: string[]): Array<{ date: string; time: string }> {
  const joined = chunk.join(' ');
  const matches = [...joined.matchAll(DATETIME_GLOBAL_PATTERN)];
  return matches.map((match) => ({ date: match[1], time: `${match[2]}:${match[3]}` }));
}
