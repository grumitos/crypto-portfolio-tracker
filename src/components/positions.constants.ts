export const SPOT_STRIP_EXCLUDED_ASSETS = new Set<string>(['USDT', 'USDC']);
export const SPOT_STRIP_ASSET_ORDER = ['BTC', 'ETH', 'BNB', 'SOL'];
export const RESULT_NUMBER_ANIM_MS = 180;
export const SPOT_VALUE_SKELETON_WIDTH = '72px';
export const SPOT_CHANGE_SKELETON_WIDTH = '56px';

export const POSITIONS_COPY = {
  title: 'Dual Investment',
  contextTitle: 'Posiciones',
  contextMetaPrefix: 'Dual Investment',
  aprTitle: 'APR promedio',
  aprSub: 'ponderado por USD',
  capitalTitle: 'En posiciones',
  capitalSub: 'capital comprometido',
  dailyTitle: 'Run-rate diario est.',
  dailySub: 'interés proyectado por día',
  countTitle: 'Posiciones activas',
  countSub: 'suscripciones abiertas',
  buyLowTitle: 'Buy Low',
  buyLowNote: 'Se liquida en el activo base si el precio cae al target',
  sellHighTitle: 'Sell High',
  sellHighNote: 'Se liquida en stablecoin si el precio sube al target',
  noData: 'N/D',
  marketError: 'No se pudo actualizar precios de mercado.',
  emptyTitle: 'Sin posiciones activas',
  emptyBody: 'Esta vista refleja posiciones abiertas reportadas por los exchanges configurados.',
  emptyHint: 'Sincroniza para consultar posiciones activas.',
  apiMissingTitle: 'Conecta un exchange para ver tus posiciones',
  apiMissingBody: 'Usa Configuración para conectar Binance o Bybit y sincronizar datos.',
};
