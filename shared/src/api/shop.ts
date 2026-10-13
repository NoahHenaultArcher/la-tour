import { z } from 'zod';
import type { CharacterOffer, ItemOffer, LotOffer } from '../rules/shop.ts';

export const buyOfferBodySchema = z.strictObject({ offerId: z.string().min(1).max(64) });
export type BuyOfferBody = z.infer<typeof buyOfferBodySchema>;

/** Assortiment courant de la taverne (sans les offres déjà achetées). */
export interface ShopDto {
  /** Prochain renouvellement (horloge du serveur). */
  renewsAt: string;
  discount: number;
  items: ItemOffer[];
  lots: LotOffer[];
  permanentLots: LotOffer[];
  characters: CharacterOffer[];
}
