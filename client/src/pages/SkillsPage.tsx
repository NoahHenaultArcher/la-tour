import {
  ELEMENT_IDS,
  PASSIVE_POSITIONS,
  byId,
  canBeFused,
  fusionCost,
  fusionOf,
  isSkillUnlocked,
  maxFusions,
  newFusionCount,
  unlockLevel,
  validateDeck,
  type CharacterDto,
  type DeckSlot,
  type ElementId,
  type SaveDto,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { SkillTooltip } from '../components/combat/SkillBar.tsx';
import { ElementBadge, FusionBadge } from '../components/ElementBadge.tsx';
import { PixelImage } from '../components/PixelImage.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { elementName, elementStyle } from '../game/elements.ts';
import { useVillageView } from '../game/village.ts';
import { errorMessage, formatNumber, t } from '../i18n/index.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';

type Skill = (typeof gameData.skills.catalog)[number];
type Draft = (Omit<DeckSlot, 'position'> | null)[];

const ALCHEMY_TOWER = 'tour_alchimie';
const skillOf = (id: string) => byId(gameData.skills.catalog, id)!;
const isPassiveSlot = (position: number) =>
  (PASSIVE_POSITIONS as readonly number[]).includes(position);

/** Deck enregistré → brouillon de 5 emplacements. */
function toDraft(character: CharacterDto): Draft {
  return [0, 1, 2, 3, 4].map((position) => {
    const slot = character.skills.find((s) => s.position === position);
    return slot ? { skillId: slot.skillId, fusionElement: slot.fusionElement } : null;
  });
}

function toSlots(draft: Draft): DeckSlot[] {
  return draft.flatMap((slot, position) =>
    slot ? [{ position, skillId: slot.skillId, fusionElement: slot.fusionElement ?? null }] : [],
  );
}

/** Page Compétences : choix du deck de chaque héros, variantes élémentaires et fusions. */
export function SkillsPage() {
  const save = useSession((s) => s.save)!;
  const [characterId, setCharacterId] = useState(save.characters[0]!.id);
  const [tab, setTab] = useState<'deck' | 'synergies'>('deck');
  const character = save.characters.find((c) => c.id === characterId) ?? save.characters[0]!;
  return (
    <div className="page">
      <TopBar />
      <main className="skills-page">
        <header className="team-header">
          <h1>{t('skills.title')}</h1>
          {save.characters.length > 1 && (
            <div className="tabs" role="tablist">
              {save.characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={c.id === character.id}
                  className={c.id === character.id ? 'toggled' : ''}
                  onClick={() => setCharacterId(c.id)}
                >
                  {t(`class.name.${c.classId}`)}
                </button>
              ))}
            </div>
          )}
          <div className="tabs skills-tabs" role="tablist">
            {(['deck', 'synergies'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'toggled' : ''}
                onClick={() => setTab(id)}
              >
                {t(`skills.tab.${id}`)}
              </button>
            ))}
          </div>
        </header>
        {/* Le deck reste monté (masqué) pour garder le brouillon en changeant d'onglet ;
            la clé le remet à zéro quand on change de héros. */}
        <div className="skills-tab" hidden={tab !== 'deck'}>
          <DeckEditor key={character.id} save={save} character={character} />
        </div>
        {tab === 'synergies' && <Synergies save={save} character={character} />}
      </main>
    </div>
  );
}

function DeckEditor({ save, character }: { save: SaveDto; character: CharacterDto }) {
  const setDeck = useSession((s) => s.setDeck);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const [draft, setDraft] = useState<Draft>(() => toDraft(character));
  const [selected, setSelected] = useState(0);
  const [pending, setPending] = useState(false);

  const level = unlockLevel(character);
  const unlocked = save.unlockedElements;
  const alchemyLevel = save.buildings[ALCHEMY_TOWER] ?? 0;
  const slots = toSlots(draft);
  const saved = toSlots(toDraft(character));
  const changed = JSON.stringify(slots) !== JSON.stringify(saved);
  const error = validateDeck(gameData, {
    classId: character.classId,
    level,
    unlockedElements: unlocked,
    alchemyLevel,
    deck: slots,
  });
  const newFusions = newFusionCount(saved, slots);
  const cost = fusionCost(alchemyLevel, newFusions);
  const missingEther = (view.resources.ether ?? 0) < cost.ether;
  const missingGold = save.gold < cost.gold;
  const fusionsUsed = slots.filter((s) => s.fusionElement).length;

  /** Place une compétence dans l'emplacement choisi (une seule version par compétence de base). */
  const place = (skill: Skill) => {
    setDraft((current) =>
      current.map((slot, position) => {
        if (position === selected) {
          const keepFusion = slot && skillOf(slot.skillId).baseId === skill.baseId;
          return { skillId: skill.id, fusionElement: keepFusion ? slot.fusionElement : null };
        }
        return slot && skillOf(slot.skillId).baseId === skill.baseId ? null : slot;
      }),
    );
  };
  const setFusion = (position: number, element: ElementId | null) =>
    setDraft((current) =>
      current.map((slot, i) =>
        i === position && slot ? { ...slot, fusionElement: element } : slot,
      ),
    );
  const clear = (position: number) =>
    setDraft((current) => current.map((slot, i) => (i === position ? null : slot)));

  const submit = async () => {
    setPending(true);
    try {
      await setDeck({
        characterId: character.id,
        deck: slots.map((s) => ({ ...s, fusionElement: s.fusionElement ?? null })),
      });
      notify('success', t('skills.saved'));
    } catch (e) {
      notify('error', errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  // Compétences proposées pour l'emplacement choisi : actives ou passives, regroupées par base.
  const passiveSlot = isPassiveSlot(selected);
  const candidates = gameData.skills.bases
    .filter((b) =>
      passiveSlot
        ? b.family === 'passive' && (b.classId === character.classId || b.classId === null)
        : b.family !== 'passive' && b.classId === character.classId,
    )
    .sort(
      (a, b) =>
        Number(a.classId === null) - Number(b.classId === null) ||
        a.requiredLevel - b.requiredLevel,
    );
  const inDeck = new Set(slots.map((s) => skillOf(s.skillId).baseId));

  return (
    <>
      <section className="panel">
        <h2>
          {t('skills.deck')} · {t(`class.name.${character.classId}`)}{' '}
          <span className="muted">{t('home.level', { level: character.level })}</span>
        </h2>
        <p className="muted small">{t('skills.rules')}</p>
        <div className="deck">
          {draft.map((slot, position) => {
            const skill = slot ? skillOf(slot.skillId) : null;
            const fusion =
              skill && slot?.fusionElement
                ? fusionOf(gameData, skill.element, slot.fusionElement)
                : null;
            return (
              <div
                key={position}
                role="button"
                tabIndex={0}
                aria-pressed={selected === position}
                className={`deck-slot editable${isPassiveSlot(position) ? ' passive' : ''}${selected === position ? ' selected' : ''}`}
                style={skill ? elementStyle(skill.element) : undefined}
                onClick={() => setSelected(position)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(position);
                  }
                }}
              >
                <span className="muted small">
                  {isPassiveSlot(position) ? t('team.passiveSlot') : t('team.activeSlot')}
                  {skill?.ultimate && <strong className="accent"> · {t('skills.ultimate')}</strong>}
                </span>
                {skill ? (
                  <>
                    <Tooltip
                      content={<SkillTooltip skill={skill} fusion={slot?.fusionElement ?? null} />}
                    >
                      {/* Le nom de la fusion est déjà sur la pastille en dessous. */}
                      <span className="deck-skill" tabIndex={0}>
                        <PixelImage src={skill.image} alt="" size={32} />
                        <span className="deck-skill-name">{skill.name}</span>
                      </span>
                    </Tooltip>
                    {fusion && slot?.fusionElement ? (
                      <FusionBadge a={skill.element} b={slot.fusionElement} name={fusion.name} />
                    ) : (
                      <ElementBadge element={skill.element} />
                    )}
                    {canBeFused(skill) && alchemyLevel > 0 && (
                      <select
                        aria-label={t('skills.fusion')}
                        value={slot?.fusionElement ?? ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setFusion(position, (e.target.value || null) as ElementId | null)
                        }
                      >
                        <option value="">{t('skills.fusionNone')}</option>
                        {ELEMENT_IDS.filter((id) => unlocked.includes(id)).map((id) => (
                          <option key={id} value={id}>
                            {fusionOf(gameData, skill.element, id)?.name ?? id} (
                            {elementName(skill.element)} + {elementName(id)})
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        clear(position);
                      }}
                    >
                      {t('skills.remove')}
                    </button>
                  </>
                ) : (
                  <span className="muted">{t('team.emptySlot')}</span>
                )}
              </div>
            );
          })}
        </div>
        {alchemyLevel > 0 ? (
          <p className="muted small">
            {t('skills.fusionLimit', {
              used: fusionsUsed,
              max: maxFusions(alchemyLevel),
              level: alchemyLevel,
            })}
          </p>
        ) : (
          <p className="muted small">{t('skills.fusionLocked')}</p>
        )}
        {newFusions > 0 && (
          <p className={missingEther || missingGold ? 'missing' : ''}>
            {t('skills.fusionCost', {
              count: newFusions,
              ether: formatNumber(cost.ether),
              gold: formatNumber(cost.gold),
            })}
          </p>
        )}
        {changed && error && <p className="error">{t(`errors.${error}`)}</p>}
        <div className="points-actions">
          <button
            type="button"
            className="primary"
            disabled={pending || !changed || error !== null}
            onClick={() => void submit()}
          >
            {t('skills.save')}
          </button>
          <button
            type="button"
            disabled={pending || !changed}
            onClick={() => setDraft(toDraft(character))}
          >
            {t('skills.reset')}
          </button>
          {changed && <span className="hint">{t('skills.unsaved')}</span>}
        </div>
      </section>

      <section className="panel">
        <h2>
          {passiveSlot ? t('skills.passives') : t('skills.actives')}{' '}
          <span className="muted">· {t('skills.selectSlot', { slot: `${selected + 1}` })}</span>
        </h2>
        <p className="muted small">{t('skills.catalogNote')}</p>
        <ul className="skill-catalog">
          {candidates.map((base) => {
            const variants = gameData.skills.catalog
              .filter((s) => s.baseId === base.id)
              .sort((a, b) => ELEMENT_IDS.indexOf(a.element) - ELEMENT_IDS.indexOf(b.element));
            const levelOk = level >= base.requiredLevel;
            return (
              <li
                key={base.id}
                className={`skill-row${inDeck.has(base.id) ? ' in-deck' : ''}${levelOk ? '' : ' locked'}`}
              >
                <PixelImage src={variants[0]?.image ?? null} alt="" size={32} />
                <span className="skill-catalog-text">
                  <strong>
                    {base.name}
                    {base.ultimate && <span className="accent"> · {t('skills.ultimate')}</span>}
                  </strong>
                  <span className="muted small">
                    {t(`skills.family.${base.family}`)} ·{' '}
                    {inDeck.has(base.id)
                      ? t('skills.inDeck')
                      : levelOk
                        ? t('skills.unlocked')
                        : t('skills.lockedLevel', { level: base.requiredLevel })}
                  </span>
                  <span className="variant-list">
                    {variants.map((skill) => {
                      const available = isSkillUnlocked(skill, level, unlocked);
                      return (
                        <Tooltip key={skill.id} content={<SkillTooltip skill={skill} />}>
                          <button
                            type="button"
                            className="variant-button"
                            style={elementStyle(skill.element)}
                            aria-disabled={!available}
                            aria-label={skill.name}
                            onClick={() => available && place(skill)}
                          >
                            {elementName(skill.element)}
                          </button>
                        </Tooltip>
                      );
                    })}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel">
        <h2>{t('skills.elements')}</h2>
        <div className="element-list">
          {unlocked.map((id) => (
            <ElementBadge key={id} element={id} />
          ))}
        </div>
        <p className="muted small">{t('skills.elementsNote')}</p>
      </section>
    </>
  );
}

/** Onglet Synergies : les 55 fusions d'éléments, leur rôle et leur effet en combat. */
function Synergies({ save, character }: { save: SaveDto; character: CharacterDto }) {
  const [element, setElement] = useState<ElementId | ''>('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const unlocked = save.unlockedElements;
  const alchemyBuilt = (save.buildings[ALCHEMY_TOWER] ?? 0) > 0;

  const fusions = gameData.skills.fusions
    .map((fusion) => {
      const missing = [fusion.element1, fusion.element2].filter(
        (id, i, pair) => !unlocked.includes(id) && pair.indexOf(id) === i,
      );
      return { fusion, missing, available: alchemyBuilt && missing.length === 0 };
    })
    .filter(
      ({ fusion, available }) =>
        (!element || fusion.element1 === element || fusion.element2 === element) &&
        (!onlyAvailable || available),
    );

  return (
    <section className="panel">
      <h2>{t('skills.synergies.title')}</h2>
      <p className="muted small">{t('skills.synergies.note')}</p>
      <div className="synergy-filters">
        <label>
          {t('skills.synergies.filter')}{' '}
          <select value={element} onChange={(e) => setElement(e.target.value as ElementId | '')}>
            <option value="">{t('skills.synergies.all')}</option>
            {ELEMENT_IDS.map((id) => (
              <option key={id} value={id}>
                {elementName(id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />{' '}
          {t('skills.synergies.onlyAvailable')}
        </label>
        <span className="muted small">
          {t('skills.synergies.count', { count: fusions.length })}
        </span>
      </div>
      <ul className="synergy-list">
        {fusions.map(({ fusion, missing, available }) => (
          <li
            key={`${fusion.element1}-${fusion.element2}`}
            className={available ? 'available' : 'locked'}
          >
            <FusionBadge a={fusion.element1} b={fusion.element2} name={fusion.name} />
            <span className="muted small">{fusion.role}</span>
            <span>{fusion.combatEffect}</span>
            <span className="muted small">
              {t('skills.synergies.example', { name: fusion.examples[character.classId] })}
            </span>
            <span className={`small ${available ? 'ok' : 'missing'}`}>
              {available
                ? t('skills.synergies.available')
                : missing.length > 0
                  ? t('skills.synergies.missing', {
                      elements: missing.map((id) => elementName(id)).join(', '),
                    })
                  : t('skills.synergies.alchemy')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
