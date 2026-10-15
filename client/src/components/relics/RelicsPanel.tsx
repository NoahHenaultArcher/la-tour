import { RELICS, RELIC_RULES, relicById, type SaveDto } from '@la-tour/shared';
import { useState } from 'react';
import { relicEffectLines, relicSlots } from '../../game/relics.ts';
import { errorMessage, t } from '../../i18n/index.ts';
import { useNotifications } from '../../stores/notifications.ts';
import { useSession } from '../../stores/session.ts';
import { Tooltip } from '../Tooltip.tsx';
import { RelicIcon, RelicTooltip } from './RelicIcon.tsx';

/**
 * Onglet « Reliques » de la page Équipe : œufs de dragon à gauche, 6 emplacements au milieu,
 * inventaire des reliques en dessous. Clic sur une relique possédée : l'équiper (emplacement choisi,
 * sinon le premier libre) ; clic sur une relique équipée ou un emplacement plein : la retirer.
 */
export function RelicsPanel({ save }: { save: SaveDto }) {
  const equipRelic = useSession((s) => s.equipRelic);
  const unequipRelic = useSession((s) => s.unequipRelic);
  const notify = useNotifications((s) => s.notify);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const slots = relicSlots(save);
  const owned = new Map(save.relics.map((r) => [r.relicId, r.slot]));

  const run = async (action: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    try {
      await action();
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const toggle = (relicId: string) => {
    if (!owned.has(relicId)) return;
    if (owned.get(relicId) !== null) {
      void run(() => unequipRelic(relicId));
      return;
    }
    const slot = selectedSlot ?? slots.findIndex((s) => s === null);
    if (slot < 0) {
      notify('error', t('relic.slotsFull'));
      return;
    }
    setSelectedSlot(null);
    void run(() => equipRelic(relicId, slot));
  };

  const item = (relicId: string) => {
    const has = owned.has(relicId);
    const equipped = has && owned.get(relicId) !== null;
    return (
      <Tooltip key={relicId} content={<RelicTooltip relicId={relicId} save={save} />}>
        <button
          type="button"
          className={`relic-cell${equipped ? ' equipped' : ''}`}
          aria-disabled={!has || pending}
          aria-pressed={equipped}
          onClick={() => toggle(relicId)}
        >
          <RelicIcon relicId={relicId} locked={!has} />
        </button>
      </Tooltip>
    );
  };

  const eggs = RELICS.filter((r) => r.kind === 'egg');
  const relics = RELICS.filter((r) => r.kind === 'relic');
  const count = (list: typeof RELICS) => list.filter((r) => owned.has(r.id)).length;
  const active = slots.filter((s): s is string => s !== null);

  return (
    <div className="relics-layout">
      <section className="panel relics-eggs">
        <h2>{t('relic.eggsTitle')}</h2>
        <p className="muted small">
          {t('relic.collected', { count: count(eggs), total: eggs.length })}
        </p>
        <div className="relic-grid eggs">{eggs.map((r) => item(r.id))}</div>
      </section>

      <section className="panel relics-slots">
        <h2>{t('relic.slotsTitle', { count: active.length, max: RELIC_RULES.slots })}</h2>
        <p className="muted small">{t('relic.slotsHint')}</p>
        <div className="relic-slot-row">
          {slots.map((relicId, slot) =>
            relicId ? (
              <Tooltip key={slot} content={<RelicTooltip relicId={relicId} save={save} />}>
                <button
                  type="button"
                  className="relic-slot filled"
                  aria-disabled={pending}
                  onClick={() => void run(() => unequipRelic(relicId))}
                >
                  <RelicIcon relicId={relicId} size={84} />
                </button>
              </Tooltip>
            ) : (
              <button
                key={slot}
                type="button"
                className={`relic-slot${selectedSlot === slot ? ' selected' : ''}`}
                aria-pressed={selectedSlot === slot}
                title={t('relic.emptySlot', { slot: slot + 1 })}
                onClick={() => setSelectedSlot(selectedSlot === slot ? null : slot)}
              >
                <span>{slot + 1}</span>
              </button>
            ),
          )}
        </div>
        {active.length > 0 && (
          <div className="relic-effects">
            <h3>{t('relic.activeEffects')}</h3>
            <ul>
              {active.map((id) => {
                const relic = relicById(id)!;
                return (
                  <li key={id}>
                    <strong className={`relic-name ${relic.kind}`}>{relic.name}</strong> :{' '}
                    {relicEffectLines(relic.effect).join(' · ')}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="panel relics-inventory">
        <h2>{t('relic.relicsTitle')}</h2>
        <p className="muted small">
          {t('relic.collected', { count: count(relics), total: relics.length })} ·{' '}
          {t('relic.dropRule', { chance: Math.round(RELIC_RULES.dropChance * 100) })}
        </p>
        <div className="relic-grid">{relics.map((r) => item(r.id))}</div>
      </section>
    </div>
  );
}
