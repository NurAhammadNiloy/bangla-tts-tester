import { describe, expect, it } from "vitest";
import {
  AMBIENCE_LIST,
  MUSIC_MOODS,
  SFX_LIST,
  duckCurve,
  envelope,
  measureLufs,
  mixBed,
  mixToChannels,
  resample,
  synthAmbience,
  synthMusic,
  synthSfx,
  toWav,
  trimSilence,
  type AmbienceName,
  type MusicMood,
  type SfxName,
} from "@/lib/audio/mix";
import { Biquad } from "@/lib/audio/mix/dsp";
import { musicLoop } from "@/lib/audio/mix/music";

const SR = 22050; // keeps the suite fast; the perf test uses 44.1 kHz

function finite(chans: Float32Array[]): boolean {
  for (const c of chans) for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) return false;
  return true;
}
const peak = (chans: Float32Array[]) => chans.reduce((p, c) => c.reduce((q, v) => Math.max(q, Math.abs(v)), p), 0);
function rms(c: Float32Array, a = 0, b = c.length): number {
  let s = 0;
  for (let i = a; i < b; i++) s += c[i] * c[i];
  return Math.sqrt(s / Math.max(1, b - a));
}
const db = (x: number) => 20 * Math.log10(x);

/** Fake narration: syllable-modulated buzz, ~ -20 dBFS RMS. */
function fakeVoice(sec: number, sr: number): Float32Array {
  const x = new Float32Array(Math.round(sec * sr));
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    const syl = Math.max(0, Math.sin(2 * Math.PI * 4 * t));
    x[i] = (0.3 * syl * (Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 700 * t))) / 1.5;
  }
  return x;
}

describe("labels", () => {
  it("lists every mood, sfx and ambience once", () => {
    const moods: MusicMood[] = ["emotional", "drama", "horror", "comedy", "scifi", "explainer", "historical", "mystery", "calm"];
    expect(MUSIC_MOODS.map((m) => m.id).sort()).toEqual([...moods].sort());
    expect(new Set(SFX_LIST.map((s) => s.id)).size).toBe(19);
    expect(AMBIENCE_LIST.map((a) => a.id)).toContain("none");
    expect(AMBIENCE_LIST).toHaveLength(9);
    for (const l of [...MUSIC_MOODS, ...SFX_LIST, ...AMBIENCE_LIST]) expect(l.label.length).toBeGreaterThan(1);
  });
});

describe("synthMusic", () => {
  it.each(MUSIC_MOODS.map((m) => m.id))("%s: stereo, right length, finite, audible, under 0 dBFS, fades", (mood) => {
    const m = synthMusic(mood, 12, SR, 3);
    expect(m).toHaveLength(2);
    expect(m[0].length).toBe(12 * SR);
    expect(m[1].length).toBe(12 * SR);
    expect(finite(m)).toBe(true);
    expect(peak(m)).toBeLessThan(0.95);
    expect(db(rms(m[0], 3 * SR, 9 * SR))).toBeGreaterThan(-35);
    expect(Math.abs(m[0][0])).toBeLessThan(1e-3); // fade in
    expect(Math.abs(m[0][m[0].length - 1])).toBeLessThan(1e-3); // fade out
  });

  it("is deterministic for a seed and differs across seeds", () => {
    const a = synthMusic("comedy", 6, SR, 42);
    const b = synthMusic("comedy", 6, SR, 42);
    const c = synthMusic("comedy", 6, SR, 43);
    expect(Buffer.from(a[0].buffer).equals(Buffer.from(b[0].buffer))).toBe(true);
    expect(Buffer.from(a[0].buffer).equals(Buffer.from(c[0].buffer))).toBe(false);
  });

  it.each(MUSIC_MOODS.map((m) => m.id))("%s loops without a seam", (mood) => {
    const [l] = musicLoop(mood, SR, 1);
    let sum = 0;
    for (let i = 1; i < l.length; i++) sum += Math.abs(l[i] - l[i - 1]);
    const meanStep = sum / l.length;
    const seam = Math.abs(l[0] - l[l.length - 1]);
    expect(seam).toBeLessThan(4 * meanStep + 1e-3);
    // synthMusic tiles the same loop
    const m = synthMusic(mood, l.length / SR + 6, SR, 1);
    expect(m[0][l.length + 100]).toBeCloseTo(l[100], 6);
  });
});

describe("synthSfx", () => {
  it.each(SFX_LIST.map((s) => s.id))("%s is short, finite and non-silent", (name) => {
    const x = synthSfx(name as SfxName, SR);
    expect(x.length).toBeGreaterThan(0.1 * SR);
    expect(x.length).toBeLessThan(5 * SR);
    expect(finite([x])).toBe(true);
    expect(peak([x])).toBeGreaterThan(0.2);
    expect(peak([x])).toBeLessThanOrEqual(1);
    expect(rms(x)).toBeGreaterThan(0.005);
  });

  it("returns a fresh copy each time", () => {
    const a = synthSfx("pop", SR);
    a[0] = 99;
    expect(synthSfx("pop", SR)[0]).not.toBe(99);
  });
});

describe("synthAmbience", () => {
  it.each(AMBIENCE_LIST.filter((a) => a.id !== "none").map((a) => a.id))("%s is stereo, finite, quiet but non-silent", (name) => {
    const a = synthAmbience(name as AmbienceName, 15, SR, 2);
    expect(a).toHaveLength(2);
    expect(a[0].length).toBe(15 * SR);
    expect(finite(a)).toBe(true);
    const r = rms(a[0], 2 * SR, 13 * SR);
    expect(r).toBeGreaterThan(0.01);
    expect(peak(a)).toBeLessThan(0.8);
  });

  it("'none' is silence", () => {
    const a = synthAmbience("none", 2, SR);
    expect(a[0].length).toBe(2 * SR);
    expect(peak(a)).toBe(0);
  });

  it("is deterministic for a seed", () => {
    const a = synthAmbience("rain", 3, SR, 5);
    const b = synthAmbience("rain", 3, SR, 5);
    expect(Buffer.from(a[1].buffer).equals(Buffer.from(b[1].buffer))).toBe(true);
  });
});

describe("trimSilence", () => {
  it("finds the sound inside padding and keeps the default 0.25 s", () => {
    const x = new Float32Array(3 * SR);
    for (let i = SR; i < 2 * SR; i++) x[i] = 0.3 * Math.sin(i * 0.1);
    const r = trimSilence(x, SR);
    expect(r.start).toBeCloseTo(0.75, 1);
    expect(r.end).toBeCloseTo(2.25, 1);
  });

  it("respects keep and threshold, clamps to the clip, ignores quiet noise", () => {
    const x = new Float32Array(2 * SR);
    for (let i = 0; i < x.length; i++) x[i] = 0.001 * Math.sin(i); // ~ -63 dBFS hiss
    for (let i = 0; i < SR / 2; i++) x[i] = 0.5 * Math.sin(i * 0.2);
    const r = trimSilence(x, SR, { keep: 0.1 });
    expect(r.start).toBe(0);
    expect(r.end).toBeCloseTo(0.6, 1);
    // A -70 dBFS threshold counts the hiss as sound.
    expect(trimSilence(x, SR, { threshold: -70, keep: 0 }).end).toBeCloseTo(2, 1);
  });

  it("returns 0..0 for silence", () => {
    expect(trimSilence(new Float32Array(SR), SR)).toEqual({ start: 0, end: 0 });
  });
});

describe("envelope", () => {
  it("gives one value per frame in 0..1, peaking at 1, zero in silence", () => {
    const x = new Float32Array(2 * SR);
    for (let i = SR / 2; i < SR; i++) x[i] = 0.4 * Math.sin(i * 0.05);
    const e = envelope(x, SR, 30);
    expect(e.length).toBe(60);
    expect(Math.max(...e)).toBeCloseTo(1, 5);
    expect(Math.min(...e)).toBeGreaterThanOrEqual(0);
    expect(e[5]).toBe(0);
    expect(e[22]).toBeGreaterThan(0.8);
    expect(e[59]).toBeLessThan(0.01);
  });

  it("all-silent clips give zeros; fps is configurable", () => {
    expect(Math.max(...envelope(new Float32Array(SR), SR, 24))).toBe(0);
    expect(envelope(new Float32Array(SR), SR, 24).length).toBe(24);
  });
});

describe("duckCurve", () => {
  it("dips during voice, ramps before the start and recovers after", () => {
    const g = duckCurve([{ start: 2, end: 4 }], 8, SR);
    expect(g.length).toBe(8 * SR);
    expect(g[1 * SR]).toBe(1);
    expect(g[Math.round(2.0 * SR)]).toBeCloseTo(0.55, 3); // fully ducked at voice start
    expect(g[3 * SR]).toBeCloseTo(0.55, 5);
    expect(g[Math.round(1.96 * SR)]).toBeGreaterThan(0.55); // mid-attack
    expect(g[Math.round(1.96 * SR)]).toBeLessThan(1);
    expect(g[Math.round(4.2 * SR)]).toBeGreaterThan(0.55);
    expect(g[Math.round(4.2 * SR)]).toBeLessThan(1);
    expect(g[5 * SR]).toBe(1);
  });

  it("merges close regions (no pumping) and honours depth", () => {
    const g = duckCurve([{ start: 1, end: 2 }, { start: 2.3, end: 3 }], 5, SR, { depth: 0.6 });
    expect(g[Math.round(2.15 * SR)]).toBeCloseTo(0.4, 5);
    const flat = duckCurve([{ start: 1, end: 2 }], 3, SR, { depth: 0 });
    expect(Math.min(...flat)).toBe(1);
  });
});

describe("resample / toWav", () => {
  it("resamples linearly to the right length", () => {
    const x = new Float32Array(24000).map((_, i) => Math.sin(i / 10));
    const y = resample(x, 24000, 48000);
    expect(y.length).toBe(48000);
    expect(y[2]).toBeCloseTo(x[1], 5);
  });

  it("writes a stereo 16-bit WAV", () => {
    const w = toWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 44100);
    const v = new DataView(w.buffer);
    expect(w.byteLength).toBe(44 + 12);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getInt16(44 + 4, true)).toBe(32767);
    expect(v.getInt16(44 + 8, true)).toBe(-32768);
  });
});

describe("mixToChannels", () => {
  const base = () => ({
    total: 12,
    sampleRate: SR,
    voice: [
      { channels: [fakeVoice(2.5, 24000)], sampleRate: 24000, start: 1 },
      { channels: [fakeVoice(2.5, 24000)], sampleRate: 24000, start: 7 },
    ],
    music: { mood: "emotional" as MusicMood },
  });

  it("returns finite stereo at the right length, peak <= -1 dBFS, near -14 LUFS", () => {
    const out = mixToChannels({ ...base(), ambience: [{ name: "rain", start: 0, end: 12 }], sfx: [{ name: "door_slam", at: 4.5 }, { name: "thunder", at: 9 }] });
    expect(out).toHaveLength(2);
    expect(out[0].length).toBe(12 * SR);
    expect(finite(out)).toBe(true);
    expect(peak(out)).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6);
    const lufs = measureLufs(out, SR);
    expect(lufs).toBeGreaterThan(-16.5);
    expect(lufs).toBeLessThan(-12.5);
  });

  it("ducks the music under the voice (scale-free band ratio)", () => {
    // Voice = 4 kHz tone; measure music below 250 Hz, where the voice has no energy.
    const tone = (sec: number) => new Float32Array(Math.round(sec * SR)).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 4000 * i) / SR));
    const voice = [{ channels: [tone(3)], sampleRate: SR, start: 2 }];
    const withV = mixToChannels({ total: 10, sampleRate: SR, voice, music: { mood: "drama" } });
    const noV = mixToChannels({ total: 10, sampleRate: SR, voice: [], music: { mood: "drama" } });
    const low = (x: Float32Array) => {
      const y = x.slice();
      new Biquad("lowpass", 250, SR).run(y);
      new Biquad("lowpass", 250, SR).run(y);
      return y;
    };
    const ratio = (x: Float32Array) => {
      const y = low(x);
      return rms(y, Math.round(2.5 * SR), Math.round(4.5 * SR)) / rms(y, Math.round(6 * SR), Math.round(8 * SR));
    };
    const r = ratio(withV[0]) / ratio(noV[0]);
    expect(r).toBeGreaterThan(0.45);
    expect(r).toBeLessThan(0.65); // default depth 0.45 -> x0.55
  });

  it("mutes the music during silences", () => {
    const out = mixToChannels({ total: 12, sampleRate: SR, voice: [], music: { mood: "drama" }, silences: [{ start: 5, end: 7 }] });
    expect(rms(out[0], Math.round(5.05 * SR), Math.round(6.95 * SR))).toBe(0);
    expect(rms(out[0], 3 * SR, Math.round(4.8 * SR))).toBeGreaterThan(0.01);
    expect(rms(out[0], Math.round(7.3 * SR), 9 * SR)).toBeGreaterThan(0.01);
  });

  it("places sfx at their times", () => {
    const out = mixToChannels({ total: 6, sampleRate: SR, voice: [], sfx: [{ name: "hit", at: 3 }] });
    expect(peak([out[0].subarray(0, Math.round(2.99 * SR))])).toBe(0);
    expect(peak([out[0].subarray(3 * SR, Math.round(3.5 * SR))])).toBeGreaterThan(0.3);
  });

  it("an empty mix is silent and finite", () => {
    const out = mixToChannels({ total: 1, voice: [] });
    expect(out[0].length).toBe(44100);
    expect(peak(out)).toBe(0);
  });

  it("mixes a 180 s 44.1 kHz bed (voice + music + ambience + sfx) quickly", () => {
    const sr = 44100;
    const voice = Array.from({ length: 40 }, (_, k) => ({ channels: [fakeVoice(3.2, 24000)], sampleRate: 24000, start: k * 4.4 + 0.5 }));
    const t0 = performance.now();
    const out = mixToChannels({
      total: 180,
      sampleRate: sr,
      voice,
      music: { mood: "historical" },
      ambience: [
        { name: "village", start: 0, end: 90 },
        { name: "night", start: 90, end: 180 },
      ],
      sfx: Array.from({ length: 12 }, (_, k) => ({ name: SFX_LIST[k].id, at: k * 14 + 2 })),
      silences: [{ start: 100, end: 102 }],
    });
    const ms = performance.now() - t0;
    console.log(`180 s mix: ${ms.toFixed(0)} ms`);
    expect(out[0].length).toBe(180 * sr);
    expect(finite(out)).toBe(true);
    expect(peak(out)).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6);
    expect(ms).toBeLessThan(5000);
  }, 20000);
});

describe("mixBed", () => {
  it("reads AudioBuffers, resamples, and fills the injected buffer", async () => {
    const fakeBuffer = (channels: Float32Array[], sampleRate: number) =>
      ({
        numberOfChannels: channels.length,
        sampleRate,
        length: channels[0].length,
        duration: channels[0].length / sampleRate,
        getChannelData: (c: number) => channels[c],
      }) as unknown as AudioBuffer;
    let made: Float32Array[] = [];
    const out = await mixBed(
      { total: 4, sampleRate: SR, voice: [{ buffer: fakeBuffer([fakeVoice(2, 24000)], 24000), start: 1 }], music: { mood: "calm" } },
      (channels, length, sampleRate) => {
        made = Array.from({ length: channels }, () => new Float32Array(length));
        const b = fakeBuffer(made, sampleRate);
        return b;
      },
    );
    expect(out.numberOfChannels).toBe(2);
    expect(out.sampleRate).toBe(SR);
    expect(made[0].length).toBe(4 * SR);
    expect(peak(made)).toBeGreaterThan(0.1);
  });
});
