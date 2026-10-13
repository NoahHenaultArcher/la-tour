import { catalogItem, rarityInfo } from '../../game/items.ts';
import { PixelImage } from '../PixelImage.tsx';

interface Props {
  catalogId: string;
  upgradeLevel?: number;
  /** Échelle d'affichage (le cadre fait 20 px, l'icône 16 px posée en 2,2). */
  scale?: number;
}

/** Icône d'objet dans le cadre de sa rareté (ui/cadre_*.png), avec son niveau d'amélioration. */
export function ItemIcon({ catalogId, upgradeLevel = 0, scale = 3 }: Props) {
  const item = catalogItem(catalogId);
  const rarity = rarityInfo(item.rarity);
  const size = 20 * scale;
  return (
    <span
      className="item-icon"
      style={{
        width: size,
        height: size,
        backgroundImage: rarity.frameImage ? `url(/${rarity.frameImage})` : undefined,
        borderColor: rarity.frameImage ? 'transparent' : rarity.color,
      }}
    >
      <span className="item-icon-image" style={{ left: 2 * scale, top: 2 * scale }}>
        <PixelImage src={item.image} alt={item.name} size={16 * scale} />
      </span>
      {upgradeLevel > 0 && <span className="item-upgrade">+{upgradeLevel}</span>}
    </span>
  );
}
