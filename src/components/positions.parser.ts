import { generateId } from '../utils/storage';
import type { DualPosition, DualPositionComponent, Direction } from '../types';

const DATETIME_GLOBAL_PATTERN = /(\d{4}-\d{2}-\d{2})\s+([01]\d|2[0-3]):([0-5]\d)/g;
const AMOUNT_PATTERN = /([+-]?\d[\d,]*(?:\.\d+)?)\s+([A-Z0-9]{2,10})$/;
const APR_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*%/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export const DEFAULT_ASSET_POOL = ['BTC', 'ETH', 'BNB', 'SOL', 'USDT', 'USDC'] as const;
const DEFAULT_ALLOWED_ASSETS = new Set<string>(DEFAULT_ASSET_POOL);

export function parseImportedPositions(raw: string): DualPosition[] {
  const parsed = parseBinancePositions(raw);
  return consolidatePositionsByPair(parsed);
}

export function parseBinancePositions(raw: string): DualPosition[] {
  const lines = raw
    .split(/\r?\n/)
    .map(normalizeImportLine)
    .filter((line) => line.length > 0 && !isIgnoredImportLine(line));

  if (lines.length === 0) return [];

  const startIndexes: number[] = [];
  lines.forEach((line, index) => {
    if (isPairLine(line, DEFAULT_ALLOWED_ASSETS)) startIndexes.push(index);
  });
  if (startIndexes.length === 0) return [];

  const parsed: DualPosition[] = [];
  startIndexes.forEach((start, index) => {
    const end = startIndexes[index + 1] ?? lines.length;
    const chunk = lines.slice(start, end);
    const position = parseBinanceChunk(chunk, DEFAULT_ALLOWED_ASSETS);
    if (position) parsed.push(position);
  });

  return parsed;
}

function parseBinanceChunk(chunk: string[], allowedAssets: Set<string>): DualPosition | null {
  const pairLine = chunk[0] ?? '';
  const pair = parsePairLine(pairLine, allowedAssets);
  if (!pair) return null;

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
  const resolvedPair = resolveAssetsForDirection(direction, pair, subscriptionAsset);
  if (!resolvedPair || !allowedAssets.has(resolvedPair.asset)) return null;

  return {
    id: generateId(),
    asset: resolvedPair.asset,
    direction,
    subscriptionAsset,
    quoteAsset: resolvedPair.quoteAsset,
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
    const parsed = parseDirectionText(line);
    if (parsed) return parsed;
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

function parsePairLine(
  line: string,
  allowedAssets: Set<string>,
): { left: string; right: string } | null {
  const match = line
    .toUpperCase()
    .replace(/\s+/g, '')
    .match(/^([A-Z0-9]{2,10})-([A-Z0-9]{2,10})$/);
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
  const clean = value.replace(/,/g, '').replace(/[^\d.+-]/g, '');
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

function parseDirectionText(value: string): Direction | null {
  const normalized = normalizeText(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (
    normalized.includes('buy low') ||
    normalized.includes('compra bajo') ||
    normalized.includes('comprar bajo') ||
    normalized.includes('compra barato') ||
    normalized.includes('comprar barato')
  ) {
    return 'buy-low';
  }
  if (
    normalized.includes('sell high') ||
    normalized.includes('vende alto') ||
    normalized.includes('vender alto') ||
    normalized.includes('vende caro') ||
    normalized.includes('vender caro')
  ) {
    return 'sell-high';
  }
  return null;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function resolveAssetsForDirection(
  direction: Direction,
  pair: { left: string; right: string },
  subscriptionAsset: string,
): { asset: string; quoteAsset: string } | null {
  if (subscriptionAsset !== pair.left && subscriptionAsset !== pair.right) return null;
  const otherAsset = subscriptionAsset === pair.left ? pair.right : pair.left;
  if (direction === 'sell-high') {
    return { asset: subscriptionAsset, quoteAsset: otherAsset };
  }
  return { asset: otherAsset, quoteAsset: subscriptionAsset };
}

function normalizeTimeForSort(value?: string): string {
  if (!value) return '00:00';
  const match = value.match(TIME_PATTERN);
  if (!match) return '00:00';
  return `${match[1]}:${match[2]}`;
}

function toDateTimeSortKey(date: string, time?: string): string {
  return `${date} ${normalizeTimeForSort(time)}`;
}

function isEarlierDateTime(
  candidateDate: string,
  candidateTime: string | undefined,
  currentDate: string,
  currentTime: string | undefined,
): boolean {
  return (
    toDateTimeSortKey(candidateDate, candidateTime) < toDateTimeSortKey(currentDate, currentTime)
  );
}

function isLaterDateTime(
  candidateDate: string,
  candidateTime: string | undefined,
  currentDate: string,
  currentTime: string | undefined,
): boolean {
  return (
    toDateTimeSortKey(candidateDate, candidateTime) > toDateTimeSortKey(currentDate, currentTime)
  );
}

interface PositionAccumulator {
  id: string;
  asset: string;
  direction: Direction;
  subscriptionAsset: string;
  quoteAsset?: string;
  amount: number;
  aprWeightSum: number;
  targetWeightSum: number;
  entryDate: string;
  entryTime?: string;
  settlementDate: string;
  settlementTime?: string;
  components: DualPositionComponent[];
}

export function consolidatePositionsByPair(positions: DualPosition[]): DualPosition[] {
  const grouped = new Map<string, PositionAccumulator>();

  positions.forEach((position) => {
    const weight = Number.isFinite(position.amount) && position.amount > 0 ? position.amount : 0;
    if (weight <= 0) return;

    const key = `${position.direction}|${position.asset}|${position.subscriptionAsset}|${position.quoteAsset ?? ''}|${position.settlementDate}`;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        id: position.id,
        asset: position.asset,
        direction: position.direction,
        subscriptionAsset: position.subscriptionAsset,
        quoteAsset: position.quoteAsset,
        amount: weight,
        aprWeightSum: position.apr * weight,
        targetWeightSum: position.targetPrice * weight,
        entryDate: position.entryDate,
        entryTime: position.entryTime,
        settlementDate: position.settlementDate,
        settlementTime: position.settlementTime,
        components: [
          {
            id: position.id,
            amount: weight,
            targetPrice: position.targetPrice,
            entryDate: position.entryDate,
            entryTime: position.entryTime,
            settlementDate: position.settlementDate,
            settlementTime: position.settlementTime,
            apr: position.apr,
          },
        ],
      });
      return;
    }

    existing.amount += weight;
    existing.aprWeightSum += position.apr * weight;
    existing.targetWeightSum += position.targetPrice * weight;

    if (
      isEarlierDateTime(
        position.entryDate,
        position.entryTime,
        existing.entryDate,
        existing.entryTime,
      )
    ) {
      existing.entryDate = position.entryDate;
      existing.entryTime = position.entryTime;
    }

    if (
      isLaterDateTime(
        position.settlementDate,
        position.settlementTime,
        existing.settlementDate,
        existing.settlementTime,
      )
    ) {
      existing.settlementDate = position.settlementDate;
      existing.settlementTime = position.settlementTime;
    }

    existing.components.push({
      id: position.id,
      amount: weight,
      targetPrice: position.targetPrice,
      entryDate: position.entryDate,
      entryTime: position.entryTime,
      settlementDate: position.settlementDate,
      settlementTime: position.settlementTime,
      apr: position.apr,
    });
  });

  return Array.from(grouped.values()).map((aggregate) => {
    const total = aggregate.amount;
    return {
      id: aggregate.id,
      asset: aggregate.asset,
      direction: aggregate.direction,
      subscriptionAsset: aggregate.subscriptionAsset,
      quoteAsset: aggregate.quoteAsset,
      amount: total,
      targetPrice: total > 0 ? aggregate.targetWeightSum / total : 0,
      entryDate: aggregate.entryDate,
      entryTime: aggregate.entryTime,
      settlementDate: aggregate.settlementDate,
      settlementTime: aggregate.settlementTime,
      apr: total > 0 ? aggregate.aprWeightSum / total : 0,
      ...(aggregate.components.length > 1 ? { components: aggregate.components } : {}),
    };
  });
}
