/**
 * Bruitages synthétisés par le navigateur (Web Audio) : aucun fichier audio.
 * Le son est coupable et son volume réglable ; le choix est retenu dans ce navigateur.
 * Tout échec (navigateur sans Web Audio, lecture bloquée) est silencieux : le jeu continue.
 */
import { create } from 'zustand';

export type SoundId =
  | 'hit'
  | 'critical'
  | 'heal'
  | 'miss'
  | 'death'
  | 'wave'
  | 'victory'
  | 'defeat'
  | 'levelUp'
  | 'loot'
  | 'roar';

const STORAGE_KEY = 'la-tour.sound';
/** Écart minimal entre deux lectures du même son (évite la bouillie sonore à la vitesse ×3). */
const MIN_GAP_MS = 45;

interface SoundSettings {
  muted: boolean;
  /** Volume de 0 à 1. */
  volume: number;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
}

function readSettings(): { muted: boolean; volume: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as {
      muted?: unknown;
      volume?: unknown;
    } | null;
    const volume = typeof saved?.volume === 'number' ? saved.volume : 0.6;
    return { muted: saved?.muted === true, volume: Math.min(1, Math.max(0, volume)) };
  } catch {
    return { muted: false, volume: 0.6 };
  }
}

function saveSettings(settings: { muted: boolean; volume: number }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Stockage indisponible : le réglage vaut pour cette visite seulement.
  }
}

export const useSoundSettings = create<SoundSettings>((set, get) => ({
  ...readSettings(),
  setMuted: (muted) => {
    set({ muted });
    saveSettings({ muted, volume: get().volume });
  },
  setVolume: (volume) => {
    set({ volume, muted: volume === 0 ? true : get().muted });
    saveSettings({ muted: get().muted, volume });
  },
}));

let context: AudioContext | null = null;
const lastPlayed = new Map<SoundId, number>();

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext();
    // Le navigateur suspend l'audio tant qu'il n'y a pas eu de clic : on tente de le relancer.
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

/** Note : oscillateur avec une enveloppe courte (attaque rapide, extinction exponentielle). */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  options: {
    type: OscillatorType;
    from: number;
    to?: number;
    start?: number;
    duration: number;
    gain: number;
  },
) {
  const t0 = ctx.currentTime + (options.start ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = options.type;
  osc.frequency.setValueAtTime(options.from, t0);
  if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, t0 + options.duration);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(options.gain, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + options.duration);
  osc.connect(gain).connect(out);
  osc.start(t0);
  osc.stop(t0 + options.duration + 0.02);
}

/** Bruit filtré (impact, souffle). */
function noise(
  ctx: AudioContext,
  out: AudioNode,
  options: { duration: number; gain: number; frequency: number; sweepTo?: number },
) {
  const t0 = ctx.currentTime;
  const length = Math.max(1, Math.floor(ctx.sampleRate * options.duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(options.frequency, t0);
  if (options.sweepTo)
    filter.frequency.exponentialRampToValueAtTime(options.sweepTo, t0 + options.duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.gain, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + options.duration);
  source.connect(filter).connect(gain).connect(out);
  source.start(t0);
}

const arpeggio = (
  ctx: AudioContext,
  out: AudioNode,
  notes: number[],
  step: number,
  type: OscillatorType,
  gain: number,
) =>
  notes.forEach((from, i) =>
    tone(ctx, out, { type, from, start: i * step, duration: step * 2.2, gain }),
  );

const SOUNDS: Record<SoundId, (ctx: AudioContext, out: AudioNode) => void> = {
  hit: (ctx, out) => {
    noise(ctx, out, { duration: 0.08, gain: 0.5, frequency: 900 });
    tone(ctx, out, { type: 'sine', from: 160, to: 70, duration: 0.1, gain: 0.5 });
  },
  critical: (ctx, out) => {
    noise(ctx, out, { duration: 0.14, gain: 0.7, frequency: 1400, sweepTo: 400 });
    tone(ctx, out, { type: 'square', from: 220, to: 55, duration: 0.18, gain: 0.35 });
    tone(ctx, out, { type: 'triangle', from: 1320, start: 0.02, duration: 0.08, gain: 0.2 });
  },
  heal: (ctx, out) => arpeggio(ctx, out, [523, 784], 0.07, 'sine', 0.25),
  miss: (ctx, out) =>
    noise(ctx, out, { duration: 0.16, gain: 0.25, frequency: 2500, sweepTo: 600 }),
  death: (ctx, out) =>
    tone(ctx, out, { type: 'square', from: 330, to: 70, duration: 0.35, gain: 0.18 }),
  wave: (ctx, out) => arpeggio(ctx, out, [392, 523], 0.12, 'square', 0.12),
  victory: (ctx, out) => arpeggio(ctx, out, [523, 659, 784, 1047], 0.11, 'square', 0.14),
  defeat: (ctx, out) => arpeggio(ctx, out, [392, 311, 262, 196], 0.16, 'triangle', 0.25),
  levelUp: (ctx, out) => arpeggio(ctx, out, [659, 784, 988, 1319], 0.07, 'triangle', 0.22),
  roar: (ctx, out) => {
    noise(ctx, out, { duration: 0.5, gain: 0.45, frequency: 300, sweepTo: 90 });
    tone(ctx, out, { type: 'sawtooth', from: 110, to: 55, duration: 0.5, gain: 0.2 });
  },
  loot: (ctx, out) => {
    tone(ctx, out, { type: 'triangle', from: 1568, duration: 0.25, gain: 0.18 });
    tone(ctx, out, { type: 'triangle', from: 2093, start: 0.06, duration: 0.3, gain: 0.14 });
  },
};

/** Joue un bruitage (sans effet si le son est coupé ou indisponible). */
export function playSound(id: SoundId, delayMs = 0): void {
  if (delayMs > 0) {
    setTimeout(() => playSound(id), delayMs);
    return;
  }
  const { muted, volume } = useSoundSettings.getState();
  if (muted || volume <= 0) return;
  const now = performance.now();
  if (now - (lastPlayed.get(id) ?? -Infinity) < MIN_GAP_MS) return;
  lastPlayed.set(id, now);
  const ctx = audio();
  if (!ctx) return;
  try {
    const master = ctx.createGain();
    master.gain.value = volume * 0.6;
    master.connect(ctx.destination);
    SOUNDS[id](ctx, master);
  } catch {
    // Lecture impossible : on continue sans son.
  }
}

/** Fin de combat : victoire ou défaite, puis montée de niveau et un carillon par objet (au rythme des animations). */
export function playOutcomeSounds(result: string, levelUp: boolean, lootCount: number): void {
  playSound(result === 'defeat' ? 'defeat' : 'victory');
  if (levelUp) playSound('levelUp', 450);
  for (let i = 0; i < lootCount; i++) playSound('loot', 650 + i * 180);
}
