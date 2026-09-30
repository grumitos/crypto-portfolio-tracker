export const CALC_INPUT_DEBOUNCE_MS = 120;
export const CALC_RESULT_ANIM_MS = 180;

/** Comision maker de spot; pagando en FDUSD la casa no cobra. */
export const SPOT_MAKER_FEE_PCT = 0.075;
export const FDUSD_MAKER_FEE_PCT = 0;

/** Pistas bajo cada campo del ciclo: muestran el valor en la unidad contraria. */
export const CALC_SELL_HINT_PCT = 'sobre el precio de compra';
export const CALC_REBUY_HINT_PCT = 'bajo el precio de venta';

export const CALCULADORA_COPY = {
  title: 'Calculadora Swing Trade',
  contextTitle: 'Calculadora',
  contextMeta: 'Swing trade · ciclo venta / recompra',

  positionTitle: 'Posición',
  positionNote: 'Tu base: coste medio y capital',
  cycleTitle: 'Ciclo',
  cycleNote: 'La vuelta que repites: se vende toda la posición',

  priceLabel: 'Precio medio de compra',
  priceHint: 'Automatico si agregas compras',
  capitalLabel: 'Capital invertido',
  capitalHint: 'Automatico si agregas compras',
  sellLabel: 'Precio de venta',
  rebuyLabel: 'Precio de recompra',
  tradesLabel: 'Rondas por año',
  tradesHint: 'Ciclos completos estimados',
  feeLabel: 'Comisión',
  feePrefix: 'Fee',
  feeSuffix: 'por lado',

  unitUsdLabel: '$',
  unitPctLabel: '%',
  unitUsdTitle: 'Capturar en dolares',
  unitPctTitle: 'Capturar en porcentaje',
  sellHintFallback: 'Indica el precio de compra para ver el equivalente',
  rebuyHintFallback: 'Indica el precio de venta para ver el equivalente',

  purchasesTitle: 'Compras',
  purchasesNote: 'Al agregarlas, el coste medio y el capital se calculan solos.',
  purchasesEmpty: 'Sin compras: los dos campos de arriba son manuales.',
  purchasesIncomplete: 'Completa cantidad y precio para cada compra.',
  purchaseHeaders: ['Cantidad', 'Precio', 'Total'] as const,

  resetLabel: 'Resetear valores',
  addLabel: 'Agregar',
  clearLabel: 'Borrar',
  pricePlaceholder: '600',
  sellPricePlaceholder: '615',
  zeroPlaceholder: '0.00',

  cycleResultsTitle: 'Rendimiento del ciclo',
  saleResultsTitle: 'Esta venta',
  signalPositive: 'Neto positivo',
  signalNegative: 'Neto negativo',
  signalSaleLoss: 'Venta bajo tu compra',
  signalFlat: 'Sin señal',
  aprLabel: 'APR estimado',
  netCyclePctLabel: 'Neto % por ciclo',
  netCycleUsdLabel: 'Neto USD por ciclo',
  feeTotalLabel: 'Fee del ciclo',
  sellPriceOutLabel: 'Precio de venta',
  rebuyPriceOutLabel: 'Precio de recompra',
  movementLabel: 'Sobre tu compra',
  saleNetLabel: 'Resultado',
};
