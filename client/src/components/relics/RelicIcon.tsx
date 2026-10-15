import { RELIC_RULES, relicById, type SaveDto } from '@la-tour/shared';
import { RELIC_FRAMES, relicEffectLines, relicSource } from '../../game/relics.ts';
import { t } from '../../i18n/index.ts';
import { PixelImage } from '../PixelImage.tsx';

/**
 * Icône d'une relique ou d'un œuf dans son cadre (ui/cadre_relique.png ou ui/cadre_oeuf.png).
 * `locked` : pas encore obtenue (grisée).
 */
export function RelicIcon({
  relicId,
  size = 56,
  locked = false,
}: {
  relicId: string;
  /** Taille du cadre en px (56 : taille réelle ; l'icône 48 px est posée en 4,4). */
  size?: number;
  locked?: boolean;
}) {
  const relic = relicById(relicId);
  if (!relic) return null;
  const scale = size / 56;
  return (
    <span
      className={`relic-icon ${relic.kind}${locked ? ' locked' : ''}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(/${RELIC_FRAMES[relic.kind]})`,
      }}
    >
      <span className="relic-icon-image" style={{ left: 4 * scale, top: 4 * scale }}>
        <PixelImage src={relic.image} alt={relic.name} size={48 * scale} />
      </span>
    </span>
  );
}

/** Infobulle d'une relique : nom, type, effets (toute l'équipe), provenance, possession. */
export function RelicTooltip({ relicId, save }: { relicId: string; save?: SaveDto }) {
  const relic = relicById(relicId);
  if (!relic) return null;
  const source = relicSource(relic);
  const owned = save?.relics.find((r) => r.relicId === relicId);
  return (
    <div className="tooltip-body">
      <strong className={`relic-name ${relic.kind}`}>{relic.name}</strong>
      <span className="muted">
        {t(relic.kind === 'egg' ? 'relic.kind.egg' : 'relic.kind.relic')}
      </span>
      <span className="muted small">{t('relic.teamWide')}</span>
      {relicEffectLines(relic.effect).map((line) => (
        <span key={line}>{line}</span>
      ))}
      <span className="muted">
        {t('relic.source', {
          monster: source.name,
          floor: source.floor,
          chance: Math.round(RELIC_RULES.dropChance * 100),
        })}
      </span>
      {save && (
        <span className={owned ? 'ok' : 'muted'}>
          {owned
            ? owned.slot !== null
              ? t('relic.equippedIn', { slot: owned.slot + 1 })
              : t('relic.owned')
            : t('relic.notOwned')}
        </span>
      )}
    </div>
  );
}
