import type { FeePreset } from '../types';

export const CALC_INPUT_DEBOUNCE_MS = 120;
export const CALC_RESULT_ANIM_MS = 180;

export const FEE_PRESETS: Record<FeePreset, { maker: number; label: string }> = {
  spot: { maker: 0.075, label: 'Spot' },
  futures: { maker: 0, label: 'Futuros' },
};

export const CALCULADORA_COPY = {
  title: 'Calculadora Swing Trade',
  contextTitle: 'Calculadora',
  contextMeta: 'Swing trade · ciclo venta / recompra',
  executionTitle: 'Ejecución',
  executionNote: 'Precio real de salida y objetivos del ciclo',
  positionsTitle: 'Compras',
  signalTitle: 'Señal actual',
  priceLabel: 'Precio activo',
  priceHint: 'Promedio ponderado de compras',
  capitalLabel: 'Capital',
  capitalHint: 'Total invertido en compras',
  tradesLabel: 'Rondas por año',
  tradesHint: 'Ciclos completos estimados',
  feeLabel: 'Comisión',
  resetLabel: 'Resetear valores',
  addLabel: 'Agregar',
  clearLabel: 'Borrar',
  pricePlaceholder: '600',
  sellPricePlaceholder: '615',
  zeroPlaceholder: '0.00',
  feePrefix: 'Fee',
  feeSuffix: 'por lado',
  sellPriceLabel: 'Precio ejecutado',
  sellPctLabel: 'Venta objetivo (%)',
  rebuyPctLabel: 'Recompra objetivo (%)',
  purchaseHeaders: ['Cantidad', 'Precio unitario', 'Total'] as const,
  purchasesEmpty: 'Agrega compras para calcular precio promedio ponderado.',
  purchasesIncomplete: 'Completa cantidad y precio para cada compra.',
  aprLabel: 'APR real anualizado',
  signalPositive: 'Neto positivo',
  signalNegative: 'Neto negativo',
  signalFlat: 'Sin señal',
  netCyclePctLabel: 'Neto % ciclo',
  netCycleUsdLabel: 'Neto USD ciclo',
  movementLabel: 'Movimiento',
  profitTradeLabel: 'Ganancia por trade',
  feeTotalLabel: 'Fee total del ciclo',
  sellPriceOutLabel: 'Precio de venta objetivo',
  rebuyPriceOutLabel: 'Precio de recompra objetivo',
};
