import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as biblePost } from "@/app/api/bible/route";
import { POST as episodePost } from "@/app/api/episode/route";
import { _resetPlannerCache } from "@/lib/openrouter/askJson";
import { _resetRateLimit } from "@/lib/rateLimit";
import { pickFastPlannerModel } from "@/lib/storyPlan";
import {
  BIBLE_SCHEMA,
  bibleToPrompt,
  enforceBible,
  estimateCost,
  foldText,
  inStory,
  matchCharacter,
  approveSection,
  mergeSection,
  normalizeBible,
  SECTIONS,
  overSpendLimit,
  runAccuracyGate,
  type StoryBible,
} from "@/lib/storyBible";
import type { EpisodePlan } from "@/lib/puppet/types";
import { FAKE_KEY, mockFetch } from "./helpers";
import { strictProblems } from "./strictSchema";

const STORY =
  "রহিমা খালা একা থাকেন। তাঁর একমাত্র ছেলে মিজান মালয়েশিয়ায় থাকে। তিন বছর ধরে তার কোনো ফোন আসেনি। ঘরের মিটারে লেখা ১৬ ইউনিট। \"মা, আমি ভালো আছি\" — একদিন চিঠি এল।";

const raw = {
  message: "A mother waits.",
  characters: [
    { id: "rahima", name: "রহিমা", mentions: ["রহিমা খালা"], relation: "mother of Mizan", look: "old woman", facts: [
      { kind: "confirmed", text: "lives alone", source: "রহিমা খালা একা থাকেন।" },
      { kind: "confirmed", text: "has two sons", source: "তার দুই ছেলে আছে" },
    ] },
    { id: "mizan", name: "মিজান", mentions: ["মিজান"], relation: "only son, in Malaysia", look: "young man", facts: [] },
    { id: "ghost", name: "রাহুল", mentions: ["রাহুল"], relation: "invented", look: "boy", facts: [] },
  ],
  places: [{ id: "room", name: "ঘর", description: "empty room with a fan", who: "nobody" }],
  events: [{ kind: "confirmed", text: "no call for 3 years", source: "তিন বছর ধরে তার কোনো ফোন আসেনি।" }],
  key_lines: [
    { text: "মা, আমি ভালো আছি", speaker: "mizan" },
    { text: "এই লাইন গল্পে নেই", speaker: "narrator" },
  ],
  key_numbers: [
    { value: "১৬", meaning: "meter units" },
    { value: "৯৯", meaning: "invented" },
  ],
  key_moments: [{ part: 0, text: "the meter", source: "ঘরের মিটারে লেখা ১৬ ইউনিট।" }],
  ending: "fade to black",
  pacing: "slow",
  prohibited: [{ kind: "confirmed", text: "Mizan never returns home", source: "" }],
};

describe("text matching", () => {
  it("folds digits, spaces, quotes and zero-width marks", () => {
    expect(foldText("১৬  ইউনিট‌")).toBe("16 ইউনিট");
    expect(inStory(STORY, "রহিমা   খালা একা থাকেন")).toBe(true);
    expect(inStory(STORY, "16 ইউনিট")).toBe(true);
    expect(inStory(STORY, "")).toBe(false);
    expect(inStory(STORY, "রাহুল")).toBe(false);
  });
});

describe("Story Accuracy Gate", () => {
  const { bible, report } = runAccuracyGate(normalizeBible(raw), STORY);

  it("removes characters never named in the story", () => {
    expect(bible.characters.map((c) => c.id)).toEqual(["rahima", "mizan"]);
    expect(report.notes.join(" ")).toMatch(/রাহুল/);
  });
  it("marks claims by evidence instead of silently downgrading them", () => {
    const facts = bible.characters[0].facts;
    expect(facts[0].check?.status).toBe("verified");
    // "has two sons": the story never says two, so it is not backed — and the AI's kind is left alone.
    expect(facts[1].check?.status).toBe("unverified");
    expect(facts[1].check?.reason).toMatch(/never says 2/);
    expect(facts[1].kind).toBe("confirmed");
    expect(bible.events[0].check?.status).toBe("verified");
  });
  it("drops key lines and numbers that are not in the story", () => {
    expect(bible.keyLines.map((l) => l.text)).toEqual(["মা, আমি ভালো আছি"]);
    expect(bible.keyNumbers.map((n) => n.value)).toEqual(["১৬"]);
    expect(report.removed).toBe(3);
    expect(report.unverified).toBe(2); // "has two sons" + the place with no passage
  });
  it("forces prohibited facts to the prohibited_change kind", () => {
    expect(bible.prohibited[0].kind).toBe("prohibited_change");
  });
  it("trusts what the user wrote", () => {
    const b = normalizeBible({ ...raw, characters: [{ id: "x", name: "নতুন", mentions: ["নতুন"], by: "user" }], key_numbers: [] });
    expect(runAccuracyGate(b, STORY).bible.characters).toHaveLength(1);
  });
  it("normalizeBible survives junk", () => {
    expect(normalizeBible(null).characters).toEqual([]);
    expect(normalizeBible({ characters: "x", events: [1, null, { text: "" }] }).events).toEqual([]);
  });
  it("the JSON schema is strict-mode safe", () => {
    expect(strictProblems(BIBLE_SCHEMA)).toEqual([]);
  });
});

describe("bible → shots", () => {
  const bible: StoryBible = { ...runAccuracyGate(normalizeBible(raw), STORY).bible, userDirection: "keep it slow" };

  it("writes only checked facts as FACT and lists the cast, prohibitions and direction", () => {
    const p = bibleToPrompt(bible, 0);
    expect(p).toMatch(/rahima = রহিমা/);
    expect(p).toMatch(/FACT: lives alone/);
    expect(p).toMatch(/unchecked: has two sons/);
    expect(p).toMatch(/NEVER[\s\S]*Mizan never returns home/);
    expect(p).toMatch(/Key scenes of THIS part[\s\S]*K1\. the meter/);
    expect(p).toMatch(/keep it slow/);
    expect(bibleToPrompt(bible, 1)).not.toMatch(/Key scenes of THIS part/);
  });

  it("matches cast to bible characters by id, name or mention", () => {
    expect(matchCharacter({ id: "rahima_khala", name: "রহিমা খালা" }, bible)?.id).toBe("rahima");
    expect(matchCharacter({ id: "mizan", name: "x" }, bible)?.id).toBe("mizan");
    expect(matchCharacter({ id: "son2", name: "কবির" }, bible)).toBeNull();
  });

  it("removes unknown cast from every shot and warns about missing numbers", () => {
    const plan = {
      version: 2,
      series: "s",
      episode: 1,
      title: "t",
      caption: "c",
      mood: "emotional",
      format: "9:16",
      cast: [
        { id: "rahima", name: "রহিমা", asset: "a", look: "l", voice: "female_old" },
        { id: "kabir", name: "কবির", asset: "a", look: "l", voice: "male" },
      ],
      places: [{ id: "yard", asset: "yard", look: "l", time: "day" }],
      shots: [
        { line: "এক", speaker: "kabir", place: "yard", camera: { shot: "wide", move: "hold", focus: "kabir" }, actors: [{ id: "kabir", x: 0.5, action: "stand", face: "neutral" }, { id: "rahima", x: 0.2, action: "stand", face: "neutral" }] },
      ],
      end: { type: "the_end", text: "শেষ" },
    } as unknown as EpisodePlan;
    const warnings: string[] = [];
    const out = enforceBible(plan, bible, warnings);
    expect(out.cast.map((c) => c.id)).toEqual(["rahima"]);
    expect(out.shots[0].speaker).toBe("narrator");
    expect(out.shots[0].actors?.map((a) => a.id)).toEqual(["rahima"]);
    expect(out.shots[0].camera.focus).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/kabir/);
    expect(warnings.join(" ")).toMatch(/১৬/);
  });
});

describe("cost + model choice", () => {
  it("adds up the lines", () => {
    const c = estimateCost({ newCharacters: 2, newPlaces: 1, voiceMinutes: 1 });
    expect(c.lines.map((l) => l.label)).toEqual(["Planning", "Pictures", "Voice", "Animation", "Retries"]);
    expect(c.total).toBeCloseTo(c.lines.reduce((a, l) => a + l.usd, 0));
  });
  it("picks a flash model from the live list only", () => {
    const m = (id: string) => ({ id, supported_parameters: ["structured_outputs"] });
    expect(pickFastPlannerModel([m("google/gemini-9-flash-lite"), m("google/gemini-3-flash-preview"), m("google/gemini-3.5-flash")])).toBe("google/gemini-3.5-flash");
    expect(pickFastPlannerModel([m("openai/gpt-5")])).toBeNull();
  });
});

describe("per-card regenerate", () => {
  it("replaces one card and keeps the rest", () => {
    const a = normalizeBible(raw);
    const b = normalizeBible({ ...raw, ending: "new ending", message: "new message" });
    const m = mergeSection({ ...a, approvedAt: 5 }, b, "ending");
    expect(m.ending).toBe("new ending");
    expect(m.message).toBe("A mother waits.");
    expect(m.approvedAt).toBeUndefined();
  });
});

describe("routes", () => {
  beforeEach(() => {
    _resetRateLimit();
    _resetPlannerCache();
  });
  afterEach(() => _resetPlannerCache());

  const req = (url: string, body: unknown) =>
    new Request(`http://x${url}`, { method: "POST", headers: { "content-type": "application/json", "x-openrouter-key": FAKE_KEY }, body: JSON.stringify(body) });
  const models = { data: [{ id: "google/gemini-3-pro", supported_parameters: ["structured_outputs"] }, { id: "google/gemini-3-flash", supported_parameters: ["structured_outputs"] }] };
  const chat = (obj: unknown) => new Response(JSON.stringify({ id: "g", choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });

  it("/api/bible returns a gated bible", async () => {
    mockFetch((url) => (url.endsWith("/models") ? Response.json(models) : chat(raw)));
    const res = await biblePost(req("/api/bible", { text: STORY, genre: "emotional", partsTotal: 1 }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.bible.characters).toHaveLength(2);
    expect(j.report.removed).toBe(3);
  });

  it("/api/bible rejects an empty story", async () => {
    const res = await biblePost(req("/api/bible", { text: " " }));
    expect(res.status).toBe(400);
  });

  it("/api/episode sends the bible to the planner and strips unknown cast", async () => {
    const gated = runAccuracyGate(normalizeBible(raw), STORY).bible;
    const unapproved = await episodePost(req("/api/episode", { text: STORY, genre: "emotional", bible: gated, fast: true }));
    expect(unapproved.status).toBe(409); // never plan from an unapproved bible
    const bible = SECTIONS.reduce((b, sec) => approveSection(b, sec), gated);
    const episode = {
      understanding: { summary: "s", people: [], places: [], key_moments: [], never_show: [] },
      series: "s", episode: 1, title: "t", caption: "c", mood: "emotional", format: "9:16",
      cast: [
        { id: "rahima", name: "রহিমা", asset: "old_woman", look: "old woman", voice: "female_old", new: true },
        { id: "kabir", name: "কবির", asset: "man", look: "man", voice: "male", new: true },
      ],
      places: [{ id: "room", asset: "room", look: "room", time: "day", weather: "clear", label: "", new: true }],
      props: [],
      shots: [{
        line: "রহিমা খালা একা থাকেন।", speaker: "kabir", place: "room", layout: "single",
        actors: [{ id: "kabir", x: 0.5, action: "stand", face: "neutral", facing: "left", toX: 0.5, prop: "" }],
        top: { place: "", actors: [] }, bottom: { place: "", actors: [] },
        screen: { type: "none" }, camera: { shot: "wide", move: "hold", focus: "" }, transition: "cut", sfx: [], bubble: false, pause: 0, hook: true, props: [],
      }],
      end: { type: "the_end", text: "শেষ" },
    };
    const { calls } = mockFetch((url) => (url.endsWith("/models") ? Response.json(models) : chat(episode)));
    const res = await episodePost(req("/api/episode", { text: STORY, genre: "emotional", bible, fast: true }));
    expect(res.status).toBe(200);
    const j = await res.json();
    const chatCall = calls.find((c) => c.url.includes("chat/completions"));
    expect(JSON.stringify(chatCall?.body)).toMatch(/STORY BIBLE/);
    expect(chatCall?.body?.model).toBe("google/gemini-3-flash"); // fast model used
    expect(j.plan.cast.map((c: { id: string }) => c.id)).toEqual(["rahima"]);
    expect(j.warnings.join(" ")).toMatch(/kabir/);
  });
});

describe("empty places and spending limit", () => {
  const bible = normalizeBible({
    message: "m",
    characters: [{ id: "rahima", name: "রহিমা", mentions: ["রহিমা"], relation: "mother", look: "old", facts: [] }],
    places: [{ id: "empty_room", name: "খালি ঘর", description: "room with a fan", who: "nobody" }],
    events: [], key_moments: [], ending: "", pacing: "", prohibited: [],
  });
  const plan = {
    version: 2, series: "s", episode: 1, title: "t", caption: "c", mood: "emotional", format: "9:16",
    cast: [{ id: "rahima", name: "রহিমা", asset: "old_woman", look: "", voice: "female_old" }],
    places: [{ id: "empty_room", asset: "home_room", look: "", time: "night" }, { id: "yard", asset: "yard", look: "", time: "day" }],
    shots: [
      { line: "ঘরটা ফাঁকা।", speaker: "narrator", place: "empty_room", camera: { shot: "wide", move: "hold" }, actors: [{ id: "rahima", x: 0.5, action: "idle", face: "sad" }] },
      { line: "উঠোনে রহিমা।", speaker: "narrator", place: "yard", camera: { shot: "wide", move: "hold" }, actors: [{ id: "rahima", x: 0.5, action: "idle", face: "sad" }] },
    ],
    end: { type: "the_end", text: "শেষ" },
  } as unknown as EpisodePlan;

  it("removes people from a place the bible says is empty, and only there", () => {
    const warnings: string[] = [];
    const out = enforceBible(plan, bible, warnings);
    expect(out.shots[0].actors).toEqual([]);
    expect(out.shots[1].actors).toHaveLength(1);
    expect(warnings.join(" ")).toMatch(/empty place/);
  });
  it("blocks only when the estimate is above a limit above zero", () => {
    expect(overSpendLimit(1.2, 1)).toBe(true);
    expect(overSpendLimit(0.8, 1)).toBe(false);
    expect(overSpendLimit(5, 0)).toBe(false);
  });
});
