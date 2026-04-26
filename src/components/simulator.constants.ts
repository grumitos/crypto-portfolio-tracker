import type { CompoundFrequency } from '../types';

export const PROJECTION_MAX_MONTH = 12;
export const RESULT_NUMBER_ANIM_MS = 180;

export const SIMULATOR_COPY = {
  title: 'Simulador de recuperación',
  kicker: 'Escenario proyectado',
  intro: 'Modela el tiempo necesario para recuperar capital y alcanzar la meta con compound.',
  parametersTitle: 'Parámetros',
  resultsTitle: 'Resultados',
  projectionTitle: 'Proyección mensual',
  capitalLabel: 'Capital actual (USD)',
  aprLabel: 'APR esperado (%)',
  frequencyLabel: 'Capitalización',
  goalLabel: 'Meta (USD)',
  autoCapitalHint: 'Capital en posiciones',
  autoAprHintPrefix: 'Promedio ponderado (USD):',
  autoGoalHint: 'Meta del dashboard',
  manualHint: 'Valor personalizado',
  resetAutoLabel: 'Resetear AUTO',
  simulateLabel: 'Simular',
  breakEvenLabel: 'BE',
  goalMilestoneLabel: 'Meta',
  estimatedDateLabel: 'Fecha estimada',
  remainingTimeLabel: 'Tiempo restante',
  dailyRunRateLabel: 'Run-rate diario estimado',
  monthlyRunRateLabel: 'Run-rate mensual estimado',
  rateLabel: 'Tasa diaria comp. / APY',
  finalBalanceLabel: 'Balance final (ultimo mes proyectado)',
  reachedBreakEven: 'BE alcanzado',
  reachedGoal: 'Meta alcanzada',
  projectionContext: '12 meses visibles, con hitos marcados en la última columna',
  projectionCaption: 'Proyección mensual de balance, ganancia acumulada e hitos de BE y Meta',
  projectionHeaders: [
    'Mes',
    'Fecha estimada',
    'Balance proyectado',
    'Ganancia acum.',
    'Hito',
  ] as const,
};

export const SIMULATOR_FREQUENCY_OPTIONS: Array<{
  value: CompoundFrequency;
  label: string;
}> = [
  { value: 'daily', label: 'Diaria' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quincenal' },
];
