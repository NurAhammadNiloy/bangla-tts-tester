/**
 * Quiet stereo ambience loops (rain, crickets, city, ...). Each is rendered
 * once as a circular loop (event writers wrap; filters run in steady state)
 * then tiled, with 0.5 s fades at the ends of the returned clip.
 */
import type { AmbienceName } from "./types";
import {
  addNoiseBurst,
  addReverb,
  addTone,
  Biquad,
  fadeEdges,
  filterChannels,
  normalise,
  rng,
  SVF,
  tile,
  type Stereo,
  type Target,
} from "./dsp";

type Builder = (sr: number, rand: () => number) => Stereo;

const LOOP_SEC = 12;

function layer(sr: number): Target {
  const n = Math.round(LOOP_SEC * sr);
  return { L: new Float32Array(n), R: new Float32Array(n), wrap: true };
}

/**
 * Render a recursive noise process for n + x samples and fold the extra x
 * samples over the start with an equal-power crossfade, so the loop seam is
 * continuous: out[n-1] = a[n-1] and out[0] = a[n].
 */
function folded(n: number, sr: number, fill: (buf: Float32Array) => void): Float32Array {
  const x = Math.round(0.25 * sr);
  const a = new Float32Array(n + x);
  fill(a);
  const out = a.subarray(0, n);
  for (let i = 0; i < x; i++) {
    const th = ((i / x) * Math.PI) / 2;
    out[i] = a[i] * Math.sin(th) + a[n + i] * Math.cos(th);
  }
  return out;
}

/** Decorrelated stereo noise with a 1/f-ish tilt (pink, Kellet's economy filter). */
function pinkNoise(t: Target, sr: number, rand: () => number, amp: number): void {
  for (const ch of [t.L, t.R]) {
    const v = folded(ch.length, sr, (buf) => {
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < buf.length; i++) {
        const w = rand() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        buf[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
      }
    });
    for (let i = 0; i < ch.length; i++) ch[i] += v[i] * amp;
  }
}

/** Brown noise (leaky integrated white). */
function brownNoise(t: Target, sr: number, rand: () => number, amp: number): void {
  for (const ch of [t.L, t.R]) {
    const v = folded(ch.length, sr, (buf) => {
      let y = 0;
      for (let i = 0; i < buf.length; i++) {
        y = 0.995 * y + (rand() * 2 - 1) * 0.1;
        buf[i] = y;
      }
    });
    for (let i = 0; i < ch.length; i++) ch[i] += v[i] * amp;
  }
}

const rain: Builder = (sr, rand) => {
  const t = layer(sr);
  pinkNoise(t, sr, rand, 1);
  filterChannels([t.L, t.R], sr, [["highpass", 350], ["lowpass", 7000], ["peaking", 3000, 0.8, 3]], true);
  // droplets
  const drops = layer(sr);
  for (let k = 0; k < LOOP_SEC * 25; k++) {
    addNoiseBurst(drops, sr, rand() * LOOP_SEC, rand, { amp: 0.15 + rand() * 0.3, tau: 0.004 + rand() * 0.006, type: "bandpass", freq: 1500 + rand() * 4000, q: 3, pan: rand() * 2 - 1 });
  }
  for (let i = 0; i < t.L.length; i++) {
    t.L[i] += drops.L[i];
    t.R[i] += drops.R[i];
  }
  return [t.L, t.R];
};

const night: Builder = (sr, rand) => {
  const t = layer(sr);
  brownNoise(t, sr, rand, 0.05);
  filterChannels([t.L, t.R], sr, [["lowpass", 400]], true);
  const crickets = [
    { f: 4400, pan: -0.6, period: 0.7 },
    { f: 4900, pan: 0.5, period: 0.95 },
    { f: 4150, pan: 0.1, period: 1.3 },
  ];
  for (const c of crickets) {
    const cycles = Math.round(LOOP_SEC / c.period);
    const per = LOOP_SEC / cycles;
    const off = rand() * per;
    for (let k = 0; k < cycles; k++) {
      if (rand() < 0.15) continue; // pauses
      const pulses = 3 + Math.floor(rand() * 2);
      for (let p = 0; p < pulses; p++) {
        addTone(t, sr, off + k * per + p * 0.032, 0.014, c.f, { wave: "sine", amp: 0.25, attack: 0.004, release: 0.008, pan: c.pan });
      }
    }
  }
  return [t.L, t.R];
};

const city: Builder = (sr, rand) => {
  const t = layer(sr);
  brownNoise(t, sr, rand, 0.6);
  filterChannels([t.L, t.R], sr, [["highpass", 30], ["lowpass", 180]], true);
  // traffic swishes: slow broadband passes
  for (let k = 0; k < 5; k++) {
    addNoiseBurst(t, sr, rand() * LOOP_SEC, rand, { amp: 0.06, attack: 1.5 + rand(), tau: 0.8, type: "bandpass", freq: 600 + rand() * 600, q: 0.6, pan: rand() * 2 - 1, maxSec: 6 });
  }
  // distant horns
  const horns = layer(sr);
  for (let k = 0; k < 2; k++) {
    const at = 1 + k * 6 + rand() * 3;
    const len = 0.25 + rand() * 0.3;
    const pan = rand() * 1.6 - 0.8;
    addTone(horns, sr, at, len, 410, { wave: "square", amp: 0.05, attack: 0.02, release: 0.08, pan });
    addTone(horns, sr, at, len, 515, { wave: "square", amp: 0.04, attack: 0.02, release: 0.08, pan });
  }
  filterChannels([horns.L, horns.R], sr, [["lowpass", 1200], ["highpass", 250]], true);
  addReverb(horns.L, horns.R, sr, { room: 0.88, wet: 0.9, circular: true });
  for (let i = 0; i < t.L.length; i++) {
    t.L[i] += horns.L[i] * 0.6;
    t.R[i] += horns.R[i] * 0.6;
  }
  return [t.L, t.R];
};

const village: Builder = (sr, rand) => {
  const t = layer(sr);
  // light wind
  pinkNoise(t, sr, rand, 0.25);
  filterChannels([t.L, t.R], sr, [["bandpass", 500, 0.5]], true);
  for (let i = 0; i < t.L.length; i++) {
    const g = 0.6 + 0.4 * Math.sin((2 * Math.PI * i) / (sr * 6));
    t.L[i] *= g;
    t.R[i] *= g;
  }
  // birds: chirps and short trills
  for (let k = 0; k < 14; k++) {
    const at = rand() * LOOP_SEC;
    const pan = rand() * 1.8 - 0.9;
    const f0 = 2500 + rand() * 2500;
    const notes = 1 + Math.floor(rand() * 4);
    for (let j = 0; j < notes; j++) {
      const up = rand() < 0.5;
      addTone(t, sr, at + j * 0.09, 0.05 + rand() * 0.04, up ? f0 : f0 * 1.4, { wave: "sine", amp: 0.12, attack: 0.008, release: 0.02, glideTo: up ? f0 * 1.4 : f0 * 0.9, pan });
    }
  }
  return [t.L, t.R];
};

/** Swept noise (wind, sea). env(p) and cutoff(p) take p in [0,1) over the loop. */
function sweptNoise(t: Target, sr: number, rand: () => number, q: number, cutoff: (p: number) => number, env: (p: number) => number, mode: "lp" | "bp"): void {
  for (const ch of [t.L, t.R]) {
    const n = ch.length;
    const off = ch === t.R ? 0.03 : 0; // slight L/R offset in the sweep
    const v = folded(n, sr, (buf) => {
      const f = new SVF(sr, cutoff(off), q);
      for (let i = 0; i < 1024; i++) f.process(rand() * 2 - 1); // settle
      for (let i = 0; i < buf.length; i++) {
        const p = (i / n + off) % 1;
        if (i % 32 === 0) f.tune(cutoff(p), q);
        f.process(rand() * 2 - 1);
        buf[i] = (mode === "lp" ? f.lp : f.bp) * env(p);
      }
    });
    for (let i = 0; i < n; i++) ch[i] += v[i];
  }
}

const wind: Builder = (sr, rand) => {
  const t = layer(sr);
  const tw = 2 * Math.PI;
  sweptNoise(
    t,
    sr,
    rand,
    3,
    (p) => 350 + 250 * Math.sin(tw * p) + 150 * Math.sin(tw * 3 * p + 1),
    (p) => 0.6 + 0.3 * Math.sin(tw * 2 * p) + 0.1 * Math.sin(tw * 5 * p),
    "bp",
  );
  brownNoise(t, sr, rand, 0.15);
  filterChannels([t.L, t.R], sr, [["highpass", 40]], true);
  return [t.L, t.R];
};

const room_hum: Builder = (sr, rand) => {
  const t = layer(sr);
  // 50 Hz mains hum + harmonics (whole number of cycles in the loop)
  for (const [f, a] of [
    [50, 0.3],
    [100, 0.15],
    [150, 0.06],
    [200, 0.03],
  ] as const) addTone(t, sr, 0, LOOP_SEC, f, { wave: "sine", amp: a, attack: 0.001, release: 0.001 });
  pinkNoise(t, sr, rand, 0.12);
  filterChannels([t.L, t.R], sr, [["lowpass", 2500]], true);
  return [t.L, t.R];
};

const crowd: Builder = (sr, rand) => {
  const t = layer(sr);
  const n = t.L.length;
  const voices = 10;
  for (let v = 0; v < voices; v++) {
    const f1 = new Biquad("bandpass", 400 + rand() * 400, sr, 4);
    const f2 = new Biquad("bandpass", 1200 + rand() * 900, sr, 5);
    const rate = 3 + rand() * 3; // syllables per second
    const cyc = Math.round(rate * LOOP_SEC);
    const ph = rand();
    const tmp = folded(n, sr, (buf) => {
      for (let i = 0; i < buf.length; i++) {
        const w = rand() * 2 - 1;
        const syl = Math.max(0, Math.sin(2 * Math.PI * ((cyc * i) / n + ph)));
        const phrase = 0.5 + 0.5 * Math.sin(2 * Math.PI * ((3 * i) / n + ph * 7));
        buf[i] = (f1.process(w) + 0.6 * f2.process(w)) * syl * syl * phrase;
      }
    });
    const pan = rand() * 1.6 - 0.8;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < n; i++) {
      t.L[i] += tmp[i] * gl;
      t.R[i] += tmp[i] * gr;
    }
  }
  filterChannels([t.L, t.R], sr, [["lowpass", 2400]], true);
  addReverb(t.L, t.R, sr, { room: 0.85, wet: 0.6, circular: true });
  return [t.L, t.R];
};

const sea: Builder = (sr, rand) => {
  const t = layer(sr);
  const waves = 2; // 6 s per wave
  const shape = (p: number) => {
    const w = (p * waves) % 1;
    // quick build, slow wash out
    return w < 0.35 ? Math.pow(w / 0.35, 2) : Math.pow(1 - (w - 0.35) / 0.65, 1.5);
  };
  sweptNoise(t, sr, rand, 0.7, (p) => 250 + 2200 * shape(p), (p) => 0.15 + 0.85 * shape(p), "lp");
  brownNoise(t, sr, rand, 0.1);
  filterChannels([t.L, t.R], sr, [["highpass", 35]], true);
  return [t.L, t.R];
};

const BUILDERS: Record<Exclude<AmbienceName, "none">, Builder> = {
  rain,
  night,
  city,
  village,
  wind,
  room_hum,
  crowd,
  sea,
};

/** Loop RMS before the mix gain (~ -16 dBFS); peak capped. */
const TARGET_RMS = 0.16;

const cache = new Map<string, Stereo>();

function ambienceLoop(name: Exclude<AmbienceName, "none">, sr: number, seed: number): Stereo {
  const key = `${name}:${sr}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const build = BUILDERS[name];
  if (!build) throw new RangeError(`Unknown ambience: ${name}`);
  const loop = build(sr, rng(seed * 7919 + name.length));
  normalise(loop, TARGET_RMS, 0.7);
  if (cache.size >= 6) cache.delete(cache.keys().next().value as string);
  cache.set(key, loop);
  return loop;
}

/** Stereo ambience [L, R] of `seconds`, deterministic per seed. "none" is silence. */
export function synthAmbience(name: AmbienceName, seconds: number, sampleRate: number, seed = 1): Float32Array[] {
  const n = Math.max(0, Math.round(seconds * sampleRate));
  if (name === "none") return [new Float32Array(n), new Float32Array(n)];
  const [l, r] = ambienceLoop(name, sampleRate, seed);
  const out = [tile(l, n), tile(r, n)];
  fadeEdges(out, sampleRate, 0.5, 0.5);
  return out;
}

/** Length of the rendered ambience loop (exposed for tests). */
export const AMBIENCE_LOOP_SECONDS = LOOP_SEC;
