// ── Portfolio ──
export interface PortfolioData {
  totalInvested: number;
  currentBalance: number;
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
  | 'derived_purchase_end_time';

export type PositionSettlementTimeSource = 'binance_settle_date_rule';

export interface DualPosition {
  id: string;
  asset: string; // e.g. "ETH", "SOL", "BTC"
  direction: Direction; // buy-low or sell-high
  subscriptionAsset: string; // e.g. "USDT", "USDC", "SOL"
  quoteAsset?: string; // quote asset for targetPrice, e.g. "USDT", "BTC"
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
  source?: 'Binance' | 'Bybit';
  positionKind?: 'dual' | 'discount-buy';
  projectedProfit?: number;
  expectedSettlementAsset?: string;
  expectedSettlementAmount?: number;
}

// ── Simulator ──
export type CompoundFrequency = 'daily' | 'weekly' | 'biweekly';

export interface SimulatorParams {
  capital: number;
  earningCapital?: number;
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

export interface Purchase {
  id: number;
  qty: string;
  price: string;
}

/** Unidad en la que se captura un precio del ciclo: absoluto o relativo. */
export type PriceUnit = 'usd' | 'pct';

export interface CalculadoraState {
  price: string;
  capital: string;
  trades: string;
  /** Precio de venta: $ absoluto, o % sobre el precio base. */
  sell: string;
  sellUnit: PriceUnit;
  /** Precio de recompra: $ absoluto, o % por debajo del precio de venta. */
  rebuy: string;
  rebuyUnit: PriceUnit;
  fdusdEnabled: boolean;
  purchases: Purchase[];
}

export interface PurchaseTotals {
  totalQty: number;
  totalUsd: number;
  avgPrice: number;
  validCount: number;
}

/**
 * Un unico ciclo base -> venta -> recompra. Distingue dos rendimientos que
 * antes se mezclaban: el de esta venta contra el costo de entrada (ocurre una
 * vez) y el del ciclo repetible (cuanto crece la bolsa al recomprar mas abajo),
 * que es el unico que tiene sentido anualizar.
 */
export interface CycleResults {
  /** Precio de venta resuelto en $. */
  sellPrice: number;
  /** Precio de recompra resuelto en $. */
  rebuyPrice: number;
  /** Recorrido de la venta sobre el precio base, en %. */
  sellMovePct: number;
  /** Caida de la recompra bajo el precio de venta, en %. */
  rebuyDipPct: number;
  /** Resultado en USD de esta venta contra el costo de entrada. Una sola vez. */
  saleNetUsd: number;
  /** Crecimiento de la bolsa por ciclo, en %. Repetible. */
  cycleNetPct: number;
  /** Ese mismo crecimiento valorado sobre el capital, en USD. */
  cycleNetUsd: number;
  /** Anualizado del ciclo repetible, en %. */
  apr: number;
  /** Comision de las dos patas del ciclo, en USD. */
  feeUsd: number;
}

// ── App State ──
export interface AppState {
  portfolio: PortfolioData;
  /** Posiciones sincronizadas desde los exchanges conectados. */
  positions: DualPosition[];
  capitalLedger: CapitalLedgerState;
}

// ── Navigation ──
export type View = 'dashboard' | 'positions' | 'capital' | 'simulator' | 'calculadora';

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
  /** Falso mientras el objetivo vale 0: no hay meta ni inversión que alcanzar. */
  isDefined: boolean;
  isReached: boolean;
  targetLabelShort: 'BE' | 'Meta';
  targetLabelLong: 'breakeven' | 'meta';
}

// ── Binance API ──
export interface BinanceApiCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface BybitApiCredentials {
  apiKey: string;
  apiSecret: string;
}

export type DualOptionType = 'CALL' | 'PUT';

export type ExchangeSource = 'Binance' | 'Bybit';

export interface BinanceAccountBalance {
  asset: string;
  free: number;
  locked: number;
  source?: ExchangeSource;
  /**
   * Origenes de una fila fusionada. `source` solo puede describir un exchange,
   * pero el dashboard agrupa el saldo por activo y un mismo activo puede recibir
   * saldo de Binance y posiciones de Bybit a la vez; sin este campo la fusion se
   * quedaria con un unico origen y la columna "Fuente" mentiria.
   */
  sources?: ExchangeSource[];
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

export interface BybitAccountBalance {
  asset: string;
  walletBalance: number;
  locked: number;
  usdValue: number;
}

export interface BybitDualAssetPosition {
  id: string;
  productId: string;
  baseCoin: string;
  quoteCoin: string;
  investCoin: string;
  amount: number;
  apr: number;
  direction: 'BuyLow' | 'SellHigh';
  targetPrice: number;
  /** Ausente si el exchange no la reporta: no se sustituye por la hora actual. */
  settlementTime?: number;
  status: 'Active' | 'Redeeming' | string;
  orderId?: string;
  duration?: string;
  yieldStartAt?: number;
  yieldEndAt?: number;
  expectedSettlementAsset?: string;
  expectedSettlementAmount?: number;
  projectedProfit?: number;
}

export interface BybitDiscountBuyPosition {
  id: string;
  productId: string;
  coin: string;
  underlyingAsset: string;
  amount: number;
  apr: number;
  purchasePrice: number;
  knockoutPrice: number;
  /** Ausente si el exchange no la reporta: no se sustituye por la hora actual. */
  settlementTime?: number;
  status: 'Active' | 'Settling' | string;
  orderId?: string;
  duration?: string;
  accountType?: string;
  toAccountType?: string;
  settleType?: 'Base' | 'Quote' | string;
  expectReceiveAt?: number;
  yieldStartAt?: number;
  projectedProfit?: number;
}

// ── Capital ledger / Hyperliquid vaults ──
export type CapitalLedgerTransactionType = 'deposit' | 'withdrawal';

export interface CapitalLedgerTransaction {
  id?: string;
  at: string;
  type: CapitalLedgerTransactionType;
  amount: string;
  url?: string;
  vaultAddress?: string;
  hash?: string;
  time?: number;
}

export interface CapitalLedgerVaultConfig {
  vaultAddress: string;
  userAddress: string;
}

export interface CapitalLedgerVaultSummary {
  activeValue: string;
  pnlTotal: string;
  vaultCount?: number;
  movementCount?: number;
}

export interface CapitalLedgerDiscoveredVault {
  vaultAddress: string;
  equity: string;
  lockedUntilTimestamp: number | null;
}

export interface CapitalLedgerVaultUser {
  userAddress: string;
  vaultEquity: string;
  pnl: string;
  allTimePnl: string;
  daysFollowing: number | null;
  vaultEntryTime: number | null;
  lockupUntil: number | null;
}

export interface CapitalLedgerVault {
  vaultAddress: string;
  url: string;
  name: string;
  apr: number | null;
  user: CapitalLedgerVaultUser | null;
  maxWithdrawable?: string;
  isClosed?: boolean;
  allowDeposits?: boolean | null;
}

export interface CapitalLedgerSyncSnapshot {
  ok: boolean;
  fetchedAt: string;
  config: CapitalLedgerVaultConfig;
  summary: CapitalLedgerVaultSummary;
  discoveredVaults: CapitalLedgerDiscoveredVault[];
  vaults: CapitalLedgerVault[];
  movements: CapitalLedgerTransaction[];
}

export interface CapitalLedgerState {
  schemaVersion: 2;
  vault: {
    activeValue: string;
    activeValueAt: string;
    pnlTotal: string;
  };
  hyperliquid: {
    vaultAddress: string;
    userAddress: string;
    lastSyncAt: string;
  };
  lastSync: CapitalLedgerSyncSnapshot | null;
  transactions: CapitalLedgerTransaction[];
}

export interface CapitalLedgerSummary {
  totalDeposited: number;
  totalWithdrawn: number;
  activeValue: number;
  pnlTotal: number;
  ledgerPnl: number;
  netCapital: number;
  activeCapital: number | null;
  activePnl: number | null;
  displayPnl: number;
  displayCapital: number;
  validTransactions: number;
  invalidTransactions: number;
  elapsedDays: number;
  xirrApr: number | null;
  apr: number | null;
}

export interface CapitalLedgerPortfolioContribution {
  investedCapital: number;
  balanceValue: number;
  pnl: number;
  activeValue: number;
  earningCapital: number;
  apr: number | null;
  dailyEarningsUsd: number;
  vaultCount: number;
  movementCount: number;
  lastSyncAt: string;
}
