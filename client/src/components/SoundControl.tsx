import { playSound, useSoundSettings } from '../game/sound.ts';
import { t } from '../i18n/index.ts';

/** Bouton couper / remettre le son et curseur de volume (bandeau du haut). */
export function SoundControl() {
  const muted = useSoundSettings((s) => s.muted);
  const volume = useSoundSettings((s) => s.volume);
  const setMuted = useSoundSettings((s) => s.setMuted);
  const setVolume = useSoundSettings((s) => s.setVolume);
  const label = t(muted ? 'sound.unmute' : 'sound.mute');
  return (
    <span className="sound-control">
      <button
        type="button"
        className="sound-toggle"
        aria-pressed={!muted}
        aria-label={label}
        title={label}
        onClick={() => {
          setMuted(!muted);
          // Petit son d'essai pour entendre le volume choisi.
          if (muted) playSound('loot');
        }}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        aria-label={t('sound.volume')}
        title={t('sound.volumeValue', { value: Math.round((muted ? 0 : volume) * 100) })}
        onChange={(e) => {
          const value = Number(e.target.value);
          setVolume(value);
          if (value > 0 && muted) setMuted(false);
        }}
        onPointerUp={() => playSound('hit')}
      />
    </span>
  );
}
