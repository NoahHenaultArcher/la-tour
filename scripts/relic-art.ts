/**
 * Images des reliques et des œufs de dragon, dessinées à partir des assets du projet (pas d'IA).
 *
 * Usage : pnpm --filter @la-tour/scripts relic-art
 *
 * - Reliques (48 px) : un sprite existant (ressource ou équipement) recoloré dans la teinte du boss,
 *   avec un éclat magique ; quelques détails ajoutés au pixel près.
 * - Œufs (48 px) : dessinés pixel par pixel aux couleurs de l'élément, avec un nid de paille et
 *   l'emblème de l'élément (assets elements/).
 * - Cadres (56 px) : ui/cadre_relique.png (jade, coins dorés) et ui/cadre_oeuf.png (pourpre,
 *   coins coupés et écailles), distincts des cadres de rareté de l'équipement.
 * Lecture et écriture PNG (RGBA 8 bits) avec zlib, sans dépendance.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RELICS, type RelicInfo } from '@la-tour/shared';
import {
  ASSETS,
  blank,
  gem,
  get,
  hex,
  hslToRgb,
  outline,
  paste,
  readPng,
  recolor,
  rgbToHsl,
  set,
  shrink,
  sparkle,
  writePng,
  type Img,
  type Rgba,
  type Recolor,
} from './art/pixels.ts';

// ---------------------------------------------------------------------------
// Reliques
// ---------------------------------------------------------------------------

const OUTLINE: Rgba = hex('#1b1424');

interface RelicArt {
  base: string;
  recolor?: Recolor;
  /** Détails dessinés après la recoloration. */
  extra?: (img: Img) => void;
  sparkles?: [number, number][];
}

const RELIC_ART: Record<string, RelicArt> = {
  'REL-01': {
    base: 'ressources/peau_de_dragon.png',
    recolor: { hue: 26, sat: 0.6, light: 0.95 },
    sparkles: [[40, 8]],
  },
  'REL-02': {
    base: 'ressources/or.png',
    extra: (img) => gem(img, 24, 14, hex('#9df06b'), hex('#3f9a2a')),
    sparkles: [[38, 10]],
  },
  'REL-03': {
    base: 'equipements/mage/MAG-AR1-P1_baton_en_bois.png',
    recolor: { hue: 110, sat: 1.1 },
    extra: (img) => {
      gem(img, 36, 11, hex('#e8ff9a'), hex('#5aa830'));
    },
    sparkles: [[41, 5]],
  },
  'REL-04': {
    base: 'ressources/os_de_dragon.png',
    recolor: { hue: 12, sat: 0.9, light: 0.92, grays: true },
    sparkles: [[40, 9]],
  },
  'REL-05': {
    base: 'ressources/charbon.png',
    recolor: { hue: 30, sat: 0.25, light: 1.6, shift: 0.05, grays: true },
    extra: (img) => {
      // Runes ancestrales qui rougeoient.
      for (const [x, y] of [
        [17, 22],
        [18, 23],
        [19, 22],
        [27, 28],
        [28, 27],
        [28, 29],
        [22, 32],
        [23, 32],
      ] as const)
        set(img, x, y, hex('#ff9a3c'));
    },
    sparkles: [[38, 12]],
  },
  'REL-06': {
    base: 'ressources/verre.png',
    recolor: { hue: 36, sat: 2.2, light: 0.72 },
    extra: (img) => {
      for (const [x, y] of [
        [23, 25],
        [24, 24],
        [25, 25],
        [24, 26],
        [23, 27],
        [25, 27],
      ] as const)
        set(img, x, y, hex('#ff5a1f'));
    },
    sparkles: [[34, 10]],
  },
  'REL-07': {
    base: 'ressources/quartz.png',
    recolor: { hue: 24, sat: 2.4, light: 0.8 },
    sparkles: [
      [40, 10],
      [10, 16],
    ],
  },
  'REL-08': {
    base: 'equipements/guerrier/GUE-COL-P1_medaillon_en_cuivre.png',
    recolor: { hue: 46, sat: 1.3, light: 1.05 },
    extra: (img) => gem(img, 24, 6, hex('#7ff0e0'), hex('#1f8f86')),
    sparkles: [[38, 14]],
  },
  'REL-09': {
    base: 'ressources/ether.png',
    recolor: { hue: 95, sat: 1.1 },
    sparkles: [[38, 8]],
  },
  'REL-10': {
    base: 'ressources/saphir.png',
    recolor: { hue: 350, sat: 0.75, light: 0.85 },
    extra: (img) => {
      for (const [x, y] of [
        [20, 20],
        [26, 28],
        [29, 22],
      ] as const)
        set(img, x, y, hex('#8fd14f'));
    },
  },
  'REL-11': {
    base: 'ressources/verre.png',
    recolor: { hue: 268, sat: 1.2, light: 0.6 },
    sparkles: [[34, 10]],
  },
  'REL-12': {
    base: 'equipements/mage/MAG-AR1-P4_baton_en_cristal.png',
    recolor: { hue: 186, sat: 1.2 },
    sparkles: [[42, 5]],
  },
  'REL-13': {
    base: 'ressources/laine.png',
    recolor: { hue: 205, sat: 0.6, light: 1.3, grays: true },
    sparkles: [[40, 10]],
  },
  'REL-14': {
    base: 'ressources/chene.png',
    recolor: { hue: 150, sat: 1.1, light: 1.05 },
    extra: (img) => gem(img, 24, 8, hex('#d2ffe8'), hex('#2a9a6c')),
    sparkles: [
      [40, 8],
      [8, 20],
    ],
  },
  'REL-15': {
    base: 'ressources/cristal.png',
    recolor: { hue: 52, sat: 1.4, light: 1.0 },
    sparkles: [[40, 8]],
  },
  'REL-16': {
    base: 'equipements/tireur/TIR-COL-P1_pendentif_en_cuivre.png',
    recolor: { hue: 100, sat: 1.2, grays: true },
    sparkles: [[38, 12]],
  },
  'REL-17': {
    base: 'equipements/mage/MAG-AR2-P5_orbe_en_diamant.png',
    recolor: { hue: 48, sat: 0.9, light: 1.05 },
    sparkles: [
      [38, 8],
      [10, 12],
    ],
  },
  'REL-18': {
    base: 'equipements/guerrier/GUE-AR2-P4_bouclier_en_mithril.png',
    recolor: { hue: 46, sat: 0.55, light: 1.2 },
    sparkles: [[40, 6]],
  },
  'REL-19': {
    base: 'ressources/ecailles.png',
    recolor: { hue: 272, sat: 1.0, light: 0.7 },
    sparkles: [[40, 10]],
  },
  'REL-20': {
    base: 'equipements/guerrier/GUE-CHA-UNI_heaume_du_roi_dechu.png',
    recolor: { hue: 352, sat: 1.1, light: 0.85 },
    sparkles: [[40, 6]],
  },
};

function drawRelic(relic: RelicInfo): Img {
  const art = RELIC_ART[relic.id];
  if (!art) throw new Error(`Pas de dessin pour ${relic.id}`);
  const base = readPng(art.base);
  const img = art.recolor ? recolor(base, art.recolor) : base;
  art.extra?.(img);
  for (const [x, y] of art.sparkles ?? []) sparkle(img, x, y);
  return img;
}

// ---------------------------------------------------------------------------
// Œufs
// ---------------------------------------------------------------------------

const ELEMENT_COLORS: Record<string, string> = {
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

const ELEMENT_ICONS: Record<string, string> = {
  fire: 'elements/feu.png',
  lightning: 'elements/electricite.png',
  acid: 'elements/acide.png',
  ice: 'elements/glace.png',
  water: 'elements/eau.png',
  wind: 'elements/vent.png',
  earth: 'elements/terre.png',
  shadow: 'elements/ombre.png',
  light: 'elements/lumiere.png',
  neutral: 'elements/neutre.png',
};

/** Aléa fixe (mêmes taches à chaque génération). */
const noise = (x: number, y: number, seed: number) => {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
};

function drawEgg(element: string, seed: number): Img {
  const img = blank(48, 48);
  const [r, g, b] = hex(ELEMENT_COLORS[element]!);
  const [hue, sat, light] = rgbToHsl(r, g, b);
  // Palette de l'œuf : 5 tons de l'élément, du plus sombre au plus clair.
  const satEgg = Math.max(0.25, Math.min(0.85, sat));
  const tone = (l: number): Rgba => [...hslToRgb(hue, satEgg, l), 255];
  const base = Math.max(0.35, Math.min(0.62, light));
  const tones = [
    tone(base - 0.28),
    tone(base - 0.15),
    tone(base),
    tone(base + 0.12),
    tone(base + 0.24),
  ];
  const spot = tone(base - 0.22);
  const cx = 24;
  const cy = 22;
  const ry = 17;
  const rx = 13;
  const inside = (x: number, y: number) => {
    const ny = (y + 0.5 - cy) / ry;
    // Haut de l'œuf plus étroit que le bas.
    const width = rx * (ny < 0 ? 1 + 0.22 * ny : 1 - 0.05 * ny);
    const nx = (x + 0.5 - cx) / width;
    return nx * nx + ny * ny <= 1;
  };
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 48; x++) {
      if (!inside(x, y)) continue;
      // Lumière venant du haut à gauche : 5 bandes de tons.
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const lit = -0.55 * nx - 0.7 * ny + 0.35 * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const band = Math.max(0, Math.min(4, Math.round(1.6 + lit * 2.4)));
      let color = tones[band]!;
      // Taches de dragon.
      if (noise(Math.floor(x / 2), Math.floor(y / 2), seed) > 0.86 && band < 4) color = spot;
      set(img, x, y, color);
    }
  // Reflet.
  for (const [x, y] of [
    [18, 10],
    [17, 11],
    [18, 11],
    [17, 12],
    [16, 13],
  ] as const)
    set(img, x, y, [255, 255, 255, 230]);
  outline(img, OUTLINE);

  // Nid de paille (tons de la ressource lin).
  const straw = [hex('#8a6a3a'), hex('#b8925a'), hex('#e0c48a')];
  for (let x = 9; x <= 38; x++) {
    const curve = Math.round(Math.abs(x - 24) * 0.18);
    for (let y = 36 - curve; y <= 41 - Math.round(curve / 2); y++) {
      const shade = (x + y * 2 + (noise(x, y, 7) > 0.5 ? 1 : 0)) % 3;
      set(img, x, y, straw[shade]!);
    }
  }
  for (let x = 8; x <= 39; x++) {
    set(img, x, 42, OUTLINE);
  }
  // Emblème de l'élément, réduit de moitié, en bas à droite.
  const emblem = shrink(readPng(ELEMENT_ICONS[element]!), 2);
  paste(img, emblem, 26, 26);
  sparkle(img, 38, 6);
  return img;
}

// ---------------------------------------------------------------------------
// Cadres (56 px, comme ui/cadre_*.png)
// ---------------------------------------------------------------------------

function drawFrame(kind: 'relic' | 'egg'): Img {
  const img = blank(56, 56);
  const palette =
    kind === 'relic'
      ? { light: hex('#7ff0d0'), mid: hex('#2fb59a'), dark: hex('#187560') }
      : { light: hex('#ff9cc8'), mid: hex('#c23a7a'), dark: hex('#6e1d45') };
  const chamfer = kind === 'egg' ? 6 : 0;
  // Coins coupés pour les œufs : un pixel est dans le cadre s'il n'est pas dans un coin retiré.
  const inShape = (x: number, y: number) =>
    !chamfer ||
    (x + y >= chamfer &&
      55 - x + y >= chamfer &&
      x + 55 - y >= chamfer &&
      55 - x + 55 - y >= chamfer);
  for (let y = 0; y < 56; y++)
    for (let x = 0; x < 56; x++) {
      if (!inShape(x, y)) continue;
      const d = Math.min(x, y, 55 - x, 55 - y);
      // Distance au bord en tenant compte des coins coupés.
      const diag = chamfer
        ? Math.min(x + y, 55 - x + y, x + 55 - y, 110 - x - y) - chamfer
        : Infinity;
      const edge = Math.min(d, Math.floor(diag / 1.5));
      if (edge >= 5) continue;
      let color: Rgba;
      if (edge === 0 || edge === 4) color = OUTLINE;
      else if (edge === 1) color = x < 28 && y < 28 ? palette.light : palette.mid;
      else if (edge === 2) color = palette.mid;
      else color = palette.dark;
      // Écailles sur le cadre des œufs.
      if (kind === 'egg' && edge === 2 && (x + y) % 4 === 0) color = palette.light;
      set(img, x, y, color);
    }
  if (kind === 'relic') {
    // Coins dorés ornés et gemmes au milieu des côtés.
    const gold = hex('#f0c040');
    const goldDark = hex('#9a6a10');
    for (const [cx, cy] of [
      [0, 0],
      [49, 0],
      [0, 49],
      [49, 49],
    ] as const)
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 7; x++) {
          const border = x === 0 || y === 0 || x === 6 || y === 6;
          set(img, cx + x, cy + y, border ? OUTLINE : (x + y) % 2 === 0 ? gold : goldDark);
        }
    for (const [x, y] of [
      [27, 2],
      [27, 53],
      [2, 27],
      [53, 27],
    ] as const)
      gem(img, x, y, hex('#d2fff0'), palette.dark);
  } else {
    // Yeux de dragon au milieu des côtés.
    for (const [x, y] of [
      [27, 2],
      [27, 53],
      [2, 27],
      [53, 27],
    ] as const)
      gem(img, x, y, hex('#ffd36a'), hex('#a8351f'));
  }
  return img;
}

// ---------------------------------------------------------------------------

writePng('ui/cadre_relique.png', drawFrame('relic'));
writePng('ui/cadre_oeuf.png', drawFrame('egg'));
let seed = 1;
for (const relic of RELICS) {
  const img = relic.kind === 'egg' ? drawEgg(relic.effect.element!, seed++) : drawRelic(relic);
  writePng(relic.image, img);
}
// Planche de contrôle : toutes les images côte à côte (×2), cadres compris.
const sheet = blank(10 * 112, 4 * 112);
RELICS.forEach((relic, i) => {
  const img = readPng(relic.image);
  const frame = readPng(relic.kind === 'egg' ? 'ui/cadre_oeuf.png' : 'ui/cadre_relique.png');
  const ox = (i % 10) * 112;
  const oy = Math.floor(i / 10) * 112;
  for (let y = 0; y < 56; y++)
    for (let x = 0; x < 56; x++) {
      const inner = x >= 4 && y >= 4 && x < 52 && y < 52 ? get(img, x - 4, y - 4) : null;
      const c = inner && inner[3] > 40 ? inner : get(frame, x, y);
      for (let k = 0; k < 4; k++) set(sheet, ox + x * 2 + (k % 2), oy + y * 2 + (k >> 1), c);
    }
});
writePng('_planches/reliques.png', sheet);

// Manifeste : les reliques, les œufs et leurs cadres (même indentation que le fichier d'origine).
const manifestFile = path.join(ASSETS, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
manifest.cadres_reliques = [
  {
    id: 'relique',
    nom: 'Relique',
    couleur: '#2fb59a',
    fichier: 'ui/cadre_relique.png',
    taille: 56,
  },
  {
    id: 'oeuf',
    nom: 'Œuf de dragon',
    couleur: '#c23a7a',
    fichier: 'ui/cadre_oeuf.png',
    taille: 56,
  },
];
manifest.reliques = RELICS.map((r) => ({
  id: r.id,
  type: r.kind === 'egg' ? 'oeuf' : 'relique',
  nom: r.name,
  monstre: r.monsterId,
  fichier: r.image,
  taille: 48,
}));
writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
console.log(`Écrit : ${RELICS.length} images, 2 cadres, _planches/reliques.png et manifest.json`);
