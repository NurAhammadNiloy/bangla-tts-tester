/**
 * OpenRouter image + video generation adapters.
 *
 * Verified against OpenRouter docs (Nov 2026):
 *  - POST /api/v1/images            → { data: [{ b64_json, media_type }], usage: { cost } }
 *  - GET  /api/v1/images/models     → supported_parameters.aspect_ratio.values, input_references
 *  - POST /api/v1/videos            → 202 { id, polling_url, status }   (async job)
 *  - GET  /api/v1/videos/{id}       → { status: pending|in_progress|completed|failed, usage.cost, error }
 *  - GET  /api/v1/videos/{id}/content?index=0 (Bearer) → MP4 bytes
 *  - GET  /api/v1/videos/models     → supported_durations / resolutions / aspect_ratios, pricing_skus
 *  - `generate_audio` defaults to true; we send false because narration comes from TTS.
 */
import { baseUrl, type ClientOptions } from "./client";
import { errorFromResponse, OpenRouterError } from "./errors";

const APP_HEADERS = { "X-Title": "Bangla TTS Tester" };

/* ------------------------------ Models ------------------------------ */

export interface ImageModel {
  id: string;
  name: string;
  acceptsReferences: boolean;
}

export interface VideoModel {
  id: string;
  name: string;
  durations: number[];
  resolutions: string[];
  acceptsFirstFrame: boolean;
  /** USD per output second by resolution, when it can be read from pricing_skus. */
  usdPerSecond: Record<string, number>;
}

/**
 * pricing_skus keys vary by provider, e.g. "cents_per_video_output_second_480p": "2"
 * or "duration_seconds_480p": "0.05" (USD). Returns USD/second per resolution,
 * plus "default" when the key has no resolution suffix. Audio-inclusive SKUs are
 * used only when no other SKU exists.
 */
export function parseVideoPricing(skus: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const audioOnly: Record<string, number> = {};
  for (const [key, raw] of Object.entries(skus ?? {})) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!/second/.test(key) || /input|image|reference/.test(key)) continue;
    const usd = key.startsWith("cents") ? value / 100 : value;
    const res = key.match(/_(\d{3,4}p|[124]k)$/i)?.[1]?.toLowerCase() ?? "default";
    if (/with_audio/.test(key)) audioOnly[res] = usd;
    else out[res] = usd;
  }
  return Object.keys(out).length ? out : audioOnly;
}

export function estimateVideoCost(model: VideoModel, resolution: string, seconds: number): number | null {
  const rate = model.usdPerSecond[resolution.toLowerCase()] ?? model.usdPerSecond.default;
  return rate === undefined ? null : Math.round(rate * seconds * 1000) / 1000;
}

/** Shortest supported duration that covers the audio, else the longest available. */
export function pickClipDuration(audioSeconds: number, supported: number[]): number | null {
  if (!supported.length) return null;
  const sorted = [...supported].sort((a, b) => a - b);
  return sorted.find((d) => d >= audioSeconds) ?? sorted[sorted.length - 1];
}

async function getJson(url: string, opts: ClientOptions): Promise<unknown> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(url, {
    headers: { Accept: "application/json", ...APP_HEADERS },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw await errorFromResponse(res);
  return res.json();
}

export async function listImageModels(opts: ClientOptions = {}): Promise<ImageModel[]> {
  const json = (await getJson(`${baseUrl()}/images/models`, opts)) as { data?: Record<string, unknown>[] };
  return (json.data ?? [])
    .filter((m) => {
      const ar = (m.supported_parameters as Record<string, { values?: string[] }> | undefined)?.aspect_ratio?.values;
      return typeof m.id === "string" && Array.isArray(ar) && ar.includes("9:16");
    })
    .map((m) => ({
      id: m.id as string,
      name: (m.name as string) ?? (m.id as string),
      acceptsReferences: !!(m.supported_parameters as Record<string, unknown> | undefined)?.input_references,
    }));
}

export async function listVideoModels(opts: ClientOptions = {}): Promise<VideoModel[]> {
  const json = (await getJson(`${baseUrl()}/videos/models`, opts)) as { data?: Record<string, unknown>[] };
  return (json.data ?? [])
    .filter(
      (m) =>
        typeof m.id === "string" &&
        Array.isArray(m.supported_durations) &&
        (m.supported_durations as unknown[]).length > 0 &&
        Array.isArray(m.supported_aspect_ratios) &&
        (m.supported_aspect_ratios as string[]).includes("9:16"),
    )
    .map((m) => {
      const skus = (m.pricing_skus as Record<string, unknown>) ?? {};
      return {
        id: m.id as string,
        name: (m.name as string) ?? (m.id as string),
        durations: (m.supported_durations as number[]).filter((d) => Number.isInteger(d) && d > 0),
        resolutions: Array.isArray(m.supported_resolutions) ? (m.supported_resolutions as string[]) : [],
        // A per-image-input price signals image-to-video support.
        acceptsFirstFrame: Object.keys(skus).some((k) => /image_input|image-input|per_image/.test(k)),
        usdPerSecond: parseVideoPricing(skus),
      };
    });
}

/* ------------------------------ Images ------------------------------ */

export interface ImageResult {
  b64: string;
  mediaType: string;
  costUsd: number | null;
}

export async function generateImage(
  p: { apiKey: string; model: string; prompt: string; aspectRatio?: string; references?: string[] },
  opts: ClientOptions = {},
): Promise<ImageResult> {
  const f = opts.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    model: p.model,
    prompt: p.prompt,
    aspect_ratio: p.aspectRatio ?? "9:16",
    n: 1,
  };
  if (p.references?.length) {
    body.input_references = p.references.map((url) => ({ type: "image_url", image_url: { url } }));
  }
  const res = await f(`${baseUrl()}/images`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json", ...APP_HEADERS },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  if (!res.ok) throw await errorFromResponse(res, p.apiKey);
  const json = (await res.json()) as { data?: { b64_json?: string; media_type?: string }[]; usage?: { cost?: number } };
  const first = json.data?.[0];
  if (!first?.b64_json) throw new OpenRouterError(502, "The image model returned no image.");
  return {
    b64: first.b64_json,
    mediaType: first.media_type ?? "image/png",
    costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : null,
  };
}

/* ------------------------------ Video ------------------------------- */

export interface VideoSubmit {
  apiKey: string;
  model: string;
  prompt: string;
  duration: number;
  resolution?: string;
  firstFrame?: string;
}

export async function submitVideo(p: VideoSubmit, opts: ClientOptions = {}): Promise<{ id: string }> {
  const f = opts.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    model: p.model,
    prompt: p.prompt,
    duration: p.duration,
    aspect_ratio: "9:16",
    generate_audio: false,
  };
  if (p.resolution) body.resolution = p.resolution;
  if (p.firstFrame) body.frame_images = [{ type: "image_url", image_url: { url: p.firstFrame }, frame_type: "first_frame" }];
  const res = await f(`${baseUrl()}/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json", ...APP_HEADERS },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  if (!res.ok) throw await errorFromResponse(res, p.apiKey);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new OpenRouterError(502, "Video job was not created.");
  return { id: json.id };
}

export interface VideoStatus {
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired" | "unknown";
  costUsd: number | null;
  error: string | null;
}

export async function getVideoStatus(apiKey: string, id: string, opts: ClientOptions = {}): Promise<VideoStatus> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${baseUrl()}/videos/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw await errorFromResponse(res, apiKey);
  const j = (await res.json()) as { status?: string; usage?: { cost?: number }; error?: unknown };
  const known = ["pending", "in_progress", "completed", "failed", "cancelled", "expired"];
  const err = j.error;
  return {
    status: (known.includes(j.status ?? "") ? j.status : "unknown") as VideoStatus["status"],
    costUsd: typeof j.usage?.cost === "number" ? j.usage.cost : null,
    error: typeof err === "string" ? err : err && typeof err === "object" ? String((err as { message?: string }).message ?? "failed") : null,
  };
}

export async function fetchVideoContent(apiKey: string, id: string, opts: ClientOptions = {}): Promise<Response> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${baseUrl()}/videos/${encodeURIComponent(id)}/content?index=0`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  if (!res.ok) throw await errorFromResponse(res, apiKey);
  return res;
}
