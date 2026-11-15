/**
 * Synthesised music beds. Each mood renders one circular loop (a chord
 * progression of a few bars), then the loop is tiled to the requested length
 * with a 1.5 s fade in and 2 s fade out.
 *
 * Beds are deliberately quiet in the 1-4 kHz "voice" band: a master EQ dips
 * the mids and softens the top so narration sits on top of the music.
 */
import type { MusicMood } from "./types";
import {
  addDecaySine,
  addEcho,
  addNoiseBurst,
  addPluck,
  addReverb,
  addTone,
  fadeEdges,
  filterChannels,
  mtof,
  normalise,
  rng,
  tile,
  type Stereo,
  type Target,
  type Wave,
} from "./dsp";

interface Loop {
  sr: number;
  n: number;
  rand: () => number;
  /** Creates a new circular stereo layer the length of the loop. */
  layer: () => Target;
}

function newLoop(seconds: number, sr: number, seed: number): Loop {
  const n = Math.round(seconds * sr);
  return {
    sr,
    n,
    rand: rng(seed),
    layer: () => ({ L: new Float32Array(n), R: new Float32Array(n), wrap: true }),
  };
}

function sumInto(dst: Target, src: Target, gain = 1): void {
  for (let i = 0; i < dst.L.length; i++) {
    dst.L[i] += src.L[i] * gain;
    dst.R[i] += src.R[i] * gain;
  }
}

const pick = <T,>(rand: () => number, arr: readonly T[]): T => arr[Math.floor(rand() * arr.length) % arr.length];

/* ---------------- instruments ---------------- */

/** Detuned 3-oscillator pad note (L / centre / R). */
function padNote(
  t: Target,
  sr: number,
  start: number,
  dur: number,
  midi: number,
  o: { wave?: Wave; amp?: number; attack?: number; release?: number; detune?: number; vibRate?: number; vibCents?: number },
): void {
  const f = mtof(midi);
  const d = o.detune ?? 7;
  const amp = (o.amp ?? 0.08) / 2;
  const base = { wave: o.wave ?? "saw", attack: o.attack ?? 1.2, release: o.release ?? 2, vibRate: o.vibRate, vibCents: o.vibCents };
  addTone(t, sr, start, dur, f * Math.pow(2, -d / 1200), { ...base, amp, pan: -0.6, phase: 0.1 });
  addTone(t, sr, start, dur, f, { ...base, amp: amp * 0.8, pan: 0, phase: 0.5 });
  addTone(t, sr, start, dur, f * Math.pow(2, d / 1200), { ...base, amp, pan: 0.6, phase: 0.8 });
}

/** Soft piano-like note: inharmonic decaying partials. */
function piano(t: Target, sr: number, start: number, midi: number, amp: number, pan = 0): void {
  const f = mtof(midi);
  const lenScale = Math.max(0.5, Math.min(1.6, 300 / f));
  for (let p = 1; p <= 6; p++) {
    const fp = f * p * Math.sqrt(1 + 0.0004 * p * p);
    addDecaySine(t, sr, start * sr, fp, amp / Math.pow(p, 1.4), (1.6 * lenScale) / Math.pow(p, 0.8), pan, 0.004, 5);
  }
}

/** Marimba: fundamental + the characteristic 4x and 10x partials. */
function marimba(t: Target, sr: number, start: number, midi: number, amp: number, pan = 0): void {
  const f = mtof(midi);
  addDecaySine(t, sr, start * sr, f, amp, 0.32, pan, 0.001);
  addDecaySine(t, sr, start * sr, f * 3.93, amp * 0.25, 0.07, pan, 0.001);
  addDecaySine(t, sr, start * sr, f * 9.2, amp * 0.06, 0.025, pan, 0.001);
}

/** Bell / celesta ping. */
function bellPing(t: Target, sr: number, start: number, midi: number, amp: number, pan = 0): void {
  const f = mtof(midi);
  const parts: [number, number, number][] = [
    [1, 1, 1.8],
    [2.76, 0.35, 0.9],
    [5.4, 0.12, 0.4],
  ];
  for (const [r, a, tau] of parts) addDecaySine(t, sr, start * sr, f * r, amp * a, tau, pan, 0.002);
}

/** Soft sub/bass note. */
function bass(t: Target, sr: number, start: number, midi: number, amp: number, tau = 0.9): void {
  const f = mtof(midi);
  addDecaySine(t, sr, start * sr, f, amp, tau, 0, 0.012);
  addDecaySine(t, sr, start * sr, f * 2, amp * 0.25, tau * 0.6, 0, 0.012);
}

/** Low pulse (drama / mystery): rounded thump on the root. */
function pulse(t: Target, sr: number, start: number, midi: number, amp: number): void {
  const f = mtof(midi);
  addDecaySine(t, sr, start * sr, f, amp, 0.22, 0, 0.006);
  addDecaySine(t, sr, start * sr, f * 2, amp * 0.3, 0.12, 0, 0.006);
}

/* ---------------- moods ---------------- */

interface Prog {
  bpm: number;
  beatsPerChord: number;
  chords: number[][];
  roots: number[];
}

const progLength = (p: Prog) => (p.chords.length * p.beatsPerChord * 60) / p.bpm;

function chordTimes(p: Prog): { t: number; dur: number; chord: number[]; root: number; i: number }[] {
  const beat = 60 / p.bpm;
  return p.chords.map((chord, i) => ({ t: i * p.beatsPerChord * beat, dur: p.beatsPerChord * beat, chord, root: p.roots[i], i }));
}

type Renderer = (seed: number, sr: number) => Stereo;

const PROGS = {
  emotional: { bpm: 70, beatsPerChord: 8, chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]], roots: [45, 41, 48, 43] },
  drama: { bpm: 80, beatsPerChord: 8, chords: [[50, 57, 62, 65], [46, 53, 58, 62], [43, 50, 55, 58], [45, 52, 57, 61]], roots: [38, 34, 31, 33] },
  comedy: { bpm: 110, beatsPerChord: 4, chords: [[60, 64, 67], [60, 65, 69], [59, 62, 67], [60, 64, 67], [60, 64, 67], [60, 65, 69], [59, 62, 67], [60, 64, 67]], roots: [48, 53, 43, 48, 48, 53, 43, 48] },
  scifi: { bpm: 100, beatsPerChord: 8, chords: [[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 50, 54]], roots: [40, 36, 38, 35] },
  explainer: { bpm: 96, beatsPerChord: 8, chords: [[55, 59, 62], [54, 57, 62], [55, 59, 64], [55, 60, 64]], roots: [43, 38, 40, 36] },
  calm: { bpm: 64, beatsPerChord: 8, chords: [[53, 57, 60, 64], [50, 53, 57, 60], [46, 53, 57, 62], [48, 55, 60, 64]], roots: [41, 38, 34, 36] },
  historical: { bpm: 66, beatsPerChord: 8, chords: [[50, 57, 62], [48, 55, 60], [46, 53, 58], [45, 52, 57, 61]], roots: [38, 36, 34, 33] },
  mystery: { bpm: 76, beatsPerChord: 8, chords: [[59, 61, 66], [55, 57, 62], [52, 57, 59], [54, 59, 61]], roots: [35, 31, 40, 42] },
} satisfies Record<string, Prog>;

/** Shared finishing: reverb, master EQ (voice-friendly), level. */
function master(mix: Target, sr: number, reverb: { room: number; wet: number; damp?: number }): Stereo {
  addReverb(mix.L, mix.R, sr, { room: reverb.room, wet: reverb.wet, damp: reverb.damp ?? 0.35, circular: true });
  filterChannels(
    [mix.L, mix.R],
    sr,
    [
      ["highpass", 38, 0.7],
      ["peaking", 2200, 0.8, -5], // make room for the voice
      ["peaking", 900, 1.0, -2],
      ["highshelf", 6500, 0.7, -4],
    ],
    true,
  );
  const out: Stereo = [mix.L, mix.R];
  normalise(out, 0.12, 0.8);
  return out;
}

const emotional: Renderer = (seed, sr) => {
  const p = PROGS.emotional;
  const lp = newLoop(progLength(p), sr, seed);
  const pad = lp.layer();
  const keys = lp.layer();
  const low = lp.layer();
  const beat = 60 / p.bpm;
  for (const c of chordTimes(p)) {
    for (const m of c.chord) padNote(pad, sr, c.t, c.dur, m, { amp: 0.07, attack: 1.8, release: 2.5 });
    bass(low, sr, c.t, c.root, 0.25, 2.2);
    bass(low, sr, c.t + 4 * beat, c.root, 0.16, 2.0);
    const tones = [...c.chord.map((m) => m + 12), c.chord[0] + 24];
    for (let b = 0; b < c.dur / beat; b++) {
      const tb = c.t + b * beat;
      if (b % 4 === 0) piano(keys, sr, tb, pick(lp.rand, tones.slice(1)) + 0, 0.16, 0.1);
      else if (lp.rand() < 0.7) piano(keys, sr, tb, pick(lp.rand, tones), 0.1, (lp.rand() - 0.5) * 0.6);
      if (lp.rand() < 0.2) piano(keys, sr, tb + beat / 2, pick(lp.rand, tones), 0.07, (lp.rand() - 0.5) * 0.6);
    }
  }
  filterChannels([pad.L, pad.R], sr, [["lowpass", 850, 0.7], ["lowpass", 1600, 0.6]], true);
  sumInto(pad, keys);
  sumInto(pad, low);
  return master(pad, sr, { room: 0.86, wet: 0.45 });
};

const drama: Renderer = (seed, sr) => {
  const p = PROGS.drama;
  const lp = newLoop(progLength(p), sr, seed);
  const strings = lp.layer();
  const pul = lp.layer();
  const beat = 60 / p.bpm;
  for (const c of chordTimes(p)) {
    for (const m of c.chord) padNote(strings, sr, c.t, c.dur, m, { amp: 0.07, attack: 1.0, release: 1.8, vibRate: 5, vibCents: 9, detune: 9 });
    // high violin line on the chord top, swelling every chord
    padNote(strings, sr, c.t + beat * 2, c.dur - beat * 2, c.chord[c.chord.length - 1] + 12, { amp: 0.03, attack: 2.5, release: 1.5, vibRate: 5.5, vibCents: 12 });
    for (let e = 0; e < (c.dur / beat) * 2; e++) {
      const accent = e % 4 === 0 ? 1 : e % 2 === 0 ? 0.7 : 0.45;
      pulse(pul, sr, c.t + (e * beat) / 2, c.root, 0.22 * accent * (0.9 + lp.rand() * 0.1));
    }
  }
  filterChannels([strings.L, strings.R], sr, [["lowpass", 1400, 0.7], ["lowpass", 2400, 0.6]], true);
  filterChannels([pul.L, pul.R], sr, [["lowpass", 400, 0.7]], true);
  sumInto(strings, pul);
  return master(strings, sr, { room: 0.85, wet: 0.4 });
};

const horror: Renderer = (seed, sr) => {
  const len = 24;
  const lp = newLoop(len, sr, seed);
  const drone = lp.layer();
  const swell = lp.layer();
  const boom = lp.layer();
  // Drone: C1 sine, C2 + F#2 saws, held through the whole loop (circular).
  const lfo = 1 / 12; // one cycle per 12 s, periodic in the loop
  addTone(drone, sr, 0, len, mtof(24), { wave: "sine", amp: 0.3, attack: 0.001, release: 0.001, vibRate: lfo, vibCents: 6 });
  addTone(drone, sr, 0, len, mtof(36), { wave: "saw", amp: 0.08, attack: 0.001, release: 0.001, pan: -0.4, vibRate: lfo * 2, vibCents: 8 });
  addTone(drone, sr, 0, len, mtof(36) * 1.004, { wave: "saw", amp: 0.08, attack: 0.001, release: 0.001, pan: 0.4, vibRate: lfo * 3, vibCents: 8 });
  addTone(drone, sr, 0, len, mtof(42), { wave: "saw", amp: 0.035, attack: 0.001, release: 0.001, vibRate: lfo, vibCents: 15 });
  // Amplitude breathing, periodic in the loop.
  for (let i = 0; i < lp.n; i++) {
    const g = 0.75 + 0.25 * Math.sin((2 * Math.PI * i) / (sr * 12));
    drone.L[i] *= g;
    drone.R[i] *= g;
  }
  // Dissonant swells (clusters of minor seconds / tritones), no melody.
  const clusters = [
    [72, 73, 78],
    [66, 67, 73],
    [61, 62, 68, 69],
  ];
  const swells = 2;
  for (let s = 0; s < swells; s++) {
    const t0 = (s * len) / swells + lp.rand() * 4;
    const cl = pick(lp.rand, clusters);
    for (const m of cl) {
      addTone(swell, sr, t0, 4.5, mtof(m), { wave: "tri", amp: 0.035, attack: 4, release: 2.5, pan: (lp.rand() - 0.5) * 1.4, vibRate: 0.3 + lp.rand(), vibCents: 20 });
    }
  }
  // Occasional low boom (once per loop).
  const tb = 6 + lp.rand() * 12;
  addTone(boom, sr, tb, 0.05, 58, { wave: "sine", amp: 0.5, attack: 0.004, release: 2.2, glideTo: 28 });
  addNoiseBurst(boom, sr, tb, lp.rand, { amp: 0.5, tau: 0.5, type: "lowpass", freq: 140 });
  filterChannels([drone.L, drone.R], sr, [["lowpass", 320, 0.9], ["lowpass", 600, 0.6]], true);
  filterChannels([swell.L, swell.R], sr, [["lowpass", 1800, 0.7]], true);
  sumInto(drone, swell);
  sumInto(drone, boom);
  return master(drone, sr, { room: 0.9, wet: 0.6, damp: 0.5 });
};

const comedy: Renderer = (seed, sr) => {
  const p = PROGS.comedy;
  const lp = newLoop(progLength(p), sr, seed);
  const mel = lp.layer();
  const beat = 60 / p.bpm;
  const penta = [72, 74, 76, 79, 81, 84];
  let step = 2;
  for (const c of chordTimes(p)) {
    for (let b = 0; b < 4; b++) {
      const tb = c.t + b * beat;
      if (b % 2 === 0) addPluck(mel, sr, tb, mtof(b === 0 ? c.root : c.root + 7), 0.3, lp.rand, { decay: 0.35, bright: 0.35, maxSec: 0.6 });
      else for (const m of c.chord) marimba(mel, sr, tb, m, 0.05, (m - 64) / 12);
    }
    for (let e = 0; e < 8; e++) {
      if (lp.rand() < (e % 2 === 0 ? 0.7 : 0.35)) {
        step = Math.max(0, Math.min(penta.length - 1, step + Math.floor(lp.rand() * 5) - 2));
        marimba(mel, sr, c.t + (e * beat) / 2, penta[step], 0.14, (lp.rand() - 0.5) * 0.8);
      }
    }
  }
  return master(mel, sr, { room: 0.7, wet: 0.2 });
};

const scifi: Renderer = (seed, sr) => {
  const p = PROGS.scifi;
  const lp = newLoop(progLength(p), sr, seed);
  const arp = lp.layer();
  const air = lp.layer();
  const low = lp.layer();
  const beat = 60 / p.bpm;
  const shapes = [
    [0, 1, 2, 3, 4, 5, 4, 3],
    [0, 2, 1, 3, 2, 4, 3, 5],
    [0, 1, 2, 3, 2, 1, 2, 3],
  ];
  for (const c of chordTimes(p)) {
    const tones = [...c.chord.map((m) => m + 12), ...c.chord.map((m) => m + 24)];
    const shape = pick(lp.rand, shapes);
    const sixteenth = beat / 4;
    for (let s = 0; s < c.dur / sixteenth; s++) {
      const m = tones[shape[s % shape.length]];
      addTone(arp, sr, c.t + s * sixteenth, 0.04, mtof(m), { wave: s % 2 ? "square" : "saw", amp: 0.045, attack: 0.002, release: 0.12, decayTau: 0.08, pan: s % 2 ? 0.35 : -0.35 });
    }
    for (const m of c.chord) {
      addTone(air, sr, c.t, c.dur, mtof(m + 12) * 1.002, { wave: "sine", amp: 0.035, attack: 1.5, release: 2, pan: -0.5 });
      addTone(air, sr, c.t, c.dur, mtof(m + 24) * 0.998, { wave: "sine", amp: 0.018, attack: 2, release: 2, pan: 0.5 });
    }
    addNoiseBurst(air, sr, c.t, lp.rand, { amp: 0.03, attack: c.dur / 2, tau: 1.0, type: "bandpass", freq: 5000, q: 1.5, pan: lp.rand() - 0.5 });
    addTone(low, sr, c.t, c.dur, mtof(c.root), { wave: "sine", amp: 0.22, attack: 0.3, release: 0.6 });
  }
  filterChannels([arp.L, arp.R], sr, [["lowpass", 1900, 1.8]], true);
  addEcho(arp.L, arp.R, sr, beat * 0.75, 0.35, 0.5, true);
  sumInto(arp, air);
  sumInto(arp, low);
  return master(arp, sr, { room: 0.88, wet: 0.4 });
};

/** Gentle pad + light pluck (explainer, calm). */
function padPluck(prog: Prog, opts: { pluckProb: number; padWave: Wave; cutoff: number; octave: number; room: number; wet: number }): Renderer {
  return (seed, sr) => {
    const lp = newLoop(progLength(prog), sr, seed);
    const pad = lp.layer();
    const pl = lp.layer();
    const low = lp.layer();
    const beat = 60 / prog.bpm;
    const rhythm = [1, 0, 1, 1, 0, 1, 0, 1];
    for (const c of chordTimes(prog)) {
      for (const m of c.chord) padNote(pad, sr, c.t, c.dur, m, { wave: opts.padWave, amp: 0.09, attack: 1.5, release: 2.2, detune: 6 });
      bass(low, sr, c.t, c.root, 0.22, 1.5);
      bass(low, sr, c.t + (c.dur / 2), c.root, 0.14, 1.2);
      const tones = c.chord.map((m) => m + opts.octave);
      for (let e = 0; e < (c.dur / beat) * 2; e++) {
        if (rhythm[e % 8] && lp.rand() < opts.pluckProb) {
          addPluck(pl, sr, c.t + (e * beat) / 2, mtof(pick(lp.rand, tones)), 0.12, lp.rand, { decay: 1.4, bright: 0.3, pan: (lp.rand() - 0.5) * 1.2 });
        }
      }
    }
    filterChannels([pad.L, pad.R], sr, [["lowpass", opts.cutoff, 0.7]], true);
    sumInto(pad, pl);
    sumInto(pad, low);
    return master(pad, sr, { room: opts.room, wet: opts.wet });
  };
}

const explainer = padPluck(PROGS.explainer, { pluckProb: 0.8, padWave: "tri", cutoff: 1200, octave: 12, room: 0.8, wet: 0.3 });
const calm = padPluck(PROGS.calm, { pluckProb: 0.35, padWave: "tri", cutoff: 900, octave: 24, room: 0.88, wet: 0.5 });

const historical: Renderer = (seed, sr) => {
  const p = PROGS.historical;
  const lp = newLoop(progLength(p), sr, seed);
  const pad = lp.layer();
  const harp = lp.layer();
  const low = lp.layer();
  const beat = 60 / p.bpm;
  const scale = [62, 64, 65, 67, 69, 70, 72, 74, 76]; // D aeolian, D4..E5
  let idx = 4;
  for (const c of chordTimes(p)) {
    for (const m of c.chord) padNote(pad, sr, c.t, c.dur, m, { amp: 0.06, attack: 1.6, release: 2.4, vibRate: 4.5, vibCents: 6 });
    addTone(low, sr, c.t, c.dur, mtof(c.root), { wave: "sine", amp: 0.18, attack: 0.8, release: 1.5 });
    let b = 0;
    while (b < c.dur / beat) {
      let m: number;
      if (b === 0) {
        const ct = c.chord.map((x) => x + 12).filter((x) => x >= 62 && x <= 76);
        m = ct.length ? pick(lp.rand, ct) : scale[idx];
        idx = Math.max(0, scale.findIndex((s) => s >= m));
      } else {
        idx = Math.max(0, Math.min(scale.length - 1, idx + pick(lp.rand, [-2, -1, -1, 1, 1, 2])));
        m = scale[idx];
      }
      addPluck(harp, sr, c.t + b * beat, mtof(m), 0.16, lp.rand, { decay: 1.8, bright: 0.55, pan: (lp.rand() - 0.5) * 0.5 });
      b += lp.rand() < 0.5 ? 2 : 1;
    }
  }
  filterChannels([pad.L, pad.R], sr, [["lowpass", 900, 0.7], ["lowpass", 1800, 0.6]], true);
  sumInto(pad, harp);
  sumInto(pad, low);
  return master(pad, sr, { room: 0.87, wet: 0.45 });
};

const mystery: Renderer = (seed, sr) => {
  const p = PROGS.mystery;
  const lp = newLoop(progLength(p), sr, seed);
  const pad = lp.layer();
  const pul = lp.layer();
  const bells = lp.layer();
  const beat = 60 / p.bpm;
  const times = chordTimes(p);
  for (const c of times) {
    for (const m of c.chord) padNote(pad, sr, c.t, c.dur, m, { wave: "tri", amp: 0.09, attack: 1.4, release: 2.2, detune: 10 });
    for (let b = 0; b < c.dur / beat; b++) pulse(pul, sr, c.t + b * beat, c.root, b % 2 === 0 ? 0.26 : 0.16);
  }
  for (let k = 0; k < 3; k++) {
    const c = times[Math.floor(lp.rand() * times.length)];
    bellPing(bells, sr, c.t + Math.floor(lp.rand() * 8) * beat, pick(lp.rand, c.chord) + 24, 0.06, (lp.rand() - 0.5) * 1.2);
  }
  filterChannels([pad.L, pad.R], sr, [["lowpass", 1000, 0.7]], true);
  filterChannels([pul.L, pul.R], sr, [["lowpass", 300, 0.7]], true);
  sumInto(pad, pul);
  sumInto(pad, bells);
  return master(pad, sr, { room: 0.88, wet: 0.5 });
};

const RENDERERS: Record<MusicMood, Renderer> = {
  emotional,
  drama,
  horror,
  comedy,
  scifi,
  explainer,
  calm,
  historical,
  mystery,
};

/* ---------------- public ---------------- */

const loopCache = new Map<string, Stereo>();
const CACHE_MAX = 4;

/** Render (or fetch from cache) one seamless loop of a mood. */
export function musicLoop(mood: MusicMood, sampleRate: number, seed = 1): Stereo {
  const key = `${mood}:${sampleRate}:${seed}`;
  const hit = loopCache.get(key);
  if (hit) return hit;
  const render = RENDERERS[mood] ?? RENDERERS.calm;
  const loop = render(seed, sampleRate);
  if (loopCache.size >= CACHE_MAX) loopCache.delete(loopCache.keys().next().value as string);
  loopCache.set(key, loop);
  return loop;
}

/**
 * Stereo music bed [L, R] of `seconds` length. Deterministic for a seed;
 * loops seamlessly; fades in over 1.5 s and out over 2 s.
 */
export function synthMusic(mood: MusicMood, seconds: number, sampleRate: number, seed = 1): Float32Array[] {
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const [l, r] = musicLoop(mood, sampleRate, seed);
  const out = [tile(l, n), tile(r, n)];
  fadeEdges(out, sampleRate, 1.5, 2);
  return out;
}
