import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Leaderboard } from '../components/Leaderboard.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { errorMessage, t } from '../i18n/index.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useRoom } from '../stores/room.ts';

/** Multijoueur : créer un salon ou en rejoindre un avec son code. */
export function MultiPage() {
  const room = useRoom((s) => s.room);
  const connected = useRoom((s) => s.connected);
  const create = useRoom((s) => s.create);
  const join = useRoom((s) => s.join);
  const notify = useNotifications((s) => s.notify);
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);

  if (room) return <Navigate to="/salon" replace />;

  const run = async (action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      navigate('/salon');
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page">
      <TopBar />
      <main className="multi-page">
        <h1>{t('multi.title')}</h1>
        <p className="muted">{t('multi.intro')}</p>
        {!connected && <p className="warning">{t('multi.connecting')}</p>}
        <section className="panel multi-actions">
          <button
            type="button"
            className="primary"
            disabled={!connected || pending}
            onClick={() => void run(create)}
          >
            {t('multi.create')}
          </button>
          <form
            className="join-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => join(code.trim().toUpperCase()));
            }}
          >
            <label>
              {t('multi.code')}
              <input
                value={code}
                maxLength={6}
                placeholder={t('multi.codePlaceholder')}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </label>
            <button type="submit" disabled={!connected || pending || code.trim().length !== 6}>
              {t('multi.join')}
            </button>
          </form>
        </section>
        <p className="muted small">{t('room.progressRule')}</p>
        <Leaderboard />
      </main>
    </div>
  );
}
