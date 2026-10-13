import { GAME_RULES, MAX_HERO_LEVEL, canInherit } from '@la-tour/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { TopBar } from '../components/TopBar.tsx';
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

  const available = canInherit(save.characters, MAX_HERO_LEVEL);
  const bestLevel = Math.max(...save.characters.map((c) => c.level));

  const confirm = async () => {
    setPending(true);
    try {
      await inherit();
      notify('success', t('heritage.done'));
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
            </ul>
          </section>
        </div>
        {available ? (
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
          <p className="warning">{t('heritage.locked', { level: bestLevel })}</p>
        )}
      </main>
    </div>
  );
}
