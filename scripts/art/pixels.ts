/**
 * Outils de dessin des scripts d'images (reliques, évolutions des classes) : lecture et écriture
 * PNG (RGBA 8 bits) avec zlib, sans dépendance, et retouches au pixel près.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS = path.resolve(here, '../../assets_rpg_tour');

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

export interface Img {
  w: number;
  h: number;
  /** RGBA, ligne après ligne. */
  px: Uint8Array;
}

export const blank = (w: number, h: number): Img => ({ w, h, px: new Uint8Array(w * h * 4) });

export function readPng(file: string): Img {
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

export function writePng(file: string, img: Img): void {
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

export type Rgba = [number, number, number, number];

export const get = (img: Img, x: number, y: number): Rgba => {
  const i = (y * img.w + x) * 4;
  return [img.px[i]!, img.px[i + 1]!, img.px[i + 2]!, img.px[i + 3]!];
};

export function set(img: Img, x: number, y: number, c: Rgba): void {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  img.px.set(c, (y * img.w + x) * 4);
}

export const hex = (value: string, alpha = 255): Rgba => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
  alpha,
];

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Teinte d'une couleur, en gardant ses ombres et lumières (le pixel art garde son relief). */
export function tint(c: Rgba, hue: number, satScale: number, lightScale = 1, lightShift = 0): Rgba {
  const [, s, l] = rgbToHsl(c[0], c[1], c[2]);
  const [r, g, b] = hslToRgb(
    hue,
    Math.min(1, s * satScale),
    Math.max(0, Math.min(1, l * lightScale + lightShift)),
  );
  return [r, g, b, c[3]];
}

export interface Recolor {
  hue: number;
  sat?: number;
  light?: number;
  shift?: number;
  /** Recolore aussi les gris (sinon les contours et métaux neutres restent tels quels). */
  grays?: boolean;
}

export function recolor(img: Img, options: Recolor): Img {
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
export function paste(base: Img, top: Img, dx: number, dy: number): void {
  for (let y = 0; y < top.h; y++)
    for (let x = 0; x < top.w; x++) {
      const c = get(top, x, y);
      if (c[3] > 40) set(base, x + dx, y + dy, [c[0], c[1], c[2], 255]);
    }
}

/** Réduction au plus proche voisin (facteur entier). */
export function shrink(img: Img, factor: number): Img {
  const out = blank(Math.floor(img.w / factor), Math.floor(img.h / factor));
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++)
      set(out, x, y, get(img, x * factor + (factor >> 1), y * factor + (factor >> 1)));
  return out;
}

/** Éclat magique en forme de « + », comme sur les icônes de ressources. */
export function sparkle(img: Img, x: number, y: number, color: Rgba = [255, 255, 255, 255]): void {
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
export function outline(img: Img, color: Rgba): void {
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
export function gem(img: Img, cx: number, cy: number, light: Rgba, dark: Rgba): void {
  const rows = [[0], [-1, 0, 1], [-2, -1, 0, 1, 2], [-1, 0, 1], [0]];
  rows.forEach((xs, i) =>
    xs.forEach((x) => set(img, cx + x, cy - 2 + i, x < 0 || i < 2 ? light : dark)),
  );
  set(img, cx, cy - 1, [255, 255, 255, 255]);
}
