import { OpenRouterError } from "@/lib/openrouter/errors";
import { clientId, rateLimit } from "@/lib/rateLimit";
import { KEY_HEADER, validateApiKey } from "@/lib/validation";

/** Shared guard: rate limit + key header. Returns the key or an error Response. */
export function guard(req: Request, bucket: string, limit: number): { key: string } | { response: Response } {
  if (!rateLimit(`${bucket}:${clientId(req)}`, limit, 60_000)) {
    return { response: Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 }) };
  }
  const key = validateApiKey(req.headers.get(KEY_HEADER));
  if (!key.ok) return { response: Response.json({ error: key.error }, { status: 401 }) };
  return { key: key.value };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof OpenRouterError) return Response.json({ error: err.message }, { status: err.status });
  const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
  return Response.json(
    { error: timedOut ? "OpenRouter took too long to respond." : "Could not reach OpenRouter." },
    { status: timedOut ? 504 : 502 },
  );
}

export const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
export const JOB_ID = /^[A-Za-z0-9_-]{1,200}$/;
/** data: URL of a png/jpeg/webp image, up to ~8 MB. */
export function isImageDataUrl(s: unknown): s is string {
  return typeof s === "string" && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 11_000_000;
}
