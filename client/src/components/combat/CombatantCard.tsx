import type { CombatView } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { CLASS_IMAGES } from '../../game/assets.ts';
import { alterationName, combatantName } from '../../game/combatText.ts';
import { formatNumber, t } from '../../i18n/index.ts';
import type { Floater } from '../../stores/combat.ts';
import { PixelImage } from '../PixelImage.tsx';
import { Tooltip } from '../Tooltip.tsx';

type CombatantView = CombatView['heroes'][number];

const elementName = (id: string) => gameData.elements.elements.find((e) => e.id === id)?.name ?? id;
const percent = (value: number) => `${Math.round(value * 100)} %`;

interface MonsterTooltipProps {
  monsterId: string;
  element: string;
  /** Niveau affiché (« Niveau 12 », ou une plage en zone de chasse). */
  levelText: string;
}

/** Infobulle d'un monstre : niveau, élément, faiblesses et résistances, altérations. */
export function MonsterTooltip({ monsterId, element: elementId, levelText }: MonsterTooltipProps) {
  const monster = gameData.monsters.monsters.find((m) => m.id === monsterId);
  const element = gameData.elements.elements.find((e) => e.id === elementId);
  const rank = gameData.monsters.ranks.find((r) => r.id === monster?.rank);
  const role = gameData.monsters.roles.find((r) => r.id === monster?.role);
  return (
    <div className="tooltip-body">
      <strong>{monster?.name ?? monsterId}</strong>
      <span>
        {levelText} · {rank?.name} · {role?.name}
      </span>
      <span>
        {t('tower.element')} : {element?.name}
      </span>
      <span>
        {t('combat.weakTo')} :{' '}
        {element?.weakAgainst.length ? element.weakAgainst.map(elementName).join(', ') : '—'}
      </span>
      <span>
        {t('combat.resists')} :{' '}
        {element?.resists.length ? element.resists.map(elementName).join(', ') : '—'}
      </span>
      {monster && monster.alterations.length > 0 && (
        <span>
          {t('combat.inflicts')} :{' '}
          {monster.alterations
            .map((a) => `${alterationName(a.id)} (${percent(a.chance)})`)
            .join(', ')}
        </span>
      )}
      {role && <span className="muted">{role.behavior}</span>}
    </div>
  );
}

/** Infobulle d'un héros : ses statistiques de combat. */
function HeroTooltip({ c }: { c: CombatantView }) {
  const s = c.stats;
  return (
    <div className="tooltip-body">
      <strong>{t(`class.name.${c.classId!}`)}</strong>
      <span>{t('combat.level', { level: c.level })}</span>
      <span>
        {t('combat.stat.attack', {
          value: formatNumber(c.attackType === 'magical' ? s.magic : s.strength),
        })}
      </span>
      <span>
        {t('combat.stat.defense', {
          resistance: formatNumber(s.resistance),
          armor: formatNumber(s.armor),
        })}
      </span>
      <span>{t('combat.stat.initiative', { value: formatNumber(s.initiative) })}</span>
      <span>
        {t('combat.stat.crit', { chance: percent(s.critChance), damage: percent(s.critDamage) })}
      </span>
    </div>
  );
}

interface Props {
  c: CombatantView;
  view: CombatView;
  active: boolean;
  selected?: boolean;
  targetable?: boolean;
  onClick?: () => void;
  floaters: Floater[];
}

export function CombatantCard({ c, view, active, selected, targetable, onClick, floaters }: Props) {
  const image =
    c.side === 'hero'
      ? CLASS_IMAGES[c.classId!]
      : (gameData.monsters.monsters.find((m) => m.id === c.refId)?.image ?? null);
  const ratio = Math.max(0, c.hp / c.stats.maxHp);
  const dead = c.hp <= 0;
  return (
    <Tooltip
      content={
        c.side === 'hero' ? (
          <HeroTooltip c={c} />
        ) : (
          <MonsterTooltip
            monsterId={c.refId!}
            element={c.element}
            levelText={t('combat.level', { level: c.level })}
          />
        )
      }
    >
      <button
        type="button"
        className={[
          'combatant',
          c.side,
          dead ? 'dead' : '',
          active ? 'active' : '',
          selected ? 'selected' : '',
          targetable ? 'targetable' : '',
          c.isBoss ? 'boss' : '',
        ].join(' ')}
        aria-disabled={!onClick || dead}
        onClick={() => !dead && onClick?.()}
      >
        <div className="combatant-image">
          <PixelImage src={image} alt={combatantName(view, c.id)} size={c.isBoss ? 112 : 80} />
          {floaters.map((f) => (
            <span key={f.id} className={`floater ${f.kind}`}>
              {f.text}
            </span>
          ))}
        </div>
        <span className="combatant-name">
          {combatantName(view, c.id)}{' '}
          <span className="muted">{t('combat.levelShort', { level: c.level })}</span>
        </span>
        <span className="hp-bar" aria-label={t('combat.hp', { hp: c.hp, max: c.stats.maxHp })}>
          <span
            className={`hp-fill${ratio < 0.3 ? ' low' : ''}`}
            style={{ width: `${ratio * 100}%` }}
          />
          <span className="hp-text">
            {formatNumber(c.hp)} / {formatNumber(c.stats.maxHp)}
          </span>
        </span>
        {(c.alterations.length > 0 || c.stunnedThisPhase) && (
          <span className="alteration-list">
            {c.stunnedThisPhase && (
              <span className="alteration stunned">{t('combat.stunned')}</span>
            )}
            {c.alterations.map((a) => (
              <span key={a.id} className="alteration">
                {alterationName(a.id)}
                {a.stacks > 1 ? ` ×${a.stacks}` : ''}
              </span>
            ))}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
