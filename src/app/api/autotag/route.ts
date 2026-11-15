import { buildAutotagPrompt, verifyAutotag } from "@/lib/autotag";
import { chatComplete, listTextModels, pickHelperModel } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { clientId, rateLimit } from "@/lib/rateLimit";
import { KEY_HEADER, MAX_INPUT_CHARS, validateApiKey } from "@/lib/validation";
import { STYLE_PRESETS, tagFamilyFor } from "@/lib/voiceDirector";

export const maxDuration = 120;

let helperCache: { at: number; model: string | null } | null = null;

/**
 * POST /api/autotag  { text, ttsModel, presetId? }
 * Uses a cheap text model on the user's own OpenRouter key to insert audio tags.
 * The result is verified to contain exactly the same Bengali text.
 */
export async function POST(req: Request) {
  if (!rateLimit(`tag:${clientId(req)}`, 10, 60_000)) {
    return Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  }
  const key = validateApiKey(req.headers.get(KEY_HEADER));
  if (!key.ok) return Response.json({ error: key.error }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const ttsModel = typeof body.ttsModel === "string" ? body.ttsModel : "";
  if (!text) return Response.json({ error: "Enter some Bengali text first." }, { status: 400 });
  if ([...text].length > MAX_INPUT_CHARS) return Response.json({ error: "Text is too long." }, { status: 400 });

  const family = tagFamilyFor(ttsModel);
  if (family === "none") {
    return Response.json({ error: "Auto-tagging works with Gemini TTS and ElevenLabs v3/v4 models only." }, { status: 400 });
  }
  const preset = STYLE_PRESETS.find((p) => p.id === body.presetId) ?? STYLE_PRESETS[0];

  try {
    if (!helperCache || Date.now() - helperCache.at > 30 * 60_000) {
      helperCache = { at: Date.now(), model: pickHelperModel(await listTextModels()) };
    }
    if (!helperCache.model) {
      return Response.json({ error: "No suitable helper model found on OpenRouter right now." }, { status: 503 });
    }

    const { content } = await chatComplete({
      apiKey: key.value,
      model: helperCache.model,
      system: buildAutotagPrompt(family, preset.tagHint),
      user: text,
    });
    const check = verifyAutotag(text, content, family);
    if (!check.ok) return Response.json({ error: check.error, helperModel: helperCache.model }, { status: 422 });
    return Response.json({ text: check.text, tags: check.tags, helperModel: helperCache.model });
  } catch (err) {
    if (err instanceof OpenRouterError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: "Could not reach OpenRouter." }, { status: 502 });
  }
}
