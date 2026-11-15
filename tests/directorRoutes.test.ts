import { beforeEach, describe, expect, it, vi } from "vitest";
import charFixture from "@/lib/__fixtures__/character.nurse_young_f.llm.json";
import episodeFixture from "@/lib/__fixtures__/episode.nurse.llm.json";
import { OpenRouterError } from "@/lib/openrouter/errors";

vi.mock("@/lib/openrouter/client", () => ({
  chatComplete: vi.fn(),
  listTextModels: vi.fn(async () => [
    { id: "test/planner-model", architecture: { output_modalities: ["text"] } },
    { id: "google/gemini-9.9-pro", architecture: { output_modalities: ["text"] } },
  ]),
}));

const { chatComplete } = await import("@/lib/openrouter/client");
const { POST: episodePost } = await import("@/app/api/episode/route");
const { POST: assetPost } = await import("@/app/api/asset/route");
const { _resetPlannerCache } = await import("@/lib/openrouter/askJson");
const { _resetRateLimit } = await import("@/lib/rateLimit");
const { FAKE_KEY } = await import("./helpers");

const chat = vi.mocked(chatComplete);
const reply = (x: unknown) => ({ content: typeof x === "string" ? x : JSON.stringify(x), generationId: "gen-1" });

function req(path: string, body: unknown, key: string | null = FAKE_KEY) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" };
  if (key) headers["x-openrouter-key"] = key;
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

const episodeBody = {
  text: "রাত তিনটা বাজে। আমার ফোনে মেসেজ এলো রহিম চাচার নম্বর থেকে।",
  genre: "horror",
  partTitle: "মৃত রোগীর মেসেজ",
  partIndex: 0,
  partsTotal: 3,
  hook: "পর্দার ওপাশে কাশি",
  isLast: false,
  characters: "মিতু, সাবিনা, রহিম চাচা",
  setting: "হাসপাতাল",
  librarySummary: "characters: old_man_lungi, young_woman_salwar",
  narrator: "female",
  previousCast: [{ id: "mitu", name: "মিতু", asset: "nurse_young_f", look: "nurse", voice: "female" }, "junk"],
};

beforeEach(() => {
  _resetRateLimit();
  _resetPlannerCache();
  chat.mockReset();
});

describe("POST /api/episode", () => {
  it("401 without key, 400 without text, never calls the model", async () => {
    expect((await episodePost(req("/api/episode", episodeBody, null))).status).toBe(401);
    expect((await episodePost(req("/api/episode", { ...episodeBody, text: "" }))).status).toBe(400);
    expect((await episodePost(req("/api/episode", "{bad"))).status).toBe(400);
    expect(chat).not.toHaveBeenCalled();
  });

  it("success: strict schema + response-healing, returns normalized plan", async () => {
    chat.mockResolvedValueOnce(reply(episodeFixture));
    const res = await episodePost(req("/api/episode", episodeBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.model).toBe("google/gemini-9.9-pro");
    expect(json.warnings).toEqual([]);
    expect(json.plan.version).toBe(2);
    expect(json.plan.shots.length).toBe(episodeFixture.shots.length);
    const call = chat.mock.calls[0][0];
    expect(call.apiKey).toBe(FAKE_KEY);
    expect(call.responseFormat).toMatchObject({ type: "json_schema", json_schema: { name: "episode_plan", strict: true } });
    expect(call.plugins).toEqual([{ id: "response-healing" }]);
    expect(call.system).toContain("characters: old_man_lungi, young_woman_salwar");
    expect(call.system).toContain("mitu (মিতু): asset=nurse_young_f");
    expect(call.user).toContain(episodeBody.text);
  });

  it("falls back to json_object on HTTP 400 and reports it", async () => {
    chat.mockRejectedValueOnce(new OpenRouterError(400, "schema not supported"));
    chat.mockResolvedValueOnce(reply("```json\n" + JSON.stringify(episodeFixture) + "\n```"));
    const res = await episodePost(req("/api/episode", episodeBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0].responseFormat).toEqual({ type: "json_object" });
    expect(chat.mock.calls[1][0].plugins).toBeUndefined();
    expect(json.warnings.join(" ")).toMatch(/plain JSON/);
  });

  it("422 on bad JSON or no shots; upstream errors keep their status", async () => {
    chat.mockResolvedValueOnce(reply("sorry, I cannot"));
    expect((await episodePost(req("/api/episode", episodeBody))).status).toBe(422);
    chat.mockResolvedValueOnce(reply({ shots: [] }));
    expect((await episodePost(req("/api/episode", episodeBody))).status).toBe(422);
    chat.mockRejectedValueOnce(new OpenRouterError(402, "no credits"));
    const r = await episodePost(req("/api/episode", episodeBody));
    expect(r.status).toBe(402);
    expect((await r.json()).error).toBe("no credits");
  });
});

describe("POST /api/asset", () => {
  const body = { kind: "character", id: "Nurse Young F", look: "Bangladeshi nurse, 27, white uniform, navy cardigan" };

  it("400 for bad kind / id / look", async () => {
    expect((await assetPost(req("/api/asset", { ...body, kind: "vehicle" }))).status).toBe(400);
    expect((await assetPost(req("/api/asset", { ...body, id: "!!!" }))).status).toBe(400);
    expect((await assetPost(req("/api/asset", { ...body, look: "" }))).status).toBe(400);
    expect(chat).not.toHaveBeenCalled();
  });

  it("success on the first try", async () => {
    chat.mockResolvedValueOnce(reply(charFixture));
    const res = await assetPost(req("/api/asset", body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.asset.id).toBe("nurse_young_f");
    expect(json.warnings).toEqual([]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0].responseFormat).toMatchObject({ json_schema: { name: "character_asset", strict: true } });
  });

  it("retries once with the problems when the first answer is broken", async () => {
    chat.mockResolvedValueOnce(reply({ kind: "character", parts: [] }));
    chat.mockResolvedValueOnce(reply(charFixture));
    const res = await assetPost(req("/api/asset", body));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0].user).toMatch(/previous answer had these problems/);
    expect(chat.mock.calls[1][0].user).toMatch(/"body"/);
    expect(json.asset.parts.find((p: { name: string }) => p.name === "body").shapes.length).toBe(5);
    expect(json.warnings[0]).toMatch(/twice/);
  });

  it("400 fallback, then bad JSON twice → 422", async () => {
    chat.mockRejectedValueOnce(new OpenRouterError(400, "no schema"));
    chat.mockResolvedValueOnce(reply("not json"));
    chat.mockResolvedValueOnce(reply("still not json"));
    const res = await assetPost(req("/api/asset", body));
    expect(res.status).toBe(422);
    expect(chat.mock.calls[1][0].responseFormat).toEqual({ type: "json_object" });
  });

  it("keeps a usable first answer if the retry is bad JSON", async () => {
    chat.mockResolvedValueOnce(reply({ parts: [] }));
    chat.mockResolvedValueOnce(reply("oops"));
    const res = await assetPost(req("/api/asset", body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.asset.parts.length).toBe(6);
  });
});
