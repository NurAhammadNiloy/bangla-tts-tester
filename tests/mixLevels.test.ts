import { describe, expect, it } from "vitest";
import { applyLevels } from "@/lib/audio/mix/mixer";

describe("applyLevels", () => {
  const sr = 1000;
  it("drops the music inside a region and restores it outside", () => {
    const g = new Float32Array(10 * sr).fill(1);
    applyLevels(g, [{ start: 4, end: 7, gain: 0.05 }], sr);
    expect(g[5 * sr]).toBeCloseTo(0.05, 3);
    expect(g[0]).toBeCloseTo(1, 3);
    expect(g[9 * sr]).toBeCloseTo(1, 3);
  });
  it("fades smoothly in and out (no hard steps)", () => {
    const g = new Float32Array(10 * sr).fill(1);
    applyLevels(g, [{ start: 4, end: 7, gain: 0.05 }], sr);
    let maxStep = 0;
    for (let i = 1; i < g.length; i++) maxStep = Math.max(maxStep, Math.abs(g[i] - g[i - 1]));
    expect(maxStep).toBeLessThan(0.02);
  });
  it("does nothing without levels", () => {
    const g = new Float32Array(100).fill(1);
    applyLevels(g, [], sr);
    expect(Array.from(g).every((x) => x === 1)).toBe(true);
  });
});
