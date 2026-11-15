/**
 * Audio mix contracts (v2). Everything is synthesised in the browser with Web
 * Audio (OfflineAudioContext), so there are no licence questions and no files
 * to download: music beds, sound effects and ambience are all generated.
 */
import type { Genre } from "@/lib/storyPlan";

export type MusicMood = Genre | "mystery" | "calm";

export type SfxName =
  | "phone_ring"
  | "notification"
  | "message"
  | "door_knock"
  | "door_creak"
  | "door_slam"
  | "footsteps"
  | "whoosh"
  | "hit"
  | "heartbeat"
  | "gasp_swell"
  | "thunder"
  | "glass_break"
  | "clock_tick"
  | "bell"
  | "pop"
  | "laugh_boing"
  | "sad_sting"
  | "scare_sting";

export type AmbienceName = "none" | "rain" | "night" | "city" | "village" | "wind" | "room_hum" | "crowd" | "sea";

export interface VoiceClip {
  buffer: AudioBuffer;
  /** Seconds on the final timeline. */
  start: number;
}

export interface MixInput {
  total: number; // seconds
  sampleRate?: number; // default 44100
  voice: VoiceClip[];
  music?: { mood: MusicMood; gain?: number /* 0..1, default 0.18 */ } | null;
  sfx?: { name: SfxName; at: number; gain?: number }[];
  ambience?: { name: AmbienceName; start: number; end: number; gain?: number }[];
  /** Moments where music drops out (e.g. silence before a twist). */
  silences?: { start: number; end: number }[];
  /** Music gain multipliers over time (1 = normal). */
  musicLevels?: { start: number; end: number; gain: number }[];
}

/** Result of trimming a voice clip's leading/trailing silence. */
export interface TrimResult {
  start: number; // seconds into the buffer where sound begins
  end: number; // seconds where it ends
}
