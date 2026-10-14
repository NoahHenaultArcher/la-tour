/**
 * Jeu en arrière-plan : savoir si l'onglet est caché, et attendre sans être ralenti par le navigateur
 * (les minuteries d'un onglet caché sont limitées à 1 par seconde, puis à 1 par minute).
 */
import { useEffect, useState } from 'react';

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, () => void>();

function timerWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./timer.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<number>) => {
      pending.get(event.data)?.();
      pending.delete(event.data);
    };
  } catch {
    // Worker indisponible : on se rabat sur une minuterie classique.
    workerFailed = true;
  }
  return worker;
}

/** Attend `ms` millisecondes, même onglet caché (Worker), sinon avec une minuterie classique. */
export function backgroundSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = timerWorker();
    if (!timer) {
      setTimeout(resolve, ms);
      return;
    }
    const id = nextId++;
    pending.set(id, resolve);
    timer.postMessage({ id, ms: Math.max(0, Math.round(ms)) });
  });
}

export const isPageHidden = () =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** L'onglet du jeu est-il caché (autre onglet, fenêtre réduite) ? */
export function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(isPageHidden);
  useEffect(() => {
    const update = () => setHidden(isPageHidden());
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}
