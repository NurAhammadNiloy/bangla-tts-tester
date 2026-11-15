import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as ttsPost } from "@/app/api/tts/route";
import { GET as generationGet } from "@/app/api/generation/route";
import { _resetRateLimit } from "@/lib/rateLimit";
import { audioResponse, errorResponse, FAKE_KEY, mockFetch } from "./helpers";

function ttsRequest(body: unknown, key: string | null = FAKE_KEY, ip = "1.1.1.1") {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (key !== null) headers["x-openrouter-key"] = key;
  return new Request("http://localhost/api/tts", { method: "POST", headers, body: JSON.stringify(body) });
}

const good = { model: "elevenlabs/eleven-v3", text: "আমার নাম জারভিস।", voice: "george" };

beforeEach(() => _resetRateLimit());
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/tts", () => {
  it("401 without a key, and never calls upstream", async () => {
    const { calls } = mockFetch(() => audioResponse([1], "audio/mpeg"));
    const res = await ttsPost(ttsRequest(good, null));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("400 for invalid input before calling upstream", async () => {
    const { calls } = mockFetch(() => audioResponse([1], "audio/mpeg"));
    const res = await ttsPost(ttsRequest({ ...good, text: "" }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("returns mp3 bytes with metric headers", async () => {
    mockFetch(() => audioResponse([0xff, 0xfb, 0x90], "audio/mpeg", "gen-abc"));
    const res = await ttsPost(ttsRequest(good));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("x-generation-id")).toBe("gen-abc");
    expect(res.headers.get("x-audio-format")).toBe("mp3");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Number(res.headers.get("x-elapsed-ms"))).toBeGreaterThanOrEqual(0);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0xff, 0xfb, 0x90]);
  });

  it("wraps pcm in a playable WAV at the requested sample rate", async () => {
    mockFetch(() => audioResponse([1, 2, 3, 4], "audio/pcm"));
    const res = await ttsPost(ttsRequest({ ...good, format: "pcm", sampleRate: 22050 }));
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(String.fromCharCode(...buf.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(buf.buffer).getUint32(24, true)).toBe(22050);
    expect(buf.byteLength).toBe(48);
  });

  it("passes through upstream status with a redacted message", async () => {
    mockFetch(() => errorResponse(402, `Insufficient credits for ${FAKE_KEY}`));
    const res = await ttsPost(ttsRequest(good));
    const text = await res.text();
    expect(res.status).toBe(402);
    expect(text).toMatch(/insufficient credits/i);
    expect(text).not.toContain(FAKE_KEY);
  });

  it("maps network failure to 502 without leaking details", async () => {
    mockFetch(() => {
      throw new TypeError(`fetch failed ${FAKE_KEY}`);
    });
    const res = await ttsPost(ttsRequest(good));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(FAKE_KEY);
  });

  it("rate limits at 20 requests per minute per client", async () => {
    mockFetch(() => audioResponse([1], "audio/mpeg"));
    for (let i = 0; i < 20; i++) expect((await ttsPost(ttsRequest(good))).status).toBe(200);
    expect((await ttsPost(ttsRequest(good))).status).toBe(429);
    expect((await ttsPost(ttsRequest(good, FAKE_KEY, "2.2.2.2"))).status).toBe(200);
  });

  it("does not log the key", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    mockFetch(() => errorResponse(500, "boom"));
    await ttsPost(ttsRequest(good));
    for (const s of spies) {
      for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain(FAKE_KEY);
      s.mockRestore();
    }
  });
});

describe("GET /api/generation", () => {
  const req = (id: string, key: string | null = FAKE_KEY) =>
    new Request(`http://localhost/api/generation?id=${encodeURIComponent(id)}`, {
      headers: key ? { "x-openrouter-key": key } : {},
    });

  it("returns cost; 202 while pending; 400 for bad ids", async () => {
    mockFetch(() => Response.json({ data: { total_cost: 0.0042, provider_name: "ElevenLabs" } }));
    const ok = await generationGet(req("gen-1"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ totalCostUsd: 0.0042, providerName: "ElevenLabs" });

    mockFetch(() => new Response("", { status: 404 }));
    expect((await generationGet(req("gen-1"))).status).toBe(202);

    expect((await generationGet(req("bad id!"))).status).toBe(400);
    expect((await generationGet(req("gen-1", null))).status).toBe(401);
  });
});
