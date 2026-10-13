import { useState } from 'react';
import { t } from '../i18n/index.ts';

/** Image de remplacement (point d'interrogation pixel art) quand une image manque. */
const FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">' +
      '<rect width="8" height="8" fill="#3a3046"/><path fill="#c9b8e8" d="M2 1h4v1H2zM6 2h1v2H6zM4 4h2v1H4zM3 5h2v1H3zM3 7h2v1H3z"/></svg>',
  );

interface PixelImageProps {
  /** Chemin relatif à assets_rpg_tour/ (null si l'image n'existe pas). */
  src: string | null;
  alt: string;
  size: number;
}

/** Image pixel art affichée sans lissage ; une image absente ne casse jamais l'affichage. */
export function PixelImage({ src, alt, size }: PixelImageProps) {
  const [failed, setFailed] = useState(false);
  const url = src && !failed ? `/${src}` : FALLBACK;
  return (
    <img
      className="pixel"
      src={url}
      alt={src && !failed ? alt : t('image.missing')}
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}
