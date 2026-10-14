/**
 * Deck d'un héros (5 compétences : 3 actives dont une seule ultime, 2 passives), déblocages
 * et fusions de la Tour d'alchimie. Vérifié par le serveur à chaque modification.
 */
import { ALCHEMY } from '../balance.ts';
import type { ClassId, ElementId } from '../constants.ts';
import type { SkillsData } from '../data/schemas.ts';
import { isSkillUnlocked, type Skill } from './skills.ts';
import { byId } from './lookup.ts';

/** Positions du deck : 0 à 2 actives, 3 et 4 passives. */
export const ACTIVE_POSITIONS = [0, 1, 2] as const;
export const PASSIVE_POSITIONS = [3, 4] as const;
export const DECK_SIZE = 5;

export interface DeckSlot {
  position: number;
  skillId: string;
  /** Second élément d'une fusion (compétence d'attaque active seulement). */
  fusionElement?: ElementId | null;
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
 */
export function newFusionCount(before: readonly DeckSlot[], after: readonly DeckSlot[]): number {
  const existing = new Set(
    before.filter((s) => s.fusionElement).map((s) => `${s.skillId}+${s.fusionElement}`),
  );
  return after.filter((s) => s.fusionElement && !existing.has(`${s.skillId}+${s.fusionElement}`))
    .length;
}

export interface DeckCheck {
  classId: ClassId;
  /** Meilleur niveau atteint (voir unlockLevel). */
  level: number;
  unlockedElements: readonly ElementId[];
  /** Niveau de la Tour d'alchimie (0 : pas construite). */
  alchemyLevel: number;
  deck: readonly DeckSlot[];
}

/** Vérifie un deck ; renvoie la première erreur trouvée, ou null s'il est valide. */
export function validateDeck(data: { skills: SkillsData }, input: DeckCheck): DeckError | null {
  const { deck } = input;
  const positions = new Set(deck.map((s) => s.position));
  if (deck.length > DECK_SIZE || positions.size !== deck.length) return 'INVALID_DECK';

  const bases = new Set<string>();
  let ultimates = 0;
  let fusions = 0;
  let damaging = 0;
  for (const slot of deck) {
    const skill = byId(data.skills.catalog, slot.skillId);
    if (!skill || !Number.isInteger(slot.position) || slot.position < 0) return 'INVALID_DECK';
    if (slot.position >= DECK_SIZE) return 'INVALID_DECK';
    const passiveSlot = slot.position >= ACTIVE_POSITIONS.length;
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
  }
  if (damaging === 0) return 'INVALID_DECK';
  if (ultimates > data.skills.params.maxUltimates) return 'TOO_MANY_ULTIMATES';
  if (fusions > maxFusions(input.alchemyLevel)) return 'TOO_MANY_FUSIONS';
  return null;
}

/** Héritage : disponible dès qu'un héros a atteint le niveau maximum. */
export function canInherit(characters: readonly { level: number }[], maxLevel: number): boolean {
  return characters.some((c) => c.level >= maxLevel);
}
