import type { CombatView } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { t } from '../../i18n/index.ts';
import { PixelImage } from '../PixelImage.tsx';
import { Tooltip } from '../Tooltip.tsx';

type Skill = (typeof gameData.skills.catalog)[number];

const TARGETS: Record<
  Skill['target'],
  'skill.target.single' | 'skill.target.area' | 'skill.target.self'
> = {
  single: 'skill.target.single',
  area: 'skill.target.area',
  self: 'skill.target.self',
};

/** Infobulle d'une compétence : élément, puissance, recharge, cible, effet, déblocage. */
export function SkillTooltip({ skill }: { skill: Skill }) {
  const element = gameData.elements.elements.find((e) => e.id === skill.element);
  return (
    <div className="tooltip-body">
      <strong>{skill.name}</strong>
      <span>
        {t('tower.element')} : {element?.name}
      </span>
      {skill.family !== 'passive' && (
        <>
          <span>{t('skill.power', { power: skill.power })}</span>
          <span>
            {skill.cooldown === 0
              ? t('skill.noCooldown')
              : t('skill.cooldown', { rounds: skill.cooldown ?? 0 })}
          </span>
          <span>{t(TARGETS[skill.target])}</span>
        </>
      )}
      <span>{skill.baseEffect}</span>
      {skill.elementEffect && <span className="muted">{skill.elementEffect}</span>}
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
}

/** Compétences du héros sélectionné, avec leur recharge. Les passifs sont rappelés à côté. */
export function SkillBar({ hero, selectedSkillId, disabled, onSelect }: Props) {
  const skillOf = (id: string) => gameData.skills.catalog.find((s) => s.id === id)!;
  return (
    <div className="skill-bar">
      {hero.skills.map((slot) => {
        const skill = skillOf(slot.skillId);
        const ready = slot.remaining === 0;
        return (
          <Tooltip key={slot.skillId} content={<SkillTooltip skill={skill} />}>
            <button
              type="button"
              className={`skill-button${selectedSkillId === slot.skillId ? ' selected' : ''}`}
              aria-disabled={disabled || !ready}
              onClick={() => !disabled && ready && onSelect(slot.skillId)}
            >
              <PixelImage src={skill.image} alt="" size={32} />
              <span>{skill.name}</span>
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
            <span className="skill-passive" tabIndex={0}>
              <PixelImage src={skill.image} alt="" size={24} />
              {skill.name}
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
