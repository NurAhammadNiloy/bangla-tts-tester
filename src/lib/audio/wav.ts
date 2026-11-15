/**
 * Wrap raw PCM (signed 16-bit little-endian) in a WAV container so browsers
 * can play and download it.
 *
 * OpenRouter returns `pcm` as 16-bit LE. ElevenLabs via OpenRouter documents
 * mono 24 kHz; Gemini and OpenAI TTS also emit 24 kHz mono, so that is the
 * default. The UI exposes the sample rate in case a model differs.
 */
export function pcm16ToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError(`Invalid sample rate: ${sampleRate}`);
  }
  if (channels !== 1 && channels !== 2) throw new RangeError(`Invalid channel count: ${channels}`);

  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  // Drop a trailing odd byte so the data chunk holds whole samples.
  const dataLength = pcm.byteLength - (pcm.byteLength % blockAlign);
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);

  const out = new Uint8Array(buffer);
  out.set(pcm.subarray(0, dataLength), 44);
  return out;
}

/** Duration in seconds of 16-bit PCM data. */
export function pcm16DurationSeconds(byteLength: number, sampleRate = 24000, channels = 1): number {
  return byteLength / (sampleRate * channels * 2);
}
