import type { DualProduct, DualProductScored, ScoreBreakdown } from '../types';

// ── Scoring weights ──

const WEIGHT_YIELD = 0.25;
const WEIGHT_SAFETY = 0.25;
const WEIGHT_COMPOUND = 0.2;
const WEIGHT_TREND = 0.15;
const WEIGHT_DURATION = 0.15;

// ── Normalization helpers ──

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function inverseDurationScore(days: number): number {
  // Shorter durations are better for compounding
  // 1 day → 1.0, 7 days → ~0.6, 30 days → ~0.2
  if (days <= 0) return 0;
  return clamp01(1 / (1 + (days - 1) * 0.12));
}

// ── Core scoring functions ──

function computeYieldScore(apr: number, maxApr: number): number {
  if (maxApr <= 0) return 0;
  return clamp01(apr / maxApr);
}

function computeSafetyScore(
  strikePrice: number,
  spotPrice: number,
  optionType: 'CALL' | 'PUT',
): number {
  if (spotPrice <= 0 || strikePrice <= 0) return 0;

  // CALL (sell-high): distance above spot → higher is safer (won't execute)
  // PUT (buy-low): distance below spot → higher is safer (won't execute)
  let distancePct: number;
  if (optionType === 'CALL') {
    distancePct = (strikePrice - spotPrice) / spotPrice;
  } else {
    distancePct = (spotPrice - strikePrice) / spotPrice;
  }

  // Negative distance means strike is on the "wrong" side → unsafe
  if (distancePct < 0) return 0;

  // 0% distance → 0, 5% → 0.5, 10%+ → ~0.8-1.0 (diminishing returns)
  return clamp01(1 - Math.exp(-distancePct * 20));
}

function computeCompoundScore(apr: number, durationDays: number): number {
  if (apr <= 0 || durationDays <= 0) return 0;

  // Effective annualized yield if you roll over continuously
  const periodRate = (apr / 100) * (durationDays / 365);
  const periodsPerYear = 365 / durationDays;
  const effectiveApr = (Math.pow(1 + periodRate, periodsPerYear) - 1) * 100;

  // Normalize: 30% effective → ~0.5, 100%+ → ~1.0
  return clamp01(effectiveApr / 150);
}

function computeTrendScore(changePercent24h: number | null, optionType: 'CALL' | 'PUT'): number {
  if (changePercent24h === null || !Number.isFinite(changePercent24h)) return 0.5; // neutral

  // CALL (sell-high): price going DOWN is good (moves away from strike) → negative change = bonus
  // PUT (buy-low): price going UP is good (moves away from strike) → positive change = bonus
  const favorable = optionType === 'CALL' ? -changePercent24h : changePercent24h;

  // Scale: -5% → 0.15, 0% → 0.5, +5% → 0.85
  return clamp01(0.5 + favorable * 0.07);
}

function computeDistancePercent(
  strikePrice: number,
  spotPrice: number,
  optionType: 'CALL' | 'PUT',
): number {
  if (spotPrice <= 0) return 0;
  if (optionType === 'CALL') {
    return ((strikePrice - spotPrice) / spotPrice) * 100;
  }
  return ((spotPrice - strikePrice) / spotPrice) * 100;
}

// ── Main scoring function ──

export function scoreDualProducts(
  products: DualProduct[],
  spotPrices: Record<string, number>,
  change24h: Record<string, number | null>,
): DualProductScored[] {
  if (products.length === 0) return [];

  const maxApr = Math.max(...products.map((p) => p.apr));

  return products.map((product) => {
    const asset = product.optionType === 'CALL' ? product.investCoin : product.exercisedCoin;
    const spotPrice = spotPrices[asset] ?? spotPrices[product.exercisedCoin] ?? 0;
    const change = change24h[asset] ?? change24h[product.exercisedCoin] ?? null;

    const yieldScore = computeYieldScore(product.apr, maxApr);
    const safetyScore = computeSafetyScore(product.strikePrice, spotPrice, product.optionType);
    const compoundScore = computeCompoundScore(product.apr, product.duration);
    const trendScore = computeTrendScore(change, product.optionType);
    const durationScore = inverseDurationScore(product.duration);

    const scoreBreakdown: ScoreBreakdown = {
      yieldScore,
      safetyScore,
      durationScore,
      trendScore,
      compoundScore,
    };

    const score =
      yieldScore * WEIGHT_YIELD +
      safetyScore * WEIGHT_SAFETY +
      compoundScore * WEIGHT_COMPOUND +
      trendScore * WEIGHT_TREND +
      durationScore * WEIGHT_DURATION;

    const distancePercent = computeDistancePercent(
      product.strikePrice,
      spotPrice,
      product.optionType,
    );

    return {
      ...product,
      score,
      scoreBreakdown,
      spotPrice,
      distancePercent,
    };
  });
}

export function getTopRecommendations(scored: DualProductScored[], limit = 3): DualProductScored[] {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function explainScore(product: DualProductScored): string {
  const parts: string[] = [];
  const { scoreBreakdown: s } = product;

  if (s.yieldScore > 0.7) parts.push('APR alto');
  else if (s.yieldScore < 0.3) parts.push('APR bajo');

  if (s.safetyScore > 0.7) parts.push('buena distancia al strike');
  else if (s.safetyScore < 0.3) parts.push('cerca del strike');

  if (s.compoundScore > 0.6) parts.push('buen rendimiento compuesto');

  if (s.trendScore > 0.65) parts.push('tendencia favorable');
  else if (s.trendScore < 0.35) parts.push('tendencia desfavorable');

  if (s.durationScore > 0.7) parts.push('plazo corto');
  else if (s.durationScore < 0.3) parts.push('plazo largo');

  if (parts.length === 0) parts.push('balance equilibrado');

  const scoreText = `Score: ${(product.score * 100).toFixed(0)}/100`;
  return `${scoreText} — ${parts.join(', ')}`;
}
