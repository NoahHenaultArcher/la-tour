import {
  CLASS_EVOLUTION,
  CLASS_EVOLUTIONS,
  CLASS_IDS,
  evolutionTier,
  nextEvolution,
  type EvolutionTier,
} from '@la-tour/shared';
import { heroImage, heroName } from '../game/evolution.ts';
import { t } from '../i18n/index.ts';
import { PixelImage } from './PixelImage.tsx';

/**
 * Évolutions des classes (page Héritage) : pour chaque classe, la forme de base puis les deux
 * évolutions avec leur bonus et le nombre d'héritages qui les débloque.
 */
export function EvolutionPanel({ heritageCount }: { heritageCount: number }) {
  const tier = evolutionTier(heritageCount);
  const next = nextEvolution(heritageCount);
  return (
    <section className="panel evolution-panel">
      <h2>{t('evolution.title')}</h2>
      <p className="muted small">{t('evolution.intro')}</p>
      <p className={next ? '' : 'ok'}>
        {next
          ? t('evolution.next', { count: next.heritages, missing: next.missing })
          : t('evolution.allReached')}
      </p>
      <div className="evolution-grid">
        {CLASS_IDS.map((classId) => (
          <ol key={classId} className="evolution-line">
            {([0, 1, 2] as EvolutionTier[]).map((step) => {
              const evolution = step === 0 ? null : CLASS_EVOLUTIONS[classId][step - 1]!;
              const reached = tier >= step;
              return (
                <li key={step} className={reached ? 'reached' : 'locked'}>
                  <PixelImage src={heroImage(classId, step)} alt="" size={64} />
                  <span className="evolution-text">
                    <strong>{heroName(classId, step)}</strong>
                    {evolution && (
                      <>
                        <span className="small">{t(`evolution.bonus.${evolution}`)}</span>
                        <span className={`small ${reached ? 'ok' : 'muted'}`}>
                          {reached
                            ? t('evolution.reached')
                            : t('evolution.at', { count: CLASS_EVOLUTION.heritages[step - 1]! })}
                        </span>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        ))}
      </div>
    </section>
  );
}
