import { errorResponse, guard } from "@/lib/apiGuard";
import { BRAND_SCHEMA, buildBrandPrompt, cleanBrandName, MAX_BRAND_HINT, sanitizeSvg } from "@/lib/brand";
import { chatComplete, listTextModels } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { parseJsonLoose, pickPlannerModel } from "@/lib/storyPlan";

export const maxDuration = 120;

let plannerCache: { at: number; model: string | null } | null = null;

async function plannerModel(): Promise<string | null> {
  if (!plannerCache || Date.now() - plannerCache.at > 30 * 60_000) {
    plannerCache = { at: Date.now(), model: pickPlannerModel(await listTextModels()) };
  }
  return plannerCache.model;
}

async function askJson(apiKey: string, model: string, user: string) {
  const base = { apiKey, model, system: buildBrandPrompt(), user, temperature: 0.9, maxTokens: 4000 };
  try {
    const r = await chatComplete(
      {
        ...base,
        responseFormat: { type: "json_schema", json_schema: { name: "page_brand", strict: true, schema: BRAND_SCHEMA } },
        plugins: [{ id: "response-healing" }],
      },
      { timeoutMs: 90_000 },
    );
    return parseJsonLoose(r.content);
  } catch (err) {
    if (!(err instanceof OpenRouterError) || err.status !== 400) throw err;
    const r = await chatComplete({ ...base, responseFormat: { type: "json_object" } }, { timeoutMs: 90_000 });
    return parseJsonLoose(r.content);
  }
}

/**
 * POST /api/brand { hint?: string } → { name, logoSvg, model }
 * Suggests a page name and a simple flat SVG logo in the house palette.
 * The SVG is rebuilt by a strict whitelist sanitiser before it leaves the server.
 */
export async function POST(req: Request) {
  const g = guard(req, "brand", 8);
  if ("response" in g) return g.response;
  let b: Record<string, unknown> = {};
  try {
    const text = await req.text();
    b = text ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!b || typeof b !== "object") b = {};
  const hint = typeof b.hint === "string" ? b.hint.replace(/\s+/g, " ").trim().slice(0, MAX_BRAND_HINT) : "";

  try {
    const model = await plannerModel();
    if (!model) return Response.json({ error: "No suitable model found on OpenRouter right now." }, { status: 503 });
    const user = hint ? `Hint from the page owner: ${hint}` : "No hint. Surprise me with something fitting for Bangla story videos.";
    // One retry: models sometimes add text or gradients the sanitiser rejects.
    for (let attempt = 0; attempt < 2; attempt++) {
      const obj = await askJson(g.key, model, user);
      const name = cleanBrandName(obj.name);
      const logoSvg = sanitizeSvg(obj.logoSvg);
      if (name && logoSvg) return Response.json({ name, logoSvg, model });
    }
    return Response.json({ error: "The AI's logo did not pass the safety check. Try again." }, { status: 502 });
  } catch (err) {
    if (err instanceof Error && !(err instanceof OpenRouterError) && /JSON/.test(err.message)) {
      return Response.json({ error: "The AI's answer was not readable. Try again." }, { status: 502 });
    }
    return errorResponse(err);
  }
}
