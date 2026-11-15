import { describe, expect, it } from "vitest";
import { autoDirect, cueFor, protagonist } from "@/lib/puppet/autoDirect";
import { SAMPLE_EPISODE } from "@/lib/puppet/sample";
import type { EpisodePlan } from "@/lib/puppet/types";

const base: EpisodePlan = {
  version: 2, series: "s", episode: 1, title: "t", caption: "c", mood: "emotional", format: "9:16",
  cast: [
    { id: "me", name: "আমি", asset: "young_man", look: "", voice: "narrator" },
    { id: "khala", name: "খালা", asset: "old_woman", look: "", voice: "female_old" },
  ],
  places: [{ id: "yard", asset: "countryside", look: "", time: "day" }, { id: "room", asset: "home_room", look: "", time: "night" }],
  shots: [
    { line: "আমি গ্রামে পৌঁছালাম।", speaker: "narrator", place: "yard", camera: { shot: "wide", move: "hold" } },
    { line: "মানুষ আমাকে চেনে না।", speaker: "narrator", place: "yard", camera: { shot: "medium", move: "hold" } },
    { line: "টাকা আমার হয় না।", speaker: "khala", place: "yard", camera: { shot: "medium", move: "hold" } },
    { line: "খালা কাঁদতে লাগলেন।", speaker: "narrator", place: "yard", camera: { shot: "medium", move: "hold" }, actors: [{ id: "khala", x: 0.5, action: "idle", face: "neutral" }] },
    { line: "খালা কাঁদতে থাকলেন।", speaker: "narrator", place: "yard", camera: { shot: "medium", move: "hold" }, actors: [{ id: "khala", x: 0.5, action: "idle", face: "neutral" }] },
  ],
  end: { type: "next_part", text: "x" },
};

describe("autoDirect", () => {
  it("reads cues from Bangla lines", () => {
    expect(cueFor("খালা কাঁদতে লাগলেন")).toEqual({ action: "cry" });
    expect(cueFor("ঘরে ঢুকলাম").action).toBe("walk_in");
    expect(cueFor("অদ্ভুত লাগল")).toEqual({}); // no over-acting from vague words
  });
  it("finds the storyteller", () => {
    expect(protagonist(base)).toBe("me");
  });
  it("never adds people to empty shots; puts speakers on screen; follows the line; avoids repeats", () => {
    const p = autoDirect(base);
    expect(p.shots[0].actors).toBeUndefined();
    expect(p.shots[1].actors).toBeUndefined(); // an empty place stays empty
    expect(p.cast).toHaveLength(base.cast.length); // no extras
    expect(p.shots[2].actors?.some((a) => a.id === "khala" && a.action === "talk")).toBe(true);
    expect(p.shots[2].camera.focus).toBe("khala");
    expect(p.shots[3].actors?.[0]).toMatchObject({ action: "cry", face: "neutral" });
    expect(p.shots[4].camera.shot).not.toBe(p.shots[3].camera.shot);
    expect(p.shots.map((s) => s.line)).toEqual(base.shots.map((s) => s.line)); // never touches the words
  });
  it("is safe on the sample episode and keeps shot count", () => {
    const p = autoDirect(SAMPLE_EPISODE);
    expect(p.shots).toHaveLength(SAMPLE_EPISODE.shots.length);
  });
});
