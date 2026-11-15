import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatComplete, getGeneration, listSpeechModels, normalizeVoices, pickHelperModel, synthesize } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { audioResponse, errorResponse, FAKE_KEY, mockFetch } from "./helpers";

const base = { apiKey: FAKE_KEY, model: "elevenlabs/eleven-v3", input: "আমি জারভিস", voice: "george" };

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllGlobals());

describe("synthesize", () => {
  it("POSTs the documented OpenAI-compatible body to /audio/speech", async () => {
    const { calls } = mockFetch(() => audioResponse([1, 2, 3], "audio/mpeg"));
    const r = await synthesize({ ...base, format: "auto" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(calls[0].body).toEqual({
      model: "elevenlabs/eleven-v3",
      input: "আমি জারভিস",
      voice: "george",
      response_format: "mp3",
    });
    expect(r.format).toBe("mp3");
    expect(r.generationId).toBe("gen-test-123");
    expect(r.fellBackToPcm).toBe(false);
    expect([...r.audio]).toEqual([1, 2, 3]);
  });

  it("falls back to pcm once when mp3 is rejected with 400 (auto mode)", async () => {
    const { calls } = mockFetch((_u, init) => {
      const body = JSON.parse(init.body as string);
      return body.response_format === "mp3"
        ? errorResponse(400, "Only pcm is supported")
        : audioResponse([9, 9], "audio/pcm");
    });
    const r = await synthesize({ ...base, model: "heygen/heygen-voice-1", format: "auto" });
    expect(calls.map((c) => c.body?.response_format)).toEqual(["mp3", "pcm"]);
    expect(r.format).toBe("pcm");
    expect(r.fellBackToPcm).toBe(true);
  });

  it("asks Gemini for pcm directly in auto mode (documented pcm-only)", async () => {
    const { calls } = mockFetch(() => audioResponse([1, 2], "audio/pcm"));
    const r = await synthesize({ ...base, model: "google/gemini-3.8-flash-tts", voice: "Kore", format: "auto" });
    expect(calls.map((c) => c.body?.response_format)).toEqual(["pcm"]);
    expect(r.format).toBe("pcm");
  });

  it("does not fall back in explicit mp3 mode or on non-400 errors", async () => {
    let m = mockFetch(() => errorResponse(400, "nope"));
    await expect(synthesize({ ...base, format: "mp3" })).rejects.toBeInstanceOf(OpenRouterError);
    expect(m.calls).toHaveLength(1);

    m = mockFetch(() => errorResponse(402, "no credits"));
    await expect(synthesize({ ...base, format: "auto" })).rejects.toMatchObject({ status: 402 });
    expect(m.calls).toHaveLength(1);
  });

  it("reports the original error if the pcm retry also fails", async () => {
    mockFetch((_u, init) =>
      JSON.parse(init.body as string).response_format === "mp3"
        ? errorResponse(400, "voice 'zzz' not found")
        : errorResponse(400, "generic"),
    );
    await expect(synthesize({ ...base, format: "auto" })).rejects.toThrow(/voice 'zzz' not found/);
  });

  it("treats a 200 JSON body or empty body as a failure, not audio", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { message: "x" } }), { headers: { "content-type": "application/json" } }));
    await expect(synthesize({ ...base, format: "mp3" })).rejects.toMatchObject({ status: 502 });
    mockFetch(() => audioResponse([], "audio/mpeg"));
    await expect(synthesize({ ...base, format: "mp3" })).rejects.toThrow(/empty audio/);
  });

  it("adds ElevenLabs language_code only for elevenlabs models", async () => {
    const { calls } = mockFetch(() => audioResponse([1], "audio/mpeg"));
    await synthesize({ ...base, format: "mp3", elevenLabsLanguageCode: "bn" });
    await synthesize({ ...base, model: "openai/gpt-4o-mini-tts-2025-12-15", format: "mp3", elevenLabsLanguageCode: "bn" });
    expect(calls[0].body?.provider).toEqual({ options: { elevenlabs: { language_code: "bn" } } });
    expect(calls[1].body?.provider).toBeUndefined();
  });

  it("never leaks the key in thrown errors", async () => {
    mockFetch(() => errorResponse(401, `bad key: ${FAKE_KEY}`));
    const err = (await synthesize({ ...base, format: "mp3" }).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain(FAKE_KEY);
  });

  it("respects OPENROUTER_BASE_URL for testing", async () => {
    vi.stubEnv("OPENROUTER_BASE_URL", "http://localhost:9999/api/v1/");
    const { calls } = mockFetch(() => audioResponse([1], "audio/mpeg"));
    await synthesize({ ...base, format: "mp3" });
    expect(calls[0].url).toBe("http://localhost:9999/api/v1/audio/speech");
  });
});

describe("listSpeechModels", () => {
  it("queries output_modalities=speech without a key and normalises data", async () => {
    const { calls } = mockFetch(() =>
      Response.json({
        data: [
          { id: "openai/gpt-4o-mini-tts-2025-12-15", name: "OpenAI TTS", pricing: { prompt: "0.0000006", completion: "0" }, supported_voices: ["alloy", "nova"] },
          { id: "elevenlabs/eleven-v3", name: "ElevenLabs: Eleven v3", pricing: { prompt: "0.00008" }, supported_voices: [{ id: "george" }, { name: "sarah" }] },
          { name: "broken entry without id" },
        ],
      }),
    );
    const models = await listSpeechModels();
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/models?output_modalities=speech");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(models.map((m) => m.id)).toEqual(["elevenlabs/eleven-v3", "openai/gpt-4o-mini-tts-2025-12-15"]);
    expect(models[0]).toMatchObject({ bengaliDocumented: true, voices: ["george", "sarah"], pricing: { prompt: "0.00008" } });
    expect(models[1].pricing).toEqual({ prompt: "0.0000006" }); // zero entries dropped
  });

  it("normalizeVoices tolerates junk", () => {
    expect(normalizeVoices(undefined)).toEqual([]);
    expect(normalizeVoices(["a", "a", 3, null, { voice_id: "b" }])).toEqual(["a", "b"]);
  });
});

describe("getGeneration", () => {
  it("maps total_cost and provider; 404 means not ready yet", async () => {
    mockFetch(() => Response.json({ data: { model: "elevenlabs/eleven-v3", provider_name: "ElevenLabs", total_cost: 0.0084, latency: 1200, generation_time: 1100 } }));
    await expect(getGeneration(FAKE_KEY, "gen-1")).resolves.toEqual({
      id: "gen-1",
      model: "elevenlabs/eleven-v3",
      providerName: "ElevenLabs",
      totalCostUsd: 0.0084,
      latencyMs: 1200,
      generationTimeMs: 1100,
    });
    mockFetch(() => new Response("not found", { status: 404 }));
    await expect(getGeneration(FAKE_KEY, "gen-1")).resolves.toBeNull();
  });
});

describe("helper model + chat", () => {
  it("picks the newest Gemini flash-lite text model from the live list", () => {
    const models = [
      { id: "google/gemini-3.8-flash-tts", architecture: { output_modalities: ["audio"] } },
      { id: "google/gemini-2.5-flash-lite", architecture: { output_modalities: ["text"] } },
      { id: "google/gemini-3.1-flash-lite", architecture: { output_modalities: ["text"] } },
      { id: "google/gemini-3.1-flash-image", architecture: { output_modalities: ["image", "text"] } },
      { id: "openai/gpt-5-mini", architecture: { output_modalities: ["text"] } },
    ];
    expect(pickHelperModel(models)).toBe("google/gemini-3.1-flash-lite");
    expect(pickHelperModel([{ id: "openai/gpt-5-mini" }])).toBe("openai/gpt-5-mini");
    expect(pickHelperModel([{ id: "x/y" }])).toBeNull();
  });

  it("chatComplete posts messages and returns content", async () => {
    const { calls } = mockFetch(() => Response.json({ id: "gen-c", choices: [{ message: { content: "hi" } }] }));
    const r = await chatComplete({ apiKey: FAKE_KEY, model: "a/b", system: "s", user: "u" });
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].body?.messages).toEqual([{ role: "system", content: "s" }, { role: "user", content: "u" }]);
    expect(r).toEqual({ content: "hi", generationId: "gen-c", finishReason: null });
  });
});
