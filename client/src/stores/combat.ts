/**
 * État du combat côté client. Le serveur renvoie l'état final et la liste des événements ;
 * le client rejoue les événements un par un (animations, journal) avant d'afficher l'état final.
 * Aucun chiffre n'est calculé ici : tout vient du serveur.
 */
import type { CombatEvent, CombatOutcome, CombatResponse, CombatView } from '@la-tour/shared';
import { create } from 'zustand';
import { api } from '../api/client.ts';
import { describeEvent } from '../game/combatText.ts';
import { errorMessage } from '../i18n/index.ts';

export type Speed = 1 | 2 | 3;

export interface Floater {
  id: number;
  targetId: string;
  text: string;
  kind: 'damage' | 'critical' | 'heal' | 'miss' | 'status';
}

interface CombatStore {
  /** État affiché (avance au rythme de la relecture des événements). */
  view: CombatView | null;
  /** État final renvoyé par le serveur. */
  target: CombatView | null;
  queue: CombatEvent[];
  log: string[];
  floaters: Floater[];
  /** Combattant qui agit (surbrillance). */
  activeId: string | null;
  outcome: CombatOutcome | null;
  pendingOutcome: CombatOutcome | null;
  busy: boolean;
  error: string | null;
  auto: boolean;
  speed: Speed;
  selectedHeroId: string | null;
  selectedSkillId: string | null;

  load: () => Promise<void>;
  start: (floor: number) => Promise<void>;
  act: (targetId?: string) => Promise<void>;
  pass: () => Promise<void>;
  playAuto: () => Promise<void>;
  forfeit: () => Promise<void>;
  startHunt: (zoneFloor: number) => Promise<void>;
  /** Quitte une zone de chasse (gains conservés). */
  retreat: () => Promise<void>;
  winWave: () => Promise<void>;
  setAuto: (auto: boolean) => void;
  setSpeed: (speed: Speed) => void;
  selectHero: (heroId: string) => void;
  selectSkill: (skillId: string | null) => void;
  /** Applique l'événement suivant de la file ; renvoie false quand la file est vide. */
  step: () => boolean;
  clearOutcome: () => void;
}

const MAX_LOG = 80;
let floaterId = 1;

export const useCombat = create<CombatStore>((set, get) => {
  /** Reçoit une réponse du serveur : les événements sont mis en file pour être rejoués. */
  const receive = (response: CombatResponse, reset = false) => {
    if (reset) {
      // Début ou reprise : l'état reçu est déjà à jour, les événements vont directement au journal.
      set({
        view: response.combat,
        target: response.combat,
        queue: [],
        log: response.events
          .map((e) => describeEvent(e, response.combat))
          .filter((text): text is string => text !== null),
        floaters: [],
        outcome: null,
        pendingOutcome: response.outcome,
        busy: false,
        error: null,
        activeId: null,
      });
      return;
    }
    set((s) => ({
      view: s.view ?? response.combat,
      target: response.combat,
      queue: [...s.queue, ...response.events],
      pendingOutcome: response.outcome,
      busy: false,
      error: null,
    }));
  };

  const call = async (request: () => Promise<CombatResponse>, reset = false) => {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      receive(await request(), reset);
    } catch (error) {
      set({ busy: false, error: errorMessage(error), auto: false });
    }
  };

  return {
    view: null,
    target: null,
    queue: [],
    log: [],
    floaters: [],
    activeId: null,
    outcome: null,
    pendingOutcome: null,
    busy: false,
    error: null,
    auto: false,
    speed: 1,
    selectedHeroId: null,
    selectedSkillId: null,

    load: () => call(api.getCombat, true),
    start: (floor) => call(() => api.startCombat(floor), true),

    act: (targetId) => {
      const { view, selectedHeroId, selectedSkillId } = get();
      const heroId = selectedHeroId ?? view?.heroes.find((h) => h.hp > 0)?.id;
      if (!heroId || !selectedSkillId) return Promise.resolve();
      return call(() => api.combatAction({ heroId, skillId: selectedSkillId, targetId }));
    },
    pass: () => call(api.combatPass),
    playAuto: () => call(api.combatAuto),
    forfeit: () => call(api.combatForfeit),
    startHunt: (zoneFloor) => call(() => api.startHunt(zoneFloor), true),
    retreat: () => call(api.combatRetreat),
    winWave: () => call(api.debugWinWave),

    setAuto: (auto) => set({ auto }),
    setSpeed: (speed) => set({ speed }),
    selectHero: (heroId) => set({ selectedHeroId: heroId, selectedSkillId: null }),
    selectSkill: (skillId) => set({ selectedSkillId: skillId }),

    step: () => {
      const { queue, view, target, pendingOutcome } = get();
      if (queue.length === 0) {
        if (target && view !== target) set({ view: target, activeId: null });
        if (pendingOutcome) set({ outcome: pendingOutcome, pendingOutcome: null, auto: false });
        return false;
      }
      const [event, ...rest] = queue;
      const next = view ? structuredClone(view) : null;
      const floaters: Floater[] = [];
      let activeId = get().activeId;
      if (next && event) {
        const find = (id: string) => [...next.heroes, ...next.monsters].find((c) => c.id === id);
        switch (event.type) {
          case 'action':
            activeId = event.actorId;
            break;
          case 'damage': {
            const c = find(event.targetId);
            if (c) c.hp = Math.max(0, c.hp - event.amount);
            floaters.push({
              id: floaterId++,
              targetId: event.targetId,
              text: `-${event.amount}`,
              kind: event.critical ? 'critical' : 'damage',
            });
            break;
          }
          case 'heal': {
            const c = find(event.targetId);
            if (c) c.hp = Math.min(c.stats.maxHp, c.hp + event.amount);
            floaters.push({
              id: floaterId++,
              targetId: event.targetId,
              text: `+${event.amount}`,
              kind: 'heal',
            });
            break;
          }
          case 'miss':
            floaters.push({ id: floaterId++, targetId: event.targetId, text: '—', kind: 'miss' });
            break;
          case 'wave':
            // Nouvelle vague : les monstres affichés sont ceux de l'état final.
            if (target && event.wave === target.waveIndex + 1) {
              next.monsters = structuredClone(target.monsters);
              next.waveIndex = target.waveIndex;
            }
            break;
          case 'round':
            next.round = event.round;
            next.firstSide = event.first;
            next.heroInitiative = event.heroInitiative;
            next.monsterInitiative = event.monsterInitiative;
            break;
          default:
            break;
        }
      }
      const text = event ? describeEvent(event, next ?? target) : null;
      set((s) => ({
        queue: rest,
        view: next,
        activeId,
        log: text ? [...s.log, text].slice(-MAX_LOG) : s.log,
        floaters: [...s.floaters, ...floaters].slice(-12),
      }));
      return true;
    },

    clearOutcome: () => set({ outcome: null, view: null, target: null, log: [], floaters: [] }),
  };
});
