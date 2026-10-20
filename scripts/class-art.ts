/**
 * Portraits des évolutions des classes (héritages 10 et 20), dessinés à partir des sprites des
 * classes de base (pas d'IA) : mêmes silhouettes, nouvelles couleurs et détails au pixel près.
 *
 * Usage : pnpm --filter @la-tour/scripts class-art
 *
 * - Mage arcaniste : robe sarcelle, cristal et orbe magenta, runes flottantes.
 * - Archimage : robe ivoire et or, cristal et orbe dorés, halo et étincelles.
 * - Épéiste : tabard bleu roi, cimier bleu, lame qui brille.
 * - Maître d'armes : armure d'acier noir, tabard pourpre, espadon dans le dos (3e arme).
 * - Arbalétier : capuche bordeaux, l'arc remplacé par une arbalète.
 * - Tireur magique : capuche indigo, arc et flèche de lumière, voile scintillant.
 * Une planche de contrôle est écrite dans _planches/evolutions.png.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ASSETS,
  blank,
  get,
  hex,
  hslToRgb,
  paste,
  readPng,
  rgbToHsl,
  set,
  sparkle,
  writePng,
  type Img,
  type Rgba,
} from './art/pixels.ts';

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

const OUTLINE: Rgba = [12, 8, 20, 255];
const clone = (img: Img): Img => ({ ...img, px: new Uint8Array(img.px) });
const isOutline = (c: Rgba) => c[3] > 0 && c[0] === 12 && c[1] === 8 && c[2] === 20;

interface HueShift {
  /** Plage de teintes à recolorer (en degrés, peut passer par 0). */
  from: [number, number];
  minSat?: number;
  maxSat?: number;
  minLight?: number;
  maxLight?: number;
  /** Zone limitée (x0, y0, x1, y1 inclus). */
  region?: [number, number, number, number];
  hue: number;
  sat?: number;
  /** Nouvelle luminosité = l × light + shift (le relief du pixel art est gardé). */
  light?: number;
  shift?: number;
}

const hueIn = (h: number, [min, max]: [number, number]) =>
  min <= max ? h >= min && h <= max : h >= min || h <= max;

/** Recolore les pixels d'une plage de teintes (les autres, peau ou or par exemple, ne bougent pas). */
function shiftHue(img: Img, o: HueShift): void {
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const c = get(img, x, y);
      if (c[3] === 0 || isOutline(c)) continue;
      if (o.region) {
        const [x0, y0, x1, y1] = o.region;
        if (x < x0 || y < y0 || x > x1 || y > y1) continue;
      }
      const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
      if (!hueIn(h, o.from)) continue;
      if (s < (o.minSat ?? 0) || s > (o.maxSat ?? 1)) continue;
      if (l < (o.minLight ?? 0) || l > (o.maxLight ?? 1)) continue;
      const [r, g, b] = hslToRgb(
        o.hue,
        Math.min(1, s * (o.sat ?? 1)),
        Math.max(0, Math.min(1, l * (o.light ?? 1) + (o.shift ?? 0))),
      );
      set(img, x, y, [r, g, b, c[3]]);
    }
}

/** Colle `top` seulement là où `base` est transparent (l'objet passe derrière le personnage). */
function pasteBehind(base: Img, top: Img, dx: number, dy: number): void {
  for (let y = 0; y < top.h; y++)
    for (let x = 0; x < top.w; x++) {
      const c = get(top, x, y);
      const bx = x + dx;
      const by = y + dy;
      if (
        c[3] > 40 &&
        bx >= 0 &&
        by >= 0 &&
        bx < base.w &&
        by < base.h &&
        get(base, bx, by)[3] === 0
      )
        set(base, bx, by, [c[0], c[1], c[2], 255]);
    }
}

/** Halo d'une couleur autour de la silhouette (1 px, semi-transparent). */
function aura(img: Img, color: Rgba): void {
  const copy = clone(img);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (get(copy, x, y)[3] !== 0) continue;
      const near = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => {
        const nx = x + dx!;
        const ny = y + dy!;
        return nx >= 0 && ny >= 0 && nx < img.w && ny < img.h && get(copy, nx, ny)[3] > 200;
      });
      if (near) set(img, x, y, color);
    }
}

/** Trait d'un pixel (Bresenham). */
function line(img: Img, x0: number, y0: number, x1: number, y1: number, c: Rgba): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    set(img, x0, y0, c);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function rect(img: Img, x0: number, y0: number, x1: number, y1: number, c: Rgba): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(img, x, y, c);
}

/** Contours devenus orphelins (plus rien à entourer) : effacés. */
function dropOrphanOutlines(img: Img): void {
  const copy = clone(img);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (!isOutline(get(copy, x, y))) continue;
      let filled = false;
      for (let dy = -1; dy <= 1 && !filled; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= img.w || ny >= img.h) continue;
          const c = get(copy, nx, ny);
          if (c[3] > 0 && !isOutline(c)) filled = true;
        }
      if (!filled) set(img, x, y, [0, 0, 0, 0]);
    }
}

const sparkles = (img: Img, points: [number, number][], color: Rgba) => {
  for (const [x, y] of points) if (get(img, x, y)[3] === 0) sparkle(img, x, y, color);
};

// ---------------------------------------------------------------------------
// Mage
// ---------------------------------------------------------------------------

/** Robe et chapeau du Mage : violets 240-258°. */
const MAGE_ROBE: [number, number] = [238, 258];
/** Cristal du bâton : bleus 188-215°. Orbe : violets 268-280°. */
const MAGE_CRYSTAL: [number, number] = [188, 215];
const MAGE_ORB: [number, number] = [266, 282];

function arcanist(): Img {
  const img = readPng('personnages/mage.png');
  shiftHue(img, { from: MAGE_ROBE, minSat: 0.3, hue: 186, sat: 0.95, light: 1.02 });
  shiftHue(img, { from: MAGE_CRYSTAL, minSat: 0.5, hue: 312, sat: 0.95 });
  shiftHue(img, { from: MAGE_ORB, minSat: 0.5, hue: 318, sat: 1.05 });
  // Runes arcaniques en orbite.
  sparkles(
    img,
    [
      [12, 30],
      [8, 52],
      [84, 26],
      [88, 44],
      [6, 74],
      [90, 66],
    ],
    hex('#ff7ae6'),
  );
  aura(img, hex('#ff5fd8', 90));
  return img;
}

function archmage(): Img {
  const img = readPng('personnages/mage.png');
  // Robe ivoire : on garde les ombres, on éclaircit fortement.
  shiftHue(img, { from: MAGE_ROBE, minSat: 0.3, hue: 42, sat: 0.14, light: 0.62, shift: 0.47 });
  shiftHue(img, { from: MAGE_CRYSTAL, minSat: 0.5, hue: 46, sat: 1, light: 1, shift: 0.05 });
  shiftHue(img, { from: MAGE_ORB, minSat: 0.5, hue: 42, sat: 1, light: 0.95, shift: 0.1 });
  sparkles(
    img,
    [
      [10, 22],
      [6, 44],
      [14, 64],
      [86, 20],
      [90, 40],
      [84, 58],
      [92, 78],
      [4, 84],
    ],
    hex('#fff3b0'),
  );
  aura(img, hex('#ffd34d', 130));
  return img;
}

// ---------------------------------------------------------------------------
// Guerrier
// ---------------------------------------------------------------------------

/** Tabard et cape du Guerrier : rouges 345-12°. Armure : gris bleutés 205-235°. */
const WARRIOR_CLOTH: [number, number] = [345, 12];
const WARRIOR_ARMOR: [number, number] = [200, 240];

/** Cimier sur le haut du casque. */
function crest(img: Img, light: Rgba, dark: Rgba): void {
  // Trouve le haut du casque au centre de la tête (colonne 51).
  let top = 0;
  while (top < img.h && get(img, 51, top)[3] === 0) top++;
  for (let i = 0; i < 4; i++) {
    const y = top - 1 - i;
    if (y < 0) break;
    rect(img, 47 + i, y, 55 - i, y, i % 2 ? dark : light);
    set(img, 46 + i, y, OUTLINE);
    set(img, 56 - i, y, OUTLINE);
  }
}

function swordsman(): Img {
  const img = readPng('personnages/guerrier.png');
  shiftHue(img, { from: WARRIOR_CLOTH, minSat: 0.4, hue: 222, sat: 0.95, light: 1.05 });
  crest(img, hex('#4f7bff'), hex('#2a46b8'));
  // Lame qui brille.
  sparkles(
    img,
    [
      [6, 2],
      [14, 12],
    ],
    hex('#ffffff'),
  );
  aura(img, hex('#6f9bff', 70));
  return img;
}

function weaponMaster(): Img {
  const img = readPng('personnages/guerrier.png');
  // Acier noir (armure), le bouclier et la lame gardent leur éclat.
  shiftHue(img, {
    from: WARRIOR_ARMOR,
    maxSat: 0.35,
    maxLight: 0.74,
    hue: 228,
    sat: 1.1,
    light: 0.62,
  });
  shiftHue(img, { from: WARRIOR_CLOTH, minSat: 0.4, hue: 282, sat: 0.9, light: 0.95 });
  crest(img, hex('#f2c94c'), hex('#b8862a'));
  // 3e arme : un espadon d'adamantite porté dans le dos.
  const sword = readPng('equipements/guerrier/GUE-AR1-P5_epee_en_adamantite.png');
  pasteBehind(img, sword, 38, -6);
  aura(img, hex('#f2c94c', 80));
  return img;
}

// ---------------------------------------------------------------------------
// Tireur
// ---------------------------------------------------------------------------

/** Capuche et cape du Tireur : verts 80-130°. */
const RANGER_CLOAK: [number, number] = [80, 130];
/** Bois et corde de l'arc (couleurs propres à l'arc, à droite du torse). */
const BOW_COLORS = [
  '216,164,102',
  '180,124,64',
  '138,84,40',
  '90,52,24',
  '46,26,14',
  '232,226,200',
];
/** L'arc est à droite du torse ; la flèche, sur la ligne 33, est gardée (carreau). */
const BOW_ZONE = { x0: 55, arrowRow: 33, arrowEnd: 88 };

function isBowPixel(c: Rgba, x: number, y: number): boolean {
  if (x < BOW_ZONE.x0 || c[3] === 0) return false;
  if (y === BOW_ZONE.arrowRow && x <= BOW_ZONE.arrowEnd) return false;
  return BOW_COLORS.includes(`${c[0]},${c[1]},${c[2]}`);
}

/** Arbalète tenue à l'horizontale : arbrier sous le carreau, arc d'acier, corde tendue, détente. */
function drawCrossbow(img: Img): void {
  const wood = hex('#8a5428');
  const woodLight = hex('#b47c40');
  const woodDark = hex('#5a3418');
  const steel = hex('#a9b2c6');
  const steelDark = hex('#4b5068');
  const string = hex('#e8e2c8');
  // Arbrier : de la crosse (contre l'épaule) jusqu'à l'avant.
  rect(img, 58, 34, 86, 36, wood);
  line(img, 58, 34, 86, 34, woodLight);
  line(img, 58, 36, 86, 36, woodDark);
  line(img, 57, 33, 87, 33, get(img, 70, 33)); // le carreau reste par-dessus
  line(img, 57, 37, 87, 37, OUTLINE);
  set(img, 57, 34, OUTLINE);
  set(img, 57, 35, OUTLINE);
  set(img, 57, 36, OUTLINE);
  set(img, 87, 34, OUTLINE);
  set(img, 87, 35, OUTLINE);
  set(img, 87, 36, OUTLINE);
  // Détente sous l'arbrier.
  rect(img, 66, 38, 67, 40, steelDark);
  set(img, 65, 38, OUTLINE);
  set(img, 65, 39, OUTLINE);
  set(img, 65, 40, OUTLINE);
  set(img, 68, 40, OUTLINE);
  rect(img, 66, 41, 67, 41, OUTLINE);
  // Arc d'acier : une courbe continue, bombée vers l'avant, que le carreau traverse.
  const top = 22;
  const bottom = 48;
  for (let y = top; y <= bottom; y++) {
    if (y === 33) continue;
    const x = 80 + Math.round(4 * Math.sin((Math.PI * (y - top)) / (bottom - top)));
    set(img, x - 1, y, OUTLINE);
    set(img, x, y, steel);
    set(img, x + 1, y, steelDark);
    set(img, x + 2, y, OUTLINE);
  }
  set(img, 80, top - 1, OUTLINE);
  set(img, 81, top - 1, OUTLINE);
  set(img, 80, bottom + 1, OUTLINE);
  set(img, 81, bottom + 1, OUTLINE);
  // Corde tendue des extrémités jusqu'à la noix (au-dessus de la détente).
  line(img, 79, 23, 68, 33, string);
  line(img, 79, 47, 68, 37, string);
}

function crossbowman(): Img {
  const img = readPng('personnages/tireur.png');
  shiftHue(img, { from: RANGER_CLOAK, minSat: 0.2, hue: 352, sat: 1.15, light: 1.05 });
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (isBowPixel(get(img, x, y), x, y)) set(img, x, y, [0, 0, 0, 0]);
  dropOrphanOutlines(img);
  drawCrossbow(img);
  aura(img, hex('#d9a066', 60));
  return img;
}

function arcaneArcher(): Img {
  const img = readPng('personnages/tireur.png');
  shiftHue(img, { from: RANGER_CLOAK, minSat: 0.2, hue: 262, sat: 1.1, light: 1.08 });
  // Arc de lumière : le bois de l'arc devient cyan lumineux, la corde blanche.
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const c = get(img, x, y);
      if (!isBowPixel(c, x, y)) continue;
      const [, , l] = rgbToHsl(c[0], c[1], c[2]);
      const [r, g, b] = hslToRgb(188, 0.9, Math.min(0.95, l * 0.7 + 0.35));
      set(img, x, y, [r, g, b, 255]);
    }
  // Pointe de la flèche magique (gris acier 215-225° à l'avant).
  shiftHue(img, { from: [205, 230], region: [84, 28, 95, 38], hue: 300, sat: 4, light: 1 });
  sparkles(
    img,
    [
      [92, 26],
      [94, 40],
      [86, 12],
      [88, 60],
      [4, 30],
      [8, 56],
      [2, 76],
    ],
    hex('#9ff4ff'),
  );
  aura(img, hex('#7fd8ff', 110));
  return img;
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

const EVOLUTIONS: { file: string; name: string; classe: string; draw: () => Img }[] = [
  {
    file: 'personnages/mage_arcaniste.png',
    name: 'Mage arcaniste',
    classe: 'Mage',
    draw: arcanist,
  },
  { file: 'personnages/archimage.png', name: 'Archimage', classe: 'Mage', draw: archmage },
  { file: 'personnages/epeiste.png', name: 'Épéiste', classe: 'Guerrier', draw: swordsman },
  {
    file: 'personnages/maitre_d_armes.png',
    name: "Maître d'armes",
    classe: 'Guerrier',
    draw: weaponMaster,
  },
  { file: 'personnages/arbaletier.png', name: 'Arbalétier', classe: 'Tireur', draw: crossbowman },
  {
    file: 'personnages/tireur_magique.png',
    name: 'Tireur magique',
    classe: 'Tireur',
    draw: arcaneArcher,
  },
];

const images = EVOLUTIONS.map((e) => {
  const img = e.draw();
  writePng(e.file, img);
  return img;
});

// Planche de contrôle (×3) : base puis ses deux évolutions, une ligne par classe.
const SCALE = 3;
const CELL = 96 * SCALE + 12;
const rows = [
  ['personnages/mage.png', 0, 1],
  ['personnages/guerrier.png', 2, 3],
  ['personnages/tireur.png', 4, 5],
] as const;
const sheet = blank(3 * CELL, rows.length * CELL);
rows.forEach(([base, a, b], row) => {
  [readPng(base), images[a]!, images[b]!].forEach((img, col) => {
    const tile = blank(96, 96);
    paste(tile, img, 0, 0);
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 96; x++) {
        const c = get(img, x, y);
        const bg: Rgba = (x >> 3) % 2 === (y >> 3) % 2 ? [54, 50, 66, 255] : [64, 60, 78, 255];
        const out: Rgba =
          c[3] === 0
            ? bg
            : [
                Math.round((c[0] * c[3] + bg[0] * (255 - c[3])) / 255),
                Math.round((c[1] * c[3] + bg[1] * (255 - c[3])) / 255),
                Math.round((c[2] * c[3] + bg[2] * (255 - c[3])) / 255),
                255,
              ];
        for (let k = 0; k < SCALE * SCALE; k++)
          set(
            sheet,
            col * CELL + x * SCALE + (k % SCALE),
            row * CELL + y * SCALE + Math.floor(k / SCALE),
            out,
          );
      }
  });
});
writePng('_planches/evolutions.png', sheet);

// Manifeste : les évolutions à la suite des classes de base.
const manifestFile = path.join(ASSETS, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
manifest.evolutions = EVOLUTIONS.map((e) => ({
  classe: e.classe,
  evolution: e.name,
  fichier: e.file,
  taille: 96,
}));
writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
console.log(`Écrit : ${EVOLUTIONS.length} portraits, _planches/evolutions.png et manifest.json`);
