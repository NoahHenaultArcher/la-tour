/**
 * Couleurs des éléments et des fusions (palette inspirée de The Spell Brigade, voir note.md).
 * Chaque élément a sa couleur ; chaque fusion a sa propre couleur fixe, intermédiaire entre
 * ses deux éléments. La couleur ne remplace jamais le nom : on l'affiche toujours avec.
 */
import type { ElementId } from '@la-tour/shared';
import { gameData } from '@la-tour/shared/data';
import type { CSSProperties } from 'react';

/** Couleur principale : icônes, badges, effets, bordures. */
export const ELEMENT_COLORS: Record<ElementId, string> = {
  fire: '#E4962D',
  lightning: '#00BFFF',
  acid: '#B3EB22',
  ice: '#C0D3D3',
  water: '#2478FF',
  wind: '#72E5D0',
  earth: '#A87545',
  shadow: '#5722B0',
  light: '#FFE783',
  neutral: '#D8DCE5',
};

/** Couleurs des 55 fusions, indexées par paire d'éléments (ordre indifférent). */
const FUSION_COLORS: [ElementId, ElementId, string][] = [
  ['fire', 'fire', '#FF6A1A'],
  ['lightning', 'lightning', '#70DFFF'],
  ['acid', 'acid', '#8EC900'],
  ['ice', 'ice', '#C8F4FF'],
  ['water', 'water', '#1677D2'],
  ['wind', 'wind', '#6DE6BB'],
  ['earth', 'earth', '#96613C'],
  ['shadow', 'shadow', '#35106F'],
  ['light', 'light', '#FFF1A6'],
  ['neutral', 'neutral', '#AEB8D7'],
  ['fire', 'lightning', '#FF55B8'],
  ['fire', 'acid', '#D6B51B'],
  ['fire', 'ice', '#F2A5A1'],
  ['fire', 'water', '#FF9B69'],
  ['fire', 'wind', '#FF8238'],
  ['fire', 'earth', '#D64A27'],
  ['fire', 'shadow', '#A82D49'],
  ['fire', 'light', '#FFD45A'],
  ['fire', 'neutral', '#E6A3FF'],
  ['lightning', 'acid', '#75D947'],
  ['lightning', 'ice', '#83D6F5'],
  ['lightning', 'water', '#168FE5'],
  ['lightning', 'wind', '#46E4D5'],
  ['lightning', 'earth', '#B7C94D'],
  ['lightning', 'shadow', '#7651C9'],
  ['lightning', 'light', '#A5EFFF'],
  ['lightning', 'neutral', '#7DA5FF'],
  ['acid', 'ice', '#A8D879'],
  ['acid', 'water', '#53B849'],
  ['acid', 'wind', '#9EDB70'],
  ['acid', 'earth', '#A6A72C'],
  ['acid', 'shadow', '#6B8D30'],
  ['acid', 'light', '#D1E85C'],
  ['acid', 'neutral', '#B5C86A'],
  ['ice', 'water', '#8AD9ED'],
  ['ice', 'wind', '#B8E8F5'],
  ['ice', 'earth', '#A6BEB9'],
  ['ice', 'shadow', '#9184C9'],
  ['ice', 'light', '#D9F5DF'],
  ['ice', 'neutral', '#D5DCEB'],
  ['water', 'wind', '#35C6CE'],
  ['water', 'earth', '#779B69'],
  ['water', 'shadow', '#4265A8'],
  ['water', 'light', '#77C9FF'],
  ['water', 'neutral', '#619DD6'],
  ['wind', 'earth', '#C0A36B'],
  ['wind', 'shadow', '#6951A0'],
  ['wind', 'light', '#A8E7BC'],
  ['wind', 'neutral', '#9DB8D7'],
  ['earth', 'shadow', '#59405B'],
  ['earth', 'light', '#D8D0A1'],
  ['earth', 'neutral', '#8E879D'],
  ['shadow', 'light', '#9766A8'],
  ['shadow', 'neutral', '#8060B5'],
  ['light', 'neutral', '#E7D6FF'],
];

const pairKey = (a: ElementId, b: ElementId) => [a, b].sort().join('+');
const fusionColors = new Map(FUSION_COLORS.map(([a, b, color]) => [pairKey(a, b), color]));

export function elementColor(id: ElementId): string {
  return ELEMENT_COLORS[id];
}

/** Couleur d'une fusion (repli : couleur du premier élément). */
export function fusionColor(a: ElementId, b: ElementId): string {
  return fusionColors.get(pairKey(a, b)) ?? ELEMENT_COLORS[a];
}

export function elementName(id: string): string {
  return gameData.elements.elements.find((e) => e.id === id)?.name ?? id;
}

/**
 * Variables CSS d'un élément : `--el` (couleur principale) ; les fonds sombres sont dérivés en CSS
 * avec color-mix (voir les classes .element-themed et .element-badge).
 */
export function elementStyle(id: ElementId): CSSProperties {
  return { '--el': ELEMENT_COLORS[id] } as CSSProperties;
}
