import type { SkillsData } from '@la-tour/shared/schemas';
import type { ImportContext } from '../context.ts';
import {
  ATTACK_STATS,
  BIOMES,
  CLASSES,
  ELEMENTS,
  SKILL_FAMILIES,
  SKILL_KINDS,
  SKILL_TARGETS,
  fromLabel,
} from '../labels.ts';
import { ImportError, type Row } from '../workbook.ts';

/** « Frappe rapide (sans recharge) » → « Frappe rapide ». */
const stripNote = (value: string) => value.replace(/\s*\([^)]*\)\s*$/, '');

export function importSkills({ books, images }: ImportContext): SkillsData {
  const params = books.skills.sheet('Paramètres');

  const common = (row: Row, where: string) => {
    const classLabel = row.text('Classe');
    const stat = row.optText('Stat');
    return {
      classId: classLabel === 'Toutes' ? null : fromLabel(CLASSES, classLabel, where),
      family: fromLabel(SKILL_FAMILIES, row.text('Famille'), where),
      kind: fromLabel(SKILL_KINDS, row.text('Type'), where),
      target: fromLabel(SKILL_TARGETS, row.text('Cible'), where),
      cooldown: row.optInt('Recharge (tours)'),
      ultimate: row.yesNo('Ultime'),
      power: row.num('Puissance (× stat)'),
      attackStat: stat === null ? null : fromLabel(ATTACK_STATS, stat, where),
      baseEffect: row.text('Effet de base'),
      trigger: row.text('Déclenchement'),
      requiredLevel: row.int('Niveau requis'),
    };
  };

  const basesSheet = books.skills.sheet('Bases');
  const bases = basesSheet.table('ID').map((row) => ({
    id: row.text('ID'),
    name: row.text('Nom (Neutre)'),
    variantRoot: row.optText('Racine des variantes'),
    ...common(row, `${basesSheet.where} ligne ${row.index}`),
    effectValue: row.optNum("Valeur d'effet (équiv. puissance)"),
    cooldownScore: row.optNum('Score de recharge'),
  }));

  const catalogSheet = books.skills.sheet('Catalogue');
  const catalog = catalogSheet.table('ID').map((row) => {
    const where = `${catalogSheet.where} ligne ${row.index}`;
    const id = row.text('ID');
    const base = bases[row.int('(aide) N° base') - 1];
    if (!base || base.name !== row.text('Compétence de base')) {
      throw new ImportError(
        `${where} : compétence de base « ${row.text('Compétence de base')} » introuvable dans Bases.`,
      );
    }
    return {
      id,
      baseId: base.id,
      name: row.text('Nom'),
      element: fromLabel(ELEMENTS, row.text('Élément'), where),
      ...common(row, where),
      elementEffect: row.optText("Effet de l'élément"),
      unlockFloor: row.int('Étage à terminer'),
      powerPerTurn: row.num('Puissance par tour (vague)'),
      image: images.get('competence', id),
    };
  });

  const fusionsSheet = books.skills.sheet('Fusions');
  const fusions = fusionsSheet.table('Élément 1').map((row) => {
    const where = `${fusionsSheet.where} ligne ${row.index}`;
    return {
      element1: fromLabel(ELEMENTS, row.text('Élément 1'), where),
      element2: fromLabel(ELEMENTS, row.text('Élément 2'), where),
      name: row.text('Fusion'),
      combatEffect: row.text('Effet en combat (tour par tour)'),
      originalIdea: row.text("Idée d'origine (fichier Éléments/Fusions)"),
      role: row.text('Rôle'),
      availableAfterFloor: row.int("Disponible après l'étage"),
      examples: {
        warrior: row.text('Exemple Guerrier'),
        mage: row.text('Exemple Mage'),
        ranger: row.text('Exemple Tireur'),
      },
    };
  });

  const unlocksSheet = books.skills.sheet('Déblocages');
  const unlockProgression = unlocksSheet
    .table('Étage terminé', { until: (row) => row.raw('Biome') === null })
    .map((row) => ({
      floor: row.int('Étage terminé'),
      biome: fromLabel(BIOMES, row.text('Biome'), `${unlocksSheet.where} ligne ${row.index}`),
      newUnlock: row.optText('Nouvel élément'),
      counts: {
        warrior: {
          actives: row.int('Guerrier : actives'),
          passives: row.int('Guerrier : passifs'),
        },
        mage: { actives: row.int('Mage : actives'), passives: row.int('Mage : passifs') },
        ranger: { actives: row.int('Tireur : actives'), passives: row.int('Tireur : passifs') },
      },
      affinities: row.int('Affinités'),
      fusions: row.int('Fusions possibles'),
    }));

  const starterKits = unlocksSheet.table('Classe', { count: 3 }).map((row) => ({
    classId: fromLabel(CLASSES, row.text('Classe'), unlocksSheet.where),
    active1: stripNote(row.text('Active 1')),
    active2: stripNote(row.text('Active 2')),
    passive: stripNote(row.text('Passif')),
    firstSupport: stripNote(row.text('Première compétence de soutien')),
  }));

  return {
    params: {
      activeSlots: params.param('Compétences actives équipées'),
      passiveSlots: params.param('Compétences passives équipées'),
      maxUltimates: params.param('Ultimes équipables en même temps'),
      enemiesPerWave: params.param('Ennemis par vague'),
      targetPowerPerTurn: params.param('Puissance moyenne visée par tour'),
      fusionPowerBonus: params.param('Bonus de puissance des fusions'),
      alchemyTowerFloor: params.param("Étage de la Tour d'alchimie"),
      simulatedTurns: params.param('Tours simulés (Rotation)'),
      areaScoreWeight: params.param("Poids d'une attaque de zone (score de recharge)"),
      cooldown1MaxScore: params.param('Score maximum pour une recharge de 1'),
      cooldown2MaxScore: params.param('Score maximum pour une recharge de 2'),
      soloActionsPerRound: params.param("Actions par manche en solo (pour toute l'équipe)"),
      multiActionsPerRound: params.param('Actions par manche en multi (par joueur)'),
      usesPerRound: params.param("Utilisations d'une même compétence par manche"),
      noCooldownLevel: params.param('Niveau requis des compétences sans recharge'),
    },
    bases,
    catalog,
    fusions,
    unlockProgression,
    starterKits,
  };
}
