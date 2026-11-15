import { pcm16ToWav } from "@/lib/audio/wav";
import { synthesize } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { clientId, rateLimit } from "@/lib/rateLimit";
import { KEY_HEADER, validateApiKey, validateTtsInput } from "@/lib/validation";

export const maxDuration = 120;

/**
 * POST /api/tts
 * Header: x-openrouter-key (user's own key; used for this request only, never stored or logged)
 * Body:   { model, text, voice?, format?, instructions?, elevenLabsLanguageCode?, sampleRate? }
 * Returns raw audio (audio/mpeg or audio/wav) plus metric headers.
 */
export async function POST(req: Request) {
  if (!rateLimit(`tts:${clientId(req)}`, 60, 60_000)) {
    return Response.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
  }

  const key = validateApiKey(req.headers.get(KEY_HEADER));
  if (!key.ok) return Response.json({ error: key.error }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const input = validateTtsInput(body);
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
  const v = input.value;

  try {
    const result = await synthesize({
      apiKey: key.value,
      model: v.model,
      input: v.text,
      voice: v.voice,
      format: v.format,
      instructions: v.instructions,
      elevenLabsLanguageCode: v.elevenLabsLanguageCode,
    });

    const isPcm = result.format === "pcm";
    const bytes = isPcm ? pcm16ToWav(result.audio, v.sampleRate) : result.audio;

    const headers = new Headers({
      "Content-Type": isPcm ? "audio/wav" : "audio/mpeg",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Audio-Format": isPcm ? "wav" : "mp3",
      "X-Upstream-Format": result.format,
      "X-Upstream-Content-Type": result.contentType || "unknown",
      "X-Elapsed-Ms": String(result.elapsedMs),
      "X-Fell-Back-To-Pcm": String(result.fellBackToPcm),
    });
    if (result.generationId) headers.set("X-Generation-Id", result.generationId);

    return new Response(bytes as BodyInit, { status: 200, headers });
  } catch (err) {
    if (err instanceof OpenRouterError) {
      return Response.json({ error: err.message, upstreamStatus: err.status }, { status: err.status });
    }
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return Response.json(
      { error: timedOut ? "OpenRouter took too long to respond (120 s)." : "Could not reach OpenRouter." },
      { status: timedOut ? 504 : 502 },
    );
  }
}
