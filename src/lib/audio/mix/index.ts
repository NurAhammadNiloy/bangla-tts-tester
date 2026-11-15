/**
 * Golpo Studio audio engine: synthesised music beds, sound effects and
 * ambience, plus the ducking mixer. Pure JS DSP on Float32Arrays; only
 * `mixBed` touches Web Audio (through an injected AudioBuffer factory).
 */
export type { AmbienceName, MixInput, MusicMood, SfxName, TrimResult, VoiceClip } from "./types";
export { synthMusic } from "./music";
export { synthSfx } from "./sfx";
export { synthAmbience } from "./ambience";
export { duckCurve, envelope, limit, measureLufs, trimSilence, type DuckOptions, type TrimOptions } from "./analysis";
export {
  mixBed,
  mixToChannels,
  resample,
  DEFAULT_AMBIENCE_GAIN,
  DEFAULT_MUSIC_GAIN,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_SFX_GAIN,
  TARGET_LUFS,
  type ResolvedMixInput,
  type ResolvedVoice,
} from "./mixer";
export { toWav } from "./wav";
export { AMBIENCE_LIST, MUSIC_MOODS, SFX_LIST } from "./labels";
