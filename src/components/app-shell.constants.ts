import type { View } from '../types';

export interface AppShellNavItem {
  view: View;
  label: string;
  active: boolean;
}

export const APP_SHELL_COPY = {
  titlePrefix: 'Crypto Portfolio',
  titleSuffix: 'Tracker',
  lastUpdatePending: 'Actualizado: pendiente',
  navLabel: 'Vistas principales',
  utilityActionsLabel: 'Acciones globales',
  syncLabel: 'Actualizar posiciones',
  configLabel: 'Configuración',
  themeLabel: 'Cambiar tema',
};
