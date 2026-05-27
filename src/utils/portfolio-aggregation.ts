import { getCapitalLedgerPortfolioContribution } from './capital-ledger';
import type { AppState, CapitalLedgerPortfolioContribution } from '../types';

export interface AggregatedPortfolioMetrics {
  baseBalance: number;
  baseInvested: number;
  balance: number;
  invested: number;
  goal: number;
  pnl: number;
  capital: CapitalLedgerPortfolioContribution;
}

export interface PortfolioYieldInput {
  totalUsd: number;
  weightedApr: number;
  dailyEarningsUsd: number;
}

export interface CombinedPortfolioYieldMetrics {
  capitalDisplayUsd: number;
  earningCapital: number;
  weightedApr: number;
  dailyEarningsUsd: number;
}

export function getAggregatedPortfolioMetrics(
  state: AppState,
  baseBalanceOverride?: number,
): AggregatedPortfolioMetrics {
  const capital = getCapitalLedgerPortfolioContribution(state.capitalLedger);
  const baseBalance = roundCurrency(baseBalanceOverride ?? state.portfolio.currentBalance);
  const baseInvested = roundCurrency(state.portfolio.totalInvested);
  const balance = roundCurrency(baseBalance + capital.balanceValue);
  const invested = roundCurrency(baseInvested + capital.investedCapital);

  return {
    baseBalance,
    baseInvested,
    balance,
    invested,
    goal: state.portfolio.goalAmount,
    pnl: roundCurrency(balance - invested),
    capital,
  };
}

export function combinePortfolioYieldMetrics(
  positions: PortfolioYieldInput,
  capital: CapitalLedgerPortfolioContribution,
): CombinedPortfolioYieldMetrics {
  const positionCapital = Math.max(0, Number.isFinite(positions.totalUsd) ? positions.totalUsd : 0);
  const positionApr = Number.isFinite(positions.weightedApr) ? positions.weightedApr : 0;
  const positionDaily = Number.isFinite(positions.dailyEarningsUsd)
    ? positions.dailyEarningsUsd
    : 0;
  const capitalEarning = Math.max(0, capital.earningCapital);
  const capitalApr = capital.apr !== null && Number.isFinite(capital.apr) ? capital.apr : 0;
  const earningCapital = positionCapital + capitalEarning;
  const weightedApr =
    earningCapital > 0
      ? (positionCapital * positionApr + capitalEarning * capitalApr) / earningCapital
      : 0;

  return {
    capitalDisplayUsd: roundCurrency(positionCapital + capital.activeValue),
    earningCapital: roundCurrency(earningCapital),
    weightedApr,
    dailyEarningsUsd: positionDaily + capital.dailyEarningsUsd,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
