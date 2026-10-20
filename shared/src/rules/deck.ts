/**
 * Deck d'un héros (5 compétences : 3 actives dont une seule ultime, 2 passives ; l'Archimage a une
 * 4e active), déblocages et fusions de la Tour d'alchimie. Vérifié par le serveur à chaque modification.
 */
import { ALCHEMY } from '../balance.ts';
import type { ClassId, ElementId } from '../constants.ts';
import type { SkillsData } from '../data/schemas.ts';
import { MAX_HERO_LEVEL } from './rewards.ts';
import { isSkillUnlocked, type Skill } from './skills.ts';
import { TOWER_FLOORS } from './tower.ts';
import { byId } from './lookup.ts';
import { evolutionTier, hasDoubleFusion, hasExtraActive } from './evolution.ts';

/** Positions du deck : 0 à 2 actives, 3 et 4 passives, 5 = 4e active de l'Archimage. */
export const ACTIVE_POSITIONS = [0, 1, 2] as const;
export const PASSIVE_POSITIONS = [3, 4] as const;
export const EXTRA_ACTIVE_POSITION = 5;
export const DECK_SIZE = 5;

/** Une position du deck porte-t-elle une compétence active ? */
export function isActivePosition(position: number): boolean {
  return (
    (ACTIVE_POSITIONS as readonly number[]).includes(position) || position === EXTRA_ACTIVE_POSITION
  );
}

/** Ordre d'affichage d'une position : la 4e active (5) se range avec les actives, avant les passifs. */
export function deckDisplayOrder(position: number): number {
  return position === EXTRA_ACTIVE_POSITION ? ACTIVE_POSITIONS.length - 0.5 : position;
}

/** Positions actives d'un héros (l'Archimage en a une de plus). */
export function activePositionsOf(classId: ClassId, heritageCount: number): number[] {
  return hasExtraActive(classId, evolutionTier(heritageCount))
    ? [...ACTIVE_POSITIONS, EXTRA_ACTIVE_POSITION]
    : [...ACTIVE_POSITIONS];
}

export interface DeckSlot {
  position: number;
  skillId: string;
  /** Second élément d'une fusion (compétence d'attaque active seulement). */
  fusionElement?: ElementId | null;
  /** Archimage : deuxième élément fusionné (en plus de `fusionElement`). */
  fusionElement2?: ElementId | null;
}

/** Éléments fusionnés d'un emplacement (0, 1 ou 2). */
export function fusionElementsOf(slot: {
  fusionElement?: ElementId | null;
  fusionElement2?: ElementId | null;
}): ElementId[] {
  return [slot.fusionElement, slot.fusionElement2].filter((e): e is ElementId => !!e);
}

export type DeckError =
  | 'INVALID_DECK'
  | 'SKILL_LOCKED'
  | 'DUPLICATE_SKILL'
  | 'TOO_MANY_ULTIMATES'
  | 'FUSION_LOCKED'
  | 'TOO_MANY_FUSIONS';

/**
 * Niveau qui compte pour les déblocages : le meilleur niveau jamais atteint
 * (une compétence débloquée reste disponible après un héritage).
 */
export function unlockLevel(character: { level: number; bestLevel?: number }): number {
  return Math.max(character.level, character.bestLevel ?? 1);
}

/** Compétences qu'un héros peut équiper : celles de sa classe et les affinités élémentaires. */
export function availableSkills(
  data: { skills: SkillsData },
  classId: ClassId,
  level: number,
  unlockedElements: readonly ElementId[],
): Skill[] {
  return data.skills.catalog.filter(
    (s) =>
      (s.classId === classId || s.classId === null) && isSkillUnlocked(s, level, unlockedElements),
  );
}

/** Une compétence peut-elle recevoir une fusion ? (attaques actives seulement) */
export function canBeFused(skill: Pick<Skill, 'family'>): boolean {
  return skill.family === 'attack';
}

/** Nombre de compétences fusionnées par héros selon le niveau de la Tour d'alchimie (0 : pas construite). */
export function maxFusions(alchemyLevel: number): number {
  const table = ALCHEMY.fusionsPerHero;
  return table[Math.min(Math.max(0, alchemyLevel), table.length - 1)] ?? 0;
}

/** Coût de `count` fusions (remise au niveau 4 de la Tour d'alchimie). */
export function fusionCost(alchemyLevel: number, count = 1): { ether: number; gold: number } {
  const factor = alchemyLevel >= ALCHEMY.discountLevel ? 1 - ALCHEMY.discount : 1;
  return {
    ether: Math.round(ALCHEMY.fusionCost.ether * factor) * count,
    gold: Math.round(ALCHEMY.fusionCost.gold * factor) * count,
  };
}

/** Fusion des deux éléments (onglet Fusions), dans un ordre ou l'autre. */
export function fusionOf(data: { skills: SkillsData }, a: ElementId, b: ElementId) {
  return (
    data.skills.fusions.find(
      (f) => (f.element1 === a && f.element2 === b) || (f.element1 === b && f.element2 === a),
    ) ?? null
  );
}

/**
 * Fusions nouvellement posées par un deck (à payer) : celles qui n'existaient pas dans
 * l'ancien deck pour la même compétence. Retirer une fusion est gratuit ; la reposer coûte.
 * Chaque élément fusionné compte (la double fusion de l'Archimage coûte deux fusions).
 */
export function newFusionCount(before: readonly DeckSlot[], after: readonly DeckSlot[]): number {
  const keys = (deck: readonly DeckSlot[]) =>
    deck.flatMap((s) => fusionElementsOf(s).map((e) => `${s.skillId}+${e}`));
  const existing = new Set(keys(before));
  return keys(after).filter((key) => !existing.has(key)).length;
}

export interface DeckCheck {
  classId: ClassId;
  /** Meilleur niveau atteint (voir unlockLevel). */
  level: number;
  unlockedElements: readonly ElementId[];
  /** Niveau de la Tour d'alchimie (0 : pas construite). */
  alchemyLevel: number;
  /** Héritages du compte : évolution de la classe (4e active et double fusion de l'Archimage). */
  heritageCount?: number;
  deck: readonly DeckSlot[];
}

/** Vérifie un deck ; renvoie la première erreur trouvée, ou null s'il est valide. */
export function validateDeck(data: { skills: SkillsData }, input: DeckCheck): DeckError | null {
  const { deck } = input;
  const tier = evolutionTier(input.heritageCount ?? 0);
  const extraActive = hasExtraActive(input.classId, tier);
  const doubleFusion = hasDoubleFusion(input.classId, tier);
  const positions = new Set(deck.map((s) => s.position));
  const size = DECK_SIZE + (extraActive ? 1 : 0);
  if (deck.length > size || positions.size !== deck.length) return 'INVALID_DECK';

  const bases = new Set<string>();
  let ultimates = 0;
  let fusions = 0;
  let damaging = 0;
  for (const slot of deck) {
    const skill = byId(data.skills.catalog, slot.skillId);
    if (!skill || !Number.isInteger(slot.position) || slot.position < 0) return 'INVALID_DECK';
    if (slot.position >= size) return 'INVALID_DECK';
    const passiveSlot = !isActivePosition(slot.position);
    if (passiveSlot !== (skill.family === 'passive')) return 'INVALID_DECK';
    if (skill.classId !== null && skill.classId !== input.classId) return 'INVALID_DECK';
    if (!isSkillUnlocked(skill, input.level, input.unlockedElements)) return 'SKILL_LOCKED';
    if (bases.has(skill.baseId)) return 'DUPLICATE_SKILL';
    bases.add(skill.baseId);
    if (skill.ultimate) ultimates += 1;
    if (skill.family === 'attack' || (skill.family === 'support' && skill.power > 0)) damaging += 1;
    if (slot.fusionElement) {
      if (!canBeFused(skill) || input.alchemyLevel < 1) return 'FUSION_LOCKED';
      if (!input.unlockedElements.includes(slot.fusionElement)) return 'FUSION_LOCKED';
      if (!fusionOf(data, skill.element, slot.fusionElement)) return 'FUSION_LOCKED';
      fusions += 1;
    }
    if (slot.fusionElement2) {
      // Archimage : un deuxième élément, différent du premier, qui fusionne aussi avec la compétence.
      if (!doubleFusion || !slot.fusionElement) return 'FUSION_LOCKED';
      if (slot.fusionElement2 === slot.fusionElement) return 'FUSION_LOCKED';
      if (!input.unlockedElements.includes(slot.fusionElement2)) return 'FUSION_LOCKED';
      if (!fusionOf(data, skill.element, slot.fusionElement2)) return 'FUSION_LOCKED';
    }
  }
  if (damaging === 0) return 'INVALID_DECK';
  if (ultimates > data.skills.params.maxUltimates) return 'TOO_MANY_ULTIMATES';
  // Archimage : toutes ses actives peuvent être fusionnées, quel que soit le niveau de la tour.
  if (!doubleFusion && fusions > maxFusions(input.alchemyLevel)) return 'TOO_MANY_FUSIONS';
  return null;
}

/**
 * Conditions de l'héritage (décision du 19/10/2026) : un héros au niveau maximum, et la tour conquise
 * (le dernier étage battu). L'héritage remet la tour à zéro : pour le suivant, il faut la reconquérir.
 */
export function heritageStatus(save: {
  characters: readonly { level: number }[];
  highestFloorCleared: number;
}) {
  const heroReady = save.characters.some((c) => c.level >= MAX_HERO_LEVEL);
  const towerReady = save.highestFloorCleared >= TOWER_FLOORS;
  return { heroReady, towerReady, ready: heroReady && towerReady };
}

export function canInherit(save: Parameters<typeof heritageStatus>[0]): boolean {
  return heritageStatus(save).ready;
}
