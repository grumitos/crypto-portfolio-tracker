import { describe, expect, it } from '#test';
import {
  calculateCapitalLedgerSummary,
  getCapitalLedgerPortfolioContribution,
  parseCapitalLedgerAmount,
  parseCapitalLedgerDate,
} from './capital-ledger';
import type { CapitalLedgerState } from '../types';

describe('capital ledger calculations', () => {
  it('parses legacy ledger dates and localized amounts', () => {
    expect(parseCapitalLedgerDate('26/4/2026 - 04:40:32')?.toISOString()).toBe(
      '2026-04-26T09:40:32.000Z',
    );
    expect(parseCapitalLedgerAmount('$1,250.50')).toBe(1250.5);
    expect(parseCapitalLedgerAmount('1.250,50')).toBe(1250.5);
    expect(parseCapitalLedgerAmount('7,36')).toBe(7.36);
  });

  it('summarizes vault capital, PnL and APR from ledger cashflows', () => {
    const summary = calculateCapitalLedgerSummary({
      vault: {
        activeValue: '110',
        activeValueAt: '2026-05-02T00:00:00.000Z',
        pnlTotal: '',
      },
      transactions: [{ at: '2026-05-01T00:00:00.000Z', type: 'deposit', amount: '100' }],
    });

    expect(summary.totalDeposited).toBe(100);
    expect(summary.totalWithdrawn).toBe(0);
    expect(summary.activeValue).toBe(110);
    expect(summary.displayCapital).toBe(100);
    expect(summary.displayPnl).toBe(10);
    expect(summary.apr).toBeGreaterThan(0);
  });

  it('contributes capital plus historical PnL to dashboard balance while APR uses active equity', () => {
    const ledger: CapitalLedgerState = {
      schemaVersion: 2,
      vault: {
        activeValue: '0',
        activeValueAt: '2026-05-04T00:00:00.000Z',
        pnlTotal: '10',
      },
      hyperliquid: { vaultAddress: '', userAddress: '', lastSyncAt: '' },
      lastSync: null,
      transactions: [
        { at: '2026-05-01T00:00:00.000Z', type: 'deposit', amount: '100' },
        { at: '2026-05-03T00:00:00.000Z', type: 'withdrawal', amount: '110' },
      ],
    };

    const contribution = getCapitalLedgerPortfolioContribution(ledger);

    expect(contribution.investedCapital).toBe(0);
    expect(contribution.balanceValue).toBeCloseTo(10, 8);
    expect(contribution.pnl).toBeCloseTo(10, 8);
    expect(contribution.earningCapital).toBe(0);
    expect(contribution.apr).toBeNull();
  });

  it('uses synced active vault equity as earning capital when APR is available', () => {
    const ledger: CapitalLedgerState = {
      schemaVersion: 2,
      vault: {
        activeValue: '110',
        activeValueAt: '2026-05-02T00:00:00.000Z',
        pnlTotal: '10',
      },
      hyperliquid: { vaultAddress: '', userAddress: '', lastSyncAt: '' },
      lastSync: null,
      transactions: [{ at: '2026-05-01T00:00:00.000Z', type: 'deposit', amount: '100' }],
    };

    const contribution = getCapitalLedgerPortfolioContribution(ledger);

    expect(contribution.investedCapital).toBe(100);
    expect(contribution.balanceValue).toBe(110);
    expect(contribution.pnl).toBe(10);
    expect(contribution.earningCapital).toBe(110);
    expect(contribution.apr).toBeGreaterThan(0);
    expect(contribution.dailyEarningsUsd).toBeGreaterThan(0);
  });
});
