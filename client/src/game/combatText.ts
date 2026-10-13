/** Textes du journal de combat (gabarits dans fr.json). */
import type { CombatEvent, CombatView } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { t } from '../i18n/index.ts';

export function combatantName(view: CombatView | null, id: string | null): string {
  if (!id) return '';
  const c = view && [...view.heroes, ...view.monsters].find((x) => x.id === id);
  if (!c) return id.startsWith('h') ? t('combat.hero') : t('combat.monster');
  return c.classId ? t(`class.name.${c.classId}`) : c.name;
}

export function skillName(skillId: string): string {
  return gameData.skills.catalog.find((s) => s.id === skillId)?.name ?? skillId;
}

export function alterationName(id: string): string {
  return gameData.monsters.alterations.find((a) => a.id === id)?.name ?? id;
}

/** Phrase du journal pour un événement (null : pas de ligne). */
export function describeEvent(event: CombatEvent, view: CombatView | null): string | null {
  const name = (id: string | null) => combatantName(view, id);
  switch (event.type) {
    case 'round':
      return t('combat.log.round', {
        round: event.round,
        side: t(event.first === 'hero' ? 'combat.side.heroes' : 'combat.side.monsters'),
        hero: event.heroInitiative,
        monster: event.monsterInitiative,
      });
    case 'wave':
      // En chasse, les vagues s'enchaînent sans fin : pas de total.
      return view?.mode === 'hunt'
        ? t('combat.log.waveHunt', { wave: event.wave })
        : t('combat.log.wave', { wave: event.wave, total: event.total });
    case 'action':
      return event.skillId
        ? t('combat.log.skill', { actor: name(event.actorId), skill: skillName(event.skillId) })
        : t('combat.log.attack', { actor: name(event.actorId) });
    case 'damage':
      return event.cause === 'alteration'
        ? t('combat.log.dot', {
            target: name(event.targetId),
            amount: event.amount,
            alteration: alterationName(event.alterationId ?? ''),
          })
        : t(event.critical ? 'combat.log.critical' : 'combat.log.damage', {
            target: name(event.targetId),
            amount: event.amount,
          }) +
            (event.elementMultiplier > 1
              ? ` ${t('combat.log.effective')}`
              : event.elementMultiplier < 1
                ? ` ${t('combat.log.resisted')}`
                : '');
    case 'miss':
      return t('combat.log.miss', { source: name(event.sourceId), target: name(event.targetId) });
    case 'heal':
      return t('combat.log.heal', { target: name(event.targetId), amount: event.amount });
    case 'alteration':
      return t('combat.log.alteration', {
        target: name(event.targetId),
        alteration: alterationName(event.alterationId),
        stacks: event.stacks,
      });
    case 'alterationEnd':
      return null;
    case 'resisted':
      return t('combat.log.statusResisted', {
        target: name(event.targetId),
        alteration: alterationName(event.alterationId),
      });
    case 'stunned':
      return t('combat.log.stunned', {
        target: name(event.targetId),
        alteration: alterationName(event.alterationId),
      });
    case 'death':
      return t('combat.log.death', { target: name(event.targetId) });
    case 'end':
      return t(`combat.log.${event.outcome}`);
  }
}
