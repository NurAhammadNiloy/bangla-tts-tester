import { errorResponse, guard } from "@/lib/apiGuard";
import {
  ASSET_KINDS,
  ASSET_SCHEMAS,
  buildAssetPrompt,
  buildAssetUserMessage,
  normalizeAsset,
  type AssetKind,
} from "@/lib/assetMaker";
import { slugId } from "@/lib/episodePlan";
import { askJson, cachedPlannerModel, JsonReplyError } from "@/lib/openrouter/askJson";

export const maxDuration = 300;

/**
 * POST /api/asset { kind: "character"|"place"|"prop", id, look }
 *  → { asset: CharacterAsset|PlaceAsset|PropAsset, model, warnings: string[] }
 * If the first answer has major problems (missing parts, empty layers, mostly bad paths),
 * the model is asked once more with those problems listed; the better answer wins.
 */
export async function POST(req: Request) {
  const g = guard(req, "asset", 20);
  if ("response" in g) return g.response;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  const kind = b.kind as AssetKind;
  if (!ASSET_KINDS.includes(kind)) return Response.json({ error: "kind must be character, place or prop." }, { status: 400 });
  const id = slugId(b.id);
  if (!id) return Response.json({ error: "Give the asset an id (letters, digits, _)." }, { status: 400 });
  const look = typeof b.look === "string" ? b.look.replace(/\s+/g, " ").trim().slice(0, 800) : "";
  if (look.length < 3) return Response.json({ error: "Describe how the asset should look." }, { status: 400 });

  try {
    const model = await cachedPlannerModel();
    if (!model) return Response.json({ error: "No suitable planning model found on OpenRouter right now." }, { status: 503 });
    const system = buildAssetPrompt(kind, { id, look });
    const ask = (problems?: string[]) =>
      askJson({
        apiKey: g.key,
        model,
        system,
        user: buildAssetUserMessage(kind, id, look, problems),
        name: `${kind}_asset`,
        schema: ASSET_SCHEMAS[kind],
        temperature: 0.4,
        maxTokens: 12000,
      });

    let first;
    try {
      first = normalizeAsset(kind, (await ask()).data, id);
    } catch (err) {
      if (!(err instanceof JsonReplyError)) throw err;
      first = null;
    }
    let best = first;
    let retried = false;
    if (!first || first.major.length) {
      retried = true;
      try {
        const second = normalizeAsset(kind, (await ask(first ? [...first.major, ...first.warnings].slice(0, 12) : ["The answer was not valid JSON."])).data, id);
        if (!best || second.major.length < best.major.length) best = second;
      } catch (err) {
        if (!(err instanceof JsonReplyError) || !best) throw err;
      }
    }
    const warnings = [...(retried ? ["Asked the model twice: the first answer had problems."] : []), ...best!.major, ...best!.warnings];
    return Response.json({ asset: best!.asset, model, warnings });
  } catch (err) {
    if (err instanceof JsonReplyError) return Response.json({ error: err.message }, { status: 422 });
    return errorResponse(err);
  }
}
