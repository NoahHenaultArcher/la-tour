import { CLASS_IDS, type ClassId } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import { useState } from 'react';
import { PixelImage } from '../components/PixelImage.tsx';
import { CLASS_IMAGES } from '../game/assets.ts';
import { errorMessage, t } from '../i18n/index.ts';
import { useSession } from '../stores/session.ts';

/** Compétences du kit de départ d'une classe (2 actives sans recharge + 1 passif, en Neutre). */
function starterKit(classId: ClassId) {
  const kit = gameData.skills.starterKits.find((k) => k.classId === classId)!;
  return [kit.active1, kit.active2, kit.passive].map((name) => {
    const base = gameData.skills.bases.find((b) => b.classId === classId && b.name === name)!;
    const skill = gameData.skills.catalog.find(
      (s) => s.baseId === base.id && s.element === 'neutral',
    )!;
    return skill;
  });
}

export function ChooseClassPage() {
  const chooseClass = useSession((s) => s.chooseClass);
  const [selected, setSelected] = useState<ClassId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      await chooseClass(selected);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <main className="choose-class">
      <h1>{t('class.title')}</h1>
      <p className="muted">{t('class.subtitle')}</p>
      <div className="class-cards">
        {CLASS_IDS.map((classId) => (
          <button
            key={classId}
            type="button"
            className={`panel class-card${selected === classId ? ' selected' : ''}`}
            onClick={() => setSelected(classId)}
            aria-pressed={selected === classId}
          >
            <PixelImage src={CLASS_IMAGES[classId]} alt={t(`class.name.${classId}`)} size={96} />
            <h2>{t(`class.name.${classId}`)}</h2>
            <p>{t(`class.role.${classId}`)}</p>
            <h3>{t('class.starterKit')}</h3>
            <ul className="skill-list">
              {starterKit(classId).map((skill) => (
                <li key={skill.id}>
                  <PixelImage src={skill.image} alt={skill.name} size={24} />
                  <span>
                    <strong>{skill.name}</strong>
                    <em>
                      {skill.family === 'passive' ? t('class.passive') : t('class.noCooldown')}
                    </em>
                    {skill.baseEffect}
                  </span>
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="primary" disabled={!selected || pending} onClick={confirm}>
        {selected ? t('class.choose', { name: t(`class.name.${selected}`) }) : t('class.title')}
      </button>
    </main>
  );
}
