import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as imagePost } from "@/app/api/image/route";
import { POST as videoPost } from "@/app/api/video/route";
import { GET as videoGet } from "@/app/api/video/[id]/route";
import { GET as videoContent } from "@/app/api/video/[id]/content/route";
import { estimateVideoCost, listImageModels, listVideoModels, parseVideoPricing, pickClipDuration, type VideoModel } from "@/lib/openrouter/media";
import { _resetRateLimit } from "@/lib/rateLimit";
import { buildTimeline, captionsFor, chunkSentence, layoutCaption, cleanSubtitle, fitRate, kenBurns, slotAt, totalDuration, wrapLines } from "@/lib/render/timeline";
import { pickMimeType } from "@/lib/render/renderer";
import { DEFAULT_SCENES } from "@/lib/mergeSample";
import { allowedTags, sanitizeTags } from "@/lib/voiceDirector";
import { FAKE_KEY, mockFetch } from "./helpers";

describe("timeline (audio is master)", () => {
  it("lays scenes end to end with lead-in and tail around each narration", () => {
    const s = buildTimeline([3.2, 5.0], 0.15, 0.35);
    expect(s[0]).toMatchObject({ start: 0, audioStart: 0.15, audioDuration: 3.2 });
    expect(s[0].end).toBeCloseTo(3.7);
    expect(s[1].start).toBeCloseTo(3.7);
    expect(s[1].audioStart).toBeCloseTo(3.85);
    expect(totalDuration(s)).toBeCloseTo(9.2);
    expect(slotAt(s, 3.69)?.index).toBe(0);
    expect(slotAt(s, 3.71)?.index).toBe(1);
    expect(slotAt(s, 99)).toBeNull();
  });

  it("fitRate speeds a slightly long clip up to end exactly with its slot, within natural limits", () => {
    expect(fitRate(8, 7.3)).toBeCloseTo(1.0959, 3);
    expect(fitRate(6, 7.3)).toBeCloseTo(0.8219, 3);
    expect(fitRate(15, 7)).toBe(1.25); // would look sped-up: clamp, clip gets trimmed
    expect(fitRate(3, 7)).toBe(0.8); // would look slow-mo: clamp, last frame holds
  });

  it("pickClipDuration takes the shortest duration that covers the audio", () => {
    expect(pickClipDuration(7.3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(8);
    expect(pickClipDuration(7.3, [5, 10])).toBe(10);
    expect(pickClipDuration(20, [5, 10])).toBe(10);
    expect(pickClipDuration(3, [])).toBeNull();
  });

  it("captions strip tags and split time by sentence length", () => {
    expect(cleanSubtitle("[sad] মা বসে থাকতেন, [short pause] ছেলের অপেক্ষায়।")).toBe("মা বসে থাকতেন, ছেলের অপেক্ষায়।");
    const c = captionsFor("[whispers] খোকা? তুই এসেছিস? [relief] ছেলেটা কেঁদে ফেলল।", 1, 6);
    expect(c.map((x) => x.text)).toEqual(["খোকা?", "তুই এসেছিস?", "ছেলেটা কেঁদে ফেলল।"]);
    expect(c[0].start).toBe(1);
    expect(c[2].end).toBeCloseTo(7);
    expect(c[1].end - c[1].start).toBeGreaterThan(c[0].end - c[0].start);
  });

  it("ken burns stays inside a safe range", () => {
    for (const i of [0, 1, 2, 3]) for (const p of [0, 0.5, 1]) {
      const k = kenBurns(i, p);
      expect(k.scale).toBeGreaterThanOrEqual(1);
      expect(k.scale).toBeLessThanOrEqual(1.12);
      expect(Math.abs(k.dx)).toBeLessThanOrEqual(0.015 + 1e-9);
    }
  });

  it("wrapLines wraps by width", () => {
    expect(wrapLines("aa bb cc dd", 5, (s) => s.length)).toEqual(["aa bb", "cc dd"]);
  });

  it("prefers MP4 recording when the browser supports it", () => {
    expect(pickMimeType((t) => t.startsWith("video/mp4"))).toMatch(/^video\/mp4/);
    expect(pickMimeType((t) => t === "video/webm")).toBe("video/webm");
    expect(pickMimeType(() => false)).toBe("");
  });

  it("sample scenes use only valid Gemini tags", () => {
    for (const s of DEFAULT_SCENES) expect(sanitizeTags(s.narration, allowedTags("gemini"))).toBe(s.narration);
  });
});

describe("video pricing", () => {
  it("reads cents and dollar SKUs per resolution", () => {
    expect(parseVideoPricing({ cents_per_image_input: "1", cents_per_video_output_second_480p: "2", cents_per_video_output_second_720p: "3" }))
      .toEqual({ "480p": 0.02, "720p": 0.03 });
    expect(parseVideoPricing({ duration_seconds: "0.08", duration_seconds_480p: "0.05" })).toEqual({ default: 0.08, "480p": 0.05 });
    expect(parseVideoPricing({ duration_seconds_with_audio_720p: "0.069504" })).toEqual({ "720p": 0.069504 });
  });
  it("estimates cost", () => {
    const m: VideoModel = { id: "x/y", name: "y", durations: [8], resolutions: ["480p"], acceptsFirstFrame: true, usdPerSecond: { "480p": 0.02 } };
    expect(estimateVideoCost(m, "480p", 8)).toBe(0.16);
    expect(estimateVideoCost({ ...m, usdPerSecond: {} }, "480p", 8)).toBeNull();
  });
});

describe("media routes", () => {
  beforeEach(() => _resetRateLimit());
  afterEach(() => vi.unstubAllGlobals());
  const auth = { "content-type": "application/json", "x-openrouter-key": FAKE_KEY };

  it("lists only 9:16-capable models with parsed pricing", async () => {
    mockFetch((url) =>
      url.endsWith("/images/models")
        ? Response.json({ data: [
            { id: "google/gemini-nano-banana-2.1", name: "NB", supported_parameters: { aspect_ratio: { values: ["1:1", "9:16"] }, input_references: {} } },
            { id: "tencent/pano", supported_parameters: { aspect_ratio: { values: ["2:1"] } } },
          ] })
        : Response.json({ data: [
            { id: "x-ai/grok-imagine-video-1.5-lite", name: "Grok", supported_durations: [1, 2, 8], supported_aspect_ratios: ["9:16"], supported_resolutions: ["480p"], pricing_skus: { cents_per_image_input: "1", cents_per_video_output_second_480p: "2" } },
            { id: "black-forest-labs/flux-video-edit", supported_durations: null, supported_aspect_ratios: null },
          ] }),
    );
    const j = { image: await listImageModels(), video: await listVideoModels() };
    expect(j.image).toEqual([{ id: "google/gemini-nano-banana-2.1", name: "NB", acceptsReferences: true }]);
    expect(j.video).toHaveLength(1);
    expect(j.video[0]).toMatchObject({ acceptsFirstFrame: true, usdPerSecond: { "480p": 0.02 } });
  });

  it("image route sends aspect 9:16 and references, returns a data URL", async () => {
    const { calls } = mockFetch(() => Response.json({ data: [{ b64_json: "iVBORw0KGgo=", media_type: "image/png" }], usage: { cost: 0.04 } }));
    const ref = "data:image/png;base64,iVBORw0KGgo=";
    const res = await imagePost(new Request("http://x/api/image", { method: "POST", headers: auth, body: JSON.stringify({ model: "a/b", prompt: "cat", references: [ref, "javascript:evil"] }) }));
    expect(await res.json()).toEqual({ dataUrl: "data:image/png;base64,iVBORw0KGgo=", costUsd: 0.04 });
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/images");
    expect(calls[0].body).toMatchObject({ aspect_ratio: "9:16", input_references: [{ type: "image_url", image_url: { url: ref } }] });
  });

  it("video submit disables model audio, uses 9:16 and the scene image as first frame", async () => {
    const { calls } = mockFetch(() => Response.json({ id: "job-1", status: "pending" }, { status: 202 }));
    const res = await videoPost(new Request("http://x/api/video", { method: "POST", headers: auth, body: JSON.stringify({ model: "x-ai/grok-imagine-video-1.5-lite", prompt: "hug", duration: 8, resolution: "480p", firstFrame: "data:image/png;base64,AAAA" }) }));
    expect(await res.json()).toEqual({ id: "job-1" });
    expect(calls[0].body).toEqual({
      model: "x-ai/grok-imagine-video-1.5-lite", prompt: "hug", duration: 8, aspect_ratio: "9:16", generate_audio: false, resolution: "480p",
      frame_images: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" }, frame_type: "first_frame" }],
    });
    const bad = await videoPost(new Request("http://x/api/video", { method: "POST", headers: auth, body: JSON.stringify({ model: "a/b", prompt: "p", duration: 99 }) }));
    expect(bad.status).toBe(400);
  });

  it("polls status and streams content with auth", async () => {
    mockFetch((url) =>
      url.endsWith("/content?index=0")
        ? new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { headers: { "content-type": "video/mp4" } })
        : Response.json({ status: "completed", usage: { cost: 0.16 } }),
    );
    const ctx = { params: Promise.resolve({ id: "job-1" }) };
    const st = await (await videoGet(new Request("http://x", { headers: auth }), ctx)).json();
    expect(st).toEqual({ status: "completed", costUsd: 0.16, error: null });
    const c = await videoContent(new Request("http://x", { headers: auth }), ctx);
    expect(c.headers.get("content-type")).toBe("video/mp4");
    expect((await c.arrayBuffer()).byteLength).toBe(8);
    expect((await videoGet(new Request("http://x", { headers: auth }), { params: Promise.resolve({ id: "../etc" }) })).status).toBe(400);
  });
});

describe("caption layout (explicit centring for iOS)", () => {
  const measure = (t: string, size: number) => [...t].length * size * 0.5;
  it("centres every line inside the frame and keeps it below the faces", () => {
    const text = "ছেলেটা মায়ের পা জড়িয়ে ধরে কেঁদে ফেলল।";
    const L = layoutCaption(text, 720, 1280, measure);
    expect(L.lines.length).toBeGreaterThanOrEqual(1);
    for (const ln of L.lines) {
      expect(ln.x).toBeGreaterThanOrEqual(0);
      expect(ln.x + ln.width).toBeLessThanOrEqual(720);
      expect(ln.x + ln.width / 2).toBeCloseTo(360, 5);
    }
    expect(L.box.x).toBeGreaterThanOrEqual(0);
    expect(L.box.x + L.box.w).toBeLessThanOrEqual(720 + 1e-6);
    expect(L.box.y).toBeGreaterThan(1280 * 0.7);
    expect(L.box.y + L.box.h).toBeLessThanOrEqual(1280 * 0.95 + 1e-6);
  });
  it("shrinks the font for very long text instead of overflowing", () => {
    const long = "আমি ".repeat(60).trim();
    const L = layoutCaption(long, 720, 1280, measure);
    expect(L.lines.length).toBeLessThanOrEqual(3);
    expect(L.fontSize).toBeLessThan(Math.round(720 * 0.054));
    for (const ln of L.lines) expect(ln.width).toBeLessThanOrEqual(720 * 0.84 + 1e-6);
  });
});

describe("chunkSentence", () => {
  it("keeps short sentences and splits long ones at commas/spaces", () => {
    expect(chunkSentence("মা বসে ছিলেন।")).toEqual(["মা বসে ছিলেন।"]);
    const long = "বারো বছর পর, এক বৃষ্টির রাতে, দরজায় কড়া নাড়ার শব্দ হলো আর মা চমকে উঠলেন।";
    const parts = chunkSentence(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toBe(long);
    for (const p of parts) expect([...p].length).toBeLessThanOrEqual(42);
  });
  it("breaks at commas when possible", () => {
    expect(chunkSentence("বারো বছর পর, এক বৃষ্টির রাতে, দরজায় কড়া নাড়ার শব্দ।")).toEqual([
      "বারো বছর পর, এক বৃষ্টির রাতে,",
      "দরজায় কড়া নাড়ার শব্দ।",
    ]);
  });
});
