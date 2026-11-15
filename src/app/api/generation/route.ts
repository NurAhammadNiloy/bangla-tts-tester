import { getGeneration } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { clientId, rateLimit } from "@/lib/rateLimit";
import { isGenerationId, KEY_HEADER, validateApiKey } from "@/lib/validation";


/** GET /api/generation?id=gen-... → billed cost and provider for one generation. */
export async function GET(req: Request) {
  if (!rateLimit(`gen:${clientId(req)}`, 60, 60_000)) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }
  const key = validateApiKey(req.headers.get(KEY_HEADER));
  if (!key.ok) return Response.json({ error: key.error }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!isGenerationId(id)) return Response.json({ error: "Invalid generation id." }, { status: 400 });

  try {
    const stats = await getGeneration(key.value, id);
    if (!stats) return Response.json({ pending: true }, { status: 202 });
    return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof OpenRouterError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Could not reach OpenRouter." }, { status: 502 });
  }
}
