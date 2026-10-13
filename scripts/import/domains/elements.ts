import { ELEMENT_IDS, type ElementId } from '@la-tour/shared';
import type { ElementsData } from '@la-tour/shared/schemas';
import type { ImportContext } from '../context.ts';
import { BIOMES, ELEMENTS, fromLabel, slugify, splitList } from '../labels.ts';
import { ImportError, type Sheet } from '../workbook.ts';

type Matrix = Record<ElementId, Record<ElementId, number>>;

const MATRIX_ANCHOR = 'Défenseur ↓ / Attaquant →';

/** Lit une matrice d'avantages (défenseur en ligne, attaquant en colonne). */
export function readMatrix(sheet: Sheet): Matrix {
  const table = sheet.table(MATRIX_ANCHOR, { count: ELEMENT_IDS.length });
  const matrix = {} as Matrix;
  for (const row of table.rows) {
    const defender = fromLabel(
      ELEMENTS,
      row.text(MATRIX_ANCHOR),
      `${sheet.where} ligne ${row.index}`,
    );
    const line = {} as Record<ElementId, number>;
    for (const [label, attacker] of Object.entries(ELEMENTS)) line[attacker] = row.num(label);
    matrix[defender] = line;
  }
  return matrix;
}

function assertSameMatrix(reference: Matrix, other: Matrix, where: string): void {
  for (const defender of ELEMENT_IDS) {
    for (const attacker of ELEMENT_IDS) {
      if (reference[defender][attacker] !== other[defender][attacker]) {
        throw new ImportError(
          `${where} : la matrice d'avantages diffère de Elements_Fusions › Avantages (défenseur ${defender}, attaquant ${attacker}).`,
        );
      }
    }
  }
}

export function importElements({ books, images }: ImportContext): ElementsData {
  const advantages = books.elements.sheet('Avantages');
  const matrix = readMatrix(advantages);
  // Les copies de la matrice dans les autres classeurs doivent être identiques.
  for (const sheet of [books.bestiary.sheet('Éléments'), books.skills.sheet('Éléments')]) {
    assertSameMatrix(matrix, readMatrix(sheet), sheet.where);
  }

  const baseSheet = books.elements.sheet('Éléments de base');
  const base = new Map(
    baseSheet
      .table('Élément')
      .map((row) => [fromLabel(ELEMENTS, row.text('Élément'), baseSheet.where), row]),
  );

  const bestiarySheet = books.bestiary.sheet('Éléments');
  const bestiary = new Map(
    bestiarySheet
      .table('Élément', { count: ELEMENT_IDS.length })
      .map((row) => [fromLabel(ELEMENTS, row.text('Élément'), bestiarySheet.where), row]),
  );

  const skillsSheet = books.skills.sheet('Éléments');
  const skills = new Map(
    skillsSheet
      .table('Élément', { count: ELEMENT_IDS.length })
      .map((row) => [fromLabel(ELEMENTS, row.text('Élément'), skillsSheet.where), row]),
  );

  const toElements = (value: string | null, where: string) =>
    splitList(value).map((label) => fromLabel(ELEMENTS, label, where));

  const elements = ELEMENT_IDS.map((id) => {
    const b = base.get(id);
    const be = bestiary.get(id);
    const s = skills.get(id);
    if (!b || !be || !s) {
      throw new ImportError(
        `Élément « ${id} » absent d'un des onglets Éléments (Elements_Fusions, bestiaire, compétences).`,
      );
    }
    const name = b.text('Élément');
    const suffix = s.text('Nom des variantes');
    const weakAgainst = toElements(be.optText('Faible contre (×1,5)'), bestiarySheet.where);
    const resists = toElements(be.optText('Résiste à (×0,75)'), bestiarySheet.where);

    // Les listes « faible contre / résiste à » doivent refléter la matrice.
    for (const attacker of ELEMENT_IDS) {
      const factor = matrix[id][attacker];
      const listed = weakAgainst.includes(attacker) ? 1.5 : resists.includes(attacker) ? 0.75 : 1;
      if (factor !== listed) {
        throw new ImportError(
          `${bestiarySheet.where} : ${name} contre ${attacker} vaut ×${factor} dans la matrice mais ×${listed} d'après les colonnes faible/résiste.`,
        );
      }
    }

    return {
      id,
      name,
      icon: b.text('Icône'),
      role: b.text('Rôle principal'),
      baseEffect: b.text('Effet de base'),
      identity: b.text('Identité / notes'),
      biome: fromLabel(BIOMES, be.text('Biome'), bestiarySheet.where),
      unlockFloor: s.int('Étage à terminer'),
      skillVariantSuffix: suffix.startsWith('(') ? null : suffix,
      skillAlteration: s.optText('Altération'),
      attackEffect: s.text('Effet ajouté aux attaques'),
      supportEffect: s.text('Effet ajouté aux soutiens (buff, soin, bouclier, debuff)'),
      affinityPassive: s.text("Passif d'affinité"),
      weakAgainst,
      resists,
      inflictedAlterations: splitList(be.optText('Altérations infligées dans ce biome')),
      image: images.get('element', slugify(name)),
    };
  });

  const biomes = ELEMENT_IDS.map((element) => {
    const row = bestiary.get(element)!;
    return {
      id: fromLabel(BIOMES, row.text('Biome'), bestiarySheet.where),
      name: row.text('Biome'),
      element,
      floorMin: row.int('Étage min'),
      floorMax: row.int('Étage max'),
    };
  });

  const fusionSheet = books.elements.sheet('Fusions');
  const fusions = fusionSheet.table('Élément A').map((row) => {
    const name = row.text('Nom de fusion');
    return {
      element1: fromLabel(ELEMENTS, row.text('Élément A'), fusionSheet.where),
      element2: fromLabel(ELEMENTS, row.text('Élément B'), fusionSheet.where),
      name,
      proposedEffect: row.text('Effet proposé'),
      role: row.text('Rôle / synergie'),
      advantageNote: row.text('Avantage élémentaire à tester'),
      status: row.text('Statut'),
      image: images.get('fusion', name),
    };
  });

  const rules = books.elements
    .sheet('Règles')
    .table('Sujet')
    .map((row) => ({
      subject: row.text('Sujet'),
      rule: row.text('Règle proposée'),
      reason: row.text('Pourquoi'),
    }));

  return { elements, biomes, matrix, fusions, rules };
}
