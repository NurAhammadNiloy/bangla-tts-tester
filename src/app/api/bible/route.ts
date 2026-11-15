import { errorResponse, guard } from "@/lib/apiGuard";
import { askJson, cachedPlannerModel, JsonReplyError } from "@/lib/openrouter/askJson";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { GENRES, MAX_STORY_CHARS, type Genre } from "@/lib/storyPlan";
import { BIBLE_SCHEMA, buildBiblePrompt, normalizeBible, runAccuracyGate } from "@/lib/storyBible";

export const maxDuration = 300;

/**
 * POST /api/bible
 *  { text, genre, partsTotal, userRules? }
 *  → { bible: StoryBible, report: GateReport, model }
 * The strong planner reads the whole story once; then plain code checks every quoted fact,
 * key line, number and character against the original text (the Story Accuracy Gate).
 */
export async function POST(req: Request) {
  const g = guard(req, "bible", 12);
  if ("response" in g) return g.response;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  const text = typeof b.text === "string" ? b.text.trim().slice(0, MAX_STORY_CHARS) : "";
  if (!text) return Response.json({ error: "The story is empty." }, { status: 400 });
  const genre = (Object.keys(GENRES).includes(b.genre as string) ? b.genre : "emotional") as Genre;
  const partsTotal = Math.max(1, Math.min(100, Math.floor(Number(b.partsTotal) || 1)));
  const userRules = typeof b.userRules === "string" ? b.userRules.trim().slice(0, 2000) : "";

  try {
    const model = await cachedPlannerModel();
    if (!model) return Response.json({ error: "No suitable planning model found on OpenRouter right now." }, { status: 503 });
    const r = await askJson({
      apiKey: g.key,
      model,
      system: buildBiblePrompt({ genre, partsTotal, userRules }),
      user: `STORY (Bangla):\n${text}`,
      name: "story_bible",
      schema: BIBLE_SCHEMA,
      maxTokens: 32_000,
      timeoutMs: 280_000,
    });
    if (r.finishReason === "length") return Response.json({ error: "The AI's answer was cut off. Try again." }, { status: 422 });
    const raw = normalizeBible(r.data);
    if (!raw.characters.length && !raw.events.length) return Response.json({ error: "The AI could not read this story. Try again." }, { status: 422 });
    const { bible, report } = runAccuracyGate(raw, text);
    if (r.mode === "json_object") report.notes.push("The model did not accept the strict schema; used plain JSON mode.");
    return Response.json({ bible, report, model });
  } catch (err) {
    if (err instanceof JsonReplyError) return Response.json({ error: err.message }, { status: 422 });
    if (err instanceof Error && !(err instanceof OpenRouterError) && /JSON/.test(err.message)) return Response.json({ error: err.message }, { status: 422 });
    return errorResponse(err);
  }
}
