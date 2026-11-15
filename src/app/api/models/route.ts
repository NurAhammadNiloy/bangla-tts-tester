import { connection } from "next/server";
import { listSpeechModels } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";
import type { SpeechModel } from "@/lib/openrouter/types";


let cache: { at: number; models: SpeechModel[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

/** Live list of OpenRouter speech models. Public data, no key required. */
export async function GET() {
  await connection(); // always run at request time, never prerender at build
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      cache = { at: Date.now(), models: await listSpeechModels() };
    }
    return Response.json({ models: cache.models, fetchedAt: new Date(cache.at).toISOString() });
  } catch (err) {
    const status = err instanceof OpenRouterError ? err.status : 502;
    const message =
      err instanceof OpenRouterError ? err.message : "Could not reach OpenRouter to list speech models.";
    return Response.json({ error: message }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
