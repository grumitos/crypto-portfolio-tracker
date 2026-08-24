import { describe, expect, it } from '#test';
import {
  combinePortfolioYieldMetrics,
  getAggregatedPortfolioMetrics,
} from './portfolio-aggregation';
import { getDefaultCapitalLedgerState } from './storage';
import type { AppState } from '../types';

function baseState(): AppState {
  return {
    portfolio: {
      totalInvested: 40000,
      currentBalance: 41055,
      goalAmount: 45000,
      lastUpdated: '2026-05-02',
      balanceHistory: [{ date: '2026-05-02', balance: 41055 }],
    },
    positions: [],
    capitalLedger: getDefaultCapitalLedgerState(),
  };
}

describe('portfolio aggregation', () => {
  it('adds capital ledger balance while keeping invested capital user-defined', () => {
    const state = baseState();
    state.capitalLedger.vault = {
      activeValue: '110',
      activeValueAt: '2026-05-02T00:00:00.000Z',
      pnlTotal: '10',
    };
    state.capitalLedger.transactions = [
      { at: '2026-05-01T00:00:00.000Z', type: 'deposit', amount: '100' },
    ];

    const aggregate = getAggregatedPortfolioMetrics(state);

    expect(aggregate.balance).toBe(41165);
    expect(aggregate.invested).toBe(40000);
    expect(aggregate.pnl).toBe(1165);
    expect(aggregate.capital.balanceValue).toBe(110);
  });

  it('weights APR and daily run-rate across positions and capital ledger equity', () => {
    const state = baseState();
    state.capitalLedger.vault = {
      activeValue: '110',
      activeValueAt: '2026-05-02T00:00:00.000Z',
      pnlTotal: '10',
    };
    state.capitalLedger.transactions = [
      { at: '2026-05-01T00:00:00.000Z', type: 'deposit', amount: '100' },
    ];
    const aggregate = getAggregatedPortfolioMetrics(state);

    const combined = combinePortfolioYieldMetrics(
      {
        totalUsd: 1055,
        weightedApr: 123.61,
        dailyEarningsUsd: 3.57,
      },
      aggregate.capital,
    );

    expect(combined.capitalDisplayUsd).toBe(1165);
    expect(combined.earningCapital).toBe(1165);
    expect(combined.weightedApr).toBeGreaterThan(123.61);
    expect(combined.dailyEarningsUsd).toBeGreaterThan(3.57);
  });
});
