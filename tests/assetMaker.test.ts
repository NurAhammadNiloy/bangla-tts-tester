import { describe, expect, it } from "vitest";
import charFixture from "@/lib/__fixtures__/character.nurse_young_f.llm.json";
import placeFixture from "@/lib/__fixtures__/place.hospital_ward_night.llm.json";
import {
  ASSET_SCHEMAS,
  buildAssetPrompt,
  buildAssetUserMessage,
  cleanColor,
  normalizeAsset,
  REQUIRED_PARTS,
  sanitizePath,
} from "@/lib/assetMaker";
import { STYLE_GUIDE_TEXT } from "@/lib/puppet/styleGuide";
import { strictProblems } from "./strictSchema";

const clone = <T,>(x: T): T => structuredClone(x);

describe("ASSET_SCHEMAS", () => {
  it.each(["character", "place", "prop"] as const)("%s schema is strict", (k) => {
    expect(strictProblems(ASSET_SCHEMAS[k])).toEqual([]);
  });
});

describe("buildAssetPrompt", () => {
  it("character prompt has box, parts, pivots, face rules, example and style guide", () => {
    const p = buildAssetPrompt("character", { id: "nurse_young_f", look: "young nurse" });
    expect(p).toContain(STYLE_GUIDE_TEXT);
    expect(p).toContain("[300, 600]");
    expect(p).toContain("(150, 600)");
    expect(p).toMatch(/Facing RIGHT/);
    expect(p).toMatch(/M L H V C Q Z/);
    expect(p).toMatch(/Do NOT draw eyes/);
    expect(p).toMatch(/REQUIRED: body, head, arm_l, arm_r, leg_l, leg_r/);
    expect(p).toContain('"name":"arm_r"');
    expect(p).toContain('id = "nurse_young_f"');
  });
  it("place and prop prompts", () => {
    const pl = buildAssetPrompt("place", { id: "x", look: "y", styleGuide: "CUSTOM GUIDE" });
    expect(pl).toContain("CUSTOM GUIDE");
    expect(pl).toContain("[1620, 1920]");
    expect(pl).toMatch(/floorY ≈ 1500/);
    expect(pl).toMatch(/Keep the centre clear/);
    expect(pl).toContain('"back":[');
    expect(buildAssetPrompt("prop", { id: "x", look: "y" })).toMatch(/anchor/);
  });
  it("user message lists problems on retry", () => {
    expect(buildAssetUserMessage("prop", "torch", "small torch", ["no shapes"])).toMatch(/- no shapes/);
  });
});

describe("sanitizePath", () => {
  it("accepts absolute M L H V C Q Z and clamps into the box", () => {
    expect(sanitizePath("M-10 5 L400 700 H50 V-3 Q1 2 3 4 C1 2 3 4 5 6 Z", 300, 600)).toBe("M0 5 L300 600 H50 V0 Q1 2 3 4 C1 2 3 4 5 6 Z");
    expect(sanitizePath("M1,2L3,4z".toUpperCase(), 10, 10)).toBe("M1 2 L3 4 Z");
  });
  it("rejects relative, arcs, wrong arity, too long, not starting with M", () => {
    expect(sanitizePath("m0 0 l10 10", 300, 600)).toBeNull();
    expect(sanitizePath("M0 0 A5 5 0 0 1 10 10", 300, 600)).toBeNull();
    expect(sanitizePath("M0 0 C1 2 3", 300, 600)).toBeNull();
    expect(sanitizePath("L0 0", 300, 600)).toBeNull();
    expect(sanitizePath("M0 0 " + "L1 1 ".repeat(1000), 300, 600)).toBeNull();
    expect(sanitizePath("M0 0 Z5", 300, 600)).toBeNull();
  });
  it("cleanColor", () => {
    expect(cleanColor("#c94f4f")).toBe("#c94f4f");
    expect(cleanColor("rgba(0,0,0,0.5)")).toBe("rgba(0,0,0,0.5)");
    expect(cleanColor("url(#x)")).toBeUndefined();
    expect(cleanColor("")).toBeUndefined();
  });
});

describe("normalizeAsset", () => {
  it("good character fixture passes cleanly", () => {
    const r = normalizeAsset("character", clone(charFixture), "nurse_young_f");
    expect(r.major).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.asset.size).toEqual([300, 600]);
    expect(r.asset.parts.map((p) => p.name)).toEqual(expect.arrayContaining([...REQUIRED_PARTS]));
    expect(r.asset.parts.map((p) => p.z)).toEqual([...r.asset.parts.map((p) => p.z)].sort((a, b) => a - b));
    expect(r.asset.face.eyeL).toEqual([150, 76]);
    // strict empties removed
    const hair = r.asset.parts.find((p) => p.name === "hair")!;
    expect(hair.shapes[0].stroke).toBeUndefined();
    expect(hair.shapes[0].opacity).toBeUndefined();
  });

  it("good place fixture passes cleanly", () => {
    const r = normalizeAsset("place", clone(placeFixture), "hospital_ward_night");
    expect(r.major).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.asset.floorY).toBe(1500);
    expect(r.asset.layers.back.length).toBeGreaterThan(3);
  });

  it("bad character: missing parts get placeholders, bad shapes dropped, face moved onto head", () => {
    const bad = {
      kind: "prop",
      id: "whatever",
      tags: ["Old Man", "old man"],
      size: [1000, 1000],
      parts: [
        { name: "head", pivot: [999, -5], z: 6, shapes: [{ d: "M100 20 C200 20 200 130 100 130 Z", fill: "#c8946b", stroke: "", strokeWidth: 0, opacity: 1 }] },
        { name: "arm_r", pivot: [185, 150], z: 9, shapes: [{ d: "m0 0 l10 10", fill: "red" }, { d: "M0 0 A1 1 0 0 1 2 2", fill: "red" }] },
        { name: "tail", pivot: [0, 0], z: 1, shapes: [] },
        { name: "head", pivot: [0, 0], z: 1, shapes: [{ d: "M0 0 L1 1 Z", fill: "red" }] },
      ],
      face: { eyeL: [10, 500], eyeSize: 99, skin: "javascript:alert(1)" },
    };
    const r = normalizeAsset("character", bad, "old_man_2");
    expect(r.asset.id).toBe("old_man_2");
    expect(r.asset.kind).toBe("character");
    expect(r.asset.size).toEqual([300, 600]);
    expect(r.asset.tags).toEqual(["old_man"]);
    for (const n of REQUIRED_PARTS) expect(r.asset.parts.some((p) => p.name === n)).toBe(true);
    expect(r.major.join(" ")).toMatch(/"body"/);
    expect(r.major.join(" ")).toMatch(/"arm_r"/);
    expect(r.warnings.join(" ")).toMatch(/kind "prop"/);
    expect(r.warnings.join(" ")).toMatch(/Unknown part "tail"/);
    expect(r.warnings.join(" ")).toMatch(/Duplicate part "head"/);
    const head = r.asset.parts.find((p) => p.name === "head")!;
    expect(head.pivot).toEqual([300, 0]);
    const [ex, ey] = r.asset.face.eyeL;
    expect(ex).toBeGreaterThanOrEqual(100);
    expect(ey).toBeLessThanOrEqual(130);
    expect(r.asset.face.eyeSize).toBe(16);
    expect(r.asset.face.skin).toBe("#c8946b");
  });

  it("bad place: empty back layer gets a placeholder, floorY clamped", () => {
    const r = normalizeAsset("place", { layers: { back: [{ d: "nonsense" }], mid: [], front: [] }, floorY: 99 }, "p");
    expect(r.asset.floorY).toBe(1300);
    expect(r.asset.layers.back.length).toBe(2);
    expect(r.major.join(" ")).toMatch(/layers.back/);
    expect(r.major.join(" ")).toMatch(/layers.mid/);
  });

  it("prop: size clamped, anchor defaults to bottom centre, too many shapes cut", () => {
    const shape = { d: "M0 0 H50 V50 H0 Z", fill: "#e0a43c", stroke: "#2b2730", strokeWidth: 3, opacity: 1 };
    const r = normalizeAsset("prop", { size: [5, 9000], shapes: Array(12).fill(shape) }, "torch");
    expect(r.asset.size).toEqual([20, 400]);
    expect(r.asset.anchor).toEqual([10, 400]);
    expect(r.asset.shapes).toHaveLength(8);
    expect(r.asset.shapes[0].d).toBe("M0 0 H20 V50 H0 Z");
    const empty = normalizeAsset("prop", {}, "x");
    expect(empty.major.length).toBe(1);
    expect(empty.asset.shapes).toHaveLength(1);
  });
});
