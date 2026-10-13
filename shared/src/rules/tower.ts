/**
 * Tour : type d'étage, composition, progression et déblocages (zones de chasse, éléments, bâtiments).
 * Règles du prompt §6–§7 et du bestiaire (onglets Étages, Zones, Paramètres §5).
 */
import type { ElementId, FloorTypeId } from '../constants.ts';
import type { ElementsData, MonstersData, VillageData, ZonesData } from '../data/schemas.ts';

export const TOWER_FLOORS = 100;

/** Étages ×5 : boss ; étages se terminant par 9 : tannière du dragon ; sinon étage normal. */
export function floorType(floor: number): FloorTypeId {
  if (floor % 5 === 0) return 'boss';
  if (floor % 10 === 9) return 'dragon';
  return 'normal';
}

/** Zone dont viennent les monstres : tranche de 5 pour un étage normal, l'étage lui-même sinon. */
export function zoneFloorOf(floor: number): number {
  return floorType(floor) === 'normal' ? 5 * Math.ceil(floor / 5) : floor;
}

/** Seuls les étages de boss et de dragon sont rejouables. */
export function isReplayable(floor: number): boolean {
  return floorType(floor) !== 'normal';
}

export function wavesOnFloor(data: MonstersData, floor: number): number {
  const type = floorType(floor);
  if (type === 'normal') return data.params.floors.normalWaves;
  if (type === 'boss') return data.params.floors.bossWaves;
  return 1;
}

/** Nombre total de monstres d'un étage (boss : 4 vagues normales puis boss + escortes). */
export function monstersOnFloor(data: MonstersData, floor: number): number {
  const f = data.params.floors;
  const type = floorType(floor);
  if (type === 'normal') return f.normalWaves * f.monstersPerWave;
  if (type === 'boss') return (f.bossWaves - 1) * f.monstersPerWave + f.bossEscorts + 1;
  return 1;
}

/** Le joueur peut jouer son étage courant, ou rejouer un étage de boss/dragon déjà terminé. */
export function canPlayFloor(
  progress: { currentFloor: number; highestFloorCleared: number },
  floor: number,
): boolean {
  if (floor < 1 || floor > TOWER_FLOORS) return false;
  if (floor === progress.currentFloor) return true;
  return isReplayable(floor) && floor <= progress.highestFloorCleared;
}

/** Zones de chasse débloquées : celles dont l'étage de boss a été battu (pas les tannières). */
export function unlockedHuntingZones(
  data: ZonesData,
  highestFloorCleared: number,
): ZonesData['zones'] {
  return data.zones.filter((z) => z.hasHuntingZone && z.floor <= highestFloorCleared);
}

/** Éléments débloqués pour les compétences : dernier étage du biome terminé (Neutre dès le départ). */
export function unlockedElements(data: ElementsData, floorCleared: number): ElementId[] {
  return data.elements.filter((e) => e.unlockFloor <= floorCleared).map((e) => e.id);
}

/** Bâtiments construits à un étage donné (niveau 1 gratuit dès le déblocage). */
export function unlockedBuildings(data: VillageData, floorCleared: number): string[] {
  return data.buildings.filter((b) => b.unlockFloor <= floorCleared).map((b) => b.id);
}
