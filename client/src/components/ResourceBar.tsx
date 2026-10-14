import { gameData } from '@la-tour/shared/data';
import { buildingById, resourceById, useVillageView, type VillageView } from '../game/village.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { useSession } from '../stores/session.ts';
import { PixelImage } from './PixelImage.tsx';
import { Tooltip } from './Tooltip.tsx';

/** Provenance d'une ressource : le bâtiment qui la produit, ou la taverne. */
function provenance(resourceId: string): string {
  const resource = resourceById(resourceId);
  if (!resource) return '';
  if (resource.source === 'taverne') return t('resource.fromTavern');
  return t('resource.fromBuilding', { building: buildingById(resource.source)?.name ?? '' });
}

/** Contenu de l'infobulle d'une ressource : nom, quantité, provenance, production par heure. */
export function ResourceTooltip({ resourceId, view }: { resourceId: string; view: VillageView }) {
  const resource = resourceById(resourceId);
  const rate = view.ratePerHour(resourceId);
  const amount = view.resources[resourceId] ?? 0;
  return (
    <div className="tooltip-body">
      <strong className="capitalize">{resource?.name ?? resourceId}</strong>
      <span>
        {t('resource.amount', {
          amount: formatNumber(amount),
          capacity: formatNumber(view.capacity),
        })}
      </span>
      <span className="muted">{provenance(resourceId)}</span>
      <span>
        {rate > 0
          ? t('resource.perHour', { rate: formatNumber(rate) })
          : t('resource.noProduction')}
      </span>
      {rate > 0 && amount >= view.capacity && <span className="error">{t('resource.full')}</span>}
    </div>
  );
}

export function ResourceChip({ resourceId, view }: { resourceId: string; view: VillageView }) {
  const resource = resourceById(resourceId);
  const amount = view.resources[resourceId] ?? 0;
  return (
    <Tooltip content={<ResourceTooltip resourceId={resourceId} view={view} />}>
      <span
        className={`resource-chip${amount >= view.capacity ? ' full' : ''}`}
        tabIndex={0}
        aria-label={resource?.name ?? resourceId}
      >
        <PixelImage src={resource?.image ?? null} alt={resource?.name ?? resourceId} size={20} />
        {formatNumber(amount)}
      </span>
    </Tooltip>
  );
}

/**
 * Barre de ressources : l'or, puis les ressources produites ou possédées
 * (dans l'ordre des classeurs), avec la production par heure au survol.
 */
export function ResourceBar({
  withGold = true,
  withResources = true,
}: {
  withGold?: boolean;
  withResources?: boolean;
}) {
  const save = useSession((s) => s.save)!;
  const view = useVillageView();
  const shown = withResources
    ? gameData.resources.resources
        .map((r) => r.id)
        .filter((id) => view.ratePerHour(id) > 0 || (view.resources[id] ?? 0) > 0)
    : [];

  return (
    <div className="resource-bar">
      {withGold && (
        <Tooltip content={<span>{t('resource.gold')}</span>}>
          <span className="resource-chip gold" tabIndex={0}>
            <span className="gold-icon" aria-hidden="true" />
            {formatNumber(save.gold)}
          </span>
        </Tooltip>
      )}
      {shown.map((id) => (
        <ResourceChip key={id} resourceId={id} view={view} />
      ))}
    </div>
  );
}
