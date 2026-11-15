import { errorResponse, guard } from "@/lib/apiGuard";
import { askJson, cachedFastPlannerModel, cachedPlannerModel, JsonReplyError } from "@/lib/openrouter/askJson";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { GENRES, MAX_STORY_CHARS, type Genre } from "@/lib/storyPlan";
import {
  applySemantic,
  BIBLE_SCHEMA,
  buildBiblePrompt,
  buildVerifyPrompt,
  claimsToVerify,
  normalizeBible,
  runAccuracyGate,
  summarize,
  VERIFY_SCHEMA,
} from "@/lib/storyBible";
import { numberedStory } from "@/lib/storyEvidence";

export const maxDuration = 300;

/**
 * POST /api/bible
 *  { text, genre, partsTotal, userRules? }
 *  → { bible: StoryBible, report: GateReport, model, verifyModel?, notes }
 * 1. The strong planner reads the whole story (as numbered sentences) once and cites sentence ids.
 * 2. Plain code checks every claim against the original text (exact quote, near quote, numbers,
 *    negation) and resolves cited ids to real story spans (the Story Accuracy Gate).
 * 3. A second, cheaper model cross-checks the claims code could not prove word by word. It may only
 *    answer with sentence ids; code turns them into evidence and re-checks the numbers.
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
      user: `STORY (Bangla), as numbered sentences:\n${numberedStory(text)}`,
      name: "story_bible",
      schema: BIBLE_SCHEMA,
      maxTokens: 32_000,
      timeoutMs: 280_000,
    });
    if (r.finishReason === "length") return Response.json({ error: "The AI's answer was cut off. Try again." }, { status: 422 });
    const raw = normalizeBible(r.data);
    if (!raw.characters.length && !raw.events.length) return Response.json({ error: "The AI could not read this story. Try again." }, { status: 422 });
    let { bible } = runAccuracyGate(raw, text);
    const notes: string[] = [];
    if (r.mode === "json_object") notes.push("The model did not accept the strict schema; used plain JSON mode.");
    const todo = claimsToVerify(bible);
    let verifyModel: string | undefined;
    if (todo.length && b.verify !== false) {
      try {
        verifyModel = (await cachedFastPlannerModel().catch(() => null)) ?? model;
        const v = await askJson({
          apiKey: g.key,
          model: verifyModel,
          system: buildVerifyPrompt(),
          user: `STORY:\n${numberedStory(text)}\n\nCLAIMS:\n${todo.map((c) => `${c.ref}: [${c.label}] ${c.text}`).join("\n")}`,
          name: "claim_check",
          schema: VERIFY_SCHEMA,
          maxTokens: 16_000,
          timeoutMs: 120_000,
        });
        if (v.finishReason !== "length") bible = applySemantic(bible, text, v.data);
        else notes.push("The cross-check answer was cut off; those claims keep the code check only.");
      } catch (err) {
        if (err instanceof OpenRouterError && err.status === 401) throw err;
        notes.push("The cross-check could not run; claims keep the code check only.");
      }
    }
    const report = summarize(bible);
    report.notes.push(...notes);
    return Response.json({ bible, report, model, ...(verifyModel ? { verifyModel } : {}) });
  } catch (err) {
    if (err instanceof JsonReplyError) return Response.json({ error: err.message }, { status: 422 });
    if (err instanceof Error && !(err instanceof OpenRouterError) && /JSON/.test(err.message)) return Response.json({ error: err.message }, { status: 422 });
    return errorResponse(err);
  }
}
