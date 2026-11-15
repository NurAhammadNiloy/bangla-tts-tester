import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as autotagPost } from "@/app/api/autotag/route";
import { verifyAutotag } from "@/lib/autotag";
import { SAMPLE_STORY } from "@/lib/bengali";
import { _resetRateLimit } from "@/lib/rateLimit";
import { validateTtsInput } from "@/lib/validation";
import {
  allowedTags, countTags, insertTag, sanitizeTags, separateAdjacentTags, STYLE_PRESETS, stripTags, tagFamilyFor, utf8Bytes,
} from "@/lib/voiceDirector";
import { FAKE_KEY, mockFetch } from "./helpers";

describe("voice director", () => {
  it("maps models to tag families", () => {
    expect(tagFamilyFor("google/gemini-3.8-flash-tts")).toBe("gemini");
    expect(tagFamilyFor("google/gemini-3.1-flash-tts-preview")).toBe("gemini");
    expect(tagFamilyFor("elevenlabs/eleven-v3")).toBe("elevenlabs");
    expect(tagFamilyFor("elevenlabs/eleven-v4-turbo")).toBe("elevenlabs");
    expect(tagFamilyFor("elevenlabs/eleven-multilingual-v2")).toBe("none");
  });

  it("presets carry a Bangladeshi accent note and avoid flatness words", () => {
    for (const p of STYLE_PRESETS) {
      expect(p.instructions).toMatch(/Bangladesh/);
      expect(p.instructions.toLowerCase()).not.toMatch(/\b(quiet|flat|monotone|careful)\b/);
      expect(utf8Bytes(p.instructions)).toBeLessThan(4000);
    }
  });

  it("insertTag inserts at the cursor with spacing", () => {
    expect(insertTag("আমি তুমি", 4, "sad")).toEqual({ text: "আমি [sad] তুমি", cursor: 10 });
    expect(insertTag("", 0, "whispers").text).toBe("[whispers] ");
    expect(insertTag("[sad] আমি", 6, "hope").text).toBe("[sad], [hope] আমি");
    expect(separateAdjacentTags("[tension] [long pause] বারো")).toBe("[tension], [long pause] বারো");
  });

  it("sanitizeTags drops unknown tags and adjacent duplicates", () => {
    const out = sanitizeTags("[SAD] [hope] আমি [dancing] যাই", allowedTags("gemini"));
    expect(out).toBe("[sad] আমি যাই");
  });

  it("sample story only uses allowed Gemini tags and no adjacent tags", () => {
    expect(sanitizeTags(SAMPLE_STORY, allowedTags("gemini"))).toBe(SAMPLE_STORY);
    expect(countTags(SAMPLE_STORY)).toBe(7);
  });

  it("stripTags ignores tags and whitespace", () => {
    expect(stripTags("[sad] আমি  [long pause] যাই")).toBe(stripTags("আমি যাই"));
  });
});

describe("verifyAutotag", () => {
  const orig = "মা দরজায় বসে ছিলেন। হঠাৎ শব্দ হলো।";
  it("accepts insert-only output and cleans fences", () => {
    const r = verifyAutotag(orig, "```\n[sad] মা দরজায় বসে ছিলেন। [gasp] হঠাৎ শব্দ হলো।\n```", "gemini");
    expect(r).toEqual({ ok: true, text: "[sad] মা দরজায় বসে ছিলেন। [gasp] হঠাৎ শব্দ হলো।", tags: 2 });
  });
  it("rejects output that changed words", () => {
    expect(verifyAutotag(orig, "[sad] মা দরজায় বসেছিলেন। হঠাৎ শব্দ হল।", "gemini").ok).toBe(false);
  });
});

describe("Gemini byte limit", () => {
  it("rejects Gemini text over 4000 bytes but allows it for ElevenLabs", () => {
    const long = "আ".repeat(1400); // 4200 bytes
    expect(validateTtsInput({ model: "google/gemini-3.8-flash-tts", text: long }).ok).toBe(false);
    expect(validateTtsInput({ model: "elevenlabs/eleven-v3", text: long }).ok).toBe(true);
  });
});

describe("POST /api/autotag", () => {
  beforeEach(() => _resetRateLimit());
  afterEach(() => vi.unstubAllGlobals());
  const req = (body: unknown, key: string | null = FAKE_KEY) =>
    new Request("http://localhost/api/autotag", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "x-openrouter-key": key } : {}) },
      body: JSON.stringify(body),
    });
  const text = "মা দরজায় বসে ছিলেন। হঠাৎ শব্দ হলো।";

  it("tags text with a helper model chosen from the live list", async () => {
    const { calls } = mockFetch((url) => {
      if (url.endsWith("/models")) return Response.json({ data: [{ id: "google/gemini-3.1-flash-lite", architecture: { output_modalities: ["text"] } }] });
      return Response.json({ choices: [{ message: { content: "[sad] মা দরজায় বসে ছিলেন। [gasp] হঠাৎ শব্দ হলো।" } }] });
    });
    const res = await autotagPost(req({ text, ttsModel: "google/gemini-3.8-flash-tts", presetId: "horror" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tags: 2, helperModel: "google/gemini-3.1-flash-lite" });
    const chat = calls.find((c) => c.url.endsWith("/chat/completions"))!;
    expect(chat.body?.model).toBe("google/gemini-3.1-flash-lite");
    expect(String((chat.body?.messages as { content: string }[])[0].content)).toMatch(/tension/);
  });

  it("422 when the model rewrites the text; 400 for unsupported TTS model; 401 without key", async () => {
    mockFetch((url) =>
      url.endsWith("/models")
        ? Response.json({ data: [{ id: "google/gemini-3.1-flash-lite" }] })
        : Response.json({ choices: [{ message: { content: "সম্পূর্ণ নতুন লেখা" } }] }),
    );
    expect((await autotagPost(req({ text, ttsModel: "google/gemini-3.8-flash-tts" }))).status).toBe(422);
    expect((await autotagPost(req({ text, ttsModel: "deepgram/aura-2" }))).status).toBe(400);
    expect((await autotagPost(req({ text, ttsModel: "google/gemini-3.8-flash-tts" }, null))).status).toBe(401);
  });
});
