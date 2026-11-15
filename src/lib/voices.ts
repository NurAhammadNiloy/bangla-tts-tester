/**
 * Voice gender and character labels.
 *
 * Gemini: genders from Google Cloud's Gemini-TTS "Voice options" table,
 * character words from Google's prebuilt-voice descriptions.
 * ElevenLabs: the 21 premade voices OpenRouter exposes.
 * Voices not listed here show as "Other".
 */
export type Gender = "female" | "male";

export interface VoiceInfo {
  gender: Gender | null;
  style?: string;
}

const GEMINI: Record<string, [Gender, string]> = {
  zephyr: ["female", "Bright"], puck: ["male", "Upbeat"], charon: ["male", "Informative"],
  kore: ["female", "Firm"], fenrir: ["male", "Excitable"], leda: ["female", "Youthful"],
  orus: ["male", "Firm"], aoede: ["female", "Breezy"], callirrhoe: ["female", "Easy-going"],
  autonoe: ["female", "Bright"], enceladus: ["male", "Breathy"], iapetus: ["male", "Clear"],
  umbriel: ["male", "Easy-going"], algieba: ["male", "Smooth"], despina: ["female", "Smooth"],
  erinome: ["female", "Clear"], algenib: ["male", "Gravelly"], rasalgethi: ["male", "Informative"],
  laomedeia: ["female", "Upbeat"], achernar: ["female", "Soft"], alnilam: ["male", "Firm"],
  schedar: ["male", "Even"], gacrux: ["female", "Mature"], pulcherrima: ["female", "Forward"],
  achird: ["male", "Friendly"], zubenelgenubi: ["male", "Casual"], vindemiatrix: ["female", "Gentle"],
  sadachbia: ["male", "Lively"], sadaltager: ["male", "Knowledgeable"], sulafat: ["female", "Warm"],
};

const ELEVEN: Record<string, Gender | null> = {
  george: "male", sarah: "female", adam: "male", alice: "female", bella: "female", bill: "male",
  brian: "male", callum: "male", charlie: "male", chris: "male", daniel: "male", eric: "male",
  harry: "male", jessica: "female", laura: "female", liam: "male", lily: "female", matilda: "female",
  river: null, roger: "male", will: "male",
};

export function voiceInfo(modelId: string, voice: string): VoiceInfo {
  const v = voice.toLowerCase();
  if (/^google\/gemini-/.test(modelId) && GEMINI[v]) return { gender: GEMINI[v][0], style: GEMINI[v][1] };
  if (/^elevenlabs\//.test(modelId) && v in ELEVEN) return { gender: ELEVEN[v] };
  return { gender: null };
}

export function voiceLabel(modelId: string, voice: string): string {
  const info = voiceInfo(modelId, voice);
  const g = info.gender === "female" ? "♀" : info.gender === "male" ? "♂" : "";
  return [g, voice, info.style ? `· ${info.style}` : ""].filter(Boolean).join(" ");
}

export function groupVoices(modelId: string, voices: string[]): { female: string[]; male: string[]; other: string[] } {
  const out = { female: [] as string[], male: [] as string[], other: [] as string[] };
  for (const v of voices) {
    const g = voiceInfo(modelId, v).gender;
    (g ? out[g] : out.other).push(v);
  }
  return out;
}
