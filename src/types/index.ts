// ── Portfolio ──
export interface PortfolioData {
  totalInvested: number;
  currentBalance: number;
  savings: number; // cash / stablecoins outside positions (manual)
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

export interface DualPositionComponent {
  id: string;
  amount: number;
  targetPrice: number;
  entryDate: string;
  entryTime?: string;
  settlementDate: string;
  settlementTime?: string;
  apr: number;
}

export type PositionEntryTimeSource =
  | 'binance_purchase_time'
  | 'derived_settle_minus_duration'
  | 'derived_purchase_end_time'
  | 'derived_now';

export type PositionSettlementTimeSource = 'binance_settle_date_rule';

export interface DualPosition {
  id: string;
  asset: string; // e.g. "ETH", "SOL", "BTC"
  direction: Direction; // buy-low or sell-high
  subscriptionAsset: string; // e.g. "USDT", "USDC", "SOL"
  amount: number; // subscription amount
  targetPrice: number;
  entryDate: string; // ISO date
  entryTime?: string; // local HH:mm
  entryTimeSource?: PositionEntryTimeSource;
  settlementDate: string; // ISO date
  settlementTime?: string; // local HH:mm (optional fallback to Binance default)
  settlementTimeSource?: PositionSettlementTimeSource;
  apr: number; // annual percentage rate
  components?: DualPositionComponent[]; // grouped source entries used for weighted aggregate rows
}

// ── Simulator ──
export type CompoundFrequency = 'daily' | 'weekly' | 'biweekly';

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
  manualPositions: DualPosition[];
  autoPositions: DualPosition[];
  positionsConfig: PositionsConfig;
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

// ── Positions mode ──
export type PositionsMode = 'manual' | 'auto';

export interface PositionsConfig {
  mode: PositionsMode;
}

// ── Binance API ──
export interface BinanceApiCredentials {
  apiKey: string;
  apiSecret: string;
  tradingPin?: string; // hashed PIN for Level 2
}

export type DualOptionType = 'CALL' | 'PUT';

export interface DualProduct {
  id: string;
  investCoin: string; // e.g. "USDT"
  exercisedCoin: string; // e.g. "BTC"
  orderId?: string;
  strikePrice: number;
  duration: number; // days
  settleDate: string; // ISO date
  apr: number;
  minAmount: number;
  maxAmount: number;
  optionType: DualOptionType; // CALL = sell-high, PUT = buy-low
  purchaseDecimal: number; // decimal places for amount
  perValue: number; // per unit value
  purchaseEndTime: number; // timestamp ms
  canPurchase?: boolean;
}

export interface ScoreBreakdown {
  yieldScore: number;
  safetyScore: number;
  durationScore: number;
  trendScore: number;
  compoundScore: number;
}

export interface DualProductScored extends DualProduct {
  score: number;
  scoreBreakdown: ScoreBreakdown;
  spotPrice: number;
  distancePercent: number; // (strike - spot) / spot for CALL, (spot - strike) / spot for PUT
}

export interface DualMarketFilters {
  asset?: string;
  direction?: Direction;
  minApr?: number;
  maxDuration?: number;
}

export interface DualMarketState {
  filters: DualMarketFilters;
}

export interface BinanceAccountBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface BinanceDualPosition {
  id: string;
  investCoin: string;
  exercisedCoin: string;
  orderId?: string;
  strikePrice: number;
  amount: number;
  duration: number;
  settleDate: string;
  apr: number;
  purchaseStatus?: string;
  purchaseEndTime?: number;
  optionType: DualOptionType;
  purchaseTime?: number; // timestamp ms
  status: string;
}
