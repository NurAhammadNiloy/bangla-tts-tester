/**
 * Synthesised sound effects (mono). Each is short and built from oscillators,
 * resonators and filtered noise. Output is peak-normalised, then trimmed by a
 * per-effect level so quiet UI sounds stay quieter than a door slam.
 */
import type { SfxName } from "./types";
import {
  addDecaySine,
  addNoiseBurst,
  addReverb,
  addTone,
  Biquad,
  dbToGain,
  fadeEdges,
  filterChannels,
  monoTarget,
  mtof,
  peakOf,
  rng,
  scale,
  SVF,
  type Target,
} from "./dsp";

type Builder = (sr: number, rand: () => number) => Float32Array;

const buf = (sr: number, seconds: number) => new Float32Array(Math.round(seconds * sr));

/** Mono reverb helper: runs the stereo reverb on a copy and folds back. */
function monoReverb(x: Float32Array, sr: number, room: number, wet: number): void {
  const r = new Float32Array(x.length);
  const l = x.slice();
  addReverb(l, r, sr, { room, wet, damp: 0.4 });
  for (let i = 0; i < x.length; i++) x[i] = l[i] + (r[i] - 0) * 0.5;
}

const phone_ring: Builder = (sr) => {
  const x = buf(sr, 2.5);
  const t = monoTarget(x);
  const bursts = [0, 0.5, 1.4, 1.9];
  for (const b0 of bursts) {
    // bell clapper at 25 Hz: each strike excites two metallic bells
    for (let s = 0; s < 0.38 * 25; s++) {
      const ts = b0 + s / 25;
      for (const [f, a] of [
        [1250, 0.5],
        [1400, 0.5],
        [2830, 0.15],
        [3150, 0.12],
      ] as const) {
        addDecaySine(t, sr, ts * sr, f * (s % 2 ? 1.003 : 1), a, 0.06, 0, 0.0005, 0.6);
      }
    }
  }
  filterChannels([x], sr, [["highpass", 400], ["lowpass", 4500]], false);
  return x;
};

const notification: Builder = (sr) => {
  const x = buf(sr, 0.7);
  const t = monoTarget(x);
  for (const [at, m] of [
    [0, 81],
    [0.14, 88],
  ] as const) {
    addDecaySine(t, sr, at * sr, mtof(m), 0.6, 0.18, 0, 0.004);
    addDecaySine(t, sr, at * sr, mtof(m) * 2, 0.08, 0.08, 0, 0.004);
  }
  return x;
};

const message: Builder = (sr) => {
  const x = buf(sr, 0.4);
  const t = monoTarget(x);
  addTone(t, sr, 0, 0.07, 620, { wave: "sine", amp: 0.6, attack: 0.004, release: 0.12, glideTo: 1250 });
  addDecaySine(t, sr, 0.09 * sr, 1250, 0.35, 0.07, 0, 0.003);
  return x;
};

/** Wooden knock: thump + body resonance + a little click. */
function knock(t: Target, sr: number, at: number, rand: () => number, amp: number): void {
  addNoiseBurst(t, sr, at, rand, { amp: amp * 0.8, tau: 0.012, type: "lowpass", freq: 1500 });
  addDecaySine(t, sr, at * sr, 190, amp, 0.045, 0, 0.0008);
  addDecaySine(t, sr, at * sr, 410, amp * 0.5, 0.03, 0, 0.0008);
  addDecaySine(t, sr, at * sr, 870, amp * 0.2, 0.015, 0, 0.0008);
}

const door_knock: Builder = (sr, rand) => {
  const x = buf(sr, 1.0);
  const t = monoTarget(x);
  knock(t, sr, 0.02, rand, 1);
  knock(t, sr, 0.24, rand, 0.9);
  knock(t, sr, 0.46, rand, 1);
  monoReverb(x, sr, 0.7, 0.2);
  return x;
};

const door_creak: Builder = (sr, rand) => {
  const dur = 1.6;
  const x = buf(sr, dur);
  // Stick-slip: impulse train with wandering rate, through resonant bands.
  const n = x.length;
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (i >= next) {
      const p = i / n;
      const rate = 35 + 60 * Math.sin(Math.PI * p) + 25 * Math.sin(9 * p) + rand() * 10;
      x[i] = (0.6 + rand() * 0.4) * Math.sin(Math.PI * p);
      next = i + sr / rate;
    }
  }
  const bands = [
    new Biquad("bandpass", 650, sr, 12),
    new Biquad("bandpass", 1350, sr, 14),
    new Biquad("bandpass", 2600, sr, 10),
  ];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = x[i];
    out[i] = bands[0].process(v) + bands[1].process(v) * 0.7 + bands[2].process(v) * 0.35;
  }
  fadeEdges([out], sr, 0.05, 0.1);
  return out;
};

const door_slam: Builder = (sr, rand) => {
  const x = buf(sr, 1.3);
  const t = monoTarget(x);
  addTone(t, sr, 0, 0.02, 95, { wave: "sine", amp: 1, attack: 0.002, release: 0.45, glideTo: 40 });
  addNoiseBurst(t, sr, 0, rand, { amp: 0.9, tau: 0.06, type: "lowpass", freq: 900 });
  addNoiseBurst(t, sr, 0, rand, { amp: 0.25, tau: 0.02, type: "highpass", freq: 2500 });
  // latch rattle
  for (let k = 0; k < 3; k++) knock(t, sr, 0.09 + k * 0.045 + rand() * 0.01, rand, 0.18 / (k + 1));
  monoReverb(x, sr, 0.8, 0.35);
  return x;
};

const footsteps: Builder = (sr, rand) => {
  const x = buf(sr, 2.2);
  const t = monoTarget(x);
  for (let s = 0; s < 4; s++) {
    const at = 0.05 + s * 0.5 + (rand() - 0.5) * 0.03;
    const a = 0.8 + rand() * 0.2;
    addNoiseBurst(t, sr, at, rand, { amp: a, tau: 0.025, type: "lowpass", freq: 420 });
    addDecaySine(t, sr, at * sr, 85 + rand() * 15, a * 0.6, 0.03, 0, 0.002);
    addNoiseBurst(t, sr, at + 0.05, rand, { amp: a * 0.35, attack: 0.005, tau: 0.03, type: "bandpass", freq: 2200, q: 1.2 });
  }
  monoReverb(x, sr, 0.6, 0.15);
  return x;
};

const whoosh: Builder = (sr, rand) => {
  const dur = 0.45;
  const x = buf(sr, dur);
  const f = new SVF(sr, 300, 1.4);
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    if (i % 16 === 0) f.tune(300 * Math.pow(10, 1.1 * Math.sin(Math.PI * Math.min(1, p * 1.2))), 1.4);
    f.process(rand() * 2 - 1);
    const env = Math.pow(Math.sin(Math.PI * p), 1.6);
    x[i] = f.bp * env;
  }
  return x;
};

const hit: Builder = (sr, rand) => {
  const x = buf(sr, 0.8);
  const t = monoTarget(x);
  addTone(t, sr, 0, 0.01, 130, { wave: "sine", amp: 1, attack: 0.001, release: 0.6, glideTo: 42 });
  addNoiseBurst(t, sr, 0, rand, { amp: 0.7, tau: 0.03, type: "lowpass", freq: 1200 });
  addNoiseBurst(t, sr, 0, rand, { amp: 0.4, tau: 0.15, type: "lowpass", freq: 180 });
  return x;
};

const heartbeat: Builder = (sr) => {
  const x = buf(sr, 1.7);
  const t = monoTarget(x);
  for (const b of [0.02, 0.85]) {
    addTone(t, sr, b, 0.03, 62, { wave: "sine", amp: 1, attack: 0.008, release: 0.12, glideTo: 45 });
    addTone(t, sr, b + 0.26, 0.02, 55, { wave: "sine", amp: 0.7, attack: 0.008, release: 0.1, glideTo: 40 });
  }
  filterChannels([x], sr, [["lowpass", 160]], false);
  return x;
};

const gasp_swell: Builder = (sr, rand) => {
  const dur = 1.6;
  const x = buf(sr, dur);
  const n = x.length;
  const f = new SVF(sr, 300, 2);
  const cut = Math.round(0.02 * sr);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    if (i % 16 === 0) f.tune(300 + 4500 * p * p, 2);
    f.process(rand() * 2 - 1);
    let env = Math.pow(p, 3);
    if (i > n - cut) env *= (n - i) / cut;
    x[i] = f.bp * env * 0.8;
  }
  const t = monoTarget(x);
  for (const m of [57, 64, 70]) addTone(t, sr, 0, dur - 0.03, mtof(m), { wave: "saw", amp: 0.06, attack: dur - 0.1, release: 0.02 });
  return x;
};

const thunder: Builder = (sr, rand) => {
  const dur = 4.2;
  const x = buf(sr, dur);
  const t = monoTarget(x);
  addNoiseBurst(t, sr, 0.02, rand, { amp: 0.8, attack: 0.004, tau: 0.08, type: "highpass", freq: 600 });
  for (let k = 0; k < 7; k++) {
    const at = 0.05 + k * 0.35 + rand() * 0.3;
    addNoiseBurst(t, sr, at, rand, { amp: (0.9 - k * 0.1) * (0.7 + rand() * 0.3), attack: 0.08 + rand() * 0.1, tau: 0.5 + rand() * 0.6, type: "lowpass", freq: 220 + rand() * 150, maxSec: 4 });
  }
  filterChannels([x], sr, [["lowpass", 1800]], false);
  monoReverb(x, sr, 0.88, 0.5);
  fadeEdges([x], sr, 0.002, 0.5);
  return x;
};

const glass_break: Builder = (sr, rand) => {
  const x = buf(sr, 1.3);
  const t = monoTarget(x);
  addNoiseBurst(t, sr, 0, rand, { amp: 1, tau: 0.08, type: "highpass", freq: 3000 });
  addNoiseBurst(t, sr, 0, rand, { amp: 0.4, tau: 0.02, type: "lowpass", freq: 800 });
  for (let k = 0; k < 40; k++) {
    const at = Math.pow(rand(), 2) * 0.35;
    addDecaySine(t, sr, at * sr, 2500 + rand() * 7500, 0.15 + rand() * 0.2, 0.05 + rand() * 0.25, 0, 0.0005);
  }
  monoReverb(x, sr, 0.75, 0.25);
  return x;
};

const clock_tick: Builder = (sr, rand) => {
  const x = buf(sr, 2.1);
  const t = monoTarget(x);
  for (let k = 0; k < 4; k++) {
    const at = 0.02 + k * 0.5;
    const hi = k % 2 === 0;
    addNoiseBurst(t, sr, at, rand, { amp: 0.4, tau: 0.003, type: "highpass", freq: 3000 });
    addDecaySine(t, sr, at * sr, hi ? 3400 : 2700, 0.6, 0.012, 0, 0.0003);
    addDecaySine(t, sr, at * sr, hi ? 1900 : 1500, 0.3, 0.02, 0, 0.0003);
  }
  return x;
};

const bell: Builder = (sr) => {
  const x = buf(sr, 3.2);
  const t = monoTarget(x);
  const f = 520;
  const parts: [number, number, number][] = [
    [0.5, 0.5, 2.6],
    [1, 1, 1.8],
    [1.183, 0.6, 1.4],
    [1.506, 0.45, 1.1],
    [2, 0.35, 0.9],
    [2.514, 0.25, 0.6],
    [2.662, 0.2, 0.5],
    [3.011, 0.15, 0.4],
  ];
  for (const [r, a, tau] of parts) addDecaySine(t, sr, 0, f * r, a, tau, 0, 0.001);
  fadeEdges([x], sr, 0.0005, 0.3);
  return x;
};

const pop: Builder = (sr, rand) => {
  const x = buf(sr, 0.18);
  const t = monoTarget(x);
  addTone(t, sr, 0, 0.005, 900, { wave: "sine", amp: 1, attack: 0.001, release: 0.07, glideTo: 220 });
  addNoiseBurst(t, sr, 0, rand, { amp: 0.3, tau: 0.004, type: "bandpass", freq: 2000 });
  return x;
};

const laugh_boing: Builder = (sr) => {
  const dur = 0.9;
  const x = buf(sr, dur);
  const n = x.length;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const tsec = i / sr;
    const base = 180 + 220 * Math.min(1, p * 3);
    const vib = 1 + 0.25 * Math.exp(-tsec * 3) * Math.sin(2 * Math.PI * 11 * tsec);
    ph += (base * vib) / sr;
    const env = Math.min(1, tsec / 0.005) * Math.exp(-tsec * 3.2);
    x[i] = (Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph)) * env;
  }
  fadeEdges([x], sr, 0.001, 0.05);
  return x;
};

/** Soft piano-like note for stings. */
function softKey(t: Target, sr: number, at: number, midi: number, amp: number): void {
  const f = mtof(midi);
  for (let p = 1; p <= 5; p++) addDecaySine(t, sr, at * sr, f * p * Math.sqrt(1 + 0.0004 * p * p), amp / Math.pow(p, 1.4), 1.4 / Math.pow(p, 0.8), 0, 0.004);
}

const sad_sting: Builder = (sr) => {
  const x = buf(sr, 3.0);
  const t = monoTarget(x);
  const notes = [67, 65, 63, 62];
  notes.forEach((m, i) => softKey(t, sr, i * 0.38, m, i === 3 ? 0.5 : 0.4));
  for (const m of [50, 55, 58]) addTone(t, sr, 0, 1.6, mtof(m), { wave: "tri", amp: 0.07, attack: 0.6, release: 1.2 });
  monoReverb(x, sr, 0.85, 0.4);
  fadeEdges([x], sr, 0.002, 0.6);
  return x;
};

const scare_sting: Builder = (sr, rand) => {
  const x = buf(sr, 2.0);
  const t = monoTarget(x);
  for (const m of [72, 73, 78, 79, 83]) {
    addTone(t, sr, 0, 0.25, mtof(m) * (1 + (rand() - 0.5) * 0.004), { wave: "saw", amp: 0.16, attack: 0.004, release: 1.2, decayTau: 0.35, vibRate: 7, vibCents: 25 });
  }
  addTone(t, sr, 0, 0.02, 70, { wave: "sine", amp: 0.8, attack: 0.002, release: 1.2, glideTo: 30 });
  addNoiseBurst(t, sr, 0, rand, { amp: 0.5, tau: 0.05, type: "highpass", freq: 1500 });
  filterChannels([x], sr, [["lowpass", 6000]], false);
  monoReverb(x, sr, 0.85, 0.45);
  fadeEdges([x], sr, 0.001, 0.4);
  return x;
};

const BUILDERS: Record<SfxName, Builder> = {
  phone_ring,
  notification,
  message,
  door_knock,
  door_creak,
  door_slam,
  footsteps,
  whoosh,
  hit,
  heartbeat,
  gasp_swell,
  thunder,
  glass_break,
  clock_tick,
  bell,
  pop,
  laugh_boing,
  sad_sting,
  scare_sting,
};

/** Relative level (dB) after peak normalisation. */
const LEVEL_DB: Record<SfxName, number> = {
  phone_ring: -6,
  notification: -8,
  message: -8,
  door_knock: -3,
  door_creak: -6,
  door_slam: 0,
  footsteps: -4,
  whoosh: -4,
  hit: 0,
  heartbeat: -1,
  gasp_swell: -4,
  thunder: 0,
  glass_break: -3,
  clock_tick: -8,
  bell: -5,
  pop: -6,
  laugh_boing: -5,
  sad_sting: -4,
  scare_sting: -2,
};

const cache = new Map<string, Float32Array>();

/** Mono sound effect, deterministic. Peak <= 1. Returns a fresh copy. */
export function synthSfx(name: SfxName, sampleRate: number): Float32Array {
  const key = `${name}:${sampleRate}`;
  let x = cache.get(key);
  if (!x) {
    const build = BUILDERS[name];
    if (!build) throw new RangeError(`Unknown sfx: ${name}`);
    x = build(sampleRate, rng(0x5f3 + name.length * 977 + name.charCodeAt(0)));
    const p = peakOf([x]);
    if (p > 0) scale([x], dbToGain(LEVEL_DB[name]) / p);
    cache.set(key, x);
  }
  return x.slice();
}
