/**
 * Small pure-JS DSP toolkit used by the music, sfx and ambience synths.
 * Everything works on plain Float32Arrays so it runs (and is tested) in Node.
 *
 * Loop renders are *circular*: note writers wrap their index modulo the
 * buffer length, and filters / reverb are run over the loop twice, keeping
 * only the second pass. The result is the steady-state periodic signal, so a
 * loop tiles seamlessly (tails ring over the seam into the start).
 */

export type Stereo = [Float32Array, Float32Array];

/** Deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** Constant-power pan gains for pan in [-1, 1]. */
export function panGains(pan: number): [number, number] {
  const th = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(th), Math.sin(th)];
}

/* ------------------------------------------------------------------ */
/* Filters                                                              */
/* ------------------------------------------------------------------ */

export type BiquadType = "lowpass" | "highpass" | "bandpass" | "peaking" | "lowshelf" | "highshelf";

/** RBJ-cookbook biquad, transposed direct form II. */
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;

  constructor(type: BiquadType, freq: number, sr: number, q = 0.7071, gainDb = 0) {
    this.set(type, freq, sr, q, gainDb);
  }

  set(type: BiquadType, freq: number, sr: number, q = 0.7071, gainDb = 0): void {
    const f = Math.max(5, Math.min(freq, sr * 0.49));
    const w0 = (2 * Math.PI * f) / sr;
    const c = Math.cos(w0);
    const s = Math.sin(w0);
    const alpha = s / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (type) {
      case "lowpass":
        b0 = (1 - c) / 2;
        b1 = 1 - c;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * c;
        a2 = 1 - alpha;
        break;
      case "highpass":
        b0 = (1 + c) / 2;
        b1 = -(1 + c);
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * c;
        a2 = 1 - alpha;
        break;
      case "bandpass": // 0 dB peak gain
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * c;
        a2 = 1 - alpha;
        break;
      case "peaking":
        b0 = 1 + alpha * A;
        b1 = -2 * c;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * c;
        a2 = 1 - alpha / A;
        break;
      case "lowshelf": {
        const k = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * c + k);
        b1 = 2 * A * (A - 1 - (A + 1) * c);
        b2 = A * (A + 1 - (A - 1) * c - k);
        a0 = A + 1 + (A - 1) * c + k;
        a1 = -2 * (A - 1 + (A + 1) * c);
        a2 = A + 1 + (A - 1) * c - k;
        break;
      }
      case "highshelf": {
        const k = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * c + k);
        b1 = -2 * A * (A - 1 + (A + 1) * c);
        b2 = A * (A + 1 + (A - 1) * c - k);
        a0 = A + 1 - (A - 1) * c + k;
        a1 = 2 * (A - 1 - (A + 1) * c);
        a2 = A + 1 - (A - 1) * c - k;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  /** Filter buf in place. */
  run(buf: Float32Array): void {
    let { z1, z2 } = this;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
  }

  /** Steady-state filter of a periodic buffer (warm-up pass, then real pass). */
  runCircular(buf: Float32Array): void {
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
    }
    this.z1 = z1;
    this.z2 = z2;
    this.run(buf);
  }
}

/** Apply a chain of biquads to each channel (circularly for loops). */
export function filterChannels(
  chans: Float32Array[],
  sr: number,
  specs: [BiquadType, number, number?, number?][],
  circular: boolean,
): void {
  for (const ch of chans) {
    for (const [type, f, q, g] of specs) {
      const bq = new Biquad(type, f, sr, q ?? 0.7071, g ?? 0);
      if (circular) bq.runCircular(ch);
      else bq.run(ch);
    }
  }
}

/**
 * Zero-delay-feedback state-variable filter (Simper/TPT). Cheap to retune
 * per block, used for swept noise (whoosh, wind, sea).
 */
export class SVF {
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  private ic1 = 0;
  private ic2 = 0;
  lp = 0;
  bp = 0;
  hp = 0;

  constructor(
    private sr: number,
    freq: number,
    q = 0.7071,
  ) {
    this.tune(freq, q);
  }

  tune(freq: number, q = 0.7071): void {
    const f = Math.max(10, Math.min(freq, this.sr * 0.45));
    const g = Math.tan((Math.PI * f) / this.sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(x: number): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - this.k * v1 - v2;
  }
}

/* ------------------------------------------------------------------ */
/* Reverb (Freeverb-style: 8 damped combs + 4 allpasses per channel)    */
/* ------------------------------------------------------------------ */

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;

class ReverbChannel {
  private combs: Float32Array[];
  private combIdx: Int32Array;
  private combStore: Float64Array;
  private aps: Float32Array[];
  private apIdx: Int32Array;

  constructor(
    sr: number,
    offset: number,
    private feedback: number,
    private damp: number,
  ) {
    const scale = sr / 44100;
    this.combs = COMBS.map((d) => new Float32Array(Math.max(1, Math.round((d + offset) * scale))));
    this.aps = ALLPASSES.map((d) => new Float32Array(Math.max(1, Math.round((d + offset) * scale))));
    this.combIdx = new Int32Array(this.combs.length);
    this.combStore = new Float64Array(this.combs.length);
    this.apIdx = new Int32Array(this.aps.length);
  }

  process(x: number): number {
    let out = 0;
    const fb = this.feedback;
    const d = this.damp;
    for (let c = 0; c < this.combs.length; c++) {
      const buf = this.combs[c];
      const i = this.combIdx[c];
      const y = buf[i];
      this.combStore[c] = y * (1 - d) + this.combStore[c] * d;
      buf[i] = x + this.combStore[c] * fb;
      this.combIdx[c] = i + 1 === buf.length ? 0 : i + 1;
      out += y;
    }
    for (let a = 0; a < this.aps.length; a++) {
      const buf = this.aps[a];
      const i = this.apIdx[a];
      const b = buf[i];
      buf[i] = out + b * 0.5;
      out = b - out;
      this.apIdx[a] = i + 1 === buf.length ? 0 : i + 1;
    }
    return out;
  }
}

export interface ReverbOpts {
  /** Comb feedback 0.7..0.95 (room size). */
  room?: number;
  /** High-frequency damping 0..1. */
  damp?: number;
  /** Wet level added on top of the dry signal. */
  wet?: number;
  /** Treat the buffers as a loop (steady-state wrap). */
  circular?: boolean;
}

/** Add a stereo reverb of (L+R) into L and R in place. */
export function addReverb(L: Float32Array, R: Float32Array, sr: number, opts: ReverbOpts = {}): void {
  const room = opts.room ?? 0.84;
  const damp = opts.damp ?? 0.3;
  const wet = (opts.wet ?? 0.3) * 0.05; // freeverb input gain 0.015 x wet scale ~3
  const rl = new ReverbChannel(sr, 0, room, damp);
  const rr = new ReverbChannel(sr, SPREAD, room, damp);
  const n = L.length;
  if (opts.circular) {
    for (let i = 0; i < n; i++) {
      const x = L[i] + R[i];
      rl.process(x);
      rr.process(x);
    }
  }
  for (let i = 0; i < n; i++) {
    const x = L[i] + R[i];
    const yl = rl.process(x);
    const yr = rr.process(x);
    L[i] += yl * wet;
    R[i] += yr * wet;
  }
}

/** Simple feedback echo (ping-pong) added in place; circular for loops. */
export function addEcho(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  delaySec: number,
  feedback: number,
  mix: number,
  circular: boolean,
): void {
  const d = Math.max(1, Math.round(delaySec * sr));
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  const n = L.length;
  let idx = 0;
  const pass = (write: boolean) => {
    for (let i = 0; i < n; i++) {
      const el = bl[idx];
      const er = br[idx];
      // ping-pong: left feeds right and vice versa
      bl[idx] = L[i] + er * feedback;
      br[idx] = R[i] * 0.3 + el * feedback;
      idx = idx + 1 === d ? 0 : idx + 1;
      if (write) {
        L[i] += el * mix;
        R[i] += er * mix;
      }
    }
  };
  if (circular) pass(false);
  pass(true);
}

/* ------------------------------------------------------------------ */
/* Note writers. `wrap` = write modulo buffer length (loops).           */
/* ------------------------------------------------------------------ */

export interface Target {
  L: Float32Array;
  /** Same array as L for mono targets (pass gr = 0). */
  R: Float32Array;
  wrap: boolean;
}

export const monoTarget = (buf: Float32Array): Target => ({ L: buf, R: buf, wrap: false });

/**
 * Exponentially decaying sine via a two-pole resonator recurrence
 * (2 mults per sample, no Math.sin): amp * e^(-t/tau) * sin(2 pi f t).
 */
export function addDecaySine(
  t: Target,
  sr: number,
  start: number,
  freq: number,
  amp: number,
  tau: number,
  pan = 0,
  attack = 0.002,
  maxSec = 8,
): void {
  const w = (2 * Math.PI * freq) / sr;
  if (!(w > 0 && w < Math.PI * 0.95) || amp === 0) return;
  const n = t.L.length;
  const r = Math.exp(-1 / (tau * sr));
  const c = 2 * r * Math.cos(w);
  const r2 = r * r;
  const len = Math.min(Math.ceil(tau * sr * 7), Math.ceil(maxSec * sr));
  const att = Math.max(1, Math.round(attack * sr));
  const [gl0, gr0] = t.L === t.R ? [1, 0] : panGains(pan);
  const gl = gl0 * amp;
  const gr = gr0 * amp;
  let y2 = 0; // y[n-2]
  let y1 = 0; // y[n-1]
  let idx = Math.round(start);
  if (t.wrap) idx = ((idx % n) + n) % n;
  for (let k = 0; k < len; k++) {
    const y = k === 1 ? r * Math.sin(w) : c * y1 - r2 * y2;
    y2 = y1;
    y1 = y;
    if (idx >= n) {
      if (!t.wrap) break;
      idx = 0;
    }
    if (idx >= 0) {
      const e = k < att ? k / att : 1;
      t.L[idx] += y * gl * e;
      if (gr !== 0) t.R[idx] += y * gr * e;
    }
    idx++;
  }
}

function polyBlep(ph: number, dt: number): number {
  if (ph < dt) {
    const x = ph / dt;
    return x + x - x * x - 1;
  }
  if (ph > 1 - dt) {
    const x = (ph - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export type Wave = "sine" | "tri" | "saw" | "square";

export interface ToneOpts {
  wave?: Wave;
  amp?: number;
  attack?: number;
  release?: number;
  pan?: number;
  /** Vibrato rate (Hz) and depth (cents). */
  vibRate?: number;
  vibCents?: number;
  /** Linear pitch glide: frequency at the end of the note. */
  glideTo?: number;
  /** Phase offset 0..1. */
  phase?: number;
  /** Envelope shape: "cos" raised-cosine attack/release (pads), "exp" exponential decay with tau. */
  decayTau?: number;
}

/**
 * Oscillator note of `dur` seconds plus `release`. Raised-cosine attack and
 * release (click-free). Optional exponential decay (decayTau).
 */
export function addTone(t: Target, sr: number, startSec: number, dur: number, freq: number, o: ToneOpts = {}): void {
  const wave = o.wave ?? "sine";
  const amp = o.amp ?? 0.2;
  const attack = Math.max(0.001, o.attack ?? 0.01);
  const release = Math.max(0.001, o.release ?? 0.05);
  const n = t.L.length;
  const total = Math.ceil((dur + release) * sr);
  const aS = attack * sr;
  const holdEnd = dur * sr;
  const rS = release * sr;
  const [gl0, gr0] = t.L === t.R ? [1, 0] : panGains(o.pan ?? 0);
  const gl = gl0 * amp;
  const gr = gr0 * amp;
  const vibRate = o.vibRate ?? 0;
  const vibDepth = o.vibCents ? Math.pow(2, o.vibCents / 1200) - 1 : 0;
  const tauDecay = o.decayTau ? Math.exp(-1 / (o.decayTau * sr)) : 1;
  let decay = 1;
  let ph = o.phase ?? 0;
  let idx = Math.round(startSec * sr);
  if (t.wrap) idx = ((idx % n) + n) % n;
  const f1 = o.glideTo ?? freq;
  for (let k = 0; k < total; k++) {
    if (idx >= n) {
      if (!t.wrap) break;
      idx = 0;
    }
    const prog = k / total;
    let f = freq + (f1 - freq) * prog;
    if (vibDepth) f *= 1 + vibDepth * Math.sin((2 * Math.PI * vibRate * k) / sr);
    const dt = f / sr;
    let s: number;
    switch (wave) {
      case "sine":
        s = Math.sin(2 * Math.PI * ph);
        break;
      case "tri":
        s = 1 - 4 * Math.abs(ph - 0.5);
        break;
      case "saw":
        s = 2 * ph - 1 - polyBlep(ph, dt);
        break;
      case "square": {
        s = (ph < 0.5 ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 0.5) % 1, dt);
        break;
      }
    }
    ph += dt;
    if (ph >= 1) ph -= 1;
    let e: number;
    if (k < aS) e = 0.5 - 0.5 * Math.cos((Math.PI * k) / aS);
    else if (k < holdEnd) e = 1;
    else e = 0.5 + 0.5 * Math.cos((Math.PI * Math.min(rS, k - holdEnd)) / rS);
    e *= decay;
    decay *= tauDecay;
    if (idx >= 0) {
      t.L[idx] += s * gl * e;
      if (gr !== 0) t.R[idx] += s * gr * e;
    }
    idx++;
  }
}

/** Karplus-Strong plucked string. bright 0..1 shapes the excitation. */
export function addPluck(
  t: Target,
  sr: number,
  startSec: number,
  freq: number,
  amp: number,
  rand: () => number,
  opts: { decay?: number; bright?: number; pan?: number; maxSec?: number } = {},
): void {
  const P = Math.max(2, Math.round(sr / freq));
  const decay = opts.decay ?? 1.2;
  const bright = opts.bright ?? 0.5;
  const line = new Float32Array(P);
  // Excitation: filtered noise burst
  const a = 0.15 + 0.8 * bright;
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < P; i++) {
    lp += a * (rand() * 2 - 1 - lp);
    line[i] = lp;
    mean += lp;
  }
  mean /= P;
  let peak = 1e-9;
  for (let i = 0; i < P; i++) {
    line[i] -= mean;
    peak = Math.max(peak, Math.abs(line[i]));
  }
  for (let i = 0; i < P; i++) line[i] /= peak;
  const rho = Math.exp(-P / (decay * sr)) ;
  const len = Math.ceil(Math.min(opts.maxSec ?? 4, decay * 5) * sr);
  const n = t.L.length;
  const [gl0, gr0] = t.L === t.R ? [1, 0] : panGains(opts.pan ?? 0);
  const gl = gl0 * amp;
  const gr = gr0 * amp;
  const att = Math.max(1, Math.round(0.0015 * sr));
  let idx = Math.round(startSec * sr);
  if (t.wrap) idx = ((idx % n) + n) % n;
  let p = 0;
  let prev = line[P - 1];
  const fadeStart = len - Math.round(0.05 * sr);
  for (let k = 0; k < len; k++) {
    if (idx >= n) {
      if (!t.wrap) break;
      idx = 0;
    }
    const y = line[p];
    line[p] = rho * 0.5 * (y + prev);
    prev = y;
    p = p + 1 === P ? 0 : p + 1;
    let e = k < att ? k / att : 1;
    if (k > fadeStart) e *= (len - k) / (len - fadeStart);
    if (idx >= 0) {
      t.L[idx] += y * gl * e;
      if (gr !== 0) t.R[idx] += y * gr * e;
    }
    idx++;
  }
}

/**
 * Filtered noise burst: amp * env * filtered(noise). env = linear attack then
 * exponential decay with tau. Filter: biquad of given type.
 */
export function addNoiseBurst(
  t: Target,
  sr: number,
  startSec: number,
  rand: () => number,
  o: { amp: number; attack?: number; tau: number; type?: BiquadType; freq?: number; q?: number; pan?: number; maxSec?: number },
): void {
  const bq = o.type ? new Biquad(o.type, o.freq ?? 1000, sr, o.q ?? 0.7071) : null;
  const len = Math.ceil(Math.min(o.maxSec ?? 6, (o.attack ?? 0) + o.tau * 7) * sr);
  const aS = Math.max(1, (o.attack ?? 0.001) * sr);
  const dec = Math.exp(-1 / (o.tau * sr));
  const n = t.L.length;
  const [gl0, gr0] = t.L === t.R ? [1, 0] : panGains(o.pan ?? 0);
  const gl = gl0 * o.amp;
  const gr = gr0 * o.amp;
  let env = 1;
  let idx = Math.round(startSec * sr);
  if (t.wrap) idx = ((idx % n) + n) % n;
  for (let k = 0; k < len; k++) {
    if (idx >= n) {
      if (!t.wrap) break;
      idx = 0;
    }
    let x = rand() * 2 - 1;
    if (bq) x = bq.process(x);
    let e: number;
    if (k < aS) e = k / aS;
    else {
      e = env;
      env *= dec;
    }
    if (idx >= 0) {
      t.L[idx] += x * gl * e;
      if (gr !== 0) t.R[idx] += x * gr * e;
    }
    idx++;
  }
}

/* ------------------------------------------------------------------ */
/* Buffer utilities                                                      */
/* ------------------------------------------------------------------ */

export function peakOf(chans: Float32Array[]): number {
  let p = 0;
  for (const ch of chans) for (let i = 0; i < ch.length; i++) {
    const a = Math.abs(ch[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rmsOf(chans: Float32Array[]): number {
  let s = 0;
  let n = 0;
  for (const ch of chans) {
    for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
    n += ch.length;
  }
  return n ? Math.sqrt(s / n) : 0;
}

export function scale(chans: Float32Array[], g: number): void {
  for (const ch of chans) for (let i = 0; i < ch.length; i++) ch[i] *= g;
}

/** Scale to the target RMS, but never let the peak exceed maxPeak. */
export function normalise(chans: Float32Array[], targetRms: number, maxPeak: number): void {
  const r = rmsOf(chans);
  const p = peakOf(chans);
  if (r <= 0 || p <= 0) return;
  scale(chans, Math.min(targetRms / r, maxPeak / p));
}

/** Tile a loop to `n` samples (no allocation per sample). */
export function tile(loop: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n);
  if (loop.length === 0) return out;
  for (let o = 0; o < n; o += loop.length) {
    const len = Math.min(loop.length, n - o);
    out.set(len === loop.length ? loop : loop.subarray(0, len), o);
  }
  return out;
}

/** Raised-cosine fade in/out in place (fades shrink for short buffers). */
export function fadeEdges(chans: Float32Array[], sr: number, fadeIn: number, fadeOut: number): void {
  const n = chans[0]?.length ?? 0;
  const fi = Math.min(Math.round(fadeIn * sr), Math.floor(n / 3));
  const fo = Math.min(Math.round(fadeOut * sr), Math.floor(n / 3));
  for (const ch of chans) {
    for (let i = 0; i < fi; i++) ch[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
    for (let i = 0; i < fo; i++) ch[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
  }
}
