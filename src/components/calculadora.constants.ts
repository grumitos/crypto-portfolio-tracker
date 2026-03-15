import type { FeePreset } from '../types';

export const CALC_INPUT_DEBOUNCE_MS = 120;
export const CALC_RESULT_ANIM_MS = 400;

export const FEE_PRESETS: Record<FeePreset, { maker: number; label: string }> = {
  spot: { maker: 0.075, label: 'Spot' },
  futures: { maker: 0, label: 'Futuros' },
};

export const CALCULADORA_COPY = {
  title: 'Calculadora Swing Trade',
  executionTitle: 'Ejecución',
  positionsTitle: 'Posiciones',
  signalTitle: 'Señal actual',
  priceLabel: 'Precio activo',
  capitalLabel: 'Capital',
  tradesLabel: 'Trades/Año',
  feeLabel: 'Comisión',
  resetLabel: 'Reset',
  addLabel: 'Agregar',
  clearLabel: 'Borrar',
  pricePlaceholder: '600',
  sellPricePlaceholder: '615',
  zeroPlaceholder: '0.00',
  feePrefix: 'Fee:',
  feeTotalPrefix: 'Total:',
  purchasesEmpty: 'Agrega compras para calcular precio promedio ponderado.',
  purchasesIncomplete: 'Completa cantidad y precio para cada compra.',
};
