import {
  COMBAT_RULES,
  DRAGON_RULES,
  byId,
  fusionOf,
  type CombatView,
  type ElementId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import type { ReactNode } from 'react';
import { CLASS_IMAGES } from '../../game/assets.ts';
import { alterationName, combatantName } from '../../game/combatText.ts';
import { elementStyle } from '../../game/elements.ts';
import { formatNumber, t } from '../../i18n/index.ts';
import type { Floater, Impact } from '../../stores/combat.ts';
import { ElementBadge } from '../ElementBadge.tsx';
import { PixelImage } from '../PixelImage.tsx';
import { Tooltip } from '../Tooltip.tsx';

type CombatantView = CombatView['heroes'][number];
type AlterationView = CombatantView['alterations'][number];

/** Effets affichés sur la carte (s'il y en a plus, les suivants sont regroupés dans « +N »). */
const MAX_EFFECTS = 3;

const percent = (value: number) => `${Math.round(value * 100)} %`;

/** Liste de pastilles d'éléments (ou un tiret si vide). */
function ElementList({ ids }: { ids: readonly ElementId[] }) {
  if (ids.length === 0) return <>—</>;
  return (
    <span className="element-list">
      {ids.map((id) => (
        <ElementBadge key={id} element={id} />
      ))}
    </span>
  );
}

interface MonsterTooltipProps {
  monsterId: string;
  element: ElementId;
  /** Niveau affiché (« Niveau 12 », ou une plage en zone de chasse). */
  levelText: string;
}

/** Comportement des dragons, d'après leurs réglages (balance.ts). */
function dragonBehavior(): string {
  return t('combat.dragonBehavior', {
    actions: DRAGON_RULES.actionsPerRound,
    every: COMBAT_RULES.dragonBreathEvery,
    thresholds: DRAGON_RULES.summonThresholds.map((s) => percent(s)).join(' et '),
    fury: percent(DRAGON_RULES.furyThreshold),
    bonus: percent(DRAGON_RULES.furyDamageBonus),
    furyEvery: DRAGON_RULES.furyBreathEvery,
  });
}

/** Infobulle d'un monstre : niveau, élément, faiblesses et résistances, altérations. */
export function MonsterTooltip({ monsterId, element: elementId, levelText }: MonsterTooltipProps) {
  const monster = byId(gameData.monsters.monsters, monsterId);
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
        {t('tower.element')} : <ElementBadge element={elementId} />
      </span>
      <span>
        {t('combat.weakTo')} : <ElementList ids={element?.weakAgainst ?? []} />
      </span>
      <span>
        {t('combat.resists')} : <ElementList ids={element?.resists ?? []} />
      </span>
      {monster && monster.alterations.length > 0 && (
        <span>
          {t('combat.inflicts')} :{' '}
          {monster.alterations
            .map((a) => `${alterationName(a.id)} (${percent(a.chance)})`)
            .join(', ')}
        </span>
      )}
      {/* Les dragons ne sont plus de simples « sacs à PV » (phase 9) : description du jeu. */}
      {role && (
        <span className="muted">{role.id === 'dragon' ? dragonBehavior() : role.behavior}</span>
      )}
    </div>
  );
}

/** Infobulle d'une altération en cours : effet, manches restantes, piles, dégâts, limites. */
function AlterationTooltip({ alteration }: { alteration: AlterationView }) {
  const info = gameData.monsters.alterations.find((a) => a.id === alteration.id);
  if (!info) return <strong>{alteration.id}</strong>;
  return (
    <div className="tooltip-body">
      <strong>{info.name}</strong>
      <span className="muted">
        {info.category} · <ElementBadge element={info.element} />
      </span>
      <span>{info.effect}</span>
      <span>{t('alteration.remaining', { rounds: alteration.remaining })}</span>
      {info.maxStacks > 1 && (
        <span>{t('alteration.stacks', { stacks: alteration.stacks, max: info.maxStacks })}</span>
      )}
      {alteration.damagePerStack > 0 && (
        <span>
          {t('alteration.damage', { amount: formatNumber(Math.round(alteration.damagePerStack)) })}
        </span>
      )}
      <span className="muted">{info.limit}</span>
      {info.onBoss !== 'Identique.' && (
        <span className="muted">{t('alteration.onBoss', { text: info.onBoss })}</span>
      )}
    </div>
  );
}

type ModifierView = CombatantView['modifiers'][number];

const signed = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value * 100)} %`;
const STAT_LABELS = {
  strength: 'team.stat.strength',
  magic: 'team.stat.magic',
  resistance: 'team.stat.resistance',
  armor: 'team.stat.armor',
  agility: 'team.stat.agility',
  accuracy: 'team.stat.accuracy',
} as const;

/** Nom d'un effet temporaire : la compétence qui l'a posé (ou le passif). */
function modifierName(m: ModifierView): string {
  if (m.key === 'dragon:fury') return t('modifier.fury');
  if (m.key.startsWith('sunder:')) return t('modifier.sunder');
  const skill = m.skillId ? byId(gameData.skills.catalog, m.skillId) : null;
  if (!skill) return t(m.kind === 'buff' ? 'modifier.buff' : 'modifier.debuff');
  if (m.key.startsWith('fusion:')) {
    const [a, b] = m.key.slice('fusion:'.length).split('+') as [ElementId, ElementId];
    return fusionOf(gameData, a, b)?.name ?? skill.name;
  }
  return m.key.startsWith('element:')
    ? t('modifier.elementSuffix', { skill: skill.name })
    : skill.name;
}

/** Infobulle d'un bonus ou d'un malus : chaque effet, la durée et les piles. */
function ModifierTooltip({ modifier: m }: { modifier: ModifierView }) {
  const lines: string[] = [];
  for (const [stat, value] of Object.entries(m.stats ?? {}) as [keyof typeof STAT_LABELS, number][])
    lines.push(t('modifier.stat', { stat: t(STAT_LABELS[stat]), value: signed(value * m.stacks) }));
  if (m.critChance) lines.push(t('modifier.critChance', { value: signed(m.critChance) }));
  if (m.dodge) lines.push(t('modifier.dodge', { value: signed(m.dodge) }));
  if (m.damageDealt) lines.push(t('modifier.damageDealt', { value: signed(m.damageDealt) }));
  if (m.damageTaken) lines.push(t('modifier.damageTaken', { value: signed(m.damageTaken) }));
  if (m.reflect) lines.push(t('modifier.reflect', { value: percent(m.reflect) }));
  if (m.controlImmune) lines.push(t('modifier.controlImmune'));
  if (m.regen) lines.push(t('modifier.regen', { value: percent(m.regen) }));
  if (m.thorns) {
    lines.push(
      t('modifier.thorns', {
        chance: percent(m.thorns.chance),
        alteration: alterationName(m.thorns.alterationId),
      }),
    );
  }
  if (m.dot) lines.push(t('modifier.dot', { amount: formatNumber(m.dot) }));
  if (m.onAttackDamage)
    lines.push(t('modifier.onAttack', { amount: formatNumber(m.onAttackDamage) }));
  if (m.playsLast) lines.push(t('modifier.playsLast'));
  if (m.nextAttackBonus) lines.push(t('modifier.nextAttack', { value: signed(m.nextAttackBonus) }));
  if (m.nextAreaBonus) lines.push(t('modifier.nextArea', { value: signed(m.nextAreaBonus) }));
  if (m.reflectNextHit)
    lines.push(t('modifier.reflectNextHit', { value: percent(m.reflectNextHit) }));
  return (
    <div className="tooltip-body">
      <strong>{modifierName(m)}</strong>
      <span className="muted">{t(m.kind === 'buff' ? 'modifier.buff' : 'modifier.debuff')}</span>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
      {m.remaining < 90 && <span>{t('modifier.remaining', { rounds: m.remaining })}</span>}
      {m.maxStacks > 1 && (
        <span>{t('modifier.stacks', { stacks: m.stacks, max: m.maxStacks })}</span>
      )}
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
  /** Impacts reçus (éclat coloré, secousse). */
  impacts?: Impact[];
  /** Numéro de l'action en cours : relance l'élan quand ce combattant agit de nouveau. */
  actionSeq?: number;
}

export function CombatantCard({
  c,
  view,
  active,
  selected,
  targetable,
  onClick,
  floaters,
  impacts = [],
  actionSeq = 0,
}: Props) {
  const image =
    c.side === 'hero'
      ? CLASS_IMAGES[c.classId!]
      : (byId(gameData.monsters.monsters, c.refId)?.image ?? null);
  const ratio = Math.max(0, c.hp / c.stats.maxHp);
  const dead = c.hp <= 0;
  const clickable = !!onClick && !dead;
  const lastHit = impacts.filter((i) => i.kind !== 'heal').at(-1);
  // Bonus, malus et altérations : les premiers sont affichés, le reste dans « +N ».
  const effects: { key: string; label: string; node: ReactNode }[] = [
    ...c.modifiers.map((m) => {
      const label = `${modifierName(m)}${m.stacks > 1 ? ` ×${m.stacks}` : ''}`;
      return {
        key: `mod:${m.key}`,
        label,
        node: (
          <Tooltip key={m.key} content={<ModifierTooltip modifier={m} />}>
            <span className={`modifier ${m.kind}`}>{label}</span>
          </Tooltip>
        ),
      };
    }),
    ...(c.stunnedThisPhase
      ? [
          {
            key: 'stunned',
            label: t('combat.stunned'),
            node: (
              <Tooltip key="stunned" content={<span>{t('combat.stunnedHelp')}</span>}>
                <span className="alteration stunned">{t('combat.stunned')}</span>
              </Tooltip>
            ),
          },
        ]
      : []),
    ...c.alterations.map((a) => {
      const element = gameData.monsters.alterations.find((x) => x.id === a.id)?.element;
      const label = `${alterationName(a.id)}${a.stacks > 1 ? ` ×${a.stacks}` : ''}`;
      return {
        key: `alt:${a.id}`,
        label,
        node: (
          <Tooltip key={a.id} content={<AlterationTooltip alteration={a} />}>
            <span className="alteration" style={element ? elementStyle(element) : undefined}>
              {label}
            </span>
          </Tooltip>
        ),
      };
    }),
  ];
  // Au-delà de 3 effets : les 2 premiers et « +N » (3 éléments, donc 3 lignes au plus : rien n'est coupé).
  const shown = effects.length > MAX_EFFECTS ? MAX_EFFECTS - 1 : effects.length;
  const hidden = effects.slice(shown);
  return (
    // Une div plutôt qu'un bouton : les altérations ont leur propre infobulle à l'intérieur.
    <div
      className={[
        'combatant',
        c.side,
        dead ? 'dead' : '',
        active ? 'active' : '',
        selected ? 'selected' : '',
        targetable ? 'targetable' : '',
        c.isBoss ? 'boss' : '',
      ].join(' ')}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => clickable && onClick()}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
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
        <div className="combatant-image">
          {/* Les clés relancent les animations : élan à chaque action, secousse à chaque coup reçu. */}
          <span
            className={`lunge${active ? ' acting' : ''}`}
            key={active ? `a${actionSeq}` : 'idle'}
          >
            <span className="hit-shake" key={lastHit?.id ?? 'none'} data-hit={lastHit?.kind}>
              <PixelImage src={image} alt={combatantName(view, c.id)} size={c.isBoss ? 112 : 80} />
            </span>
          </span>
          {impacts.map((i) => (
            <span key={i.id} className={`burst ${i.kind}`} style={elementStyle(i.element)} />
          ))}
          {floaters.map((f) => (
            <span key={f.id} className={`floater ${f.kind}`}>
              {f.text}
            </span>
          ))}
        </div>
      </Tooltip>
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
          {c.shield > 0 && ` · ${t('combat.shield', { amount: formatNumber(c.shield) })}`}
        </span>
        {c.shield > 0 && (
          <span
            className="shield-fill"
            style={{ width: `${Math.min(100, (c.shield / c.stats.maxHp) * 100)}%` }}
          />
        )}
      </span>
      {/* Bande d'effets de hauteur fixe : la carte garde toujours la même taille. */}
      <span className="alteration-list">
        {effects.slice(0, shown).map((e) => e.node)}
        {hidden.length > 0 && (
          <Tooltip
            content={
              <div className="tooltip-body">
                {hidden.map((e) => (
                  <span key={e.key}>{e.label}</span>
                ))}
              </div>
            }
          >
            <span className="alteration more">+{hidden.length}</span>
          </Tooltip>
        )}
      </span>
    </div>
  );
}
