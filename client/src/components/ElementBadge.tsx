import type { ElementId } from '@la-tour/shared';
import type { CSSProperties } from 'react';
import { elementName, elementStyle, fusionColor } from '../game/elements.ts';

/** Pastille d'élément : couleur de l'élément + son nom (la couleur seule ne suffit pas). */
export function ElementBadge({ element }: { element: ElementId }) {
  return (
    <span className="element-badge" style={elementStyle(element)}>
      {elementName(element)}
    </span>
  );
}

/** Pastille de fusion : sa couleur propre, son nom, et les deux éléments qui la composent. */
export function FusionBadge({ a, b, name }: { a: ElementId; b: ElementId; name: string }) {
  return (
    <span className="fusion-badge">
      <span className="element-badge" style={{ '--el': fusionColor(a, b) } as CSSProperties}>
        {name}
      </span>
      <ElementBadge element={a} />
      {a !== b && <ElementBadge element={b} />}
    </span>
  );
}
