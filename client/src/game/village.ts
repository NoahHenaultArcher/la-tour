/**
 * Vue du village côté client : production et stocks estimés en direct, uniquement pour l'affichage.
 * Les vrais chiffres sont toujours ceux du serveur (collecte régulière et avant chaque dépense).
 */
import { computeIdleProduction, villageIdleSettings, type SaveDto } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../stores/session.ts';

const REFRESH_MS = 2000;

export interface VillageView {
  /** Stock estimé de chaque ressource à cet instant. */
  resources: Record<string, number>;
  capacity: number;
  maxHours: number;
  /** Bonus de production de la Tour d'amélioration (0,1 = +10 %). */
  productionBonus: number;
  /** Production par heure, bonus compris. */
  ratePerHour: (resourceId: string) => number;
}

export function computeVillageView(save: SaveDto, receivedAt: number, now: number): VillageView {
  const settings = villageIdleSettings(gameData.village, save.buildings, save.upgradeTower);
  // Dernière collecte exprimée dans l'horloge locale, d'après l'écart mesuré par le serveur.
  const serverLag = Date.parse(save.serverTime) - Date.parse(save.lastIdleCollectAt);
  const projection = computeIdleProduction({
    now: new Date(now),
    lastCollectedAt: new Date(receivedAt - serverLag),
    ratesPerHour: settings.ratesPerHour,
    stocks: Object.fromEntries(
      Object.entries(save.resources).map(([id, amount]) => [id, { amount, fraction: 0 }]),
    ),
    capacity: settings.capacity,
    maxHours: settings.maxHours,
    productionBonus: settings.productionBonus,
  });
  const resources = { ...save.resources };
  for (const [id, stock] of Object.entries(projection.stocks)) resources[id] = stock.amount;
  return {
    resources,
    capacity: settings.capacity,
    maxHours: settings.maxHours,
    productionBonus: settings.productionBonus,
    ratePerHour: (id) =>
      Math.round((settings.ratesPerHour[id] ?? 0) * (1 + settings.productionBonus)),
  };
}

/** Vue du village rafraîchie toutes les 2 secondes. */
export function useVillageView(): VillageView {
  const save = useSession((s) => s.save)!;
  const receivedAt = useSession((s) => s.saveReceivedAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  return useMemo(() => computeVillageView(save, receivedAt, now), [save, receivedAt, now]);
}

export const resourceById = (id: string) => gameData.resources.resources.find((r) => r.id === id);
export const buildingById = (id: string) => gameData.village.buildings.find((b) => b.id === id);
