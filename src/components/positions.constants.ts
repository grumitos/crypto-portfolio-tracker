export const DURATION_PRESETS = [
  { label: '1D', days: 1 },
  { label: '2D', days: 2 },
  { label: '3D', days: 3 },
  { label: '5D', days: 5 },
  { label: '1S', days: 7 },
  { label: '2S', days: 14 },
  { label: '1M', days: 30 },
] as const;

export const SPOT_STRIP_EXCLUDED_ASSETS = new Set<string>(['USDT', 'USDC']);
export const SPOT_STRIP_ASSET_ORDER = ['BTC', 'ETH', 'BNB', 'SOL'];
export const RESULT_NUMBER_ANIM_MS = 180;
export const SPOT_VALUE_SKELETON_WIDTH = '72px';
export const SPOT_CHANGE_SKELETON_WIDTH = '56px';

export const POSITIONS_COPY = {
  title: 'Dual Investment',
  kicker: 'Operaciones activas',
  intro:
    'Seguimiento de posiciones abiertas, capital comprometido y contexto de mercado en tiempo real.',
  aprTitle: 'APR promedio',
  capitalTitle: 'En posiciones',
  dailyTitle: 'Run-rate diario est.',
  countTitle: 'Posiciones activas',
  buyLowTitle: 'Buy Low',
  sellHighTitle: 'Sell High',
  noData: 'N/D',
  marketError: 'No se pudo actualizar precios de mercado.',
  autoEmptyTitle: 'Sin posiciones activas',
  autoEmptyBody:
    'Esta vista refleja posiciones abiertas reportadas por los exchanges configurados.',
  apiMissingTitle: 'Conecta un exchange para habilitar la lectura automatica',
  apiMissingBody: 'Usa Configuracion para conectar Binance o Bybit y sincronizar datos.',
  manualEmptyTitle: 'Sin posiciones activas',
  manualEmptyBody: 'No hay posiciones cargadas para mostrar en esta vista.',
  emptyHintAuto: 'Sincroniza para consultar posiciones activas.',
  emptyHintManual: 'Consulta tu backup o cambia a Auto para ver posiciones sincronizadas.',
};
