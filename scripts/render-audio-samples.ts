/**
 * Render every music mood, sfx and ambience to /tmp/golpo-audio/*.wav and
 * print numeric sanity stats (peak, RMS, zero-crossing rate, seam jump).
 * Run: npx jiti scripts/render-audio-samples.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { AMBIENCE_LIST, MUSIC_MOODS, SFX_LIST, mixToChannels, synthAmbience, synthMusic, synthSfx, toWav, measureLufs } from "../src/lib/audio/mix/index";

const SR = 44100;
const DIR = "/tmp/golpo-audio";
mkdirSync(DIR, { recursive: true });

function stats(ch: Float32Array[]) {
  let peak = 0, s = 0, zc = 0, n = 0;
  for (const c of ch) {
    for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
      s += c[i] * c[i];
      if (i && (c[i] >= 0) !== (c[i - 1] >= 0)) zc++;
    }
    n += c.length;
  }
  const rms = Math.sqrt(s / n);
  return `peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS  rms ${(20 * Math.log10(rms)).toFixed(1)} dBFS  zcr ${Math.round((zc / n) * SR)} /s  dur ${(ch[0].length / SR).toFixed(2)} s`;
}

for (const { id } of MUSIC_MOODS) {
  const t = performance.now();
  const m = synthMusic(id, 30, SR, 1);
  const ms = performance.now() - t;
  writeFileSync(`${DIR}/music_${id}.wav`, toWav(m, SR));
  console.log(`music ${id.padEnd(11)} ${stats(m)}  ${ms.toFixed(0)} ms`);
}
for (const { id } of SFX_LIST) {
  const x = synthSfx(id, SR);
  writeFileSync(`${DIR}/sfx_${id}.wav`, toWav([x], SR));
  console.log(`sfx ${id.padEnd(13)} ${stats([x])}`);
}
for (const { id } of AMBIENCE_LIST) {
  if (id === "none") continue;
  const a = synthAmbience(id, 20, SR, 1);
  writeFileSync(`${DIR}/amb_${id}.wav`, toWav(a, SR));
  console.log(`amb ${id.padEnd(9)} ${stats(a)}`);
}

// A demo mix: fake "voice" (formant-ish buzz bursts) with music, rain and sfx.
const voiceClip = (sec: number) => {
  const x = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const syl = Math.max(0, Math.sin(2 * Math.PI * 4 * t));
    x[i] = 0.3 * syl * (Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 700 * t) + 0.3 * Math.sin(2 * Math.PI * 1800 * t)) / 1.8;
  }
  return x;
};
const voice = [0.5, 5, 10, 16].map((start) => ({ channels: [voiceClip(3.5)], sampleRate: SR, start }));
const t0 = performance.now();
const mix = mixToChannels({
  total: 22, sampleRate: SR, voice,
  music: { mood: "emotional" },
  ambience: [{ name: "rain", start: 0, end: 22 }],
  sfx: [{ name: "door_knock", at: 4.2 }, { name: "scare_sting", at: 14.5 }],
  silences: [{ start: 14.2, end: 16 }],
});
console.log(`mix 22 s: ${stats(mix)}  LUFS ${measureLufs(mix, SR).toFixed(1)}  ${(performance.now() - t0).toFixed(0)} ms`);
writeFileSync(`${DIR}/mix_demo.wav`, toWav(mix, SR));
