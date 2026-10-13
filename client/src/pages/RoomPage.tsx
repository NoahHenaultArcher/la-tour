import type { RoomContent, RoomContentOption } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Modal } from '../components/Modal.tsx';
import { PixelImage } from '../components/PixelImage.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { CLASS_IMAGES } from '../game/assets.ts';
import { errorMessage, t } from '../i18n/index.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useRoom } from '../stores/room.ts';
import { useSession } from '../stores/session.ts';

/** Libellé d'un contenu : étage courant, étage de boss ou de dragon, zone de chasse. */
function contentLabel(content: RoomContent | RoomContentOption): string {
  if (content.mode === 'hunt') {
    const zone = gameData.zones.zones.find((z) => z.floor === content.floor);
    return t('room.content.hunt', { zone: zone?.name ?? String(content.floor) });
  }
  if ('kind' in content && content.kind === 'current')
    return t('room.content.current', { floor: content.floor });
  const floor = gameData.floors.floors.find((f) => f.floor === content.floor);
  return t('room.content.boss', {
    floor: content.floor,
    type: floor ? t(`tower.type.${floor.type}`) : '',
  });
}

const contentKey = (c: RoomContent) => `${c.mode}:${c.floor}`;

/** Salon : code, joueurs et héros choisis, contenu, « Prêt », chat, lancement par l'hôte. */
export function RoomPage() {
  const room = useRoom((s) => s.room);
  const chat = useRoom((s) => s.chat);
  const actions = useRoom.getState();
  const user = useSession((s) => s.user)!;
  const save = useSession((s) => s.save)!;
  const notify = useNotifications((s) => s.notify);
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [picking, setPicking] = useState(false);
  const chatRef = useRef<HTMLOListElement>(null);
  const wasInCombat = useRef(room?.inCombat ?? false);

  // Le combat démarre : tout le monde passe sur la scène de combat.
  useEffect(() => {
    if (room?.inCombat && !wasInCombat.current) navigate('/combat');
    wasInCombat.current = room?.inCombat ?? false;
  }, [room?.inCombat, navigate]);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [chat]);

  if (!room) return <Navigate to="/multi" replace />;

  const me = room.players.find((p) => p.userId === user.id);
  const isHost = room.hostId === user.id;
  const allReady = room.players.every((p) => p.ready && p.characterId && p.connected);
  // Fenêtre de sélection quand le joueur a plusieurs héros et n'en a pas encore choisi.
  const mustPick = !!me && !me.characterId && save.characters.length > 1;

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      notify('error', errorMessage(error));
    }
  };

  return (
    <div className="page">
      <TopBar />
      <main className="room-page">
        <header className="tower-header">
          <h1>{t('room.title', { code: room.code })}</h1>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(room.code)
                .then(() => notify('success', t('room.copied')))
                .catch(() => undefined)
            }
          >
            {t('room.copy')}
          </button>
          {room.inCombat && (
            <button type="button" className="primary" onClick={() => navigate('/combat')}>
              {t('room.toCombat')}
            </button>
          )}
          <button
            type="button"
            className="danger"
            onClick={() => void run(actions.leave).then(() => navigate('/multi'))}
          >
            {t('room.leave')}
          </button>
        </header>

        <section className="panel room-players">
          <h2>{t('room.players', { count: room.players.length })}</h2>
          <ul>
            {room.players.map((p) => (
              <li key={p.userId} className={p.connected ? '' : 'offline'}>
                {p.classId ? (
                  <PixelImage src={CLASS_IMAGES[p.classId]} alt="" size={48} />
                ) : (
                  <span className="slot-empty" />
                )}
                <span className="room-player-text">
                  <strong>
                    {p.username}
                    {p.userId === user.id && <span className="muted"> ({t('room.you')})</span>}
                    {p.isHost && <span className="accent"> · {t('room.host')}</span>}
                  </strong>
                  <span className="muted small">
                    {p.classId
                      ? `${t(`class.name.${p.classId}`)} · ${t('home.level', { level: p.level ?? 1 })}`
                      : t('room.noCharacter')}
                    {!p.connected && ` · ${t('room.offline')}`}
                  </span>
                </span>
                <span className={`room-ready ${p.ready ? 'ok' : 'muted'}`}>
                  {p.ready ? t('room.ready') : t('room.notReady')}
                </span>
              </li>
            ))}
          </ul>
          {me && !room.inCombat && (
            <div className="points-actions">
              <button
                type="button"
                className={me.ready ? '' : 'primary'}
                disabled={!me.characterId}
                onClick={() => void run(() => actions.setReady(!me.ready))}
              >
                {me.ready ? t('room.unreadyButton') : t('room.readyButton')}
              </button>
              {save.characters.length > 1 && (
                <button type="button" onClick={() => setPicking(true)}>
                  {t('room.changeCharacter')}
                </button>
              )}
            </div>
          )}
        </section>

        <section className="panel room-content">
          <h2>{t('room.content')}</h2>
          {isHost && !room.inCombat ? (
            <select
              value={room.content ? contentKey(room.content) : ''}
              onChange={(e) => {
                const option = room.contentOptions.find((o) => contentKey(o) === e.target.value);
                if (option)
                  void run(() => actions.setContent({ mode: option.mode, floor: option.floor }));
              }}
            >
              {room.contentOptions.map((o) => (
                <option key={contentKey(o)} value={contentKey(o)}>
                  {contentLabel(o)}
                </option>
              ))}
            </select>
          ) : (
            <p>
              {room.content
                ? t('room.contentChosen', { content: contentLabel(room.content) })
                : '—'}
            </p>
          )}
          <p className="muted small">{t('room.progressRule')}</p>
          {isHost && !room.inCombat && (
            <div className="points-actions">
              <button
                type="button"
                className="primary"
                disabled={!allReady}
                onClick={() => void run(actions.start)}
              >
                {t('room.start')}
              </button>
              {!allReady && <span className="muted small">{t('room.startHint')}</span>}
            </div>
          )}
          {room.inCombat && <p className="accent">{t('room.inCombat')}</p>}
        </section>

        <section className="panel room-chat">
          <h2>{t('room.chat')}</h2>
          <ol ref={chatRef}>
            {chat.length === 0 && <li className="muted">{t('room.chatEmpty')}</li>}
            {chat.map((m) => (
              <li key={m.id}>
                <strong>{m.username}</strong> : {m.text}
              </li>
            ))}
          </ol>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = message.trim();
              if (!text) return;
              setMessage('');
              void run(() => actions.sendChat(text));
            }}
          >
            <input
              value={message}
              maxLength={200}
              placeholder={t('room.chatPlaceholder')}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button type="submit" disabled={!message.trim()}>
              {t('room.send')}
            </button>
          </form>
        </section>
      </main>

      <Modal
        open={(mustPick || picking) && !room.inCombat}
        onClose={() => setPicking(false)}
        title={t('room.chooseCharacter')}
      >
        <div className="class-cards">
          {save.characters.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`class-card panel${me?.characterId === c.id ? ' selected' : ''}`}
              onClick={() =>
                void run(() => actions.chooseCharacter(c.id)).then(() => setPicking(false))
              }
            >
              <PixelImage src={CLASS_IMAGES[c.classId]} alt="" size={64} />
              <strong>{t(`class.name.${c.classId}`)}</strong>
              <span className="muted">{t('home.level', { level: c.level })}</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
