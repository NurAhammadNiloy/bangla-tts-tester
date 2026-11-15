import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  estimateSeconds,
  MAX_PART_SECONDS,
  normalizeOutline,
  normalizeScenes,
  partSeconds,
  pickPlannerModel,
  splitSentences,
  suggestCaption,
} from "@/lib/storyPlan";
import { POST as planPost } from "@/app/api/plan/route";
import { _resetRateLimit } from "@/lib/rateLimit";
import { FAKE_KEY, mockFetch } from "./helpers";

const long = (n: number) => Array.from({ length: n }, (_, i) => `বাক্য নম্বর ${i + 1} এখানে একটু লম্বা করে লেখা হলো যাতে সময় বাড়ে।`);

describe("story plan helpers", () => {
  it("splits Bangla sentences on দাঁড়ি, ? and !", () => {
    expect(splitSentences("আমি গেলাম। সে এলো? হ্যাঁ!\n\nশেষ।")).toEqual(["আমি গেলাম।", "সে এলো?", "হ্যাঁ!", "শেষ।"]);
  });

  it("estimates time without counting tags", () => {
    expect(estimateSeconds("[sad] আমি")).toBe(estimateSeconds("আমি"));
  });

  it("makes continuous parts that cover every sentence", () => {
    const s = long(30);
    const plan = normalizeOutline(
      { title: "t", genre: "horror", parts: [{ title: "a", firstSentence: 1 }, { title: "b", firstSentence: 12 }, { title: "c", firstSentence: 25, hook: "x" }] },
      s,
    );
    expect(plan.genre).toBe("horror");
    expect(plan.parts.map((p) => [p.from, p.to])).toEqual([[1, 11], [12, 24], [25, 30]]);
  });

  it("adds a first part when the AI skips the start, and falls back on unknown genre", () => {
    const plan = normalizeOutline({ genre: "nope", parts: [{ title: "b", firstSentence: 5 }] }, long(10));
    expect(plan.genre).toBe("emotional");
    expect(plan.parts[0].from).toBe(1);
    expect(plan.parts.at(-1)!.to).toBe(10);
  });

  it("never lets a part go over 6 minutes", () => {
    const s = long(400);
    const plan = normalizeOutline({ parts: [{ title: "all", firstSentence: 1 }] }, s);
    expect(plan.parts.length).toBeGreaterThan(1);
    for (const p of plan.parts) expect(partSeconds(plan, p)).toBeLessThanOrEqual(MAX_PART_SECONDS);
    expect(plan.parts.at(-1)!.to).toBe(400);
  });

  it("keeps only valid scenes and drops unknown tags", () => {
    const sc = normalizeScenes({ scenes: [{ narration: "[sad] আমি [zzz] গেলাম", picture: "a girl" }, { narration: "", picture: "x" }] });
    expect(sc).toHaveLength(1);
    expect(sc[0].narration).not.toContain("zzz");
    expect(() => normalizeScenes({ scenes: [] })).toThrow();
  });

  it("picks a strong text model with structured output", () => {
    expect(
      pickPlannerModel([
        { id: "google/gemini-2.5-flash-lite", supported_parameters: ["structured_outputs"] },
        { id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"] },
        { id: "google/gemini-2.5-pro", supported_parameters: ["tools"] },
      ]),
    ).toBe("google/gemini-2.5-flash");
  });

  it("matches subtitle style to story and art", () => {
    expect(suggestCaption("horror", "minimal")).toBe("clean");
    expect(suggestCaption("scifi", "flat")).toBe("clean");
    expect(suggestCaption("emotional", "anime")).toBe("box");
    expect(suggestCaption("emotional", "explainer")).toBe("headline");
    expect(suggestCaption("explainer", "flat")).toBe("headline");
  });
});

describe("POST /api/plan", () => {
  beforeEach(() => _resetRateLimit());
  afterEach(() => vi.unstubAllGlobals());

  const req = (body: unknown) =>
    new Request("http://localhost/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json", "x-openrouter-key": FAKE_KEY, "x-forwarded-for": "9.9.9.9" },
      body: JSON.stringify(body),
    });

  function handler(content: unknown) {
    return (url: string) => {
      if (url.includes("/models"))
        return Response.json({ data: [{ id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"], architecture: { output_modalities: ["text"] } }] });
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
    };
  }

  it("plans an outline", async () => {
    const story = long(20).join(" ");
    const { calls } = mockFetch(handler({ title: "গল্প", genre: "drama", characters: "", setting: "", parts: [{ title: "a", firstSentence: 1 }, { title: "b", firstSentence: 10, hook: "h" }] }));
    const res = await planPost(req({ mode: "outline", story }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.plan.parts).toHaveLength(2);
    const chat = calls.find((c) => c.url.includes("/chat/completions"))!;
    expect((chat.body!.response_format as { type: string }).type).toBe("json_schema");
  });

  it("plans scenes for one part", async () => {
    mockFetch(handler({ scenes: [{ narration: "আমি গেলাম।", picture: "girl walks", speaker: "", titleTag: "" }] }));
    const res = await planPost(req({ mode: "scenes", text: "আমি গেলাম।", genre: "drama", characters: "", setting: "", partTitle: "a", hook: "", isLast: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).scenes).toHaveLength(1);
  });

  it("401 without a key", async () => {
    const { calls } = mockFetch(handler({}));
    const res = await planPost(new Request("http://localhost/api/plan", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
