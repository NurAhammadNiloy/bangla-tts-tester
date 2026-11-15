import type { RequestedFormat } from "@/lib/openrouter/types";

/** Eleven v3's per-request limit; the lowest of the Bengali-capable models. */
export const MAX_INPUT_CHARS = 5000;
export const KEY_HEADER = "x-openrouter-key";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateApiKey(raw: string | null): Result<string> {
  const key = (raw ?? "").trim();
  if (!key) return { ok: false, error: "Enter your OpenRouter API key." };
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) {
    return { ok: false, error: "That does not look like a valid OpenRouter API key." };
  }
  return { ok: true, value: key };
}

export interface TtsInput {
  model: string;
  text: string;
  voice?: string;
  format: RequestedFormat;
  instructions?: string;
  elevenLabsLanguageCode?: string;
  sampleRate: number;
}

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
const VOICE_ID = /^[\p{L}\p{N}_:.\- ]{1,120}$/u;

export function validateTtsInput(body: unknown): Result<TtsInput> {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request body." };
  const b = body as Record<string, unknown>;

  const model = typeof b.model === "string" ? b.model.trim() : "";
  if (!MODEL_ID.test(model)) return { ok: false, error: "Choose a model from the list." };

  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { ok: false, error: "Enter some Bengali text." };
  if ([...text].length > MAX_INPUT_CHARS) {
    return { ok: false, error: `Text is too long (max ${MAX_INPUT_CHARS} characters for this tester).` };
  }

  let voice: string | undefined;
  if (typeof b.voice === "string" && b.voice.trim()) {
    voice = b.voice.trim();
    if (!VOICE_ID.test(voice)) return { ok: false, error: "Voice name contains unsupported characters." };
  }

  const format: RequestedFormat = b.format === "mp3" || b.format === "pcm" ? b.format : "auto";

  let instructions: string | undefined;
  if (typeof b.instructions === "string" && b.instructions.trim()) {
    instructions = b.instructions.trim().slice(0, 1000);
  }

  let elevenLabsLanguageCode: string | undefined;
  if (typeof b.elevenLabsLanguageCode === "string" && b.elevenLabsLanguageCode.trim()) {
    const code = b.elevenLabsLanguageCode.trim().toLowerCase();
    if (!/^[a-z]{2,3}$/.test(code)) return { ok: false, error: "Language code must be like 'bn'." };
    elevenLabsLanguageCode = code;
  }

  const sr = Number(b.sampleRate ?? 24000);
  const sampleRate = [16000, 22050, 24000, 44100, 48000].includes(sr) ? sr : 24000;

  return { ok: true, value: { model, text, voice, format, instructions, elevenLabsLanguageCode, sampleRate } };
}

export function isGenerationId(id: string | null): id is string {
  return !!id && /^[A-Za-z0-9_-]{4,200}$/.test(id);
}
