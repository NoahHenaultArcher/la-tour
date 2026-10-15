import {
  CLASS_IDS,
  ELEMENT_IDS,
  RARITY_IDS,
  SLOT_IDS,
  type ClassId,
  type ElementId,
  type RarityId,
  type SlotId,
} from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api/client.ts';
import { errorMessage, formatNumber, t } from '../i18n/index.ts';
import { useCombat } from '../stores/combat.ts';
import { useSession } from '../stores/session.ts';
import { useDebug } from './console.ts';

const resources = gameData.resources.resources;
const rarityName = (id: RarityId) => gameData.equipment.rarities.find((r) => r.id === id)!.name;
const elementName = (id: ElementId) => gameData.elements.elements.find((e) => e.id === id)!.name;

/** Formulaire d'une action de debug : envoie la requête et met à jour la sauvegarde. */
function Action({
  title,
  onSubmit,
  children,
}: {
  title: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      className="debug-action"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h3>{title}</h3>
      <div className="debug-fields">{children}</div>
    </form>
  );
}

/**
 * Panneau de debug (ouvert par `debug.enable()` dans la console).
 * Le serveur vérifie le rôle admin à chaque action : le panneau seul ne donne aucun droit.
 */
export function DebugPanel() {
  const setOpen = useDebug((s) => s.setOpen);
  const status = useSession((s) => s.status);
  const save = useSession((s) => s.save);
  const setSave = useSession((s) => s.setSave);
  const collect = useSession((s) => s.collect);
  const combatInProgress = useCombat((s) => s.target?.phase === 'heroes');
  const winWave = useCombat((s) => s.winWave);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const [gold, setGold] = useState(10_000);
  const [resourceId, setResourceId] = useState('all');
  const [resourceAmount, setResourceAmount] = useState(1000);
  const [characterId, setCharacterId] = useState('');
  const [xp, setXp] = useState(1000);
  const [level, setLevel] = useState(10);
  const [floor, setFloor] = useState(15);
  const [abyssFloor, setAbyssFloor] = useState(10);
  const [element, setElement] = useState<ElementId>('fire');
  const [item, setItem] = useState({
    classId: 'warrior' as ClassId,
    slot: 'weapon1' as SlotId,
    rarity: 'epic' as RarityId,
    tier: 1,
    upgradeLevel: 0,
  });
  const [hours, setHours] = useState(8);

  const run = (action: string, body: object = {}) => {
    setPending(true);
    setMessage(null);
    api
      .debug(action, body)
      .then(async (updated) => {
        setSave(updated);
        // Après avoir avancé l'horloge, on collecte tout de suite pour voir « Pendant votre absence ».
        if (action === 'idle') await collect(true);
        setMessage({ ok: true, text: t('debug.done') });
      })
      .catch((error: unknown) => setMessage({ ok: false, text: errorMessage(error) }))
      .finally(() => setPending(false));
  };

  const characters = save?.characters ?? [];
  const selectedCharacter = characterId || characters[0]?.id || '';

  return (
    <aside className="debug-panel" aria-label={t('debug.title')}>
      <header>
        <h2>{t('debug.title')}</h2>
        <button type="button" onClick={() => setOpen(false)}>
          {t('debug.close')}
        </button>
      </header>

      {status !== 'ready' || !save ? (
        <p>{t('debug.loginRequired')}</p>
      ) : (
        <fieldset disabled={pending}>
          <p className="muted">
            {t('debug.summary', {
              gold: formatNumber(save.gold),
              floor: save.currentFloor,
              items: save.items.length,
              elements: save.unlockedElements.length,
            })}
          </p>
          {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}

          <Action title={t('debug.gold')} onSubmit={() => run('gold', { amount: gold })}>
            <input
              type="number"
              min={1}
              value={gold}
              onChange={(e) => setGold(Number(e.target.value))}
            />
            <button type="submit">{t('debug.give')}</button>
          </Action>

          <Action
            title={t('debug.resources')}
            onSubmit={() => run('resources', { resourceId, amount: resourceAmount })}
          >
            <select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
              <option value="all">{t('debug.allResources')}</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={resourceAmount}
              onChange={(e) => setResourceAmount(Number(e.target.value))}
            />
            <button type="submit">{t('debug.give')}</button>
          </Action>

          {characters.length === 0 ? (
            <p className="muted">{t('debug.characterRequired')}</p>
          ) : (
            <>
              <Action
                title={t('debug.xp')}
                onSubmit={() => run('xp', { characterId: selectedCharacter, amount: xp })}
              >
                <select value={selectedCharacter} onChange={(e) => setCharacterId(e.target.value)}>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t(`class.name.${c.classId}`)} — {t('home.level', { level: c.level })}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={xp}
                  onChange={(e) => setXp(Number(e.target.value))}
                />
                <button type="submit">{t('debug.give')}</button>
              </Action>
              <Action
                title={t('debug.level')}
                onSubmit={() => run('level', { characterId: selectedCharacter, level })}
              >
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={level}
                  onChange={(e) => setLevel(Number(e.target.value))}
                />
                <button type="submit">{t('debug.setLevel')}</button>
              </Action>
            </>
          )}

          <Action title={t('debug.tower')} onSubmit={() => run('floor', { floor })}>
            <input
              type="number"
              min={1}
              max={100}
              value={floor}
              onChange={(e) => setFloor(Number(e.target.value))}
              aria-label={t('debug.floor')}
            />
            <button type="submit">{t('debug.goToFloor')}</button>
            <button type="button" onClick={() => run('unlock-tower')}>
              {t('debug.unlockTower')}
            </button>
          </Action>

          <Action title={t('debug.abyss')} onSubmit={() => run('abyss', { floor: abyssFloor })}>
            <input
              type="number"
              min={1}
              max={10_000}
              value={abyssFloor}
              onChange={(e) => setAbyssFloor(Number(e.target.value))}
              aria-label={t('debug.floor')}
            />
            <button type="submit">{t('debug.goToAbyss')}</button>
          </Action>

          <Action title={t('debug.element')} onSubmit={() => run('element', { element })}>
            <select value={element} onChange={(e) => setElement(e.target.value as ElementId)}>
              {ELEMENT_IDS.map((id) => (
                <option key={id} value={id}>
                  {elementName(id)}
                </option>
              ))}
            </select>
            <button type="submit">{t('debug.unlockElement')}</button>
          </Action>

          <Action title={t('debug.relics')} onSubmit={() => run('relic', { relicId: 'all' })}>
            <button type="submit">{t('debug.giveAllRelics')}</button>
          </Action>

          <Action title={t('debug.item')} onSubmit={() => run('item', item)}>
            <select
              value={item.classId}
              onChange={(e) => setItem({ ...item, classId: e.target.value as ClassId })}
              aria-label={t('debug.class')}
            >
              {CLASS_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`class.name.${id}`)}
                </option>
              ))}
            </select>
            <select
              value={item.slot}
              onChange={(e) => setItem({ ...item, slot: e.target.value as SlotId })}
              aria-label={t('debug.slot')}
            >
              {SLOT_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`slot.${id}`)}
                </option>
              ))}
            </select>
            <select
              value={item.rarity}
              onChange={(e) => setItem({ ...item, rarity: e.target.value as RarityId })}
              aria-label={t('debug.rarity')}
            >
              {RARITY_IDS.map((id) => (
                <option key={id} value={id}>
                  {rarityName(id)}
                </option>
              ))}
            </select>
            <label>
              {t('debug.tier')}
              <input
                type="number"
                min={1}
                max={5}
                value={item.tier}
                onChange={(e) => setItem({ ...item, tier: Number(e.target.value) })}
              />
            </label>
            <label>
              {t('debug.upgrade')}
              <input
                type="number"
                min={0}
                max={99}
                value={item.upgradeLevel}
                onChange={(e) => setItem({ ...item, upgradeLevel: Number(e.target.value) })}
              />
            </label>
            <button type="submit">{t('debug.create')}</button>
          </Action>

          <Action title={t('debug.idle')} onSubmit={() => run('idle', { hours })}>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              aria-label={t('debug.hours')}
            />
            <button type="submit">{t('debug.advance')}</button>
          </Action>

          <div className="debug-action">
            <h3>{t('debug.combat')}</h3>
            <div className="debug-fields">
              <button
                type="button"
                disabled={!combatInProgress}
                onClick={() => {
                  void winWave().then(() =>
                    setMessage(
                      useCombat.getState().error
                        ? { ok: false, text: useCombat.getState().error! }
                        : { ok: true, text: t('debug.done') },
                    ),
                  );
                }}
              >
                {t('debug.winWaveNow')}
              </button>
              {!combatInProgress && <span className="muted">{t('debug.noCombat')}</span>}
            </div>
          </div>

          <div className="debug-action">
            <h3>{t('debug.shop')}</h3>
            <div className="debug-fields">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setPending(true);
                  setMessage(null);
                  api
                    .debugResetShop()
                    .then(() => setMessage({ ok: true, text: t('debug.shopReset') }))
                    .catch((error: unknown) => setMessage({ ok: false, text: errorMessage(error) }))
                    .finally(() => setPending(false));
                }}
              >
                {t('debug.resetShop')}
              </button>
            </div>
          </div>
        </fieldset>
      )}
    </aside>
  );
}
