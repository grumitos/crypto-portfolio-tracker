import type { CompoundFrequency } from '../types';

export const PROJECTION_MAX_MONTH = 12;
export const RESULT_NUMBER_ANIM_MS = 180;

/** Geometria de la curva de proyeccion (SVG puro, sin librerias). */
export const PROJECTION_CHART = {
  width: 776,
  height: 150,
  paddingTop: 18,
  paddingBottom: 12,
} as const;

export const SIMULATOR_COPY = {
  title: 'Simulador de recuperación',
  contextTitle: 'Simulador',
  contextMeta: 'Compound sobre el capital que renta',
  parametersTitle: 'Parámetros',
  capitalLabel: 'Capital actual (USD)',
  aprLabel: 'APR esperado (%)',
  frequencyLabel: 'Capitalización',
  frequencyHint: 'Diaria · Semanal · Quincenal',
  goalLabel: 'Meta (USD)',
  autoCapitalHint: 'Balance combinado; APR sobre capital activo',
  autoAprHintPrefix: 'Promedio ponderado (USD):',
  autoGoalHint: 'Meta del dashboard',
  manualHint: 'Valor personalizado',
  resetAutoLabel: 'Resetear AUTO',
  simulateLabel: 'Simular',
  goalHeroLabel: 'Meta alcanzada el',
  goalHeroContext: 'al ritmo actual',
  breakEvenLabel: 'Breakeven',
  chartTitle: 'Curva de recuperación',
  chartNote: '12 meses · compound diario',
  chartAriaLabel: 'Curva de proyección de saldo a 12 meses',
  chartStartLabel: 'hoy',
  chartEndLabel: 'mes 12',
  dailyRunRateLabel: 'Run-rate diario est.',
  dailyRunRateSub: 'interés del primer día',
  monthlyRunRateLabel: 'Run-rate mensual est.',
  monthlyRunRateSub: 'primer mes',
  rateLabel: 'Tasa diaria comp. / APY',
  rateSub: 'según la frecuencia elegida',
  finalBalanceLabel: 'Saldo a 12 meses',
  finalBalanceSub: 'último mes proyectado',
  reachedBreakEven: 'BE alcanzado',
  reachedGoal: 'Meta alcanzada',
  projectionTitle: 'Proyección mensual',
  projectionContext: '12 meses · hitos marcados en la columna final',
  projectionCaption: 'Proyección mensual de balance, ganancia del mes e hitos de BE y Meta',
  projectionHeaders: ['Mes', 'Fecha', 'Balance', 'Ganado en el mes', 'Hito'] as const,
  /** Mes e hito miden lo justo; las tres columnas centrales reparten el resto. */
  projectionColumnWidths: ['56px', '', '', '', '120px'] as const,
  milestoneBeLabel: 'Breakeven',
  milestoneGoalLabel: 'Meta',
};

export const SIMULATOR_FREQUENCY_OPTIONS: Array<{
  value: CompoundFrequency;
  label: string;
}> = [
  { value: 'daily', label: 'Diaria' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quincenal' },
];
