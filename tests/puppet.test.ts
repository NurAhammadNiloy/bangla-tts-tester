import { beforeAll, describe, expect, it, vi } from "vitest";
import { FakePath2D, makeFakeCtx } from "./puppetFakeCanvas";
import { STARTER_LIBRARY, summarizeLibrary, recolor } from "@/lib/puppet/library";
import { validateAsset, normalizePlan, splitLongShots, closestEnum, ACTION_LIST } from "@/lib/puppet/validate";
import { parsePath, pathBounds } from "@/lib/puppet/path";
import { poseAt, ACTIONS, blinkAt, travelAt } from "@/lib/puppet/actions";
import { frameShot, applyMove, layerView, wideView, transitionOverlay, clampView, frameXToPlace, type ActorBox } from "@/lib/puppet/camera";
import { drawScreen } from "@/lib/puppet/screens";
import { drawCharacter, headPoints, FACES } from "@/lib/puppet/rig";
import { createShotDrawer, speakerAnchor } from "@/lib/puppet/engine";
import { SAMPLE_EPISODE } from "@/lib/puppet/sample";
import type { CharacterAsset, ScreenSpec, ShotSize } from "@/lib/puppet/types";

beforeAll(() => {
  vi.stubGlobal("Path2D", FakePath2D);
});

const lib = STARTER_LIBRARY;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe("starter library", () => {
  it("has enough assets", () => {
    expect(Object.keys(lib.characters).length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(lib.places).length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(lib.props).length).toBeGreaterThanOrEqual(12);
    for (const id of ["smartphone", "keypad_phone", "letter", "bag", "cup", "lantern", "umbrella", "chair", "table", "bed", "money_notes", "suitcase"]) expect(lib.props[id]).toBeTruthy();
  });

  it("every starter asset validates", () => {
    for (const a of [...Object.values(lib.characters), ...Object.values(lib.places), ...Object.values(lib.props)]) {
      const r = validateAsset(a);
      expect(r.errors, a.id).toEqual([]);
      expect(r.ok).toBe(true);
      // JSON round trip keeps it valid (the asset maker format is plain JSON)
      expect(validateAsset(clone(a)).ok).toBe(true);
    }
  });

  it("places are 1620x1920 and characters 300x600", () => {
    for (const p of Object.values(lib.places)) expect(p.size).toEqual([1620, 1920]);
    for (const c of Object.values(lib.characters)) {
      expect(c.size).toEqual([300, 600]);
      const b = c.parts.find((p) => p.name === "leg_r")!;
      const bottom = Math.max(...b.shapes.map((s) => pathBounds(s.d)!.y1));
      expect(bottom).toBeGreaterThan(590);
      expect(bottom).toBeLessThanOrEqual(601);
      // the face sits on the head
      const head = c.parts.find((p) => p.name === "head")!;
      const hb = head.shapes.map((s) => pathBounds(s.d)!).reduce((a, x) => ({ x0: Math.min(a.x0, x.x0), y0: Math.min(a.y0, x.y0), x1: Math.max(a.x1, x.x1), y1: Math.max(a.y1, x.y1) }));
      for (const p of [c.face.eyeL, c.face.eyeR, c.face.mouth]) {
        expect(p[0]).toBeGreaterThan(hb.x0);
        expect(p[0]).toBeLessThan(hb.x1);
        expect(p[1]).toBeGreaterThan(hb.y0);
        expect(p[1]).toBeLessThan(hb.y1);
      }
    }
  });

  it("summarizes for prompts", () => {
    const s = summarizeLibrary(lib);
    expect(s).toContain("CHARACTERS");
    expect(s).toContain("old_woman");
    expect(s).toContain("night_alley");
    expect(s).toContain("smartphone");
  });

  it("recolor swaps colours and keeps validity", () => {
    const base = lib.characters.young_man;
    const shirt = base.parts.find((p) => p.name === "body")!.shapes[1].fill!;
    const r = recolor(base, { [shirt]: "#7c5ba6" }, "young_man_b");
    expect(r.id).toBe("young_man_b");
    expect(r.parts.find((p) => p.name === "body")!.shapes[1].fill).toBe("#7c5ba6");
    expect(base.parts.find((p) => p.name === "body")!.shapes[1].fill).toBe(shirt);
    expect(validateAsset(r).ok).toBe(true);
  });
});

describe("validateAsset", () => {
  it("rejects broken assets", () => {
    const c = clone(lib.characters.young_man);
    expect(validateAsset(null).ok).toBe(false);
    expect(validateAsset({ ...c, kind: "monster" }).ok).toBe(false);
    expect(validateAsset({ ...c, parts: c.parts.filter((p) => p.name !== "arm_r") }).errors.join()).toMatch(/arm_r/);
    const badPivot = clone(c);
    badPivot.parts[0].pivot = [5000, 10];
    expect(validateAsset(badPivot).ok).toBe(false);
    const badPath = clone(c);
    badPath.parts[0].shapes[0].d = "<script>alert(1)</script>";
    expect(validateAsset(badPath).ok).toBe(false);
    const badPath2 = clone(c);
    badPath2.parts[0].shapes[0].d = "L 10 10";
    expect(validateAsset(badPath2).ok).toBe(false);
    const badColor = clone(c);
    badColor.parts[0].shapes[0].fill = "url(javascript:x)";
    expect(validateAsset(badColor).ok).toBe(false);
    expect(validateAsset({ ...c, size: ["300", 600] }).ok).toBe(false);
    const many = clone(c);
    many.parts[0].shapes = Array.from({ length: 200 }, () => ({ d: "M0 0L1 1Z", fill: "#000" }));
    expect(validateAsset(many).ok).toBe(false);
    const noFace = clone(c) as Partial<CharacterAsset>;
    delete noFace.face;
    expect(validateAsset(noFace).ok).toBe(false);
    const place = clone(lib.places.kitchen);
    expect(validateAsset({ ...place, floorY: 99999 }).ok).toBe(false);
    const prop = clone(lib.props.cup);
    expect(validateAsset({ ...prop, shapes: [] }).ok).toBe(false);
    expect(validateAsset({ ...prop, anchor: [-500, 0] }).ok).toBe(false);
  });

  it("parses path data", () => {
    expect(parsePath("M0 0L10 10Z")).toHaveLength(3);
    expect(parsePath("m0,0 l10,10 10,0z")).toHaveLength(4);
    expect(parsePath("M0 0 C 1 2 3")).toBeNull();
    expect(pathBounds("M10 20L30 5")).toEqual({ x0: 10, y0: 5, x1: 30, y1: 20 });
  });
});

describe("normalizePlan", () => {
  it("fixes bad input", () => {
    const { plan, warnings } = normalizePlan(
      {
        title: "t",
        mood: "spooky",
        cast: [
          { id: "Rafi Khan", name: "রাফি", asset: "nope", look: "old woman in a white saree", voice: "girl" },
          { id: "b", name: "B", asset: "young_man", look: "", voice: "male" },
          { id: "n", name: "N", asset: "custom_ghost", look: "ghost", voice: "female", new: true },
        ],
        places: [{ id: "p1", asset: "haunted_lane", look: "dark alley at night with an old door", time: "midnight", weather: "rainy" }],
        props: [{ id: "ph", asset: "mobile_phone", look: "smartphone" }],
        shots: [
          { line: "a", speaker: "ghost", place: "p1", actors: [{ id: "rafi_khan", x: 7, action: "Sobbing", face: "terrified" }, { id: "zzz", x: 0.2, action: "idle", face: "neutral" }], camera: { shot: "close-up", move: "zoom in" } },
          { line: "b", speaker: "b", actors: [{ id: "b", x: -3, action: "walkk_in", face: "joy", prop: "ph" }], camera: { shot: "close", move: "static" }, transition: "crossfade" },
          { line: "c", speaker: "b", layout: "split", actors: [{ id: "b", x: 0.5, action: "phone_ear", face: "neutral" }, { id: "rafi_khan", x: 0.5, action: "phone", face: "x" }], camera: { shot: "medium", move: "?" } },
          { line: "d", speaker: "narrator", screen: { type: "weird" }, camera: { shot: "pov", move: "hold" } },
          "garbage",
        ],
      },
      lib,
    );
    expect(plan.version).toBe(2);
    expect(plan.mood).toBe("emotional");
    expect(plan.cast[0].id).toBe("rafi_khan");
    expect(plan.cast[0].asset).toBe("old_woman");
    expect(plan.cast[2].asset).toBe("custom_ghost"); // new: kept for the asset maker
    expect(plan.places[0].asset).toBe("night_alley");
    expect(plan.places[0].time).toBe("night");
    expect(plan.places[0].weather).toBe("rain");
    expect(plan.props?.[0].asset).toBe("smartphone");
    const [s0, s1, s2, s3] = plan.shots;
    expect(plan.shots).toHaveLength(4);
    expect(s0.speaker).toBe("narrator");
    expect(s0.actors).toHaveLength(1);
    expect(s0.actors![0]).toMatchObject({ x: 1, action: "cry", face: "scared" });
    expect(s0.camera).toMatchObject({ shot: "close", move: "push_in" });
    expect(s1.actors![0]).toMatchObject({ x: 0, action: "walk_in", face: "happy", prop: "ph" });
    expect(s1.camera.shot).not.toBe("close"); // no two consecutive shots share a size
    expect(s1.transition).toBe("fade");
    expect(s2.layout).toBe("split");
    expect(s2.top?.actors.length).toBe(1);
    expect(s2.bottom?.actors[0].action).toBe("phone_ear");
    expect(s3.screen?.type).toBe("text_card");
    for (let i = 1; i < plan.shots.length; i++) expect(plan.shots[i].camera.shot).not.toBe(plan.shots[i - 1].camera.shot);
    expect(warnings.length).toBeGreaterThan(3);
  });

  it("survives garbage", () => {
    for (const x of [null, 42, "x", [], { shots: "no" }]) {
      const { plan } = normalizePlan(x, lib);
      expect(plan.shots.length).toBeGreaterThan(0);
      expect(plan.places.length).toBeGreaterThan(0);
      const { ctx, nanCalls } = makeFakeCtx();
      createShotDrawer(plan, 0, lib)(ctx, 540, 960, { t: 0.5, dur: 2, talk: 0.3 });
      expect(nanCalls).toEqual([]);
    }
  });

  it("keeps the sample episode intact", () => {
    const { plan } = normalizePlan(clone(SAMPLE_EPISODE), lib);
    expect(plan.shots.length).toBe(SAMPLE_EPISODE.shots.length);
    expect(plan.shots.map((s) => s.camera.shot)).toEqual(SAMPLE_EPISODE.shots.map((s) => s.camera.shot));
  });

  it("maps enums by synonym and distance", () => {
    expect(closestEnum("Walking", ACTION_LIST, "action", "idle")).toBe("walk_in");
    expect(closestEnum("lie down", ACTION_LIST, "action", "idle")).toBe("lie_down");
    expect(closestEnum("qwertyuiop", ACTION_LIST, "action", "idle")).toBe("idle");
  });
});

describe("splitLongShots", () => {
  it("splits long lines into 2-3 beats with different cameras", () => {
    const durs = SAMPLE_EPISODE.shots.map((_, i) => (i === 0 ? 9 : i === 2 ? 5 : 2));
    const beats = splitLongShots(SAMPLE_EPISODE, durs, 4);
    const b0 = beats.filter((b) => b.shotIndex === 0);
    expect(b0).toHaveLength(3);
    expect(b0[0].start).toBe(0);
    expect(b0[2].end).toBeCloseTo(9);
    expect(b0[0].cameraOverride).toBeUndefined();
    expect(b0[1].cameraOverride?.shot).not.toBe(SAMPLE_EPISODE.shots[0].camera.shot);
    expect(b0[2].cameraOverride?.shot).not.toBe(b0[1].cameraOverride?.shot);
    expect(beats.filter((b) => b.shotIndex === 2)).toHaveLength(2);
    expect(beats.filter((b) => b.shotIndex === 1)).toHaveLength(1); // screen shot stays one beat
    expect(beats.filter((b) => b.shotIndex === 5)).toHaveLength(1);
    // contiguous
    for (const i of [0, 2]) {
      const bs = beats.filter((b) => b.shotIndex === i);
      for (let k = 1; k < bs.length; k++) expect(bs[k].start).toBeCloseTo(bs[k - 1].end);
    }
  });
});

describe("camera", () => {
  const place: [number, number] = [1620, 1920];
  const actor: ActorBox = { x: 810, headTop: 720, faceY: 800, feetY: 1500 };
  it("wide shows the base frame", () => {
    const v = wideView(place, 1500, 1080, 1920);
    expect(v.s).toBeCloseTo(1);
    expect(v.cx).toBe(810);
  });
  it("tighter sizes zoom in and keep the head in frame with headroom", () => {
    const sizes: ShotSize[] = ["wide", "medium", "close", "extreme_close"];
    const scales = sizes.map((s) => frameShot(s, [actor], place, 1500, 1080, 1920).s);
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeGreaterThan(scales[i - 1]);
    for (const s of ["medium", "close"] as ShotSize[]) {
      const v = frameShot(s, [actor], place, 1500, 1080, 1920);
      const topPx = 960 + (actor.headTop - v.cy) * v.s;
      expect(topPx).toBeGreaterThan(20);
      expect(topPx).toBeLessThan(1920 * 0.3);
    }
    const ec = frameShot("extreme_close", [actor], place, 1500, 1080, 1920);
    const facePx = 960 + (actor.faceY - ec.cy) * ec.s;
    expect(Math.abs(facePx - 960)).toBeLessThan(300);
  });
  it("never shows outside the place", () => {
    const v = clampView({ cx: -500, cy: 99999, s: 0.1 }, place, 1080, 1920);
    expect(v.cx - 540 / v.s).toBeGreaterThanOrEqual(-0.001);
    expect(v.cy + 960 / v.s).toBeLessThanOrEqual(1920.001);
  });
  it("moves and parallax", () => {
    const v = frameShot("medium", [actor], place, 1500, 1080, 1920);
    expect(applyMove(v, "push_in", 1, 2).s).toBeGreaterThan(v.s);
    expect(applyMove(v, "pull_out", 0, 0).s).toBeGreaterThan(applyMove(v, "pull_out", 1, 2).s);
    expect(applyMove(v, "pan_left", 0, 0).cx).toBeGreaterThan(applyMove(v, "pan_left", 1, 2).cx);
    expect(applyMove(v, "pan_right", 0, 0).cx).toBeLessThan(applyMove(v, "pan_right", 1, 2).cx);
    expect(applyMove(v, "whip", 0, 0).cx).not.toBe(v.cx);
    expect(applyMove(v, "whip", 1, 1).cx).toBeCloseTo(v.cx);
    expect(applyMove(v, "shake", 0.5, 0.33).cx).not.toBe(applyMove(v, "shake", 0.5, 0.4).cx);
    const ref = { cx: 810, cy: 960, s: 1 };
    const moved = { cx: 1010, cy: 960, s: 1 };
    expect(layerView(moved, ref, 0.6).cx).toBeCloseTo(930);
    expect(layerView(moved, ref, 1.25).cx).toBeCloseTo(1060);
    expect(frameXToPlace(0, 1620)).toBe(270);
    expect(frameXToPlace(1, 1620)).toBe(1350);
  });
  it("transitions", () => {
    expect(transitionOverlay("cut", undefined, 0, 2)).toBeNull();
    expect(transitionOverlay("flash", undefined, 0, 2)).toEqual({ color: "#ffffff", alpha: 1 });
    expect(transitionOverlay("fade", undefined, 1, 2)).toBeNull();
    expect(transitionOverlay(undefined, "dip_black", 2, 2)?.alpha).toBeCloseTo(1);
    expect(transitionOverlay(undefined, "dip_black", 1, 2)).toBeNull();
  });
});

describe("actions", () => {
  it("poseAt is deterministic and in range", () => {
    for (const a of ACTIONS) {
      for (const t of [0, 0.37, 1.2, 3.9]) {
        const p1 = poseAt(a, t, 4, 0.5, 3.3, { face: "sad" });
        const p2 = poseAt(a, t, 4, 0.5, 3.3, { face: "sad" });
        expect(p1).toEqual(p2);
        expect(p1.face.blink).toBeGreaterThanOrEqual(0);
        expect(p1.face.blink).toBeLessThanOrEqual(1);
        expect(p1.face.mouthOpen).toBeGreaterThanOrEqual(0);
        expect(p1.face.mouthOpen).toBeLessThanOrEqual(1);
        for (const x of Object.values(p1.parts)) {
          expect(Math.abs(x!.rot ?? 0)).toBeLessThan(Math.PI * 1.1);
          expect(Number.isFinite(x!.dy ?? 0)).toBe(true);
        }
        expect(Math.abs(p1.root.dy)).toBeLessThan(400);
      }
    }
  });
  it("blinks every 3-5 s, not in sync between actors", () => {
    const times = (seed: number) => {
      const out: number[] = [];
      for (let t = 0; t < 30; t += 0.02) if (blinkAt(t, seed) > 0.9 && (!out.length || t - out[out.length - 1] > 1)) out.push(t);
      return out;
    };
    const a = times(1.5),
      b = times(7.9);
    expect(a.length).toBeGreaterThanOrEqual(5);
    expect(a.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < a.length; i++) expect(a[i] - a[i - 1]).toBeGreaterThan(2.8);
    expect(a.slice(0, 3)).not.toEqual(b.slice(0, 3));
  });
  it("walking legs swing, sitting lowers the body, cry forces the face", () => {
    const w1 = poseAt("walk_in", 0.1, 3, 0, 1);
    const w2 = poseAt("walk_in", 0.55, 3, 0, 1);
    expect(w1.parts.leg_l?.rot).not.toBeCloseTo(w2.parts.leg_l?.rot ?? 0);
    expect(travelAt("walk_in", 10, 3).moving).toBe(false);
    expect(poseAt("walk_in", 10, 3, 0, 1).parts.leg_l?.rot ?? 0).toBeCloseTo(0);
    expect(poseAt("sit", 1, 3, 0, 1, { seat: 140 }).root.dy).toBeGreaterThan(40);
    expect(poseAt("cry", 1, 3, 0, 1, { face: "happy" }).face.face).toBe("crying");
    expect(poseAt("talk", 1, 3, 0.8, 1).face.mouthOpen).toBeCloseTo(0.8);
    expect(poseAt("lie_down", 1, 3, 0, 1).root.rot).toBeCloseTo(-Math.PI / 2);
  });
});

describe("rig", () => {
  it("draws every character with every face and mirrored without errors", () => {
    for (const c of Object.values(lib.characters))
      for (const face of FACES) {
        const { ctx, nanCalls, depth } = makeFakeCtx();
        const pose = poseAt("talk", 1.3, 3, 0.6, 2, { face });
        drawCharacter(ctx, c, pose, { x: 200, y: 600, scale: 1, facing: face === "sad" ? "left" : "right", prop: lib.props.smartphone });
        expect(nanCalls).toEqual([]);
        expect(depth()).toBe(0);
      }
  });
  it("mirrors head position when facing left", () => {
    const c = lib.characters.young_man;
    const pose = poseAt("idle", 0, 1, 0, 1);
    const r = headPoints(c, pose, { x: 500, y: 600, scale: 1, facing: "right" });
    const l = headPoints(c, pose, { x: 500, y: 600, scale: 1, facing: "left" });
    expect(r.face[0] - 500).toBeCloseTo(-(l.face[0] - 500));
    expect(r.top[1]).toBeLessThan(r.face[1]);
  });
});

describe("screens", () => {
  const specs: ScreenSpec[] = [
    { type: "notification", app: "অ্যাপ", title: "নতুন অর্ডার", body: "ঠিকানা: ১৩/বি, পুরান লেন। অনেক লম্বা লেখা যাতে লাইন ভাঙে এবং বক্সের বাইরে না যায়।" },
    { type: "incoming_call", caller: "মা", subtitle: "মোবাইল" },
    { type: "video_call", caller: "রাফি", who: "rafi" },
    { type: "chat", title: "বন্ধু", messages: [{ from: "me", text: "কোথায় তুই?" }, { from: "them", text: "আসছি" }, { from: "me", text: "তাড়াতাড়ি" }] },
    { type: "letter", text: "প্রিয় মা, অনেক দিন তোমাকে দেখি না। ভালো থেকো।", signature: "তোমার খোকা" },
    { type: "tv_news", headline: "শহরে ভারী বৃষ্টি", ticker: "সব খবর" },
    { type: "calendar", title: "শ্রাবণ", days: 30, marked: 12 },
    { type: "map", from: "মেস", to: "পুরান লেন" },
    { type: "photo", caption: "সেই দিন", who: ["rafi", "nanu"] },
    { type: "text_card", text: "দশ বছর পর…" },
  ];
  it("draws every ScreenSpec full-screen and in a phone without throwing", () => {
    for (const spec of specs)
      for (const shot of ["medium", "pov_hand", "extreme_close"] as ShotSize[])
        for (const t of [0, 0.5, 2.4]) {
          const { ctx, nanCalls, depth, calls } = makeFakeCtx();
          drawScreen(ctx, spec, 1080, 1920, { t, dur: 2.5, shot, plan: SAMPLE_EPISODE, lib, talk: 0.5, background: (c) => c.fillRect(0, 0, 10, 10) });
          expect(nanCalls, `${spec.type} ${shot} ${t}`).toEqual([]);
          expect(depth()).toBe(0);
          expect(calls.some((c) => c.name === "textAlign")).toBe(false);
        }
  });
  it("draws Bangla text left-aligned", () => {
    const { ctx } = makeFakeCtx();
    drawScreen(ctx, specs[9], 1080, 1920, { t: 1 });
    expect((ctx as unknown as { textAlign: string }).textAlign).toBe("left");
  });
});

describe("engine", () => {
  it("draws every shot of the sample episode at several times", () => {
    SAMPLE_EPISODE.shots.forEach((_, i) => {
      const draw = createShotDrawer(SAMPLE_EPISODE, i, lib);
      for (const t of [0, 0.3, 1.25, 2.49, 2.5]) {
        const { ctx, nanCalls, depth, calls } = makeFakeCtx();
        draw(ctx, 1080, 1920, { t, dur: 2.5, talk: 0.5 + 0.5 * Math.sin(t * 9) });
        expect(nanCalls, `shot ${i} t ${t}`).toEqual([]);
        expect(depth()).toBe(0);
        expect(calls.length).toBeGreaterThan(20);
      }
    });
  });
  it("draws beats with camera overrides", () => {
    const beats = splitLongShots(SAMPLE_EPISODE, SAMPLE_EPISODE.shots.map(() => 9));
    for (const b of beats) {
      const draw = createShotDrawer(SAMPLE_EPISODE, b.shotIndex, lib, { beat: b });
      const { ctx, nanCalls } = makeFakeCtx();
      draw(ctx, 540, 960, { t: (b.start + b.end) / 2, dur: 9, talk: 0.4 });
      expect(nanCalls).toEqual([]);
    }
  });
  it("finds the speaker's head for speech bubbles", () => {
    const i = SAMPLE_EPISODE.shots.findIndex((s) => s.speaker === "nanu");
    const a = speakerAnchor(SAMPLE_EPISODE, i, lib, 1080, 1920, { t: 1, dur: 2.5, talk: 0.5 });
    expect(a).not.toBeNull();
    expect(a!.x).toBeGreaterThan(0);
    expect(a!.x).toBeLessThan(1080);
    expect(a!.y).toBeGreaterThan(0);
    expect(a!.y).toBeLessThan(1920 * 0.7);
    expect(speakerAnchor(SAMPLE_EPISODE, 0, lib, 1080, 1920, { t: 1, dur: 2.5, talk: 0 })).toBeNull(); // narrator
    const split = SAMPLE_EPISODE.shots.findIndex((s) => s.layout === "split");
    const b = speakerAnchor(SAMPLE_EPISODE, split, lib, 1080, 1920, { t: 1, dur: 2.5, talk: 0 });
    expect(b!.y).toBeGreaterThan(960); // the manager is in the bottom half
  });
  it("sample episode uses the required features", () => {
    const shots = SAMPLE_EPISODE.shots;
    expect(shots.length).toBeGreaterThanOrEqual(8);
    expect(shots.length).toBeLessThanOrEqual(10);
    expect(shots.filter((s) => s.screen).length).toBeGreaterThanOrEqual(2);
    expect(shots.some((s) => s.layout === "split")).toBe(true);
    expect(SAMPLE_EPISODE.places.some((p) => p.weather === "rain" && p.time === "night")).toBe(true);
    expect(new Set(shots.flatMap((s) => (s.actors ?? []).map((a) => a.action))).size).toBeGreaterThanOrEqual(5);
    const { plan, warnings } = normalizePlan(clone(SAMPLE_EPISODE), lib);
    expect(warnings).toEqual([]);
    expect(plan.cast.length).toBe(3);
  });
});
