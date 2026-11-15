import { describe, expect, it } from "vitest";
import { pcm16DurationSeconds, pcm16ToWav } from "@/lib/audio/wav";
import { bengaliRatio, codePointLength, DEFAULT_BENGALI_TEXT, isBengaliDocumented } from "@/lib/bengali";
import { errorFromResponse, redact } from "@/lib/openrouter/errors";
import { rateLimit, _resetRateLimit } from "@/lib/rateLimit";
import { toCsv, type TestRecord } from "@/lib/report";
import { isGenerationId, validateApiKey, validateTtsInput } from "@/lib/validation";
import { FAKE_KEY } from "./helpers";

describe("pcm16ToWav", () => {
  it("writes a valid 44-byte RIFF/WAVE header", () => {
    const pcm = new Uint8Array(48000); // 1 s of 24 kHz mono 16-bit
    const wav = pcm16ToWav(pcm, 24000);
    const v = new DataView(wav.buffer);
    const ascii = (o: number, n: number) => String.fromCharCode(...wav.subarray(o, o + n));
    expect(wav.byteLength).toBe(44 + 48000);
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(36, 4)).toBe("data");
    expect(v.getUint32(4, true)).toBe(36 + 48000);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(28, true)).toBe(48000); // byte rate
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(48000);
  });

  it("copies samples and drops a trailing odd byte", () => {
    const wav = pcm16ToWav(new Uint8Array([1, 2, 3, 4, 5]), 24000);
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4]);
  });

  it("rejects bad sample rates", () => {
    expect(() => pcm16ToWav(new Uint8Array(4), 100)).toThrow(RangeError);
  });

  it("computes duration", () => {
    expect(pcm16DurationSeconds(48000, 24000)).toBe(1);
  });
});

describe("bengali helpers", () => {
  it("default text is Bengali script", () => {
    expect(bengaliRatio(DEFAULT_BENGALI_TEXT)).toBeGreaterThan(0.95);
    expect(bengaliRatio("Hello world")).toBe(0);
  });
  it("counts code points, not UTF-16 units", () => {
    expect(codePointLength("😀আ")).toBe(2);
  });
  it("flags only provider-documented Bengali families", () => {
    expect(isBengaliDocumented("elevenlabs/eleven-v3")).toBe(true);
    expect(isBengaliDocumented("elevenlabs/eleven-v3-conversational")).toBe(true);
    expect(isBengaliDocumented("google/gemini-3.1-flash-tts-preview")).toBe(true);
    expect(isBengaliDocumented("elevenlabs/eleven-flash-v2")).toBe(false);
    expect(isBengaliDocumented("openai/gpt-4o-mini-tts-2025-12-15")).toBe(false);
  });
});

describe("redaction", () => {
  it("removes the key and anything key-shaped", () => {
    const msg = `bad key ${FAKE_KEY} and sk-or-v1-zzzzzzzzzz, header Bearer abcdefghijklmnop`;
    const out = redact(msg, FAKE_KEY);
    expect(out).not.toContain(FAKE_KEY);
    expect(out).not.toContain("sk-or-v1-zzz");
    expect(out).not.toContain("abcdefghijklmnop");
  });

  it("errorFromResponse adds a hint and redacts upstream text", async () => {
    const res = new Response(JSON.stringify({ error: { message: `Invalid key ${FAKE_KEY}` } }), { status: 401 });
    const err = await errorFromResponse(res, FAKE_KEY);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/rejected the API key/);
    expect(err.message).not.toContain(FAKE_KEY);
  });

  it("handles non-JSON error bodies", async () => {
    const err = await errorFromResponse(new Response("<html>oops</html>", { status: 502 }));
    expect(err.message).toMatch(/upstream/);
  });
});

describe("validation", () => {
  it("api key", () => {
    expect(validateApiKey(FAKE_KEY).ok).toBe(true);
    expect(validateApiKey(` ${FAKE_KEY} `)).toEqual({ ok: true, value: FAKE_KEY });
    expect(validateApiKey(null).ok).toBe(false);
    expect(validateApiKey("short").ok).toBe(false);
    expect(validateApiKey("sk-or-v1-has space inside-0123456789").ok).toBe(false);
  });

  it("tts input: happy path with defaults", () => {
    const r = validateTtsInput({ model: "elevenlabs/eleven-v3", text: " আমি " });
    expect(r).toEqual({
      ok: true,
      value: {
        model: "elevenlabs/eleven-v3",
        text: "আমি",
        voice: undefined,
        format: "auto",
        instructions: undefined,
        elevenLabsLanguageCode: undefined,
        sampleRate: 24000,
      },
    });
  });

  it("tts input: rejects bad model ids, empty and oversized text, bad codes", () => {
    expect(validateTtsInput({ model: "../etc/passwd", text: "a" }).ok).toBe(false);
    expect(validateTtsInput({ model: "a/b", text: "   " }).ok).toBe(false);
    expect(validateTtsInput({ model: "a/b", text: "আ".repeat(5001) }).ok).toBe(false);
    expect(validateTtsInput({ model: "a/b", text: "আ".repeat(5000) }).ok).toBe(true);
    expect(validateTtsInput({ model: "a/b", text: "x", elevenLabsLanguageCode: "bengali!" }).ok).toBe(false);
    expect(validateTtsInput({ model: "a/b", text: "x", voice: "<script>" }).ok).toBe(false);
    expect(validateTtsInput(null).ok).toBe(false);
  });

  it("tts input: unknown sample rate falls back to 24 kHz; format is whitelisted", () => {
    const r = validateTtsInput({ model: "a/b", text: "x", sampleRate: 12345, format: "wav" });
    expect(r.ok && r.value.sampleRate).toBe(24000);
    expect(r.ok && r.value.format).toBe("auto");
  });

  it("generation id", () => {
    expect(isGenerationId("gen-abc_123")).toBe(true);
    expect(isGenerationId("gen?x=1")).toBe(false);
    expect(isGenerationId(null)).toBe(false);
  });
});

describe("rate limit", () => {
  it("allows up to the limit inside the window", () => {
    _resetRateLimit();
    for (let i = 0; i < 3; i++) expect(rateLimit("ip", 3, 1000, 0)).toBe(true);
    expect(rateLimit("ip", 3, 1000, 10)).toBe(false);
    expect(rateLimit("ip", 3, 1000, 2000)).toBe(true);
  });
});

describe("csv report", () => {
  const row: TestRecord = {
    time: "t",
    model: "elevenlabs/eleven-v3",
    provider: "ElevenLabs",
    endpoint: "POST x",
    voice: "george",
    outputFormat: "MP3",
    characters: 100,
    audioSeconds: 5.2,
    sizeBytes: 1000,
    generationMs: 1500,
    costUsd: 0.008,
    audioQuality: 4,
    pronunciation: 3,
    notes: '=HYPERLINK("x"), "quoted"',
    generationId: null,
  };
  it("starts with a UTF-8 BOM and header row", () => {
    const csv = toCsv([row]);
    expect(csv.startsWith("﻿time,model,")).toBe(true);
  });
  it("neutralises formulas and escapes quotes", () => {
    const line = toCsv([row]).split("\r\n")[1];
    expect(line).toContain(`"'=HYPERLINK(""x""), ""quoted"""`);
  });
});
