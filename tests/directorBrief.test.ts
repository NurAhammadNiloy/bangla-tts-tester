import { beforeAll, describe, expect, it, vi } from "vitest";
import fixture from "@/lib/__fixtures__/episode.nurse.llm.json";
import { buildEpisodePrompt, CAMERA_MOVES, EPISODE_SCHEMA, normalizeEpisode, slowMove, type EpisodeContext } from "@/lib/episodePlan";
import { layoutCaption } from "@/lib/render/timeline";
import { drawEndCard } from "@/lib/render/episodeRenderer";
import { SAFE, SAFE_BOTTOM_Y } from "@/lib/render/safeZone";
import { drawWriteOn, writeProgress } from "@/lib/puppet/engine";
import { STARTER_PROPS } from "@/lib/puppet/library/props";
import { FakePath2D, makeFakeCtx } from "./puppetFakeCanvas";
import { createShotDrawer } from "@/lib/puppet/engine";
import { STARTER_LIBRARY } from "@/lib/puppet/library";
import { SAMPLE_EPISODE } from "@/lib/puppet/sample";
import type { EpisodePlan } from "@/lib/puppet/types";

const ctx: EpisodeContext = {
  genre: "horror", partTitle: "t", partIndex: 0, partsTotal: 2, hook: "h", isLast: false,
  characters: "মিতু", setting: "ward", librarySummary: "", narrator: "female",
};
const clone = <T,>(x: T): T => structuredClone(x);
const measure = (s: string, size: number) => [...s].length * size * 0.5;

describe("slow camera only", () => {
  it("never offers shake or whip to the planner", () => {
    expect(CAMERA_MOVES).not.toContain("shake");
    expect(CAMERA_MOVES).not.toContain("whip");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const moves = (EPISODE_SCHEMA as any).properties.shots.items.properties.camera.properties.move.enum;
    expect(moves).not.toContain("shake");
    expect(buildEpisodePrompt(ctx)).toMatch(/Never shake or whip/);
  });
  it("turns fast moves in a loose answer into slow ones", () => {
    expect(slowMove("shake")).toBe("push_in");
    expect(slowMove("whip")).toBe("hold");
    expect(slowMove("pan_left")).toBe("pan_left");
    expect(slowMove("nonsense")).toBe("hold");
  });
  it("normalizeEpisode never keeps a shake", () => {
    const raw = clone(fixture);
    raw.shots[1].camera.move = "shake";
    const plan = normalizeEpisode(raw, ctx, []);
    expect(plan.shots.some((s) => s.camera.move === "shake" || s.camera.move === "whip")).toBe(false);
  });
});

describe("music, hold and prop state in the plan", () => {
  it("keeps music, hold, prop state and notebook text; hold only after the last split piece", () => {
    const raw = clone(fixture);
    const shot = raw.shots[2] as Record<string, unknown>;
    shot.music = "drop";
    shot.hold = 3.5;
    shot.props = [{ id: "clipboard", x: 0.5, state: "off", text: "১৬" }];
    const plan = normalizeEpisode(raw, ctx, []);
    const idx = plan.shots.findIndex((s) => s.hold);
    expect(idx).toBeGreaterThanOrEqual(0);
    const s = plan.shots[idx];
    expect(s.music).toBe("drop");
    expect(s.hold).toBe(3.5);
    expect(s.props?.[0]).toMatchObject({ id: "clipboard", state: "off", text: "১৬" });
    expect(plan.shots.filter((x) => x.hold).length).toBe(1);
  });
  it("clamps hold to 5 seconds and ignores unknown music values", () => {
    const raw = clone(fixture);
    (raw.shots[0] as Record<string, unknown>).hold = 99;
    (raw.shots[0] as Record<string, unknown>).music = "loud";
    const plan = normalizeEpisode(raw, ctx, []);
    expect(plan.shots[0].hold).toBe(5);
    expect(plan.shots[0].music).toBeUndefined();
  });
});

describe("safe zones and subtitles", () => {
  it("subtitles use at most two lines and stay above the bottom safe zone and inside the right edge", () => {
    const text = Array.from({ length: 24 }, (_, i) => `শব্দ${i}`).join(" ");
    const L = layoutCaption(text, 1080, 1920, measure);
    const lines = new Set(L.words.map((w) => Math.round(w.y)));
    expect(lines.size).toBeLessThanOrEqual(2);
    expect(L.box.y + L.box.h).toBeLessThanOrEqual(1920 * SAFE_BOTTOM_Y + 1);
    for (const w of L.words) expect(w.x + w.width).toBeLessThanOrEqual(1080 * (1 - SAFE.right) + 1);
  });
});

describe("quiet end card", () => {
  it("draws nothing but black at the start of the fade, then one centred text without a box", () => {
    const a = makeFakeCtx();
    drawEndCard(a.ctx, 1080, 1920, { text: "মিজান কি ফিরবে?" }, 0.3);
    expect(a.calls.some((c) => c.name === "fillText")).toBe(false);
    const b = makeFakeCtx();
    drawEndCard(b.ctx, 1080, 1920, { text: "মিজান কি ফিরবে?" }, 1);
    expect(b.calls.filter((c) => c.name === "fillText").length).toBe(1);
    expect(b.calls.some((c) => c.name === "roundRect")).toBe(false);
  });
});

describe("write-on and library props", () => {
  it("writes from left to right over time", () => {
    expect(writeProgress(0)).toBe(0);
    expect(writeProgress(1.2)).toBeGreaterThan(0.3);
    expect(writeProgress(1.2)).toBeLessThan(0.7);
    expect(writeProgress(5)).toBe(1);
    const c = makeFakeCtx();
    drawWriteOn(c.ctx, "১৬", 110, 140, 0);
    expect(c.calls.some((x) => x.name === "fillText")).toBe(false);
    drawWriteOn(c.ctx, "১৬", 110, 140, 0.5);
    expect(c.calls.some((x) => x.name === "fillText")).toBe(true);
  });
  it("has a ceiling fan, a hand fan and a notebook ready to use", () => {
    const ids = STARTER_PROPS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["ceiling_fan", "hand_fan", "notebook"]));
  });
});

describe("fan on / off", () => {
  beforeAll(() => vi.stubGlobal("Path2D", FakePath2D));
  const base = structuredClone(SAMPLE_EPISODE) as EpisodePlan;
  const withFan = (state?: "on" | "off"): EpisodePlan => {
    const plan = structuredClone(base);
    plan.shots[0] = { ...plan.shots[0], camera: { shot: "wide", move: "hold" }, actors: [], props: [{ id: "ceiling_fan", x: 0.5, ...(state ? { state } : {}) }] };
    return plan;
  };
  /** setTransform matrices drawn at time t. */
  const frame = (plan: EpisodePlan, t: number) => {
    const { ctx, calls } = makeFakeCtx();
    createShotDrawer(plan, 0, STARTER_LIBRARY)(ctx, 540, 960, { t, dur: 4, talk: 0 });
    return JSON.stringify(calls.filter((c) => c.name === "setTransform").map((c) => c.args));
  };
  it("spins while on and hangs still while off", () => {
    expect(frame(withFan("on"), 0.1)).not.toBe(frame(withFan("on"), 0.2));
    expect(frame(withFan("off"), 0.1)).toBe(frame(withFan("off"), 0.2));
    expect(frame(withFan(), 0.1)).not.toBe(frame(withFan(), 0.2)); // default = on
  });
});
