/**
 * Story Voice Director: genre presets and audio-tag palettes.
 *
 * Based on Google's Gemini 3.1 Flash TTS prompting guide (Apr 2026):
 *  - Style instructions set the overall register; accent comes from the style
 *    prompt, not the language setting.
 *  - Inline tags go in [brackets], in ENGLISH ONLY, even inside Bengali text.
 *  - Place a tag where the shift should happen; never put two tags side by side.
 *  - Avoid "flatness" words (quiet, flat, monotone, careful) in style notes.
 */

export type TagFamily = "gemini" | "elevenlabs" | "none";

export function tagFamilyFor(modelId: string): TagFamily {
  if (/^google\/gemini-.*tts/.test(modelId)) return "gemini";
  if (/^elevenlabs\/eleven-v(3|4)/.test(modelId)) return "elevenlabs";
  return "none";
}

/** Tags listed as "commonly used" in Google's guide. */
export const GEMINI_TAGS = {
  emotion: [
    "sad", "hope", "tension", "nervousness", "anxiety", "panic", "awe", "relief",
    "excitement", "amusement", "anger", "frustration", "curiosity", "adoration", "determination",
  ],
  delivery: ["whispers", "laughs", "sighs", "gasp", "slow", "fast", "short pause", "long pause"],
} as const;

/** Commonly used Eleven v3/v4 audio tags. */
export const ELEVEN_TAGS = {
  emotion: ["sad", "excited", "angry", "happy", "curious", "nervous", "crying", "sarcastic"],
  delivery: ["whispers", "sighs", "laughs", "gasps", "exhales", "pause"],
} as const;

export function tagsFor(family: TagFamily): { emotion: readonly string[]; delivery: readonly string[] } {
  if (family === "gemini") return GEMINI_TAGS;
  if (family === "elevenlabs") return ELEVEN_TAGS;
  return { emotion: [], delivery: [] };
}

export function allowedTags(family: TagFamily): Set<string> {
  const t = tagsFor(family);
  return new Set([...t.emotion, ...t.delivery]);
}

export interface StylePreset {
  id: string;
  label: string;
  emoji: string;
  /** Suggested Gemini voice (from Google's 30 prebuilt voices). */
  geminiVoice: string;
  /** Suggested ElevenLabs premade voice. */
  elevenVoice: string;
  /** Director's note sent as `instructions` (Gemini / OpenAI / Fish Audio). */
  instructions: string;
  /** Tells the auto-tagger which emotional palette fits this genre. */
  tagHint: string;
}

const BASE =
  "Read only the story text. Everything in this note is direction and must not be spoken. " +
  "Language: Bengali as spoken in Bangladesh, with a natural Dhaka accent and correct Bangla pronunciation, not a Kolkata accent. ";

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "emotional",
    label: "Emotional family",
    emoji: "🥲",
    geminiVoice: "Kore",
    elevenVoice: "alice",
    instructions:
      BASE +
      "PROFILE: a warm Bangladeshi storyteller in her thirties telling a true family story to close friends. " +
      "SCENE: late evening, a small room lit by one lamp, everyone listening closely. " +
      "PERFORMANCE: warm and sincere, with a lump in the throat at the sad moments. Patient and unhurried, " +
      "letting the most painful lines breathe before moving on.",
    tagHint: "sad, sighs, hope, long pause, short pause, adoration, relief",
  },
  {
    id: "horror",
    label: "Horror",
    emoji: "👻",
    geminiVoice: "Charon",
    elevenVoice: "brian",
    instructions:
      BASE +
      "PROFILE: a deep-voiced Bangladeshi horror narrator telling a ghost story in a village at night. " +
      "SCENE: a power cut, rain on a tin roof, listeners huddled together. " +
      "PERFORMANCE: tense and gripping, building dread slowly, dropping to a whisper before each scare and " +
      "speeding up when panic hits.",
    tagHint: "tension, whispers, slow, long pause, gasp, panic, nervousness, fast",
  },
  {
    id: "comedy",
    label: "Comedy",
    emoji: "😄",
    geminiVoice: "Puck",
    elevenVoice: "charlie",
    instructions:
      BASE +
      "PROFILE: a playful, quick-witted Bangladeshi friend telling a funny story at an adda over tea. " +
      "SCENE: a busy tea stall, friends laughing along. " +
      "PERFORMANCE: lively and cheeky, with comic timing, a small pause before each punchline, and real laughter.",
    tagHint: "amusement, laughs, excitement, short pause, fast, curiosity",
  },
  {
    id: "drama",
    label: "Family drama",
    emoji: "🎭",
    geminiVoice: "Fenrir",
    elevenVoice: "daniel",
    instructions:
      BASE +
      "PROFILE: an expressive Bangladeshi drama narrator, like a TV natok voice-over. " +
      "SCENE: a tense family confrontation in a Dhaka apartment. " +
      "PERFORMANCE: strong and expressive, rising with anger and frustration, softening for regret.",
    tagHint: "anger, frustration, sad, tension, short pause, sighs, determination",
  },
  {
    id: "narrator",
    label: "Calm narrator",
    emoji: "📖",
    geminiVoice: "Aoede",
    elevenVoice: "george",
    instructions:
      BASE +
      "PROFILE: a clear, friendly Bangladeshi audiobook narrator. " +
      "SCENE: a recording studio, speaking to one listener. " +
      "PERFORMANCE: warm, clear and steady, with natural pauses at sentence ends.",
    tagHint: "short pause, long pause, curiosity, hope",
  },
];

/** Insert `[tag] ` at the cursor, adding a space before it if needed. */
export function insertTag(text: string, cursor: number, tag: string): { text: string; cursor: number } {
  const pos = Math.max(0, Math.min(cursor, text.length));
  let before = text.slice(0, pos);
  const after = text.slice(pos);
  let lead = "";
  if (/\]\s*$/.test(before)) {
    // Right after another tag: separate with a comma (Google: no adjacent tags).
    before = before.trimEnd();
    lead = ", ";
  } else if (before.length && !/\s$/.test(before)) {
    lead = " ";
  }
  const snippet = `${lead}[${tag}] `;
  return { text: before + snippet + after.replace(/^\s+/, ""), cursor: before.length + snippet.length };
}

const TAG_RE = /\[[^\]\n]{1,40}\]/g;

/** Text with every [tag] removed and whitespace collapsed — used to prove the auto-tagger kept the words. */
export function stripTags(text: string): string {
  return text.replace(TAG_RE, " ").replace(/\s+/g, "");
}

/** Remove tags not in the allowed set and fix adjacent tags (Google: never two tags side by side). */
export function sanitizeTags(text: string, allowed: Set<string>): string {
  let out = text.replace(TAG_RE, (m) => (allowed.has(m.slice(1, -1).trim().toLowerCase()) ? m.toLowerCase() : ""));
  // Collapse "[a] [b]" → keep the first.
  out = out.replace(/(\[[^\]]+\])\s*(\[[^\]]+\])/g, "$1");
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

/** Google: never put two tags directly next to each other. Join them with a comma instead. */
export function separateAdjacentTags(text: string): string {
  return text.replace(/\]\s*\[/g, "], [");
}

export function countTags(text: string): number {
  return (text.match(TAG_RE) ?? []).length;
}

/** Gemini TTS limits text and style prompt to 4,000 bytes each. Bengali is 3 bytes per character in UTF-8. */
export const GEMINI_MAX_BYTES = 4000;
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}
