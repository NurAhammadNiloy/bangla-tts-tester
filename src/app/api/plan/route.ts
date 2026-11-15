import { errorResponse, guard } from "@/lib/apiGuard";
import { chatComplete, listTextModels } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";
import {
  buildOutlinePrompt,
  buildScenesPrompt,
  estimateSeconds,
  GENRES,
  MAX_STORY_CHARS,
  normalizeOutline,
  normalizeScenes,
  OUTLINE_SCHEMA,
  parseJsonLoose,
  pickPlannerModel,
  SCENES_SCHEMA,
  splitSentences,
  type Genre,
} from "@/lib/storyPlan";

export const maxDuration = 300;

let plannerCache: { at: number; model: string | null } | null = null;

async function plannerModel(): Promise<string | null> {
  if (!plannerCache || Date.now() - plannerCache.at > 30 * 60_000) {
    plannerCache = { at: Date.now(), model: pickPlannerModel(await listTextModels()) };
  }
  return plannerCache.model;
}

/** Ask for strict JSON; if the endpoint rejects the schema, retry once in plain JSON mode. */
async function askJson(apiKey: string, model: string, system: string, user: string, name: string, schema: object) {
  const base = { apiKey, model, system, user, temperature: 0.3, maxTokens: 16000 };
  try {
    const r = await chatComplete(
      { ...base, responseFormat: { type: "json_schema", json_schema: { name, strict: true, schema } }, plugins: [{ id: "response-healing" }] },
      { timeoutMs: 240_000 },
    );
    return parseJsonLoose(r.content);
  } catch (err) {
    if (!(err instanceof OpenRouterError) || err.status !== 400) throw err;
    const r = await chatComplete({ ...base, responseFormat: { type: "json_object" } }, { timeoutMs: 240_000 });
    return parseJsonLoose(r.content);
  }
}

/**
 * POST /api/plan
 *  { mode: "outline", story, partMinutes? }  → { plan, model }   (parts with hooks, no scenes yet)
 *  { mode: "scenes", text, genre, characters, setting, partTitle, hook, isLast } → { scenes, model }
 */
export async function POST(req: Request) {
  const g = guard(req, "plan", 12);
  if ("response" in g) return g.response;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  try {
    const model = await plannerModel();
    if (!model) return Response.json({ error: "No suitable planning model found on OpenRouter right now." }, { status: 503 });

    if (b.mode === "scenes") {
      const text = s(b.text, MAX_STORY_CHARS);
      if (!text) return Response.json({ error: "This part has no text." }, { status: 400 });
      const genre = (Object.keys(GENRES).includes(b.genre as string) ? b.genre : "emotional") as Genre;
      const obj = await askJson(
        g.key,
        model,
        buildScenesPrompt({
          genre,
          characters: s(b.characters, 2000),
          setting: s(b.setting, 400),
          partTitle: s(b.partTitle, 80),
          hook: s(b.hook, 200),
          isLast: b.isLast === true,
        }),
        text,
        "part_scenes",
        SCENES_SCHEMA,
      );
      return Response.json({ scenes: normalizeScenes(obj), model });
    }

    const story = s(b.story, MAX_STORY_CHARS + 1);
    if ([...story].length < 40) return Response.json({ error: "Paste a story of at least a few sentences." }, { status: 400 });
    if ([...story].length > MAX_STORY_CHARS) {
      return Response.json({ error: `Story is too long for one plan (max ${MAX_STORY_CHARS.toLocaleString()} letters).` }, { status: 400 });
    }
    const sentences = splitSentences(story);
    const total = sentences.reduce((a, x) => a + estimateSeconds(x), 0);
    const pm = Number(b.partMinutes);
    const numbered = sentences.map((x, i) => `${i + 1}. ${x}`).join("\n");
    const obj = await askJson(
      g.key,
      model,
      buildOutlinePrompt(total, [1, 2, 3, 4, 5, 6].includes(pm) ? pm : null),
      numbered,
      "story_outline",
      OUTLINE_SCHEMA,
    );
    return Response.json({ plan: normalizeOutline(obj, sentences), model });
  } catch (err) {
    if (err instanceof Error && !(err instanceof OpenRouterError) && /plan|JSON|scenes|sentences/.test(err.message)) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    return errorResponse(err);
  }
}
