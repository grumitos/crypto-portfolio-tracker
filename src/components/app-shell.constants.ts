import type { View } from '../types';

export interface AppShellNavItem {
  view: View;
  label: string;
  icon: string;
  active: boolean;
}

export const APP_SHELL_COPY = {
  titlePrefix: 'Crypto',
  titleSuffix: 'Portfolio Tracker',
  lastUpdatePending: 'Actualizado: pendiente',
  navLabel: 'Vistas principales',
  utilityActionsLabel: 'Acciones globales',
  syncLabel: 'Actualizar posiciones',
  configLabel: 'Configuración, importación y exportación',
  themeLabel: 'Cambiar tema',
};
