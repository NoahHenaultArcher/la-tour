import type { ItemDto, LotOffer, ShopDto } from '@la-tour/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { heroImage, heroName, saveTier } from '../game/evolution.ts';
import { catalogItem } from '../game/items.ts';
import { resourceById, useVillageView } from '../game/village.ts';
import { errorMessage, formatNumber, t } from '../i18n/index.ts';
import { useNotifications } from '../stores/notifications.ts';
import { useSession } from '../stores/session.ts';
import { ItemIcon } from './items/ItemIcon.tsx';
import { ItemName, ItemTooltip } from './items/ItemTooltip.tsx';
import { PixelImage } from './PixelImage.tsx';
import { Tooltip } from './Tooltip.tsx';

/** Prix en or, en rouge s'il manque de l'or. */
function Price({ price, gold }: { price: number; gold: number }) {
  return (
    <span className={`price${gold < price ? ' missing' : ''}`}>
      <span className="gold-icon" aria-hidden="true" />
      {formatNumber(price)}
    </span>
  );
}

/** Minutes restantes avant le renouvellement, d'après l'horloge du serveur. */
function useMinutesUntil(isoDate: string | undefined, onReached: () => void): number | null {
  const serverTime = useSession((s) => s.save?.serverTime);
  const receivedAt = useSession((s) => s.saveReceivedAt);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const skew = serverTime ? Date.parse(serverTime) - receivedAt : 0;
  const remaining = isoDate ? Date.parse(isoDate) - (now + skew) : null;
  useEffect(() => {
    if (remaining !== null && remaining <= 0) onReached();
  }, [remaining, onReached]);
  return remaining === null ? null : Math.max(1, Math.ceil(remaining / 60_000));
}

/** Contenu du panneau de la taverne : personnages, objets et ressources, renouvelés toutes les heures. */
export function TavernSection() {
  const save = useSession((s) => s.save)!;
  const buyOffer = useSession((s) => s.buyOffer);
  const notify = useNotifications((s) => s.notify);
  const view = useVillageView();
  const [shop, setShop] = useState<ShopDto | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(() => {
    api
      .getShop()
      .then(setShop)
      .catch((error: unknown) => notify('error', errorMessage(error)));
  }, [notify]);
  useEffect(refresh, [refresh]);
  const minutes = useMinutesUntil(shop?.renewsAt, refresh);

  if (!shop) return <p className="muted">{t('app.loading')}</p>;

  const buy = async (offerId: string, success: string) => {
    setPending(true);
    try {
      setShop(await buyOffer(offerId));
      notify('success', success);
    } catch (error) {
      notify('error', errorMessage(error));
      refresh();
    } finally {
      setPending(false);
    }
  };

  const buyButton = (offerId: string, price: number, success: string) => (
    <button
      type="button"
      disabled={pending || save.gold < price}
      onClick={() => void buy(offerId, success)}
    >
      {t('tavern.buy')}
    </button>
  );

  const lotRow = (lot: LotOffer) => {
    const resource = resourceById(lot.resourceId);
    const name = resource?.name ?? lot.resourceId;
    return (
      <li key={lot.offerId}>
        <span className="inventory-item">
          <PixelImage src={resource?.image ?? null} alt="" size={24} />
          <span className="capitalize">{t('tavern.lot', { quantity: lot.quantity, name })}</span>
          <span className="muted">
            {t('tavern.have', { amount: formatNumber(view.resources[lot.resourceId] ?? 0) })}
          </span>
        </span>
        <Price price={lot.price} gold={save.gold} />
        {buyButton(lot.offerId, lot.price, t('tavern.bought', { name: `${lot.quantity} ${name}` }))}
      </li>
    );
  };

  return (
    <>
      <p className="muted">
        {t('tavern.renews', { minutes: minutes ?? 60 })}
        {shop.discount > 0 &&
          ` · ${t('tavern.discount', { discount: Math.round(shop.discount * 100) })}`}
      </p>

      {shop.characters.length > 0 && (
        <section>
          <h3>{t('tavern.characters')}</h3>
          <ul className="shop-list">
            {shop.characters.map((offer) => (
              <li key={offer.offerId}>
                <span className="inventory-item">
                  <PixelImage src={heroImage(offer.classId, saveTier(save))} alt="" size={48} />
                  <span>
                    <strong>{heroName(offer.classId, saveTier(save))}</strong>
                    <span className="muted"> · {t('tavern.characterNote')}</span>
                  </span>
                </span>
                <Price price={offer.price} gold={save.gold} />
                {buyButton(
                  offer.offerId,
                  offer.price,
                  t('tavern.recruited', { name: heroName(offer.classId, saveTier(save)) }),
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>{t('tavern.items')}</h3>
        {shop.items.length === 0 ? (
          <p className="muted">{t('tavern.soldOut')}</p>
        ) : (
          <ul className="shop-list">
            {shop.items.map((offer) => {
              const info = catalogItem(offer.catalogId);
              // Objet fictif (pas encore acheté) pour l'infobulle et la comparaison.
              const preview: ItemDto = {
                id: offer.offerId,
                catalogId: offer.catalogId,
                upgradeLevel: 0,
                equippedBy: null,
                slot: null,
              };
              const wearer = save.characters.find((c) => c.classId === info.classId);
              return (
                <li key={offer.offerId}>
                  <Tooltip
                    content={
                      <ItemTooltip
                        item={preview}
                        save={save}
                        resources={view.resources}
                        compareWith={wearer?.id ?? null}
                      />
                    }
                  >
                    <span className="inventory-item" tabIndex={0}>
                      <ItemIcon catalogId={offer.catalogId} scale={1.5} />
                      <ItemName catalogId={offer.catalogId} />
                    </span>
                  </Tooltip>
                  <Price price={offer.price} gold={save.gold} />
                  {buyButton(offer.offerId, offer.price, t('tavern.bought', { name: info.name }))}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3>{t('tavern.resources')}</h3>
        <ul className="shop-list">
          {shop.lots.map(lotRow)}
          {shop.permanentLots.map(lotRow)}
        </ul>
        <p className="muted">{t('tavern.resourcesNote')}</p>
      </section>

      <p className="muted">{t('tavern.sellHint')}</p>
    </>
  );
}
