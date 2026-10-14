import { byId } from '@la-tour/shared';
/** Textes du journal de combat (gabarits dans fr.json). */
import type { CombatEvent, CombatView } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { t } from '../i18n/index.ts';

/** Multijoueur : pseudo du joueur de chaque héros (h0, h1…), renseigné par le salon. */
let heroNames: Record<string, string> = {};

export function setHeroNames(names: Record<string, string>): void {
  heroNames = names;
}

export function combatantName(view: CombatView | null, id: string | null): string {
  if (!id) return '';
  const c = view && [...view.heroes, ...view.monsters].find((x) => x.id === id);
  if (!c) return id.startsWith('h') ? (heroNames[id] ?? t('combat.hero')) : t('combat.monster');
  if (!c.classId) return c.name;
  const className = t(`class.name.${c.classId}`);
  return heroNames[c.id]
    ? t('combat.playerHero', { player: heroNames[c.id]!, hero: className })
    : className;
}

export function skillName(skillId: string): string {
  return byId(gameData.skills.catalog, skillId)?.name ?? skillId;
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
        : t(event.actorId.startsWith('h') ? 'combat.log.freeShot' : 'combat.log.attack', {
            actor: name(event.actorId),
          });
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
    case 'shield':
      return t('combat.log.shield', { target: name(event.targetId), amount: event.amount });
    case 'modifier':
      return t(event.kind === 'buff' ? 'combat.log.buff' : 'combat.log.debuff', {
        target: name(event.targetId),
        effect: event.skillId ? skillName(event.skillId) : t('modifier.sunder'),
      });
    case 'cleanse':
      return t('combat.log.cleanse', { target: name(event.targetId), count: event.count });
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
    case 'enrage':
      return t('combat.log.enrage', { target: name(event.targetId) });
    case 'summon':
      return t('combat.log.summon', {
        source: name(event.sourceId),
        monsters: event.monsterIds.map((id) => name(id)).join(', '),
      });
    case 'end':
      return t(`combat.log.${event.outcome}`);
  }
}
