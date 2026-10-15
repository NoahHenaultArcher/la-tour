/** Aide à l'affichage des reliques et œufs de dragon (les règles sont dans shared). */
import {
  RELIC_RULES,
  byId,
  type RelicEffect,
  type RelicInfo,
  type RelicStat,
  type SaveDto,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { t, type TranslationKey } from '../i18n/index.ts';
import { elementName } from './elements.ts';

export const RELIC_FRAMES = {
  relic: 'ui/cadre_relique.png',
  egg: 'ui/cadre_oeuf.png',
} as const;

const percent = (value: number) =>
  `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

/** Reliques équipées, dans l'ordre des emplacements. */
export function equippedRelicIds(save: SaveDto): string[] {
  return save.relics
    .filter((r) => r.slot !== null)
    .sort((a, b) => a.slot! - b.slot!)
    .map((r) => r.relicId);
}

/** Relique équipée dans chaque emplacement (null : vide). */
export function relicSlots(save: SaveDto): (string | null)[] {
  return Array.from(
    { length: RELIC_RULES.slots },
    (_, slot) => save.relics.find((r) => r.slot === slot)?.relicId ?? null,
  );
}

/** Boss ou dragon qui lâche la relique, et son étage. */
export function relicSource(relic: RelicInfo): { name: string; floor: number } {
  const monster = byId(gameData.monsters.monsters, relic.monsterId);
  return { name: monster?.name ?? relic.monsterId, floor: monster?.zoneFloor ?? 0 };
}

const STAT_LABELS: Record<RelicStat, TranslationKey> = {
  vitality: 'relic.stat.vitality',
  strength: 'team.stat.strength',
  magic: 'team.stat.magic',
  resistance: 'team.stat.resistance',
  armor: 'team.stat.armor',
  agility: 'team.stat.agility',
  initiative: 'team.stat.initiative',
};

/** Effets d'une relique, une phrase par effet (valables pour toute l'équipe). */
export function relicEffectLines(effect: RelicEffect): string[] {
  const lines: string[] = [];
  for (const [stat, value] of Object.entries(effect.stats ?? {}) as [RelicStat, number][])
    lines.push(
      t('relic.effect.stat', {
        stat: t(STAT_LABELS[stat]),
        value: percent(value),
      }),
    );
  const add = (key: TranslationKey, value: number | undefined) => {
    if (value) lines.push(t(key, { value: percent(value) }));
  };
  add('relic.effect.critChance', effect.critChance);
  add('relic.effect.critDamage', effect.critDamage);
  add('relic.effect.dodge', effect.dodge);
  add('relic.effect.statusResistance', effect.statusResistance);
  add('relic.effect.healingBonus', effect.healingBonus);
  add('relic.effect.damageDealt', effect.damageDealt);
  add('relic.effect.damageTaken', effect.damageTaken);
  add('relic.effect.regen', effect.regen);
  add('relic.effect.lifesteal', effect.lifesteal);
  add('relic.effect.alterationChance', effect.alterationChance);
  add('relic.effect.gold', effect.gold);
  if (effect.startShield)
    lines.push(
      t('relic.effect.startShield', {
        value: percent(effect.startShield),
        rounds: RELIC_RULES.startShieldRounds,
      }),
    );
  add('relic.effect.taunt', effect.taunt);
  if (effect.revive)
    lines.push(t('relic.effect.revive', { value: percent(RELIC_RULES.reviveShare) }));
  if (effect.element)
    lines.push(
      t('relic.effect.egg', {
        element: elementName(effect.element),
        skills: percent(RELIC_RULES.eggElementDamage),
        fusions: percent(RELIC_RULES.eggFusionDamage),
      }),
    );
  return lines;
}
