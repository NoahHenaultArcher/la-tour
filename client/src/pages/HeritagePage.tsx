import {
  CLASS_EVOLUTIONS,
  GAME_RULES,
  MAX_HERO_LEVEL,
  TOWER_FLOORS,
  evolutionTier,
  heritageStatus,
} from '@la-tour/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { EvolutionPanel } from '../components/EvolutionPanel.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { heroName } from '../game/evolution.ts';
import { errorMessage, t } from '../i18n/index.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';

const percentBonus = (count: number) => Math.round(GAME_RULES.heritageStatBonus * count * 100);

/** Héritage : récapitulatif de ce qui est perdu, gardé et gagné, puis confirmation. */
export function HeritagePage() {
  const save = useSession((s) => s.save)!;
  const inherit = useSession((s) => s.inherit);
  const notify = useNotifications((s) => s.notify);
  const navigate = useNavigate();
  const [understood, setUnderstood] = useState(false);
  const [pending, setPending] = useState(false);

  const status = heritageStatus(save);
  const bestLevel = Math.max(...save.characters.map((c) => c.level));

  const confirm = async () => {
    setPending(true);
    try {
      const before = evolutionTier(save.heritageCount);
      await inherit();
      notify('success', t('heritage.done'));
      // 10e et 20e héritages : les héros prennent leur évolution.
      const after = evolutionTier(save.heritageCount + 1);
      if (after > before) {
        const names = save.characters.map((c) => heroName(c.classId, after)).join(', ');
        notify('success', t('evolution.unlocked', { names }));
      }
      navigate('/village');
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page">
      <TopBar />
      <main className="heritage-page">
        <header className="tower-header">
          <h1>{t('heritage.title')}</h1>
          <p className="muted">{t('heritage.intro')}</p>
        </header>
        <p>
          {t('heritage.count', {
            count: save.heritageCount,
            bonus: percentBonus(save.heritageCount),
          })}
        </p>
        <div className="heritage-columns">
          <section className="panel heritage-lost">
            <h2>{t('heritage.lost')}</h2>
            <ul>
              <li>{t('heritage.lost.levels')}</li>
              <li>{t('heritage.lost.tower')}</li>
              <li>{t('heritage.lost.zones')}</li>
            </ul>
          </section>
          <section className="panel heritage-kept">
            <h2>{t('heritage.kept')}</h2>
            <ul>
              <li>{t('heritage.kept.goods')}</li>
              <li>{t('heritage.kept.village')}</li>
              <li>{t('heritage.kept.skills')}</li>
            </ul>
          </section>
          <section className="panel heritage-gained">
            <h2>{t('heritage.gained')}</h2>
            <ul>
              <li>{t('heritage.gained.bonus', { bonus: percentBonus(save.heritageCount + 1) })}</li>
              {evolutionTier(save.heritageCount + 1) > evolutionTier(save.heritageCount) &&
                save.characters.map((c) => {
                  const tier = evolutionTier(save.heritageCount + 1);
                  const evolution = CLASS_EVOLUTIONS[c.classId][tier - 1]!;
                  return (
                    <li key={c.id} className="ok">
                      {heroName(c.classId, tier)} : {t(`evolution.bonus.${evolution}`)}
                    </li>
                  );
                })}
            </ul>
          </section>
        </div>
        <EvolutionPanel heritageCount={save.heritageCount} />
        {status.ready ? (
          <section className="panel heritage-confirm">
            <label>
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
              />{' '}
              {t('heritage.understood')}
            </label>
            <button
              type="button"
              className="primary danger"
              disabled={!understood || pending}
              onClick={() => void confirm()}
            >
              {t('heritage.confirm')}
            </button>
          </section>
        ) : (
          <section className="panel heritage-requirements">
            <p className="warning">
              {t(save.heritageCount > 0 ? 'heritage.lockedAgain' : 'heritage.locked')}
            </p>
            <ul>
              <li className={status.heroReady ? 'ok' : 'missing'}>
                {status.heroReady ? '✔' : '✘'}{' '}
                {t('heritage.need.level', { max: MAX_HERO_LEVEL, level: bestLevel })}
              </li>
              <li className={status.towerReady ? 'ok' : 'missing'}>
                {status.towerReady ? '✔' : '✘'}{' '}
                {t('heritage.need.tower', {
                  floor: TOWER_FLOORS,
                  cleared: save.highestFloorCleared,
                })}
              </li>
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
