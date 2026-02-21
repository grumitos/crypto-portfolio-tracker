// ── Portfolio ──
export interface PortfolioData {
  totalInvested: number;
  currentBalance: number;
  savings: number;        // cash / stablecoins outside positions (manual)
  goalAmount: number;
  lastUpdated: string; // ISO date
  balanceHistory: BalanceSnapshot[];
}

export interface BalanceSnapshot {
  date: string; // ISO date
  balance: number;
}

// ── Dual Investment Positions ──
export type Direction = 'buy-low' | 'sell-high';

export interface DualPosition {
  id: string;
  asset: string;            // e.g. "ETH", "SOL", "BTC"
  direction: Direction;      // buy-low or sell-high
  subscriptionAsset: string; // e.g. "USDT", "USDC", "SOL"
  amount: number;            // subscription amount
  targetPrice: number;
  entryDate: string;         // ISO date
  entryTime?: string;        // local HH:mm
  settlementDate: string;    // ISO date
  settlementTime?: string;   // local HH:mm (optional fallback to Binance default)
  apr: number;               // annual percentage rate
}

// ── Simulator ──
export type CompoundFrequency = 'daily' | 'weekly' | 'biweekly';
export type SimulationTargetMode = 'be' | 'goal' | 'both';

export interface SimulatorParams {
  capital: number;
  apr: number;
  frequency: CompoundFrequency;
  goal: number;
  invested: number;
}

export interface ProjectionRow {
  month: number;
  date: string;
  balance: number;
  earned: number;
}

// ── Swing Trade Calculator ──
export type FeePreset = 'spot' | 'futures';

export interface Purchase {
  id: number;
  qty: string;
  price: string;
}

export interface CalculadoraState {
  price: string;
  capital: string;
  trades: string;
  sellPrice: string;
  sellPct: string;
  rebuyPct: string;
  feePreset: FeePreset;
  fdusdEnabled: boolean;
  sellSyncSource: 'price' | 'percent' | null;
  purchases: Purchase[];
}

export interface PurchaseTotals {
  totalQty: number;
  totalUsd: number;
  avgPrice: number;
  validCount: number;
}

export interface AchievedResults {
  achievedR: number;
  achievedMovement: number;
  achievedProfitPerTrade: number;
  achievedAnnualProfit: number;
  achievedApr: number;
}

export interface StrategyResults {
  sellPrice: number;
  rebuyPrice: number;
  netPct: number;
  netUsd: number;
  netPctCycle: number;
  netUsdCycle: number;
  feeTotalPct: number;
}

// ── App State ──
export interface AppState {
  portfolio: PortfolioData;
  positions: DualPosition[];
}

// ── Navigation ──
export type View = 'dashboard' | 'positions' | 'simulator' | 'calculadora';

// ── Dashboard Goal Selection ──
export interface DashboardLegendState {
  be: boolean;
  goal: boolean;
}

export type DashboardGoalMode = 'be' | 'goal' | 'both';
export type DashboardGoalTarget = 'be' | 'goal';

export interface DashboardGoalDetails {
  mode: DashboardGoalMode;
  target: DashboardGoalTarget;
  targetAmount: number;
  remainingAmount: number;
  isReached: boolean;
  targetLabelShort: 'BE' | 'Meta';
  targetLabelLong: 'breakeven' | 'meta';
}
