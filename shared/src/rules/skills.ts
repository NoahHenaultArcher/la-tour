/**
 * Compétences : recharge calculée, puissance par tour, déblocage.
 * Formules de Competences_RPG_Tour.xlsx (Bases col. H et P, Catalogue col. S, Paramètres).
 */
import type { ClassId, ElementId } from '../constants.ts';
import type { SkillsData } from '../data/schemas.ts';
import { excelRound } from './math.ts';

export type SkillBase = SkillsData['bases'][number];
export type Skill = SkillsData['catalog'][number];

/**
 * Deck de départ d'une classe : 2 actives sans recharge (positions 0 et 1) et 1 passif (position 3),
 * en élément Neutre, d'après le kit de l'onglet Déblocages.
 */
export function starterDeckFor(
  data: { skills: SkillsData },
  classId: ClassId,
): { position: number; skillId: string }[] {
  const kit = data.skills.starterKits.find((k) => k.classId === classId);
  if (!kit) throw new Error(`Kit de départ introuvable pour ${classId}`);
  const skillIdOf = (name: string) => {
    const base = data.skills.bases.find((b) => b.classId === classId && b.name === name);
    const skill =
      base && data.skills.catalog.find((s) => s.baseId === base.id && s.element === 'neutral');
    if (!skill) throw new Error(`Compétence de départ introuvable : ${name}`);
    return skill.id;
  };
  return [
    { position: 0, skillId: skillIdOf(kit.active1) },
    { position: 1, skillId: skillIdOf(kit.active2) },
    { position: 3, skillId: skillIdOf(kit.passive) },
  ];
}

/** Score de recharge = puissance × poids de zone + valeur d'effet. */
export function cooldownScore(data: SkillsData, base: SkillBase): number | null {
  if (base.family === 'passive' || base.effectValue === null) return null;
  const weight = base.target === 'area' ? data.params.areaScoreWeight : 1;
  return excelRound(base.power * weight + base.effectValue, 2);
}

/**
 * Recharge en manches : 0 pour le kit de départ, 3 pour une ultime,
 * sinon 1, 2 ou 3 selon le score. null pour un passif.
 */
export function cooldownFor(data: SkillsData, base: SkillBase): number | null {
  if (base.family === 'passive') return null;
  const p = data.params;
  if (base.requiredLevel <= p.noCooldownLevel) return 0;
  if (base.ultimate) return 3;
  const score = cooldownScore(data, base)!;
  if (score <= p.cooldown1MaxScore) return 1;
  if (score <= p.cooldown2MaxScore) return 2;
  return 3;
}

/** Puissance par tour (vague) : puissance × ennemis touchés ÷ recharge. */
export function powerPerTurn(
  data: SkillsData,
  skill: Pick<Skill, 'cooldown' | 'power' | 'target'>,
): number {
  if (skill.cooldown === null) return 0;
  const targets = skill.target === 'area' ? data.params.enemiesPerWave : 1;
  return (skill.power * targets) / Math.max(1, skill.cooldown);
}

/** Une compétence est disponible si le héros a le niveau requis et que son élément est débloqué. */
export function isSkillUnlocked(
  skill: Skill,
  heroLevel: number,
  unlockedElements: readonly ElementId[],
): boolean {
  return skill.requiredLevel <= heroLevel && unlockedElements.includes(skill.element);
}
