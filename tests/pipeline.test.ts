import { describe, expect, it } from "vitest";
import { estimateEpisode, layoutEpisode, LEAD_IN, MIN_SHOT, TAIL, END_CARD_SECONDS, END_SILENCE, MUSIC_GAIN } from "@/lib/pipeline/layout";
import { castVoices, voiceForShot } from "@/lib/pipeline/voices";
import { STYLE_PRESETS } from "@/lib/voiceDirector";
import type { EpisodePlan } from "@/lib/puppet/types";

const plan: EpisodePlan = {
  version: 2,
  series: "শেষ ডেলিভারি",
  episode: 1,
  title: "t",
  caption: "c",
  mood: "horror",
  format: "9:16",
  cast: [
    { id: "a", name: "তানভীর", asset: "young_man", look: "", voice: "male" },
    { id: "b", name: "বৃদ্ধ", asset: "old_man", look: "", voice: "male_old", new: true },
  ],
  places: [{ id: "p", asset: "city_street", look: "", time: "night", new: true }],
  shots: [
    { line: "রাত ২টায় একটা অর্ডার এলো।", speaker: "narrator", place: "p", camera: { shot: "wide", move: "hold" }, sfx: ["notification"] },
    { line: "কে?", speaker: "a", place: "p", camera: { shot: "close", move: "push_in" }, pause: 0.8 },
    { line: "", speaker: "narrator", place: "p", camera: { shot: "medium", move: "hold" } },
  ],
  end: { type: "next_part", text: "পরের পর্ব দেখুন" },
};

describe("layoutEpisode", () => {
  it("lays shots end to end from voice lengths", () => {
    const L = layoutEpisode(plan, [
      { seconds: 2, offset: 0.1 },
      { seconds: 0.5, offset: 0 },
      { seconds: 0, offset: 0 },
    ]);
    expect(L.slots[0].start).toBe(0);
    expect(L.slots[0].end).toBeCloseTo(LEAD_IN + 2 + TAIL);
    expect(L.slots[1].start).toBeCloseTo(L.slots[0].end);
    // short line: minimum shot length, plus the suspense pause
    expect(L.slots[1].end - L.slots[1].start).toBeCloseTo(MIN_SHOT + 0.8);
    // one suspense pause + the silent closing seconds under the end card
    expect(L.silences).toHaveLength(2);
    expect(L.slots[2].captions).toHaveLength(0);
    expect(L.total).toBeCloseTo(L.endCardStart + END_CARD_SECONDS);
    expect(L.sfx).toEqual([{ name: "notification", at: 0.05 }]);
    expect(L.voiceRegions).toHaveLength(2);
    expect(L.slots[0].captions[0].start).toBeCloseTo(LEAD_IN);
  });

  it("holds the picture after a key line and drops the music", () => {
    const keyed: EpisodePlan = {
      ...plan,
      shots: [{ ...plan.shots[0], music: "drop", hold: 3.5 }, { ...plan.shots[1], music: "soft" }, plan.shots[2]],
    };
    const L = layoutEpisode(keyed, [{ seconds: 2, offset: 0 }, { seconds: 0.5, offset: 0 }, { seconds: 0, offset: 0 }]);
    expect(L.slots[0].end - L.slots[0].start).toBeCloseTo(LEAD_IN + 2 + TAIL + 3.5);
    // the hold is a silence that starts when the voice ends
    expect(L.silences[0].start).toBeCloseTo(LEAD_IN + 2);
    expect(L.silences[0].end).toBeCloseTo(L.slots[0].end);
    expect(L.musicLevels).toHaveLength(2);
    expect(L.musicLevels[0].gain).toBe(MUSIC_GAIN.drop);
    expect(L.musicLevels[1].gain).toBe(MUSIC_GAIN.soft);
    expect(L.musicLevels[0].end).toBeCloseTo(L.slots[0].end);
  });

  it("leaves the last seconds silent under the closing question", () => {
    const L = layoutEpisode(plan, [{ seconds: 1, offset: 0 }, { seconds: 1, offset: 0 }, { seconds: 0, offset: 0 }]);
    const last = L.silences[L.silences.length - 1];
    expect(last.end).toBeGreaterThanOrEqual(L.total);
    expect(L.total - last.start).toBeCloseTo(END_SILENCE);
  });

  it("estimates length and new assets", () => {
    const e = estimateEpisode(plan);
    expect(e.shots).toBe(3);
    expect(e.newAssets).toBe(2);
    expect(e.seconds).toBeGreaterThan(END_CARD_SECONDS);
  });
});

describe("castVoices", () => {
  it("gives each cast member a distinct Gemini voice", () => {
    const v = castVoices(plan.cast, STYLE_PRESETS[0], "gemini", "female");
    expect(v.narrator).toBe("Sulafat");
    expect(v.byCast.a).not.toBe(v.byCast.b);
    expect(voiceForShot("narrator", v)).toBe("Sulafat");
    expect(voiceForShot("a", v)).toBe(v.byCast.a);
    expect(voiceForShot("missing", v)).toBe("Sulafat");
  });
});
