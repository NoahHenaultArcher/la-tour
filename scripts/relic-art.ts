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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { RELICS, type RelicInfo } from '@la-tour/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(here, '../assets_rpg_tour');

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

interface Img {
  w: number;
  h: number;
  /** RGBA, ligne après ligne. */
  px: Uint8Array;
}

const blank = (w: number, h: number): Img => ({ w, h, px: new Uint8Array(w * h * 4) });

function readPng(file: string): Img {
  const buf = readFileSync(path.join(ASSETS, file));
  let offset = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
        throw new Error(`${file} : PNG RGBA 8 bits non entrelacé attendu`);
    }
    if (type === 'IDAT') idat.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= 4 ? px[y * stride + x - 4]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { w, h, px };
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function writePng(file: string, img: Img): void {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(img.h * (img.w * 4 + 1));
  for (let y = 0; y < img.h; y++)
    raw.set(img.px.subarray(y * img.w * 4, (y + 1) * img.w * 4), y * (img.w * 4 + 1) + 1);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const target = path.join(ASSETS, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, png);
}

// ---------------------------------------------------------------------------
// Pixels et couleurs
// ---------------------------------------------------------------------------

type Rgba = [number, number, number, number];

const get = (img: Img, x: number, y: number): Rgba => {
  const i = (y * img.w + x) * 4;
  return [img.px[i]!, img.px[i + 1]!, img.px[i + 2]!, img.px[i + 3]!];
};

function set(img: Img, x: number, y: number, c: Rgba): void {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  img.px.set(c, (y * img.w + x) * 4);
}

const hex = (value: string, alpha = 255): Rgba => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
  alpha,
];

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Teinte d'une couleur, en gardant ses ombres et lumières (le pixel art garde son relief). */
function tint(c: Rgba, hue: number, satScale: number, lightScale = 1, lightShift = 0): Rgba {
  const [, s, l] = rgbToHsl(c[0], c[1], c[2]);
  const [r, g, b] = hslToRgb(
    hue,
    Math.min(1, s * satScale),
    Math.max(0, Math.min(1, l * lightScale + lightShift)),
  );
  return [r, g, b, c[3]];
}

interface Recolor {
  hue: number;
  sat?: number;
  light?: number;
  shift?: number;
  /** Recolore aussi les gris (sinon les contours et métaux neutres restent tels quels). */
  grays?: boolean;
}

function recolor(img: Img, options: Recolor): Img {
  const out = { ...img, px: new Uint8Array(img.px) };
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const c = get(img, x, y);
      if (c[3] === 0) continue;
      const [, s, l] = rgbToHsl(c[0], c[1], c[2]);
      // Contours très sombres et gris : conservés, sauf demande contraire.
      if (l < 0.13 || (!options.grays && s < 0.12)) continue;
      const source: Rgba = options.grays && s < 0.12 ? [c[0], c[1], c[2], c[3]] : c;
      set(
        out,
        x,
        y,
        tint(
          source,
          options.hue,
          options.grays && s < 0.12 ? Math.max(options.sat ?? 1, 0.35) * 2 : (options.sat ?? 1),
          options.light,
          options.shift,
        ),
      );
    }
  return out;
}

/** Colle `top` sur `base` (transparence simple : tout pixel opaque remplace). */
function paste(base: Img, top: Img, dx: number, dy: number): void {
  for (let y = 0; y < top.h; y++)
    for (let x = 0; x < top.w; x++) {
      const c = get(top, x, y);
      if (c[3] > 40) set(base, x + dx, y + dy, [c[0], c[1], c[2], 255]);
    }
}

/** Réduction au plus proche voisin (facteur entier). */
function shrink(img: Img, factor: number): Img {
  const out = blank(Math.floor(img.w / factor), Math.floor(img.h / factor));
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++)
      set(out, x, y, get(img, x * factor + (factor >> 1), y * factor + (factor >> 1)));
  return out;
}

/** Éclat magique en forme de « + », comme sur les icônes de ressources. */
function sparkle(img: Img, x: number, y: number, color: Rgba = [255, 255, 255, 255]): void {
  set(img, x, y, color);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const)
    set(img, x + dx, y + dy, [color[0], color[1], color[2], 200]);
}

/** Contour sombre d'une pièce ajoutée (1 px autour des pixels opaques). */
function outline(img: Img, color: Rgba): void {
  const copy = { ...img, px: new Uint8Array(img.px) };
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
        return nx >= 0 && ny >= 0 && nx < img.w && ny < img.h && get(copy, nx, ny)[3] > 0;
      });
      if (near) set(img, x, y, color);
    }
}

/** Petit losange (gemme) de 5 px de haut. */
function gem(img: Img, cx: number, cy: number, light: Rgba, dark: Rgba): void {
  const rows = [[0], [-1, 0, 1], [-2, -1, 0, 1, 2], [-1, 0, 1], [0]];
  rows.forEach((xs, i) =>
    xs.forEach((x) => set(img, cx + x, cy - 2 + i, x < 0 || i < 2 ? light : dark)),
  );
  set(img, cx, cy - 1, [255, 255, 255, 255]);
}

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
