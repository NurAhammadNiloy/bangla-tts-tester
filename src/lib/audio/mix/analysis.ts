/**
 * Signal analysis helpers: silence trimming, mouth-flap envelope, ducking
 * curve, loudness estimate and a look-ahead soft limiter.
 */
import type { TrimResult } from "./types";
import { Biquad, dbToGain } from "./dsp";

export interface TrimOptions {
  /** Level (dBFS, RMS over 10 ms windows) below which audio counts as silence. Default -45. */
  threshold?: number;
  /** Seconds of padding kept before the first and after the last sound. Default 0.25. */
  keep?: number;
}

/**
 * Find where sound begins and ends in a clip. Uses 10 ms RMS windows so a
 * single stray sample does not count as sound. All-silent clips return
 * { start: 0, end: 0 }.
 */
export function trimSilence(samples: Float32Array, sampleRate: number, opts: TrimOptions = {}): TrimResult {
  const thr = dbToGain(opts.threshold ?? -45);
  const thr2 = thr * thr;
  const keep = opts.keep ?? 0.25;
  const dur = samples.length / sampleRate;
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  let first = -1;
  let last = -1;
  for (let w = 0; w < samples.length; w += win) {
    const end = Math.min(samples.length, w + win);
    let s = 0;
    for (let i = w; i < end; i++) s += samples[i] * samples[i];
    if (s / (end - w) >= thr2) {
      if (first < 0) first = w;
      last = end;
    }
  }
  if (first < 0) return { start: 0, end: 0 };
  return {
    start: Math.max(0, first / sampleRate - keep),
    end: Math.min(dur, last / sampleRate + keep),
  };
}

/**
 * Loudness per video frame, 0..1, for mouth flaps. RMS per frame, gated at
 * -50 dBFS, smoothed with a fast attack / slower release, then normalised to
 * the clip's own (smoothed) peak.
 */
export function envelope(samples: Float32Array, sampleRate: number, fps = 30): Float32Array {
  const frames = Math.ceil((samples.length / sampleRate) * fps);
  const out = new Float32Array(frames);
  const gate = dbToGain(-50);
  const per = sampleRate / fps;
  let y = 0;
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(f * per);
    const b = Math.min(samples.length, Math.floor((f + 1) * per));
    let s = 0;
    for (let i = a; i < b; i++) s += samples[i] * samples[i];
    let r = b > a ? Math.sqrt(s / (b - a)) : 0;
    if (r < gate) r = 0;
    y += (r > y ? 0.65 : 0.35) * (r - y);
    out[f] = y;
    if (y > peak) peak = y;
  }
  if (peak > 0) {
    for (let f = 0; f < frames; f++) out[f] = Math.min(1, out[f] / peak);
  }
  return out;
}

export interface DuckOptions {
  /** Fractional gain reduction while voice plays (0.45 -> music at 55 %, about -5 dB). */
  depth?: number;
  /** Seconds to duck down before a voice region starts. */
  attack?: number;
  /** Seconds to recover after a voice region ends. */
  release?: number;
}

/**
 * Per-sample gain curve for the music bed: 1 outside voice, (1 - depth)
 * inside, with raised-cosine ramps that finish *at* the voice start (so the
 * first syllable is clear) and begin at the voice end. Regions closer than
 * attack + release are merged so the music doesn't pump between lines.
 * Cost is O(total + ducked samples).
 */
export function duckCurve(
  voiceRegions: { start: number; end: number }[],
  total: number,
  sampleRate: number,
  opts: DuckOptions = {},
): Float32Array {
  const depth = Math.max(0, Math.min(1, opts.depth ?? 0.45));
  const attack = Math.max(0, opts.attack ?? 0.08);
  const release = Math.max(0, opts.release ?? 0.35);
  const n = Math.max(0, Math.round(total * sampleRate));
  const g = new Float32Array(n).fill(1);
  if (depth === 0 || n === 0) return g;
  const low = 1 - depth;
  const regs = voiceRegions
    .filter((r) => r.end > r.start)
    .map((r) => ({ ...r }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of regs) {
    const prev = merged[merged.length - 1];
    if (prev && r.start - prev.end <= attack + release) prev.end = Math.max(prev.end, r.end);
    else merged.push(r);
  }
  const apply = (i: number, v: number) => {
    if (i >= 0 && i < n && v < g[i]) g[i] = v;
  };
  for (const r of merged) {
    const s = Math.round(r.start * sampleRate);
    const e = Math.round(r.end * sampleRate);
    const a = Math.round(attack * sampleRate);
    const rl = Math.round(release * sampleRate);
    for (let i = Math.max(0, s - a); i < s && i < n; i++) {
      const p = (i - (s - a)) / a; // 0..1
      apply(i, 1 - depth * (0.5 - 0.5 * Math.cos(Math.PI * p)));
    }
    const hs = Math.max(0, s);
    const he = Math.min(n, e);
    for (let i = hs; i < he; i++) g[i] = Math.min(g[i], low);
    for (let i = Math.max(0, e); i < e + rl && i < n; i++) {
      const p = (i - e) / rl;
      apply(i, low + depth * (0.5 - 0.5 * Math.cos(Math.PI * p)));
    }
  }
  return g;
}

/**
 * Integrated loudness estimate in LUFS, BS.1770-style: K-weighting
 * approximated with an RBJ high-shelf (+4 dB @ 1.5 kHz) and high-pass
 * (38 Hz), 400 ms blocks with 75 % overlap, absolute gate -70 LUFS and a
 * relative gate -10 LU. Close to a real meter (within ~1 LU on typical
 * speech/music); good enough to target -14 LUFS for Facebook/Instagram.
 */
export function measureLufs(chans: Float32Array[], sampleRate: number): number {
  const n = chans[0]?.length ?? 0;
  const hop = Math.max(1, Math.round(sampleRate * 0.1));
  const nHops = Math.floor(n / hop);
  if (nHops < 1) return -Infinity;
  const hopPow = new Float64Array(nHops);
  for (const ch of chans) {
    const shelf = new Biquad("highshelf", 1500, sampleRate, 0.7071, 4);
    const hp = new Biquad("highpass", 38, sampleRate, 0.5);
    for (let h = 0; h < nHops; h++) {
      let s = 0;
      const end = (h + 1) * hop;
      for (let i = h * hop; i < end; i++) {
        const y = hp.process(shelf.process(ch[i]));
        s += y * y;
      }
      hopPow[h] += s / hop;
    }
  }
  const blocks: number[] = [];
  for (let b = 0; b + 4 <= nHops; b++) blocks.push((hopPow[b] + hopPow[b + 1] + hopPow[b + 2] + hopPow[b + 3]) / 4);
  if (blocks.length === 0) blocks.push(hopPow.reduce((a, v) => a + v, 0) / nHops);
  const lk = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = blocks.filter((p) => p > 0 && lk(p) > -70);
  if (abs.length === 0) return -Infinity;
  const meanAbs = abs.reduce((a, v) => a + v, 0) / abs.length;
  const relGate = lk(meanAbs) - 10;
  const rel = abs.filter((p) => lk(p) > relGate);
  const mean = rel.reduce((a, v) => a + v, 0) / rel.length;
  return lk(mean);
}

/**
 * Look-ahead soft limiter (stereo-linked), in place. Required gain per
 * sample = ceiling / |peak|; a sliding minimum over the look-ahead window,
 * an exponential release, then a moving average of the same window. The
 * average of window minima never exceeds the required gain, so the output
 * peak is <= ceiling with a smooth (click-free) gain curve.
 */
export function limit(chans: Float32Array[], sampleRate: number, ceilingDb = -1, lookahead = 0.005, release = 0.08): void {
  const n = chans[0]?.length ?? 0;
  if (n === 0) return;
  const ceil = dbToGain(ceilingDb);
  const req = (i: number) => {
    let p = 0;
    for (const ch of chans) {
      const a = Math.abs(ch[i]);
      if (a > p) p = a;
    }
    return p > ceil ? ceil / p : 1;
  };
  const W = Math.max(1, Math.round(lookahead * sampleRate));
  // Sliding minimum over [j, j + W - 1] -> h[j]
  const h = new Float32Array(n);
  const reqv = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    reqv[i] = req(i);
    if (reqv[i] < 1) any = true;
  }
  if (!any) return;
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < n + W - 1; k++) {
    if (k < n) {
      while (tail > head && reqv[dq[tail - 1]] >= reqv[k]) tail--;
      dq[tail++] = k;
    }
    const j = k - W + 1;
    if (j >= 0) {
      while (dq[head] < j) head++;
      h[j] = reqv[dq[head]];
    }
  }
  // Release: rise back towards 1 exponentially, never above h.
  const rc = 1 - Math.exp(-1 / (release * sampleRate));
  let r = h[0];
  for (let j = 0; j < n; j++) {
    r += (1 - r) * rc;
    if (h[j] < r) r = h[j];
    h[j] = r;
  }
  // Moving average over [i - W + 1, i] (treat j < 0 as h[0]).
  let sum = h[0] * W;
  for (let i = 0; i < n; i++) {
    sum += h[i] - (i - W >= 0 ? h[i - W] : h[0]);
    const g = Math.min(sum / W, reqv[i]);
    for (const ch of chans) {
      let v = ch[i] * g;
      if (v > ceil) v = ceil;
      else if (v < -ceil) v = -ceil;
      ch[i] = v;
    }
  }
}
