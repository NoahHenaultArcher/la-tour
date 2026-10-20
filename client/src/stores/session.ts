import type {
  ClassId,
  CraftItemBody,
  SetDeckBody,
  UpgradeTowerBranchId,
  IdleReport,
  ItemDto,
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
  /** `slot` = weapon3 : 3e arme du Maître d'armes. */
  equipItem: (itemId: string, characterId: string, slot?: 'weapon3') => Promise<void>;
  unequipItem: (itemId: string) => Promise<void>;
  /** Reliques : équiper dans un emplacement (0 à 5), ou retirer. */
  equipRelic: (relicId: string, slot: number) => Promise<void>;
  unequipRelic: (relicId: string) => Promise<void>;
  upgradeItem: (itemId: string) => Promise<void>;
  /** Fabrique un objet ; renvoie l'objet obtenu (sa rareté est tirée par le serveur). */
  craftItem: (body: CraftItemBody) => Promise<ItemDto | null>;
  allocateStatPoints: (characterId: string, add: Partial<StatAllocation>) => Promise<void>;
  resetStatPoints: (characterId: string) => Promise<void>;
  /** Achat à la taverne ; renvoie l'assortiment à jour. */
  buyOffer: (offerId: string) => Promise<ShopDto>;
  /** Revente d'un objet ; renvoie l'or gagné. */
  sellItem: (itemId: string) => Promise<number>;
  /** Revente groupée (« Tout vendre ») ; renvoie l'or gagné. */
  sellItems: (itemIds: string[]) => Promise<number>;
  /** Annule des ventes récentes (rachat au même prix) ; renvoie l'or rendu. */
  buyBackItems: (itemIds: string[]) => Promise<number>;
  /** Nouveau deck d'un héros (les fusions nouvelles sont payées par le serveur). */
  setDeck: (body: SetDeckBody) => Promise<void>;
  upgradeTowerBranch: (branch: UpgradeTowerBranchId) => Promise<void>;
  /** Héritage : tout le compte recommence la tour avec +25 % de stats. */
  inherit: () => Promise<void>;
  setSave: (save: SaveDto) => void;
  dismissAbsenceReport: () => void;
}

const withSave = (save: SaveDto) => ({ save, saveReceivedAt: Date.now() });

export const useSession = create<SessionState>((set, get) => {
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
    equipItem: async (itemId, characterId, slot) => {
      set(withSave(await api.equipItem({ itemId, characterId, ...(slot ? { slot } : {}) })));
    },
    unequipItem: async (itemId) => {
      set(withSave(await api.unequipItem({ itemId })));
    },
    equipRelic: async (relicId, slot) => {
      set(withSave(await api.equipRelic({ relicId, slot })));
    },
    unequipRelic: async (relicId) => {
      set(withSave(await api.unequipRelic({ relicId })));
    },
    upgradeItem: async (itemId) => {
      set(withSave(await api.upgradeItem({ itemId })));
    },
    craftItem: async (body) => {
      const before = new Set(get().save?.items.map((i) => i.id));
      const save = await api.craftItem(body);
      set(withSave(save));
      return save.items.find((i) => !before.has(i.id)) ?? null;
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
    sellItems: async (itemIds) => {
      const { gold, save } = await api.sellItems({ itemIds });
      set(withSave(save));
      return gold;
    },
    buyBackItems: async (itemIds) => {
      const { gold, save } = await api.buyBackItems({ itemIds });
      set(withSave(save));
      return gold;
    },

    setDeck: async (body) => {
      set(withSave(await api.setDeck(body)));
    },
    upgradeTowerBranch: async (branch) => {
      set(withSave(await api.upgradeTowerBranch({ branch })));
    },
    inherit: async () => {
      set(withSave(await api.heritage()));
    },

    setSave: (save) => set(withSave(save)),
    dismissAbsenceReport: () => set({ absenceReport: null }),
  };
});
