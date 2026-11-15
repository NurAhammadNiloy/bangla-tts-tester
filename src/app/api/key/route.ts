import { errorResponse, guard } from "@/lib/apiGuard";
import { baseUrl } from "@/lib/openrouter/client";
import { errorFromResponse } from "@/lib/openrouter/errors";

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * GET /api/key  (header x-openrouter-key)
 * Checks the key with OpenRouter's documented "get current API key" endpoint,
 * GET {base}/key (https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key).
 * → { ok: true, label?, limitRemaining?, usage? }  or  { ok: false, error } with the upstream status.
 * limitRemaining is only present when the key has a credit limit.
 */
export async function GET(req: Request) {
  const g = guard(req, "key", 20);
  if ("response" in g) {
    const j = (await g.response.json()) as { error?: string };
    return Response.json({ ok: false, error: j.error ?? "Key check failed." }, { status: g.response.status });
  }
  try {
    const res = await fetch(`${baseUrl()}/key`, {
      headers: { Authorization: `Bearer ${g.key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const err = await errorFromResponse(res, g.key);
      const error = res.status === 401 ? "OpenRouter did not accept this key. Copy it again from openrouter.ai/keys." : err.message;
      return Response.json({ ok: false, error }, { status: err.status });
    }
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown> };
    const d = json.data ?? {};
    const label = typeof d.label === "string" && d.label.trim() ? d.label.trim().slice(0, 80) : undefined;
    return Response.json(
      { ok: true, label, limitRemaining: num(d.limit_remaining), usage: num(d.usage) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const r = errorResponse(err);
    const j = (await r.json()) as { error?: string };
    return Response.json({ ok: false, error: j.error ?? "Could not reach OpenRouter." }, { status: r.status });
  }
}
