import { isBengaliDocumented } from "@/lib/bengali";
import { separateAdjacentTags, tagFamilyFor } from "@/lib/voiceDirector";
import { errorFromResponse, OpenRouterError } from "./errors";
import type {
  GenerationStats,
  RequestedFormat,
  SpeechModel,
  SpeechRequest,
  SpeechResult,
  UpstreamAudioFormat,
} from "./types";

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/** Server-side only. Lets tests point at a mock; users cannot change it. */
export function baseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

const APP_HEADERS = {
  // Optional OpenRouter attribution headers (shown in the user's activity log).
  "X-Title": "Bangla TTS Tester",
};

type FetchLike = typeof fetch;

export interface ClientOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/* ----------------------------- Models ----------------------------- */

interface RawModel {
  id: string;
  name?: string;
  description?: string;
  pricing?: Record<string, unknown>;
  supported_voices?: unknown;
}

/** `supported_voices` is not fully specified in the docs; accept strings or objects. */
export function normalizeVoices(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const id = o.id ?? o.voice_id ?? o.name ?? o.voice;
      if (typeof id === "string") out.push(id);
    }
  }
  return [...new Set(out)];
}

export function normalizePricing(raw: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : null;
    if (s !== null && Number(s) !== 0 && !Number.isNaN(Number(s))) out[k] = s;
  }
  return out;
}

export function normalizeModel(m: RawModel): SpeechModel {
  return {
    id: m.id,
    name: m.name ?? m.id,
    description: (m.description ?? "").slice(0, 400),
    voices: normalizeVoices(m.supported_voices),
    pricing: normalizePricing(m.pricing),
    bengaliDocumented: isBengaliDocumented(m.id),
  };
}

/** Public endpoint, no key needed. */
export async function listSpeechModels(opts: ClientOptions = {}): Promise<SpeechModel[]> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${baseUrl()}/models?output_modalities=speech`, {
    headers: { Accept: "application/json", ...APP_HEADERS },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw await errorFromResponse(res);
  const json = (await res.json()) as { data?: RawModel[] };
  const models = (json.data ?? []).filter((m) => typeof m?.id === "string").map(normalizeModel);
  // Bengali-documented first, then alphabetical.
  return models.sort(
    (a, b) => Number(b.bengaliDocumented) - Number(a.bengaliDocumented) || a.id.localeCompare(b.id),
  );
}

/* ----------------------------- Speech ----------------------------- */

export interface SynthesizeParams {
  apiKey: string;
  model: string;
  input: string;
  voice?: string;
  format: RequestedFormat;
  instructions?: string;
  elevenLabsLanguageCode?: string;
}

function buildBody(p: SynthesizeParams, format: UpstreamAudioFormat): SpeechRequest {
  const input = tagFamilyFor(p.model) === "gemini" ? separateAdjacentTags(p.input) : p.input;
  const body: SpeechRequest = { model: p.model, input, response_format: format };
  if (p.voice) body.voice = p.voice;
  if (p.instructions) body.instructions = p.instructions;
  if (p.elevenLabsLanguageCode && p.model.startsWith("elevenlabs/")) {
    // `language_code` is an accepted key under provider.options.elevenlabs.
    body.provider = { options: { elevenlabs: { language_code: p.elevenLabsLanguageCode } } };
  }
  return body;
}

function formatFromContentType(ct: string, requested: UpstreamAudioFormat): UpstreamAudioFormat {
  if (/mpeg|mp3/i.test(ct)) return "mp3";
  if (/pcm|l16|raw/i.test(ct)) return "pcm";
  return requested;
}

async function speechOnce(
  p: SynthesizeParams,
  format: UpstreamAudioFormat,
  opts: ClientOptions,
): Promise<Omit<SpeechResult, "fellBackToPcm" | "elapsedMs">> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${baseUrl()}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.apiKey}`,
      "Content-Type": "application/json",
      ...APP_HEADERS,
    },
    body: JSON.stringify(buildBody(p, format)),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  if (!res.ok) throw await errorFromResponse(res, p.apiKey);

  const contentType = res.headers.get("content-type") ?? "";
  if (/json/i.test(contentType)) {
    // A 200 with JSON means no audio came back; surface it instead of saving JSON as "audio".
    throw await errorFromResponse(new Response(await res.text(), { status: 502 }), p.apiKey);
  }
  const audio = new Uint8Array(await res.arrayBuffer());
  if (audio.byteLength === 0) throw new OpenRouterError(502, "The provider returned empty audio.");

  return {
    audio,
    contentType,
    format: formatFromContentType(contentType, format),
    generationId: res.headers.get("x-generation-id"),
  };
}

/**
 * Generate speech. In `auto` mode we ask for mp3 first (small, playable) and,
 * if the provider rejects it with a 400 (Gemini TTS / HeyGen are documented as
 * pcm-only), retry once with pcm. If the retry also fails, the original error
 * is reported because it is usually the more informative one.
 */
export async function synthesize(p: SynthesizeParams, opts: ClientOptions = {}): Promise<SpeechResult> {
  const started = performance.now();
  // Gemini TTS is documented as pcm-only, so skip the doomed mp3 attempt in auto mode.
  const pcmOnly = /^google\/gemini-/.test(p.model);
  const first: UpstreamAudioFormat = p.format === "pcm" || (p.format === "auto" && pcmOnly) ? "pcm" : "mp3";
  try {
    const r = await speechOnce(p, first, opts);
    return { ...r, elapsedMs: Math.round(performance.now() - started), fellBackToPcm: false };
  } catch (err) {
    const canFallBack = p.format === "auto" && err instanceof OpenRouterError && err.status === 400;
    if (!canFallBack) throw err;
    try {
      const r = await speechOnce(p, "pcm", opts);
      return { ...r, elapsedMs: Math.round(performance.now() - started), fellBackToPcm: true };
    } catch {
      throw err;
    }
  }
}

/* --------------------------- Generation --------------------------- */

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Look up billed cost. Stats can lag a few seconds after generation; returns null on 404. */
export async function getGeneration(
  apiKey: string,
  id: string,
  opts: ClientOptions = {},
): Promise<GenerationStats | null> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${baseUrl()}/generation?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFromResponse(res, apiKey);
  const json = (await res.json()) as { data?: Record<string, unknown> };
  const d = json.data ?? {};
  return {
    id,
    model: typeof d.model === "string" ? d.model : null,
    providerName: typeof d.provider_name === "string" ? d.provider_name : null,
    totalCostUsd: num(d.total_cost),
    latencyMs: num(d.latency),
    generationTimeMs: num(d.generation_time),
  };
}

/* ---------------------------- Chat (LLM) --------------------------- */

interface RawTextModel {
  id: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: Record<string, unknown>;
}

/**
 * Pick a cheap, fast text model for small helper jobs (auto-tagging), from the
 * LIVE model list so no model ID is hard-coded. Preference order by pattern.
 */
export const HELPER_MODEL_PREFERENCES: RegExp[] = [
  /^google\/gemini-[\d.]+-flash-lite(-preview)?$/,
  /^google\/gemini-[\d.]+-flash(-preview)?$/,
  /^openai\/gpt-[\d.]+-mini$/,
];

export function pickHelperModel(models: RawTextModel[]): string | null {
  const textOnly = models.filter((m) => {
    const out = m.architecture?.output_modalities ?? ["text"];
    return out.length === 1 && out[0] === "text" && !/tts|image|audio|embed/i.test(m.id);
  });
  for (const re of HELPER_MODEL_PREFERENCES) {
    const hits = textOnly.filter((m) => re.test(m.id)).map((m) => m.id).sort().reverse(); // newest version first
    if (hits.length) return hits[0];
  }
  return null;
}

export async function listTextModels(opts: ClientOptions = {}): Promise<RawTextModel[]> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${baseUrl()}/models`, {
    headers: { Accept: "application/json", ...APP_HEADERS },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw await errorFromResponse(res);
  const json = (await res.json()) as { data?: RawTextModel[] };
  return (json.data ?? []).filter((m) => typeof m?.id === "string");
}

export async function chatComplete(
  p: { apiKey: string; model: string; system: string; user: string; temperature?: number; maxTokens?: number },
  opts: ClientOptions = {},
): Promise<{ content: string; generationId: string | null }> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json", ...APP_HEADERS },
    body: JSON.stringify({
      model: p.model,
      temperature: p.temperature ?? 0.2,
      max_tokens: p.maxTokens ?? 4000,
      messages: [
        { role: "system", content: p.system },
        { role: "user", content: p.user },
      ],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });
  if (!res.ok) throw await errorFromResponse(res, p.apiKey);
  const json = (await res.json()) as { id?: string; choices?: { message?: { content?: unknown } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new OpenRouterError(502, "The helper model returned no text.");
  }
  return { content, generationId: json.id ?? null };
}
