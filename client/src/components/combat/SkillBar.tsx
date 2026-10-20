import { byId, fusionOf, type CombatView, type ElementId } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { elementStyle } from '../../game/elements.ts';
import { t } from '../../i18n/index.ts';
import { ElementBadge, FusionBadge } from '../ElementBadge.tsx';
import { PixelImage } from '../PixelImage.tsx';
import { Tooltip } from '../Tooltip.tsx';

type Skill = (typeof gameData.skills.catalog)[number];

const TARGETS: Record<
  Skill['target'],
  'skill.target.single' | 'skill.target.area' | 'skill.target.self' | 'skill.target.team'
> = {
  single: 'skill.target.single',
  area: 'skill.target.area',
  self: 'skill.target.self',
  team: 'skill.target.team',
};

/**
 * Infobulle d'une compétence : élément (ou fusion), puissance, recharge, cible, effet, déblocage.
 * `fusion2` : deuxième fusion de l'Archimage.
 */
export function SkillTooltip({
  skill,
  fusion = null,
  fusion2 = null,
}: {
  skill: Skill;
  fusion?: ElementId | null;
  fusion2?: ElementId | null;
}) {
  const fused = fusion ? fusionOf(gameData, skill.element, fusion) : null;
  const fused2 = fused && fusion2 ? fusionOf(gameData, skill.element, fusion2) : null;
  const fusionCount = (fused ? 1 : 0) + (fused2 ? 1 : 0);
  const fusedPower =
    Math.round(skill.power * gameData.skills.params.fusionPowerBonus ** fusionCount * 100) / 100;
  const names = [fused?.name, fused2?.name].filter(Boolean).join(' + ');
  return (
    <div className="tooltip-body">
      <strong>{fused ? `${skill.name} · ${names}` : skill.name}</strong>
      <span>
        {t('tower.element')} :{' '}
        {fused && fusion ? (
          <>
            <FusionBadge a={skill.element} b={fusion} name={fused.name} />
            {fused2 && fusion2 && <FusionBadge a={skill.element} b={fusion2} name={fused2.name} />}
          </>
        ) : (
          <ElementBadge element={skill.element} />
        )}
      </span>
      {skill.family !== 'passive' && (
        <>
          <span>
            {fused
              ? t('skill.fusionPower', { power: fusedPower })
              : t('skill.power', { power: skill.power })}
          </span>
          <span>
            {skill.cooldown === 0
              ? t('skill.noCooldown')
              : t('skill.cooldown', { rounds: skill.cooldown ?? 0 })}
          </span>
          <span>{t(TARGETS[skill.target])}</span>
        </>
      )}
      <span>{skill.baseEffect}</span>
      {fused ? (
        <>
          <span className="unique-passive">
            {t('skill.fusion', { name: fused.name, effect: fused.combatEffect })}
          </span>
          {fused2 && (
            <span className="unique-passive">
              {t('skill.fusion', { name: fused2.name, effect: fused2.combatEffect })}
            </span>
          )}
        </>
      ) : (
        skill.elementEffect && (
          <span className="muted">{t('skill.elementEffect', { effect: skill.elementEffect })}</span>
        )
      )}
      <span className="muted">
        {skill.unlockFloor > 0
          ? t('skill.unlockLevelFloor', { level: skill.requiredLevel, floor: skill.unlockFloor })
          : t('skill.unlockLevel', { level: skill.requiredLevel })}
      </span>
    </div>
  );
}

interface Props {
  hero: CombatView['heroes'][number];
  selectedSkillId: string | null;
  disabled: boolean;
  onSelect: (skillId: string) => void;
  /** Compétence que ce héros vient de lancer (léger encadré pendant la relecture). */
  justUsedSkillId?: string | null;
}

/**
 * Compétences du héros sélectionné, avec leur recharge ; les passifs suivent, au même format.
 * Toutes les cartes ont la même taille, quel que soit leur contenu.
 */
export function SkillBar({
  hero,
  selectedSkillId,
  disabled,
  onSelect,
  justUsedSkillId = null,
}: Props) {
  const skillOf = (id: string) => byId(gameData.skills.catalog, id)!;
  return (
    <div className="skill-bar">
      {hero.skills.map((slot) => {
        const skill = skillOf(slot.skillId);
        const ready = slot.remaining === 0;
        const fused = slot.fusion ? fusionOf(gameData, skill.element, slot.fusion) : null;
        const fused2 =
          fused && slot.fusion2 ? fusionOf(gameData, skill.element, slot.fusion2) : null;
        return (
          <Tooltip
            key={slot.skillId}
            content={
              <SkillTooltip skill={skill} fusion={slot.fusion ?? null} fusion2={slot.fusion2} />
            }
          >
            <button
              type="button"
              className={`skill-button${selectedSkillId === slot.skillId ? ' selected' : ''}${justUsedSkillId === slot.skillId ? ' just-used' : ''}`}
              style={elementStyle(skill.element)}
              aria-disabled={disabled || !ready}
              onClick={() => !disabled && ready && onSelect(slot.skillId)}
            >
              <PixelImage src={skill.image} alt="" size={32} />
              <span className="skill-name">{skill.name}</span>
              {/* Ligne réservée même sans fusion : la carte garde sa hauteur. */}
              <span className="skill-fusion">
                {[fused?.name, fused2?.name].filter(Boolean).join(' + ')}
              </span>
              <span className="skill-cooldown">
                {ready
                  ? slot.cooldown === 0
                    ? '∞'
                    : t('skill.ready')
                  : t('skill.wait', { rounds: slot.remaining })}
              </span>
            </button>
          </Tooltip>
        );
      })}
      {hero.passives.map((id) => {
        const skill = skillOf(id);
        return (
          <Tooltip key={id} content={<SkillTooltip skill={skill} />}>
            <span className="skill-button passive" style={elementStyle(skill.element)} tabIndex={0}>
              <PixelImage src={skill.image} alt="" size={32} />
              <span className="skill-name">{skill.name}</span>
              <span className="skill-fusion" />
              <span className="skill-cooldown">{t('team.passiveSlot')}</span>
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
