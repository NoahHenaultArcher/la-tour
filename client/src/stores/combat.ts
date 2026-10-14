/**
 * État du combat côté client. Le serveur renvoie l'état final et la liste des événements ;
 * le client rejoue les événements un par un (animations, journal) avant d'afficher l'état final.
 * Aucun chiffre n'est calculé ici : tout vient du serveur.
 * En multijoueur, les mises à jour arrivent par Socket.IO (store room.ts) et sont rejouées de même.
 */
import type {
  CombatEvent,
  CombatOutcome,
  CombatResponse,
  CombatView,
  MultiCombatUpdate,
  MultiOutcome,
} from '@la-tour/shared';
import { create } from 'zustand';
import { api } from '../api/client.ts';
import { describeEvent } from '../game/combatText.ts';
import { errorMessage } from '../i18n/index.ts';
import { useRoom } from './room.ts';

export type Speed = 1 | 2 | 3;

export interface Floater {
  id: number;
  targetId: string;
  text: string;
  kind: 'damage' | 'critical' | 'heal' | 'miss' | 'status' | 'shield';
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
  /** Mode auto en cours (s'arrête à la fin du combat, en cas d'erreur ou de retraite ; jamais en multi). */
  auto: boolean;
  /** Choix du joueur (bouton auto) : chaque combat solo suivant démarre ainsi (retenu dans le navigateur). */
  autoWanted: boolean;
  speed: Speed;
  selectedHeroId: string | null;
  selectedSkillId: string | null;
  /** Solo (requêtes HTTP) ou multijoueur (Socket.IO, un héros par joueur). */
  mode: 'solo' | 'multi';
  /** Multijoueur : héros du joueur, fin du tour (minuteur), bilan « qui a obtenu quoi ». */
  ownHeroId: string | null;
  turnDeadline: string | null;
  multiOutcome: MultiOutcome | null;
  pendingMulti: MultiOutcome | null;

  load: () => Promise<void>;
  /** Mise à jour d'un combat multijoueur reçue du serveur. */
  receiveMulti: (update: MultiCombatUpdate, ownHeroId: string | null) => void;
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

const AUTO_KEY = 'la-tour.auto';

/** Confort propre au navigateur : sans stockage disponible, l'auto repart désactivé. */
function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === '1';
  } catch {
    return false;
  }
}

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

  /** Multijoueur : l'intention part par Socket.IO ; le résultat arrive par combat:update. */
  const multiCall = async (request: () => Promise<void>) => {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      await request();
      set({ busy: false });
    } catch (error) {
      set({ busy: false, error: errorMessage(error) });
    }
  };
  const multi = () => get().mode === 'multi';

  /** Un nouveau combat solo reprend le dernier choix du bouton auto. */
  const initialAuto = () => set({ auto: get().autoWanted });

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
    autoWanted: readAuto(),
    speed: 1,
    selectedHeroId: null,
    selectedSkillId: null,
    mode: 'solo',
    ownHeroId: null,
    turnDeadline: null,
    multiOutcome: null,
    pendingMulti: null,

    // Un combat multijoueur en cours se resynchronise par Socket.IO, pas par HTTP.
    load: () => {
      if (useRoom.getState().room?.inCombat) return Promise.resolve();
      // Combat multijoueur terminé (bilan déjà versé) : on revient au combat solo éventuel.
      if (multi()) get().clearOutcome();
      // Reprise d'un combat solo après un rechargement : le choix auto s'applique aussi.
      if (!get().view) initialAuto();
      return call(api.getCombat, true);
    },

    receiveMulti: (update, ownHeroId) => {
      const { mode, view, multiOutcome, pendingMulti } = get();
      // Nouveau combat (ou reprise après un rechargement) : l'état reçu remplace l'affichage.
      const fresh =
        mode !== 'multi' || view === null || multiOutcome !== null || pendingMulti !== null;
      if (fresh) set({ multiOutcome: null, pendingMulti: null });
      set({
        mode: 'multi',
        ownHeroId,
        selectedHeroId: ownHeroId,
        turnDeadline: update.turnDeadline,
        auto: false,
        speed: 1,
      });
      const response: CombatResponse = {
        combat: update.combat,
        events: update.events,
        outcome: null,
      };
      receive(response, fresh);
      set({ pendingMulti: update.outcome });
    },
    start: (floor) => {
      if (multi()) get().clearOutcome();
      initialAuto();
      return call(() => api.startCombat(floor), true);
    },

    act: (targetId) => {
      const { view, selectedHeroId, selectedSkillId } = get();
      const heroId = selectedHeroId ?? view?.heroes.find((h) => h.hp > 0)?.id;
      if (!heroId || !selectedSkillId) return Promise.resolve();
      if (multi())
        return multiCall(() => useRoom.getState().action({ skillId: selectedSkillId, targetId }));
      return call(() => api.combatAction({ heroId, skillId: selectedSkillId, targetId }));
    },
    pass: () => (multi() ? multiCall(useRoom.getState().pass) : call(api.combatPass)),
    playAuto: () => call(api.combatAuto),
    forfeit: () => (multi() ? multiCall(useRoom.getState().forfeit) : call(api.combatForfeit)),
    startHunt: (zoneFloor) => {
      if (multi()) get().clearOutcome();
      initialAuto();
      return call(() => api.startHunt(zoneFloor), true);
    },
    retreat: () => {
      if (multi()) return multiCall(useRoom.getState().withdraw);
      // L'auto s'arrête pendant la retraite ; le choix du joueur reste retenu pour la prochaine chasse.
      set({ auto: false });
      return call(api.combatRetreat);
    },
    winWave: () => (multi() ? multiCall(useRoom.getState().debugWinWave) : call(api.debugWinWave)),

    setAuto: (auto) => {
      try {
        localStorage.setItem(AUTO_KEY, auto ? '1' : '0');
      } catch {
        // Stockage indisponible : le choix vaut pour cette visite seulement.
      }
      set({ auto, autoWanted: auto });
    },
    setSpeed: (speed) => set({ speed }),
    selectHero: (heroId) => set({ selectedHeroId: heroId, selectedSkillId: null }),
    selectSkill: (skillId) => set({ selectedSkillId: skillId }),

    step: () => {
      const { queue, view, target, pendingOutcome, pendingMulti } = get();
      if (queue.length === 0) {
        if (target && view !== target) set({ view: target, activeId: null });
        if (pendingOutcome) set({ outcome: pendingOutcome, pendingOutcome: null, auto: false });
        if (pendingMulti)
          set({ multiOutcome: pendingMulti, pendingMulti: null, turnDeadline: null });
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
            if (c) {
              // Le bouclier absorbe d'abord, comme sur le serveur.
              const absorbed = Math.min(c.shield, event.amount);
              c.shield -= absorbed;
              c.hp = Math.max(0, c.hp - (event.amount - absorbed));
            }
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
          case 'shield': {
            const c = find(event.targetId);
            if (c) c.shield += event.amount;
            floaters.push({
              id: floaterId++,
              targetId: event.targetId,
              text: `+${event.amount}`,
              kind: 'shield',
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

    clearOutcome: () =>
      set({
        outcome: null,
        multiOutcome: null,
        pendingMulti: null,
        view: null,
        target: null,
        log: [],
        floaters: [],
        mode: 'solo',
        ownHeroId: null,
        turnDeadline: null,
      }),
  };
});
