import { create } from 'zustand';

export interface Notification {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

interface NotificationState {
  items: Notification[];
  notify: (kind: Notification['kind'], text: string) => void;
  dismiss: (id: number) => void;
}

const DURATION_MS = 4000;
let nextId = 1;

/** Notifications éphémères (amélioration réussie, erreur…). */
export const useNotifications = create<NotificationState>((set, get) => ({
  items: [],
  notify: (kind, text) => {
    const id = nextId++;
    set({ items: [...get().items, { id, kind, text }] });
    setTimeout(() => get().dismiss(id), DURATION_MS);
  },
  dismiss: (id) => set({ items: get().items.filter((n) => n.id !== id) }),
}));
