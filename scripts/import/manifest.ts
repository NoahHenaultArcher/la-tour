/**
 * Index des images de assets_rpg_tour/manifest.json.
 * Une image absente n'est pas bloquante : elle est signalée et remplacée par null
 * (le client affiche alors une image par défaut).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ImportError } from './workbook.ts';

const entry = z.object({ fichier: z.string() }).loose();
const manifestSchema = z
  .object({
    personnages: z.array(entry.extend({ classe: z.string() })),
    monstres: z.array(entry.extend({ id: z.string() })),
    equipements: z.array(
      entry.extend({ id: z.string(), ids_catalogue: z.array(z.string()).optional() }),
    ),
    village: z.array(entry.extend({ id: z.string() })),
    ressources: z.array(entry.extend({ id: z.string() })),
    elements: z.array(entry.extend({ id: z.string() })),
    cadres_rarete: z.array(entry.extend({ id: z.string(), couleur: z.string() })),
    competences: z.array(entry.extend({ id: z.string() })),
    fusions: z.array(entry.extend({ nom: z.string() })),
  })
  .loose();

export type ImageKind =
  | 'personnage'
  | 'monstre'
  | 'equipement'
  | 'village'
  | 'ressource'
  | 'element'
  | 'cadre'
  | 'competence'
  | 'fusion';

export class ImageIndex {
  readonly warnings: string[] = [];
  private readonly maps = new Map<ImageKind, Map<string, string>>();
  readonly frameColors = new Map<string, string>();

  constructor(private readonly assetsDir: string) {
    const file = path.join(assetsDir, 'manifest.json');
    let parsed: z.infer<typeof manifestSchema>;
    try {
      parsed = manifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    } catch (error) {
      throw new ImportError(
        `manifest.json illisible ou incomplet (${file}) : ${(error as Error).message}`,
      );
    }
    this.add(
      'personnage',
      parsed.personnages.map((e) => [e.classe, e.fichier]),
    );
    this.add(
      'monstre',
      parsed.monstres.map((e) => [e.id, e.fichier]),
    );
    this.add(
      'equipement',
      parsed.equipements.flatMap((e) =>
        (e.ids_catalogue ?? [e.id]).map((id): [string, string] => [id, e.fichier]),
      ),
    );
    this.add(
      'village',
      parsed.village.map((e) => [e.id, e.fichier]),
    );
    this.add(
      'ressource',
      parsed.ressources.map((e) => [e.id, e.fichier]),
    );
    this.add(
      'element',
      parsed.elements.map((e) => [e.id, e.fichier]),
    );
    this.add(
      'cadre',
      parsed.cadres_rarete.map((e) => [e.id, e.fichier]),
    );
    this.add(
      'competence',
      parsed.competences.map((e) => [e.id, e.fichier]),
    );
    this.add(
      'fusion',
      parsed.fusions.map((e) => [e.nom, e.fichier]),
    );
    for (const frame of parsed.cadres_rarete) this.frameColors.set(frame.id, frame.couleur);
  }

  private add(kind: ImageKind, entries: [string, string][]): void {
    this.maps.set(kind, new Map(entries));
  }

  /** Chemin relatif à assets_rpg_tour/, ou null (avec un avertissement) si l'image manque. */
  get(kind: ImageKind, key: string): string | null {
    const file = this.maps.get(kind)?.get(key);
    if (!file) {
      this.warnings.push(`image ${kind} « ${key} » absente du manifest`);
      return null;
    }
    if (!existsSync(path.join(this.assetsDir, file))) {
      this.warnings.push(`image ${kind} « ${key} » : fichier ${file} introuvable`);
      return null;
    }
    return file;
  }
}
