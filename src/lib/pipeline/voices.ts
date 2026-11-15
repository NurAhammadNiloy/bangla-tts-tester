/**
 * Voice casting (v2): the narrator uses the story preset's voice; each cast
 * member gets a distinct prebuilt voice by type, so dialogue sounds like
 * different people. Gemini prebuilt voice names only (verified list used by
 * src/lib/voiceDirector.ts presets); other engines fall back to the preset voice.
 */
import { presetVoice, type StylePreset, type TagFamily } from "@/lib/voiceDirector";
import type { CastMember } from "@/lib/puppet/types";

const GEMINI_BY_TYPE: Record<Exclude<CastMember["voice"], "narrator">, string[]> = {
  female: ["Kore", "Leda", "Aoede", "Despina", "Callirrhoe"],
  male: ["Charon", "Orus", "Puck", "Enceladus", "Umbriel"],
  female_old: ["Gacrux", "Vindemiatrix", "Pulcherrima"],
  male_old: ["Iapetus", "Algenib", "Rasalgethi"],
  child: ["Leda", "Zephyr", "Puck"],
};

export function castVoices(
  cast: CastMember[],
  preset: StylePreset,
  family: TagFamily,
  narratorGender: "female" | "male",
): { narrator: string | null; byCast: Record<string, string | null> } {
  const narrator = presetVoice(preset, family, narratorGender);
  const byCast: Record<string, string | null> = {};
  const used = new Set<string>(narrator ? [narrator] : []);
  for (const m of cast) {
    if (family !== "gemini" || m.voice === "narrator") {
      byCast[m.id] = m.voice === "narrator" ? narrator : presetVoice(preset, family, m.voice.startsWith("female") ? "female" : "male");
      continue;
    }
    const options = GEMINI_BY_TYPE[m.voice] ?? GEMINI_BY_TYPE.male;
    const pick = options.find((v) => !used.has(v)) ?? options[0];
    used.add(pick);
    byCast[m.id] = pick;
  }
  return { narrator, byCast };
}

export function voiceForShot(speaker: string, voices: ReturnType<typeof castVoices>): string | null {
  if (speaker === "narrator") return voices.narrator;
  return voices.byCast[speaker] ?? voices.narrator;
}


/** Small stable string hash (cache keys, not security). */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Storage key for one recorded line. Everything that changes the sound must be
 * in the key (text, voice, model, voice directions) so a changed setting can
 * never replay an old recording.
 */
export function voiceCacheKey(
  projectId: string,
  part: number,
  shot: number,
  gen: { text: string; voice: string; model: string; instructions?: string },
): string {
  const sig = [gen.model, gen.voice, gen.instructions ?? "", gen.text].join("\u0001");
  return `${projectId}/${part}/voice/${shot}/${hashText(sig)}`;
}
