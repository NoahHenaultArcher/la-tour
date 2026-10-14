/**
 * Recherche par identifiant dans les catalogues (960 objets, 484 compétences, 92 monstres…).
 * L'index est construit une fois par liste puis réutilisé : on évite les parcours linéaires
 * répétés dans le moteur de combat et dans les longues listes de l'interface.
 */
const indexes = new WeakMap<readonly { id: string }[], Map<string, { id: string }>>();

export function byId<T extends { id: string }>(list: readonly T[], id: string): T | undefined {
  let index = indexes.get(list);
  if (!index) {
    index = new Map(list.map((entry) => [entry.id, entry]));
    indexes.set(list, index);
  }
  return index.get(id) as T | undefined;
}
