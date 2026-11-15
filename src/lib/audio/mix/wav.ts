import { pcm16ToWav } from "../wav";

/** Encode mono or stereo float channels as a 16-bit PCM WAV (debugging / download). */
export function toWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const ch = channels.slice(0, 2);
  if (ch.length === 0) throw new RangeError("toWav needs at least one channel");
  const n = ch[0].length;
  const pcm = new Uint8Array(n * ch.length * 2);
  const view = new DataView(pcm.buffer);
  let o = 0;
  for (let i = 0; i < n; i++) {
    for (const c of ch) {
      const v = Math.max(-1, Math.min(1, c[i] || 0));
      view.setInt16(o, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
      o += 2;
    }
  }
  return pcm16ToWav(pcm, sampleRate, ch.length);
}
