export const AUTO_BALANCE_SYNC_COOLDOWN_MS = 5000;
export const GOAL_NUMBER_ANIM_MS = 180;
export const DASHBOARD_BALANCE_LOADING_ROW_COUNT = 3;
export const DASHBOARD_BALANCE_VISIBLE_ITEMS = 12;
export const DASHBOARD_BALANCE_DECIMALS_SMALL = 6;
export const DASHBOARD_BALANCE_DECIMALS_MEDIUM = 4;
export const DASHBOARD_BALANCE_DECIMALS_LARGE = 2;

/**
 * Zona izquierda de la escala reservada al titulo de la seccion (y al borde del
 * track). Una etiqueta que cuelgue a la izquierda por debajo de este porcentaje
 * se saldria del contenedor o pisaria el titulo, asi que cambia de lado y sube
 * una fila.
 */
export const PROGRESS_TICK_EDGE_PCT = 22;

/**
 * Separacion minima entre las dos marcas para que sus etiquetas convivan en la
 * misma fila. Por debajo de este margen la marca mas baja sube a una segunda
 * fila.
 */
export const PROGRESS_TICK_MIN_SEPARATION_PCT = 12;

export const DASHBOARD_COPY = {
  sectionTitle: 'Resumen del portfolio',
  contextTitle: 'Resumen',
  investedTitle: 'Invertido total',
  balanceTitle: 'Saldo total',
  pnlContext: 'frente a lo invertido',
  balanceDateTitle: 'Fecha de corte',
  goalTitle: 'Progreso hacia breakeven y meta',
  defaultGoalLabel: 'Meta',
  remainingPrefix: 'para',
  remainingText: 'Faltan',
  reachedSuffix: 'alcanzado',
  goalTargetText: 'la meta',
  breakEvenTargetText: 'breakeven',
  averageAprTitle: 'APR promedio',
  averageAprSub: 'ponderado por USD',
  capitalTitle: 'En posiciones',
  capitalSub: 'capital comprometido',
  dailyRunRateTitle: 'Run-rate diario est.',
  dailyRunRateSub: 'interés proyectado por día',
  activePositionsTitle: 'Posiciones activas',
  activePositionsSub: 'suscripciones abiertas',
  accountBalanceTitle: 'Saldo en cuenta',
  accountBalanceCopy: 'Disponible y comprometido por activo',
  emptyBalancesTitle: 'Sin activos disponibles',
  emptyBalancesCopy: 'No hay saldos reportados por los exchanges configurados.',
  assetLabel: 'Activo',
  sourceLabel: 'Fuente',
  freeLabel: 'Libre',
  lockedLabel: 'Bloqueado',
  totalLabel: 'Total',
  breakEvenLegend: 'BE',
  goalLegend: 'Meta',
  /** Las marcas de la barra nombran el hito completo y llevan su importe. */
  breakEvenTickName: 'Breakeven',
  goalTickName: 'Meta',
  progressRegionLabel: 'Progreso del portfolio',
  etaLabel: 'Tiempo estimado para el objetivo activo',
  etaPrefix: 'ETA',
} as const;
