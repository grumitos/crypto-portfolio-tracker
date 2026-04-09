export const AUTO_BALANCE_SYNC_COOLDOWN_MS = 5000;
export const GOAL_NUMBER_ANIM_MS = 400;
export const DASHBOARD_BALANCE_LOADING_CARD_COUNT = 3;
export const DASHBOARD_BALANCE_VISIBLE_ITEMS = 12;
export const DASHBOARD_BALANCE_DECIMALS_SMALL = 6;
export const DASHBOARD_BALANCE_DECIMALS_MEDIUM = 4;
export const DASHBOARD_BALANCE_DECIMALS_LARGE = 2;

export const DASHBOARD_COPY = {
  sectionTitle: 'Resumen del portfolio',
  sectionKicker: 'Vista general',
  sectionIntro: 'Capital, progreso y run-rate actual en una sola lectura.',
  investedTitle: 'Invertido total',
  balanceTitle: 'Saldo total',
  pnlTitle: 'P&L',
  goalTitle: 'Progreso: breakeven y meta',
  defaultGoalLabel: 'Meta',
  remainingPrefix: 'para',
  remainingText: 'Faltan',
  reachedSuffix: 'alcanzado',
  goalTargetText: 'la meta',
  breakEvenTargetText: 'breakeven',
  averageAprTitle: 'APR promedio',
  capitalTitle: 'En posiciones',
  dailyRunRateTitle: 'Run-rate diario est.',
  activePositionsTitle: 'Posiciones activas',
  accountBalanceTitle: 'Saldo en cuenta',
  accountBalanceCopy: 'Disponible y comprometido por activo.',
  accountBalanceBadge: 'Binance',
  emptyBalancesTitle: 'Sin activos disponibles',
  emptyBalancesCopy: 'No hay saldos reportados por Binance en este momento.',
  freeLabel: 'Libre',
  lockedLabel: 'Bloq.',
  breakEvenLegend: 'BE',
  goalLegend: 'Meta',
  progressRegionLabel: 'Progreso del portfolio',
  etaLabel: 'Tiempo estimado para el objetivo activo',
} as const;
