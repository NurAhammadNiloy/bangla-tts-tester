import { errorResponse, guard } from "@/lib/apiGuard";
import {
  buildEpisodePrompt,
  EPISODE_SCHEMA,
  normalizeEpisode,
  parsePreviousCast,
  parsePreviousPlaces,
  type EpisodeContext,
} from "@/lib/episodePlan";
import { askJson, cachedFastPlannerModel, cachedPlannerModel, JsonReplyError } from "@/lib/openrouter/askJson";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { GENRES, MAX_STORY_CHARS, type Genre } from "@/lib/storyPlan";
import type { EpisodePlan } from "@/lib/puppet/types";
import { blockedReasons, normalizeBible, rawApprovedSections, recheck, SECTIONS, type StoryBible } from "@/lib/storyBible";
import { inStory, storyHash } from "@/lib/storyEvidence";
import { reportLine, validatePlan } from "@/lib/storyValidator";

export const maxDuration = 300;

/**
 * POST /api/episode
 *  { text, genre, partTitle, partIndex (0-based), partsTotal, hook, isLast, characters, setting,
 *    librarySummary, previousCast?, previousPlaces?, narrator, series?, bible?, fast? }
 *  `story` = the whole story; `bible` = the approved Story Bible (required, see below).
 *  Errors: { error, code, details? } with code one of bible_required, story_required,
 *  bible_story_mismatch, part_not_in_story, bible_not_approved, bible_blocked.
 *  What the server can and cannot guarantee: the Bible and its approvals live in the browser, so
 *  the client could write any of it. The server therefore (1) requires one, (2) ties it to the
 *  story it was sent with (hash) and checks the part really is part of that story, (3) checks the
 *  approval hashes against the content as sent, (4) recomputes every claim's check from the
 *  story instead of trusting the checks the browser sent, and (5) validates the plan it gets
 *  back. That stops mistakes and stale or inconsistent state; it is NOT tamper-proof: a client
 *  that fabricates a complete, self-consistent Bible with its own approvals passes. Real
 *  integrity would need server-held, signed approval records (accounts or a signing secret).
 *  `fast` = true: plan with a cheaper model first, fall back to the strong model if its answer is unusable.
 *  → { plan: EpisodePlan, model, warnings: string[], report: ValidationReport, blocked: boolean }
 *  `blocked` = the plan breaks a hard story rule; the app must not go to paid steps with it.
 *  Development/test only: GOLPO_ALLOW_UNBOUND_PLAN=1 (ignored when NODE_ENV is "production") lets a
 *  request without a bible through, for tests of the planner itself.
 */
const problem = (status: number, code: string, error: string, details?: unknown) => Response.json({ error, code, ...(details ? { details } : {}) }, { status });
const unboundAllowed = () => process.env.GOLPO_ALLOW_UNBOUND_PLAN === "1" && process.env.NODE_ENV !== "production";

export async function POST(req: Request) {
  const g = guard(req, "episode", 12);
  if ("response" in g) return g.response;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const text = s(b.text, MAX_STORY_CHARS);
  if (!text) return Response.json({ error: "This part has no text." }, { status: 400 });
  const genre = (Object.keys(GENRES).includes(b.genre as string) ? b.genre : "emotional") as Genre;
  const partIndex = Math.max(0, Math.min(99, Math.floor(Number(b.partIndex) || 0)));
  const partsTotal = Math.max(partIndex + 1, Math.min(100, Math.floor(Number(b.partsTotal) || partIndex + 1)));
  const ctx: EpisodeContext = {
    genre,
    partTitle: s(b.partTitle, 80),
    partIndex,
    partsTotal,
    hook: s(b.hook, 200),
    isLast: typeof b.isLast === "boolean" ? b.isLast : partIndex + 1 >= partsTotal,
    characters: s(b.characters, 2000),
    setting: s(b.setting, 400),
    librarySummary: s(b.librarySummary, 60_000),
    previousCast: parsePreviousCast(b.previousCast),
    previousPlaces: parsePreviousPlaces(b.previousPlaces, genre),
    narrator: b.narrator === "male" ? "male" : "female",
    series: s(b.series, 60) || undefined,
    bible: b.bible && typeof b.bible === "object" ? normalizeBible(b.bible) : undefined,
  };
  const fast = b.fast === true;
  // Never plan shots (the step before paid pictures) from a bible that is not approved, or that
  // does not belong to this story, or that the story contradicts.
  let checked: StoryBible | undefined;
  if (!ctx.bible) {
    if (!unboundAllowed()) return problem(409, "bible_required", "Make and approve the Director's review before planning the shots.");
  } else {
    const story = s(b.story, MAX_STORY_CHARS * 20);
    if (!story) return problem(400, "story_required", "The whole story must be sent together with the Story Bible.");
    if (!ctx.bible.storyHash || ctx.bible.storyHash !== storyHash(story))
      return problem(409, "bible_story_mismatch", "This Story Bible was made from a different version of the story. Make the review again.");
    if (!inStory(story, text)) return problem(409, "part_not_in_story", "This part's text is not part of the story the Story Bible was made from.");
    const { open } = rawApprovedSections(b.bible);
    if (open.length) return problem(409, "bible_not_approved", `Approve the Director's review first (${open.join(", ")} not approved for its current content).`, { open });
    checked = recheck(ctx.bible, story);
    const reasons = SECTIONS.flatMap((sec) => blockedReasons(checked!, sec));
    if (reasons.length) return problem(409, "bible_blocked", "The story disagrees with something in the Story Bible. Fix or remove it in the review.", { reasons });
    ctx.bible = checked;
  }

  try {
    const strong = await cachedPlannerModel();
    if (!strong) return Response.json({ error: "No suitable planning model found on OpenRouter right now." }, { status: 503 });
    const warnings: string[] = [];
    const fastModel = fast ? await cachedFastPlannerModel().catch(() => null) : null;
    const planWith = async (model: string): Promise<{ plan: EpisodePlan; mode: string }> => {
      const ask = (extra: string, maxTokens: number) =>
        askJson({
          apiKey: g.key,
          model,
          system: buildEpisodePrompt(ctx),
          user: `PART TEXT (Bangla):\n${text}${extra}`,
          name: "episode_plan",
          schema: EPISODE_SCHEMA,
          maxTokens,
          timeoutMs: 280_000,
        });
      // Thinking models spend part of max_tokens on hidden reasoning, so give plenty of room.
      let r = await ask("", 48_000);
      let plan: EpisodePlan;
      try {
        if (r.finishReason === "length") throw new Error("cut off");
        plan = normalizeEpisode(r.data, ctx, warnings);
      } catch {
        warnings.push(r.finishReason === "length" ? "The first answer was cut off; asked again for a shorter plan." : "The first answer had no usable shots; asked again.");
        r = await ask("\n\nIMPORTANT: answer with the complete JSON object only. Use at most 28 shots; keep every field short.", 60_000);
        plan = normalizeEpisode(r.data, ctx, warnings);
      }
      return { plan, mode: r.mode };
    };
    let model = strong;
    let result: { plan: EpisodePlan; mode: string };
    if (fastModel && fastModel !== strong) {
      try {
        model = fastModel;
        result = await planWith(fastModel);
      } catch (err) {
        if (err instanceof OpenRouterError && err.status === 401) throw err;
        warnings.push("The fast model's plan was not usable; used the strong model instead.");
        model = strong;
        result = await planWith(strong);
      }
    } else {
      result = await planWith(strong);
    }
    const plan = result.plan;
    // Nothing is deleted to make the plan pass: the report says what is wrong, the app blocks the paid steps.
    const report = ctx.bible ? validatePlan(plan, ctx.bible, { partIndex, partText: text, isLast: ctx.isLast }) : validatePlan(plan, normalizeBible({}), {});
    if (ctx.bible) warnings.push(reportLine(report));
    const r = { mode: result.mode };
    if (r.mode === "json_object") warnings.push("The model did not accept the strict schema; used plain JSON mode.");
    return Response.json({ plan, model, warnings, report, blocked: !!ctx.bible && !report.ok });
  } catch (err) {
    if (err instanceof JsonReplyError || (err instanceof Error && !(err instanceof OpenRouterError) && /shots|JSON/.test(err.message))) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    return errorResponse(err);
  }
}
