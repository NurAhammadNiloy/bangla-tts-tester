/**
 * Mock-OpenRouter end-to-end: real client + real routes, fetch stubbed to play
 * the /models and /chat/completions answers from the fixtures.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { POST as assetPost } from "@/app/api/asset/route";
import { POST as episodePost } from "@/app/api/episode/route";
import charFixture from "@/lib/__fixtures__/character.nurse_young_f.llm.json";
import episodeFixture from "@/lib/__fixtures__/episode.nurse.llm.json";
import placeFixture from "@/lib/__fixtures__/place.hospital_ward_night.llm.json";
import { _resetPlannerCache } from "@/lib/openrouter/askJson";
import type { CharacterAsset, EpisodePlan, PlaceAsset } from "@/lib/puppet/types";
import { _resetRateLimit } from "@/lib/rateLimit";
import { errorResponse, FAKE_KEY, mockFetch } from "./helpers";

const MODELS = { data: [{ id: "google/gemini-9.9-pro", architecture: { output_modalities: ["text"] }, supported_parameters: ["structured_outputs"] }] };

function server(answers: unknown[], { rejectSchema = false } = {}) {
  const queue = [...answers];
  return mockFetch((url, init) => {
    if (url.endsWith("/models")) return Response.json(MODELS);
    if (url.endsWith("/chat/completions")) {
      const body = JSON.parse(String(init.body));
      if (rejectSchema && body.response_format?.type === "json_schema") return errorResponse(400, "json_schema not supported");
      return Response.json({ id: "gen-e2e", choices: [{ message: { content: JSON.stringify(queue.shift()) } }] });
    }
    return new Response("not found", { status: 404 });
  });
}

function post(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-openrouter-key": FAKE_KEY },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  _resetRateLimit();
  _resetPlannerCache();
  vi.stubEnv("GOLPO_ALLOW_UNBOUND_PLAN", "1"); // explicit development path
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("director e2e (mock OpenRouter)", () => {
  it("plans the nurse episode", async () => {
    const { calls } = server([episodeFixture]);
    const res = await episodePost(
      post("/api/episode", {
        text: "রাত তিনটা বাজে। আমার ফোনে মেসেজ এলো এমন একজনের নম্বর থেকে, যাকে গত সপ্তাহে কবর দেওয়া হয়েছে।",
        genre: "horror", partTitle: "মৃত রোগীর মেসেজ", partIndex: 0, partsTotal: 3, hook: "পর্দার ওপাশে কাশি",
        isLast: false, characters: "মিতু, সাবিনা, রহিম চাচা", setting: "সরকারি হাসপাতাল", librarySummary: "props: phone", narrator: "female",
      }),
    );
    expect(res.status).toBe(200);
    const { plan, model, warnings } = (await res.json()) as { plan: EpisodePlan; model: string; warnings: string[] };
    expect(model).toBe("google/gemini-9.9-pro");
    expect(warnings).toEqual([]);
    expect(plan.series).toBe("বেড নম্বর ১২");
    expect(plan.cast.map((c) => c.id)).toEqual(["mitu", "rahim", "sabina"]);
    const chatCall = calls.find((c) => c.url.endsWith("/chat/completions"))!;
    expect(chatCall.body?.plugins).toEqual([{ id: "response-healing" }]);
    expect((chatCall.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
  });

  it("makes a character and a place (with the json_object fallback)", async () => {
    server([charFixture, placeFixture], { rejectSchema: true });
    const c = await assetPost(post("/api/asset", { kind: "character", id: "nurse_young_f", look: "young Bangladeshi nurse" }));
    expect(c.status).toBe(200);
    const cj = (await c.json()) as { asset: CharacterAsset; warnings: string[] };
    expect(cj.asset.parts).toHaveLength(9);
    expect(cj.warnings).toEqual([]);
    const p = await assetPost(post("/api/asset", { kind: "place", id: "hospital_ward_night", look: "hospital ward at night" }));
    expect(p.status).toBe(200);
    const pj = (await p.json()) as { asset: PlaceAsset };
    expect(pj.asset.size).toEqual([1620, 1920]);
    expect(pj.asset.layers.front).toHaveLength(2);
  });
});
