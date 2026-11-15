/**
 * Shared "ask for JSON" helper for planner-style calls (episode planner, asset maker).
 * Same pattern as /api/plan: strict json_schema + the response-healing plugin; if the
 * endpoint rejects that with HTTP 400, retry once in plain json_object mode.
 */
import { chatComplete, listTextModels } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { pickPlannerModel } from "@/lib/storyPlan";

/** The model answered, but not with a JSON object we can read. Routes map this to 422. */
export class JsonReplyError extends Error {
  constructor(message = "The AI's answer was not valid JSON. Try again.") {
    super(message);
    this.name = "JsonReplyError";
  }
}

/** Strip code fences / chatter and parse the outermost JSON object. */
export function parseJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "");
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last <= first) throw new JsonReplyError();
  text = text.slice(first, last + 1);
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new JsonReplyError();
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new JsonReplyError();
  return v as Record<string, unknown>;
}

export interface AskJsonParams {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** json_schema name, e.g. "episode_plan". */
  name: string;
  schema: object;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AskJsonResult {
  data: Record<string, unknown>;
  /** "json_schema" when strict mode worked, "json_object" after the 400 fallback. */
  mode: "json_schema" | "json_object";
}

export async function askJson(p: AskJsonParams): Promise<AskJsonResult> {
  const base = {
    apiKey: p.apiKey,
    model: p.model,
    system: p.system,
    user: p.user,
    temperature: p.temperature ?? 0.3,
    maxTokens: p.maxTokens ?? 16000,
  };
  const timeoutMs = p.timeoutMs ?? 240_000;
  try {
    const r = await chatComplete(
      {
        ...base,
        responseFormat: { type: "json_schema", json_schema: { name: p.name, strict: true, schema: p.schema } },
        plugins: [{ id: "response-healing" }],
      },
      { timeoutMs },
    );
    return { data: parseJsonObject(r.content), mode: "json_schema" };
  } catch (err) {
    if (!(err instanceof OpenRouterError) || err.status !== 400) throw err;
    const r = await chatComplete({ ...base, responseFormat: { type: "json_object" } }, { timeoutMs });
    return { data: parseJsonObject(r.content), mode: "json_object" };
  }
}

/* ---------------------------- planner model cache ---------------------------- */

let plannerCache: { at: number; model: string | null } | null = null;

/** Same choice as /api/plan: pickPlannerModel over the live model list, cached 30 minutes. */
export async function cachedPlannerModel(): Promise<string | null> {
  if (!plannerCache || Date.now() - plannerCache.at > 30 * 60_000) {
    plannerCache = { at: Date.now(), model: pickPlannerModel(await listTextModels()) };
  }
  return plannerCache.model;
}

export function _resetPlannerCache() {
  plannerCache = null;
}
