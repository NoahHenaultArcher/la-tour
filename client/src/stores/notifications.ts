import { create } from 'zustand';

export interface Notification {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
  /** Nombre de fois où ce même message est arrivé d'affilée (achats répétés…). */
  count: number;
}

interface NotificationState {
  items: Notification[];
  notify: (kind: Notification['kind'], text: string) => void;
  dismiss: (id: number) => void;
}

const DURATION_MS = 4000;
/** Au-delà, les plus anciennes disparaissent : pas de colonne de messages qui couvre l'écran. */
const MAX_VISIBLE = 3;
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Notifications éphémères (amélioration réussie, erreur…). Un message répété est regroupé (×N). */
export const useNotifications = create<NotificationState>((set, get) => {
  const schedule = (id: number) => {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), DURATION_MS),
    );
  };
  return {
    items: [],
    notify: (kind, text) => {
      const items = get().items;
      const same = items.find((n) => n.kind === kind && n.text === text);
      if (same) {
        // Même message : on l'incrémente, on le remet en dernier et on relance son délai.
        set({
          items: [...items.filter((n) => n.id !== same.id), { ...same, count: same.count + 1 }],
        });
        schedule(same.id);
        return;
      }
      const id = nextId++;
      const next = [...items, { id, kind, text, count: 1 }];
      for (const old of next.slice(0, Math.max(0, next.length - MAX_VISIBLE))) {
        clearTimeout(timers.get(old.id));
        timers.delete(old.id);
      }
      set({ items: next.slice(-MAX_VISIBLE) });
      schedule(id);
    },
    dismiss: (id) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      set({ items: get().items.filter((n) => n.id !== id) });
    },
  };
});
