/**
 * Final mix: voice at full level, music ducked under the voice (and muted for
 * dramatic silences), ambience beds, sound effects, then loudness
 * normalisation to about -14 LUFS and a -1 dBFS soft limiter.
 */
import type { MixInput } from "./types";
import { synthAmbience } from "./ambience";
import { duckCurve, limit, measureLufs, trimSilence } from "./analysis";
import { synthMusic } from "./music";
import { synthSfx } from "./sfx";

export interface ResolvedVoice {
  /** One (mono) or two (stereo) channels of PCM. */
  channels: Float32Array[];
  sampleRate: number;
  /** Seconds on the final timeline. */
  start: number;
}

/** MixInput with the voice already decoded to plain sample arrays. */
export type ResolvedMixInput = Omit<MixInput, "voice"> & { voice: ResolvedVoice[] };

export const DEFAULT_SAMPLE_RATE = 44100;
export const DEFAULT_MUSIC_GAIN = 0.18;
export const DEFAULT_AMBIENCE_GAIN = 0.1;
export const DEFAULT_SFX_GAIN = 0.8;
export const TARGET_LUFS = -14;
export const CEILING_DB = -1;
/** Fade used when music drops out for a silence. */
const SILENCE_FADE = 0.12;
/** Normalisation never changes the level by more than this (dB). */
const MAX_MAKEUP_DB = 20;

/** Linear-interpolation resampler. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const n = Math.max(0, Math.round((x.length * to) / from));
  const out = new Float32Array(n);
  const step = from / to;
  const last = x.length - 1;
  for (let i = 0; i < n; i++) {
    const p = i * step;
    const k = Math.floor(p);
    if (k >= last) {
      out[i] = x[last] ?? 0;
    } else {
      const f = p - k;
      out[i] = x[k] + (x[k + 1] - x[k]) * f;
    }
  }
  return out;
}

function addAt(dst: Float32Array, src: Float32Array, offset: number, gain: number): void {
  const a = Math.max(0, offset);
  const b = Math.min(dst.length, offset + src.length);
  for (let i = a; i < b; i++) dst[i] += src[i - offset] * gain;
}

/** Multiply `g` by a mute curve for each silence (fade out before, fade in after). */
function applySilences(g: Float32Array, silences: { start: number; end: number }[], sr: number): void {
  const f = Math.round(SILENCE_FADE * sr);
  const n = g.length;
  for (const s of silences) {
    const a = Math.round(s.start * sr);
    const b = Math.round(s.end * sr);
    if (b <= a) continue;
    for (let i = Math.max(0, a - f); i < a && i < n; i++) {
      const p = (a - i) / f; // 1 -> 0 approaching the silence
      g[i] *= 0.5 - 0.5 * Math.cos(Math.PI * p);
    }
    for (let i = Math.max(0, a); i < b && i < n; i++) g[i] = 0;
    for (let i = Math.max(0, b); i < b + f && i < n; i++) {
      const p = (i - b) / f;
      g[i] *= 0.5 - 0.5 * Math.cos(Math.PI * p);
    }
  }
}

/**
 * Mix everything to stereo [L, R] of length round(total * sampleRate).
 *
 * Levels: voice 1.0; music `music.gain` (default 0.18) x duck curve (-5 dB
 * under voice), muted during `silences`; ambience 0.10; sfx 0.8. The beds
 * themselves are pre-normalised (music RMS ~ -18 dBFS, ambience ~ -16 dBFS).
 *
 * Mastering: the whole mix is gain-normalised to -14 LUFS (integrated
 * loudness approximated per `measureLufs`, makeup capped at +/-20 dB), then
 * a look-ahead limiter keeps peaks <= -1 dBFS. Heavy limiting can leave the
 * result slightly under -14 LUFS; that is intentional (no extra loudening).
 */
export function mixToChannels(input: ResolvedMixInput): Float32Array[] {
  const sr = input.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const n = Math.max(0, Math.round(input.total * sr));
  const L = new Float32Array(n);
  const R = new Float32Array(n);

  // Voice
  const regions: { start: number; end: number }[] = [];
  for (const v of input.voice) {
    if (!v.channels.length) continue;
    const chans = v.channels.map((c) => resample(c, v.sampleRate, sr));
    const off = Math.round(v.start * sr);
    addAt(L, chans[0], off, 1);
    addAt(R, chans[1] ?? chans[0], off, 1);
    const tr = trimSilence(chans[0], sr, { keep: 0.05 });
    if (tr.end > tr.start) regions.push({ start: v.start + tr.start, end: v.start + tr.end });
  }

  // Music
  if (input.music) {
    const gain = input.music.gain ?? DEFAULT_MUSIC_GAIN;
    const [ml, mr] = synthMusic(input.music.mood, input.total, sr);
    const g = duckCurve(regions, input.total, sr);
    if (input.silences?.length) applySilences(g, input.silences, sr);
    for (let i = 0; i < n; i++) {
      const k = g[i] * gain;
      L[i] += ml[i] * k;
      R[i] += mr[i] * k;
    }
  }

  // Ambience
  for (const a of input.ambience ?? []) {
    if (a.name === "none") continue;
    const start = Math.max(0, a.start);
    const end = Math.min(input.total, a.end);
    if (end <= start) continue;
    const [al, ar] = synthAmbience(a.name, end - start, sr);
    const gain = a.gain ?? DEFAULT_AMBIENCE_GAIN;
    const off = Math.round(start * sr);
    addAt(L, al, off, gain);
    addAt(R, ar, off, gain);
  }

  // Sound effects (mono, centred)
  for (const s of input.sfx ?? []) {
    const x = synthSfx(s.name, sr);
    const gain = s.gain ?? DEFAULT_SFX_GAIN;
    const off = Math.round(s.at * sr);
    addAt(L, x, off, gain);
    addAt(R, x, off, gain);
  }

  // Mastering
  const out = [L, R];
  const lufs = measureLufs(out, sr);
  if (Number.isFinite(lufs)) {
    const db = Math.max(-MAX_MAKEUP_DB, Math.min(MAX_MAKEUP_DB, TARGET_LUFS - lufs));
    const g = Math.pow(10, db / 20);
    for (let i = 0; i < n; i++) {
      L[i] *= g;
      R[i] *= g;
    }
  }
  limit(out, sr, CEILING_DB);
  return out;
}

/**
 * Browser convenience: decode voice AudioBuffers, mix, and copy into an
 * AudioBuffer made by `makeBuffer` (e.g. `(c, l, r) => new AudioBuffer({ numberOfChannels: c, length: l, sampleRate: r })`).
 */
export async function mixBed(
  input: MixInput,
  makeBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer,
): Promise<AudioBuffer> {
  const sr = input.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const voice: ResolvedVoice[] = input.voice.map((v) => {
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, v.buffer.numberOfChannels); c++) channels.push(v.buffer.getChannelData(c));
    return { channels, sampleRate: v.buffer.sampleRate, start: v.start };
  });
  const out = mixToChannels({ ...input, voice, sampleRate: sr });
  const buf = makeBuffer(2, out[0].length, sr);
  for (let c = 0; c < 2; c++) {
    if (typeof buf.copyToChannel === "function") buf.copyToChannel(out[c] as Float32Array<ArrayBuffer>, c);
    else buf.getChannelData(c).set(out[c]);
  }
  return buf;
}
