import type {
  ClassId,
  CraftItemBody,
  IdleReport,
  SaveDto,
  ShopDto,
  StatAllocation,
  UserDto,
} from '@la-tour/shared';
import { create } from 'zustand';
import { ApiError, api } from '../api/client.ts';

type Status = 'loading' | 'anonymous' | 'ready';

/** En dessous de cette absence, on ne montre pas la fenêtre « Pendant votre absence ». */
const ABSENCE_REPORT_MIN_HOURS = 5 / 60;

interface SessionState {
  status: Status;
  user: UserDto | null;
  /** Sauvegarde telle que renvoyée par le serveur (seule source de vérité). */
  save: SaveDto | null;
  /** Instant (horloge locale) où la sauvegarde a été reçue, pour l'affichage en direct. */
  saveReceivedAt: number;
  /** Rapport à afficher dans la fenêtre « Pendant votre absence ». */
  absenceReport: IdleReport | null;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  chooseClass: (classId: ClassId) => Promise<void>;
  /** Collecte la production idle sur le serveur ; `showReport` affiche la fenêtre d'absence. */
  collect: (showReport?: boolean) => Promise<void>;
  upgradeBuilding: (buildingId: string) => Promise<void>;
  equipItem: (itemId: string, characterId: string) => Promise<void>;
  unequipItem: (itemId: string) => Promise<void>;
  upgradeItem: (itemId: string) => Promise<void>;
  craftItem: (body: CraftItemBody) => Promise<void>;
  allocateStatPoints: (characterId: string, add: Partial<StatAllocation>) => Promise<void>;
  resetStatPoints: (characterId: string) => Promise<void>;
  /** Achat à la taverne ; renvoie l'assortiment à jour. */
  buyOffer: (offerId: string) => Promise<ShopDto>;
  /** Revente d'un objet ; renvoie l'or gagné. */
  sellItem: (itemId: string) => Promise<number>;
  setSave: (save: SaveDto) => void;
  dismissAbsenceReport: () => void;
}

const withSave = (save: SaveDto) => ({ save, saveReceivedAt: Date.now() });

export const useSession = create<SessionState>((set) => {
  const collect = async (showReport = false) => {
    const { save, report } = await api.collect();
    const worthShowing =
      showReport &&
      report.elapsedHours >= ABSENCE_REPORT_MIN_HOURS &&
      Object.keys(report.produced).length > 0;
    set(worthShowing ? { ...withSave(save), absenceReport: report } : withSave(save));
  };

  const loadAfterAuth = async (user: UserDto) => {
    set({ user });
    await collect(true);
    set({ status: 'ready' });
  };

  return {
    status: 'loading',
    user: null,
    save: null,
    saveReceivedAt: 0,
    absenceReport: null,

    init: async () => {
      try {
        const { user } = await api.me();
        await loadAfterAuth(user);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          set({ status: 'anonymous', user: null, save: null });
        else throw error;
      }
    },

    login: async (username, password) => {
      const { user } = await api.login({ username, password });
      await loadAfterAuth(user);
    },

    register: async (username, password) => {
      const { user } = await api.register({ username, password });
      await loadAfterAuth(user);
    },

    logout: async () => {
      try {
        await api.logout();
      } finally {
        set({ status: 'anonymous', user: null, save: null, absenceReport: null });
      }
    },

    chooseClass: async (classId) => {
      set(withSave(await api.chooseClass({ classId })));
    },

    collect,

    upgradeBuilding: async (buildingId) => {
      set(withSave(await api.upgradeBuilding({ buildingId })));
    },
    equipItem: async (itemId, characterId) => {
      set(withSave(await api.equipItem({ itemId, characterId })));
    },
    unequipItem: async (itemId) => {
      set(withSave(await api.unequipItem({ itemId })));
    },
    upgradeItem: async (itemId) => {
      set(withSave(await api.upgradeItem({ itemId })));
    },
    craftItem: async (body) => {
      set(withSave(await api.craftItem(body)));
    },
    allocateStatPoints: async (characterId, add) => {
      set(withSave(await api.allocateStatPoints({ characterId, add })));
    },
    resetStatPoints: async (characterId) => {
      set(withSave(await api.resetStatPoints({ characterId })));
    },
    buyOffer: async (offerId) => {
      const { shop, save } = await api.buyOffer({ offerId });
      set(withSave(save));
      return shop;
    },
    sellItem: async (itemId) => {
      const { gold, save } = await api.sellItem({ itemId });
      set(withSave(save));
      return gold;
    },

    setSave: (save) => set(withSave(save)),
    dismissAbsenceReport: () => set({ absenceReport: null }),
  };
});
