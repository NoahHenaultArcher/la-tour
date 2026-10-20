import type { ClassId, EvolutionId } from '@la-tour/shared';

/** Portraits des classes (assets_rpg_tour/personnages). */
export const CLASS_IMAGES: Record<ClassId, string> = {
  warrior: 'personnages/guerrier.png',
  mage: 'personnages/mage.png',
  ranger: 'personnages/tireur.png',
};

/** Portraits des évolutions (héritages 10 et 20). */
export const EVOLUTION_IMAGES: Record<EvolutionId, string> = {
  arcanist: 'personnages/mage_arcaniste.png',
  archmage: 'personnages/archimage.png',
  swordsman: 'personnages/epeiste.png',
  weaponMaster: 'personnages/maitre_d_armes.png',
  crossbowman: 'personnages/arbaletier.png',
  arcaneArcher: 'personnages/tireur_magique.png',
};
