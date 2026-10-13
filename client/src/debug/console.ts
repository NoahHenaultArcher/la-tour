import { create } from 'zustand';
import { t } from '../i18n/index.ts';

interface DebugState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useDebug = create<DebugState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

interface DebugCommand {
  enable: () => void;
  disable: () => void;
}

declare global {
  interface Window {
    debug: DebugCommand;
  }
}

/**
 * Commande de console `debug.enable()` : affiche seulement le panneau.
 * Chaque action du panneau est une requête que le serveur n'accepte que pour un compte admin.
 */
export function installDebugCommand(): void {
  window.debug = {
    enable: () => {
      useDebug.getState().setOpen(true);
      console.info(t('debug.console.enabled'));
    },
    disable: () => {
      useDebug.getState().setOpen(false);
      console.info(t('debug.console.disabled'));
    },
  };
}
