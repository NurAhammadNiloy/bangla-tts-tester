import type { AmbienceName, MusicMood, SfxName } from "./types";

export const MUSIC_MOODS: { id: MusicMood; label: string }[] = [
  { id: "emotional", label: "Emotional (soft piano)" },
  { id: "drama", label: "Drama (strings + pulse)" },
  { id: "horror", label: "Horror (dark drone)" },
  { id: "comedy", label: "Comedy (bouncy marimba)" },
  { id: "scifi", label: "Sci-fi (synth arpeggio)" },
  { id: "explainer", label: "Explainer (light pluck)" },
  { id: "historical", label: "Historical (harp + pad)" },
  { id: "mystery", label: "Mystery (low pulse)" },
  { id: "calm", label: "Calm (gentle pad)" },
];

export const SFX_LIST: { id: SfxName; label: string }[] = [
  { id: "phone_ring", label: "Phone ring" },
  { id: "notification", label: "Notification" },
  { id: "message", label: "Message" },
  { id: "door_knock", label: "Door knock" },
  { id: "door_creak", label: "Door creak" },
  { id: "door_slam", label: "Door slam" },
  { id: "footsteps", label: "Footsteps" },
  { id: "whoosh", label: "Whoosh" },
  { id: "hit", label: "Hit" },
  { id: "heartbeat", label: "Heartbeat" },
  { id: "gasp_swell", label: "Gasp swell" },
  { id: "thunder", label: "Thunder" },
  { id: "glass_break", label: "Glass break" },
  { id: "clock_tick", label: "Clock tick" },
  { id: "bell", label: "Bell" },
  { id: "pop", label: "Pop" },
  { id: "laugh_boing", label: "Cartoon boing" },
  { id: "sad_sting", label: "Sad sting" },
  { id: "scare_sting", label: "Scare sting" },
];

export const AMBIENCE_LIST: { id: AmbienceName; label: string }[] = [
  { id: "none", label: "None" },
  { id: "rain", label: "Rain" },
  { id: "night", label: "Night (crickets)" },
  { id: "city", label: "City" },
  { id: "village", label: "Village (birds)" },
  { id: "wind", label: "Wind" },
  { id: "room_hum", label: "Room hum" },
  { id: "crowd", label: "Crowd murmur" },
  { id: "sea", label: "Sea waves" },
];
