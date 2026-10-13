/**
 * Lecture des classeurs : valeurs calculées uniquement (jamais les formules).
 * Les tableaux sont repérés par le texte de leur en-tête, pas par la lettre de colonne,
 * pour résister à un déplacement de colonne. Toute anomalie lève une ImportError
 * qui cite le classeur, l'onglet et la cellule.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export type CellValue = string | number | boolean | null;

/** Valeurs qui signifient « rien » dans les classeurs. */
const EMPTY_MARKERS = new Set(['', '—', '-', 'Aucun', 'Aucune']);

/** Compare deux libellés sans tenir compte des espaces superflus ni du type d'apostrophe. */
export function normalizeLabel(value: string): string {
  return value.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

export class Workbook {
  readonly fileName: string;
  private readonly book: XLSX.WorkBook;

  constructor(filePath: string) {
    this.fileName = path.basename(filePath);
    try {
      this.book = XLSX.read(readFileSync(filePath), {
        cellFormula: true,
        cellHTML: false,
        cellText: false,
      });
    } catch (error) {
      throw new ImportError(`Impossible de lire ${filePath} : ${(error as Error).message}`);
    }
  }

  sheet(name: string): Sheet {
    const ws = this.book.Sheets[name];
    if (!ws) {
      throw new ImportError(
        `${this.fileName} : onglet « ${name} » introuvable (onglets présents : ${this.book.SheetNames.join(', ')}).`,
      );
    }
    return new Sheet(this.fileName, name, ws);
  }
}

export class Sheet {
  private readonly range: XLSX.Range;

  constructor(
    readonly fileName: string,
    readonly name: string,
    private readonly ws: XLSX.WorkSheet,
  ) {
    this.range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
  }

  get where(): string {
    return `${this.fileName} › ${this.name}`;
  }

  get lastRow(): number {
    return this.range.e.r + 1;
  }

  get lastColumn(): number {
    return this.range.e.c + 1;
  }

  /** Valeur calculée d'une cellule (row et col commencent à 1). */
  value(row: number, col: number): CellValue {
    const cell = this.ws[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })] as
      XLSX.CellObject | undefined;
    if (!cell || cell.v === undefined || cell.t === 'z') return null;
    if (cell.t === 'e') {
      throw new ImportError(
        `${this.where} : la cellule ${address(row, col)} contient une erreur Excel (${cell.w ?? cell.v}).`,
      );
    }
    // Une formule qui renvoie "" est traitée comme une cellule vide.
    if (typeof cell.v === 'string') return cell.v.trim() === '' ? null : cell.v.trim();
    if (cell.v instanceof Date) return cell.v.toISOString();
    return cell.v;
  }

  /** Vrai si la cellule est calculée par une formule (faux pour une valeur saisie à la main). */
  isFormula(row: number, col: number): boolean {
    const cell = this.ws[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })] as
      XLSX.CellObject | undefined;
    return Boolean(cell?.f);
  }

  valueAt(ref: string): CellValue {
    const { r, c } = XLSX.utils.decode_cell(ref);
    return this.value(r + 1, c + 1);
  }

  /** Numéro de la n-ième ligne (à partir de `fromRow`) dont la colonne `col` vaut `label`. */
  findRow(
    label: string,
    options: { col?: number; fromRow?: number; occurrence?: number } = {},
  ): number {
    const col = options.col ?? 1;
    let remaining = options.occurrence ?? 1;
    const wanted = normalizeLabel(label);
    for (let row = options.fromRow ?? 1; row <= this.lastRow; row++) {
      const v = this.value(row, col);
      if (typeof v === 'string' && normalizeLabel(v) === wanted && --remaining === 0) return row;
    }
    throw new ImportError(
      `${this.where} : ligne « ${label} » introuvable en colonne ${columnName(col)}.`,
    );
  }

  /** Numéro de la première ligne dont la colonne A commence par `prefix` (titres de section). */
  findRowStartingWith(prefix: string, fromRow = 1): number {
    const wanted = normalizeLabel(prefix);
    for (let row = fromRow; row <= this.lastRow; row++) {
      const v = this.value(row, 1);
      if (typeof v === 'string' && normalizeLabel(v).startsWith(wanted)) return row;
    }
    throw new ImportError(`${this.where} : section « ${prefix}… » introuvable.`);
  }

  /**
   * Lit un tableau dont l'en-tête contient `anchor` en colonne A.
   * Sans `count`, les lignes sont lues jusqu'à la première dont la colonne A est vide
   * (ou, avec `until`, jusqu'à la première ligne qui vérifie la condition, ex. une note sous le tableau).
   */
  table(
    anchor: string,
    options: {
      fromRow?: number;
      occurrence?: number;
      count?: number;
      until?: (row: Row) => boolean;
    } = {},
  ): Table {
    const headerRow = this.findRow(anchor, options);
    const headers = new Map<string, number[]>();
    for (let col = 1; col <= this.lastColumn; col++) {
      const v = this.value(headerRow, col);
      if (typeof v !== 'string' || v === '') continue;
      const key = normalizeLabel(v);
      headers.set(key, [...(headers.get(key) ?? []), col]);
    }
    const rows: Row[] = [];
    for (let row = headerRow + 1; row <= this.lastRow; row++) {
      if (options.count !== undefined) {
        if (rows.length === options.count) break;
      } else if (this.value(row, 1) === null) {
        break;
      }
      const current = new Row(this, row, headers);
      if (options.until?.(current)) break;
      rows.push(current);
    }
    if (options.count !== undefined && rows.length !== options.count) {
      throw new ImportError(
        `${this.where} : le tableau « ${anchor} » devrait avoir ${options.count} lignes, ${rows.length} trouvées.`,
      );
    }
    return new Table(this, anchor, headerRow, rows);
  }

  /** Paramètres « libellé | valeur » : libellé en colonne `labelCol`, valeur juste à droite. */
  param(label: string, options: { labelCol?: number; fromRow?: number } = {}): number {
    const labelCol = options.labelCol ?? 1;
    const row = this.findRow(label, { col: labelCol, fromRow: options.fromRow });
    return toNumber(
      this.value(row, labelCol + 1),
      `${this.where} : paramètre « ${label} » (${address(row, labelCol + 1)})`,
    );
  }

  paramText(label: string, options: { labelCol?: number; fromRow?: number } = {}): string {
    const labelCol = options.labelCol ?? 1;
    const row = this.findRow(label, { col: labelCol, fromRow: options.fromRow });
    return toText(
      this.value(row, labelCol + 1),
      `${this.where} : paramètre « ${label} » (${address(row, labelCol + 1)})`,
    );
  }
}

export class Table {
  constructor(
    readonly sheet: Sheet,
    readonly anchor: string,
    readonly headerRow: number,
    readonly rows: Row[],
  ) {}

  map<T>(fn: (row: Row) => T): T[] {
    return this.rows.map(fn);
  }
}

export class Row {
  constructor(
    private readonly sheet: Sheet,
    readonly index: number,
    private readonly headers: Map<string, number[]>,
  ) {}

  private column(header: string, occurrence: number): number {
    const cols = this.headers.get(normalizeLabel(header));
    const col = cols?.[occurrence];
    if (col === undefined) {
      const known = [...this.headers.keys()].join(' | ');
      throw new ImportError(
        `${this.sheet.where} : colonne « ${header} »${occurrence > 0 ? ` (n° ${occurrence + 1})` : ''} introuvable dans l'en-tête ligne ${this.index}. Colonnes : ${known}`,
      );
    }
    return col;
  }

  private context(header: string, occurrence: number): string {
    return `${this.sheet.where} : cellule ${address(this.index, this.column(header, occurrence))} (« ${header} »)`;
  }

  has(header: string): boolean {
    return this.headers.has(normalizeLabel(header));
  }

  raw(header: string, occurrence = 0): CellValue {
    return this.sheet.value(this.index, this.column(header, occurrence));
  }

  isFormula(header: string, occurrence = 0): boolean {
    return this.sheet.isFormula(this.index, this.column(header, occurrence));
  }

  text(header: string, occurrence = 0): string {
    return toText(this.raw(header, occurrence), this.context(header, occurrence));
  }

  optText(header: string, occurrence = 0): string | null {
    const v = this.raw(header, occurrence);
    if (v === null || (typeof v === 'string' && EMPTY_MARKERS.has(v))) return null;
    return toText(v, this.context(header, occurrence));
  }

  num(header: string, occurrence = 0): number {
    return toNumber(this.raw(header, occurrence), this.context(header, occurrence));
  }

  optNum(header: string, occurrence = 0): number | null {
    const v = this.raw(header, occurrence);
    if (v === null || (typeof v === 'string' && EMPTY_MARKERS.has(v))) return null;
    return toNumber(v, this.context(header, occurrence));
  }

  int(header: string, occurrence = 0): number {
    const v = this.num(header, occurrence);
    if (!Number.isInteger(v)) {
      throw new ImportError(`${this.context(header, occurrence)} : entier attendu, trouvé ${v}.`);
    }
    return v;
  }

  optInt(header: string, occurrence = 0): number | null {
    const v = this.optNum(header, occurrence);
    if (v !== null && !Number.isInteger(v)) {
      throw new ImportError(`${this.context(header, occurrence)} : entier attendu, trouvé ${v}.`);
    }
    return v;
  }

  /** Valeur « Oui » / « Non ». */
  yesNo(header: string, occurrence = 0): boolean {
    const v = this.text(header, occurrence);
    if (v === 'Oui') return true;
    if (v === 'Non') return false;
    throw new ImportError(
      `${this.context(header, occurrence)} : « Oui » ou « Non » attendu, trouvé « ${v} ».`,
    );
  }

  /** Cellule de la colonne n (1 = A), pour les tableaux sans en-tête exploitable. */
  at(col: number): CellValue {
    return this.sheet.value(this.index, col);
  }
}

export function toNumber(value: CellValue, context: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new ImportError(`${context} : nombre attendu, trouvé ${describe(value)}.`);
}

export function toText(value: CellValue, context: string): string {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number') return String(value);
  throw new ImportError(`${context} : texte attendu, trouvé ${describe(value)}.`);
}

function describe(value: CellValue): string {
  return value === null ? 'une cellule vide' : `« ${String(value)} »`;
}

export function columnName(col: number): string {
  return XLSX.utils.encode_col(col - 1);
}

export function address(row: number, col: number): string {
  return `${columnName(col)}${row}`;
}
