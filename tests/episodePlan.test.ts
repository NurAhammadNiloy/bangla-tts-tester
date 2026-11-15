import { describe, expect, it } from "vitest";
import fixture from "@/lib/__fixtures__/episode.nurse.llm.json";
import {
  buildEpisodePrompt,
  cleanLine,
  EPISODE_SCHEMA,
  MAX_DIALOGUE_WORDS,
  MAX_NARRATION_WORDS,
  normalizeEpisode,
  SFX,
  splitLine,
  wordCount,
  type EpisodeContext,
} from "@/lib/episodePlan";
import type { CastMember, EpisodePlan, PlaceRef } from "@/lib/puppet/types";
import { strictProblems } from "./strictSchema";

const ctx: EpisodeContext = {
  genre: "horror",
  partTitle: "মৃত রোগীর মেসেজ",
  partIndex: 0,
  partsTotal: 3,
  hook: "পর্দার ওপাশে কাশির শব্দ",
  isLast: false,
  characters: "মিতু (নার্স), সাবিনা (নার্স), রহিম চাচা (মৃত রোগী)",
  setting: "ঢাকার সরকারি হাসপাতাল, রাত",
  librarySummary: "characters: old_man_lungi (old man, lungi), young_woman_salwar (young woman)\nplaces: office_desk, corridor\nprops: phone",
  narrator: "female",
};

const clone = <T,>(x: T): T => structuredClone(x);
function shotsOf(p: EpisodePlan) {
  return p.shots;
}

describe("EPISODE_SCHEMA", () => {
  it("is strict everywhere (additionalProperties false, required = all keys)", () => {
    expect(strictProblems(EPISODE_SCHEMA)).toEqual([]);
  });
  it("screen has a type enum with none and every ScreenSpec type", () => {
    const screen = EPISODE_SCHEMA.properties.shots.items.properties.screen;
    expect(screen.properties.type.enum).toEqual(
      expect.arrayContaining(["none", "notification", "incoming_call", "video_call", "chat", "letter", "tv_news", "calendar", "map", "photo", "text_card"]),
    );
  });
  it("sfx enum is exactly the allowed list", () => {
    expect(EPISODE_SCHEMA.properties.shots.items.properties.sfx.items.enum).toEqual([...SFX]);
  });
});

describe("buildEpisodePrompt", () => {
  const p = buildEpisodePrompt(ctx);
  it("contains the key director rules and the library summary", () => {
    expect(p).toContain(ctx.librarySummary);
    expect(p).toMatch(/first 3 seconds/i);
    expect(p).toContain("এক গ্রামে");
    expect(p).toContain(`dialogue at most ${MAX_DIALOGUE_WORDS} words`);
    expect(p).toContain(`narration at most ${MAX_NARRATION_WORDS} words`);
    expect(p).toMatch(/Every 4–6 shots/);
    expect(p).toMatch(/Never the same camera.shot twice in a row/);
    expect(p).toMatch(/layout "split"/);
    expect(p).toMatch(/dip_black/);
    expect(p).toContain("scare_sting");
    expect(p).toMatch(/HORROR/);
    expect(p).toContain("পরের পর্ব দেখুন");
    expect(p).toContain("পর্ব 1");
    expect(p).toMatch(/new = true/);
  });
  it("last part asks for the_end; previous cast and places are listed for reuse", () => {
    const cast: CastMember[] = [{ id: "mitu", name: "মিতু", asset: "nurse_young_f", look: "young nurse", voice: "female" }];
    const places: PlaceRef[] = [{ id: "ward_night", asset: "hospital_ward_night", look: "ward", time: "night" }];
    const q = buildEpisodePrompt({ ...ctx, isLast: true, partIndex: 2, previousCast: cast, previousPlaces: places, genre: "comedy" });
    expect(q).toContain("the_end");
    expect(q).toContain("শেষ");
    expect(q).toContain("mitu (মিতু): asset=nurse_young_f");
    expect(q).toContain("ward_night: asset=hospital_ward_night");
    expect(q).toContain("laugh_boing");
    expect(q).not.toContain("HORROR");
  });
});

describe("line helpers", () => {
  it("cleanLine keeps short voice tags, drops junk and adjacent tags", () => {
    expect(cleanLine("  [SAD]  আমি   [whispers] [gasp] যাব [১২৩]  ")).toBe("[sad] আমি [whispers] যাব");
  });
  it("splitLine splits at sentence ends, then commas, then even chunks", () => {
    const long = "এক দুই তিন চার পাঁচ ছয়। সাত আট নয় দশ এগারো বারো তেরো চোদ্দ পনেরো ষোল সতেরো আঠারো উনিশ কুড়ি।";
    const parts = splitLine(long, 12);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((x) => wordCount(x) <= 12)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
    const noPunct = Array.from({ length: 30 }, (_, i) => `শব্দ${i}`).join(" ");
    const p2 = splitLine(noPunct, 12);
    expect(p2).toHaveLength(3);
    expect(p2.every((x) => wordCount(x) <= 12)).toBe(true);
  });
});

describe("normalizeEpisode", () => {
  it("good fixture → exact plan with no warnings", () => {
    const w: string[] = [];
    const plan = normalizeEpisode(clone(fixture), ctx, w);
    expect(w).toEqual([]);
    expect(plan.version).toBe(2);
    expect(plan.episode).toBe(1);
    expect(plan.mood).toBe("horror");
    expect(plan.end).toEqual({ type: "next_part", text: "পরের পর্ব দেখুন" });
    expect(plan.shots[0].hook).toBe(true);
    expect(plan.shots[0].screen?.type).toBe("notification");
    const chat = plan.shots.find((s) => s.screen?.type === "chat")!;
    expect(chat.line).toBe("");
    expect(chat.pause).toBeGreaterThanOrEqual(1.5);
    // strict "empty" fields are gone from the TS shape
    for (const s of plan.shots) {
      expect(s.top).toBeUndefined();
      expect(s.screen?.type).not.toBe("none");
      if (s.speaker === "narrator") expect(s.bubble).toBe(false);
      else expect(s.bubble).toBe(true);
    }
    expect(plan.places.find((p) => p.id === "corridor_night")?.weather).toBe("fog");
    expect(plan.places.find((p) => p.id === "nurse_station")?.weather).toBeUndefined();
    expect(plan.cast.find((c) => c.id === "rahim")?.new).toBeUndefined();
    expect(plan.cast.find((c) => c.id === "mitu")?.new).toBe(true);
    const photo = plan.shots.find((s) => s.screen?.type === "photo")!.screen as { who: string[] };
    expect(photo.who).toEqual(["rahim", "mitu"]);
  });

  it("splits overlong lines into extra shots with a different camera shot", () => {
    const o = clone(fixture);
    const longLine =
      "সেদিন রাতে আমি একা একা ওয়ার্ডের শেষ মাথা পর্যন্ত হেঁটে গেলাম, কারণ আমার মনে হচ্ছিল কেউ আমার নাম ধরে খুব আস্তে আস্তে ডাকছে আর সেই ডাক ক্রমশ কাছে আসছে";
    o.shots[3].line = longLine;
    const w: string[] = [];
    const plan = normalizeEpisode(o, ctx, w);
    expect(plan.shots.length).toBeGreaterThan(fixture.shots.length);
    expect(w.join(" ")).toMatch(/split/);
    for (const s of plan.shots) {
      expect(wordCount(s.line)).toBeLessThanOrEqual(s.speaker === "narrator" ? MAX_NARRATION_WORDS : MAX_DIALOGUE_WORDS);
    }
    const i = plan.shots.findIndex((s) => longLine.startsWith(s.line) && s.line);
    expect(plan.shots[i + 1].camera.shot).not.toBe(plan.shots[i].camera.shot);
    expect(plan.shots[i + 1].sfx).toBeUndefined();
    expect(plan.shots[i + 1].actors).toEqual(plan.shots[i].actors);
  });

  it("never keeps the same camera shot twice in a row", () => {
    const o = clone(fixture);
    for (const s of o.shots) s.camera.shot = "close";
    const w: string[] = [];
    const plan = normalizeEpisode(o, ctx, w);
    for (let i = 1; i < plan.shots.length; i++) expect(plan.shots[i].camera.shot).not.toBe(plan.shots[i - 1].camera.shot);
    expect(w.join(" ")).toMatch(/repeated camera/);
  });

  it("unknown enums fall back to defaults and sfx are filtered", () => {
    const o = clone(fixture) as unknown as { shots: Record<string, unknown>[]; mood: string; format: string };
    o.mood = "space opera";
    o.format = "16:9";
    o.shots[1] = {
      ...o.shots[1],
      camera: { shot: "dutch_angle", move: "spin", focus: "nobody" },
      transition: "star_wipe",
      sfx: ["explosion", "heartbeat", "heartbeat"],
      actors: [{ id: "mitu", x: 7, action: "moonwalk", face: "smug", facing: "up", toX: 0, prop: "lightsaber" }],
    };
    const plan = normalizeEpisode(o, ctx);
    const s = plan.shots[1];
    expect(plan.mood).toBe("horror");
    expect(plan.format).toBe("9:16");
    expect(s.camera.move).toBe("hold");
    expect(s.camera.focus).toBeUndefined();
    expect(s.transition).toBe("cut");
    expect(s.sfx).toEqual(["heartbeat"]);
    expect(s.actors).toEqual([{ id: "mitu", x: 1, action: "idle", face: "neutral", facing: "left" }]);
  });

  it("fixes speaker refs: names map to ids, unknown → narrator", () => {
    const o = clone(fixture);
    o.shots[5].speaker = "সাবিনা";
    o.shots[6].speaker = "ghost";
    const w: string[] = [];
    const plan = normalizeEpisode(o, ctx, w);
    expect(plan.shots[5].speaker).toBe("sabina");
    expect(plan.shots[6].speaker).toBe("narrator");
    expect(plan.shots[6].bubble).toBe(false);
    expect(w.join(" ")).toMatch(/unknown speaker/);
  });

  it("drops invalid screens and split layouts, keeps the shot", () => {
    const o = clone(fixture) as unknown as { shots: Record<string, unknown>[] };
    o.shots[4] = { ...o.shots[4], screen: { type: "map", from: "ঢাকা", to: "" }, layout: "split", top: { place: "nowhere", actors: [] } };
    const plan = normalizeEpisode(o, ctx);
    expect(plan.shots[4].screen).toBeUndefined();
    expect(plan.shots[4].layout).toBe("single");
  });

  it("missing fields: builds a minimal valid plan; reuses previous cast/places", () => {
    const prevCast: CastMember[] = [{ id: "mitu", name: "মিতু", asset: "nurse_young_f", look: "young nurse", voice: "female" }];
    const prevPlaces: PlaceRef[] = [{ id: "ward_night", asset: "hospital_ward_night", look: "ward", time: "night" }];
    const w: string[] = [];
    const plan = normalizeEpisode(
      { shots: [{ line: "আমি আবার সেই ওয়ার্ডে।", speaker: "mitu", actors: [{ id: "mitu" }] }, { line: "   " }, {}] },
      { ...ctx, isLast: true, partIndex: 2, previousCast: prevCast, previousPlaces: prevPlaces },
      w,
    );
    expect(plan.shots).toHaveLength(1);
    expect(plan.cast).toEqual(prevCast);
    expect(plan.places).toEqual(prevPlaces);
    expect(plan.shots[0]).toMatchObject({ speaker: "mitu", place: "ward_night", bubble: true, hook: true, camera: { shot: "medium", move: "hold" } });
    expect(plan.end).toEqual({ type: "the_end", text: "শেষ" });
    expect(plan.episode).toBe(3);
    expect(plan.title).toContain("পর্ব 3");
  });

  it("forces the end type from ctx even if the model chose the other one", () => {
    const plan = normalizeEpisode(clone(fixture), { ...ctx, isLast: true });
    expect(plan.end).toEqual({ type: "the_end", text: "শেষ" });
  });

  it("throws when no usable shot is left", () => {
    expect(() => normalizeEpisode({ shots: [{ line: "" }] }, ctx)).toThrow(/no usable shots/);
    expect(() => normalizeEpisode({}, ctx)).toThrow(/no usable shots/);
  });
});
