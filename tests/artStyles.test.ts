import { describe, expect, it } from "vitest";
import { ART_STYLES, buildImagePrompt } from "@/lib/artStyles";
import { DEFAULT_CHARACTERS, VIDEO_MOTION_HINT } from "@/lib/mergeSample";

describe("art styles", () => {
  it("has unique ids and no studio or artist brand names", () => {
    expect(new Set(ART_STYLES.map((a) => a.id)).size).toBe(ART_STYLES.length);
    const banned = /ghibli|pixar|disney|dreamworks|miyazaki|marvel|aardman|van gogh/i;
    for (const a of ART_STYLES) expect(a.prompt).not.toMatch(banned);
  });

  it("every picture prompt keeps the same characters, whatever the style", () => {
    for (const a of ART_STYLES) {
      const p = buildImagePrompt(a.prompt, "Bangladeshi village setting.", DEFAULT_CHARACTERS, "Mother at the door.");
      expect(p).toContain(a.prompt);
      expect(p).toContain(`Characters: ${DEFAULT_CHARACTERS}`);
      expect(p).toMatch(/9:16/);
      expect(p.endsWith("Scene: Mother at the door.")).toBe(true);
    }
  });

  it("video motion hint is style-neutral", () => {
    expect(VIDEO_MOTION_HINT).not.toMatch(/flat 2D/i);
    expect(VIDEO_MOTION_HINT).toMatch(/same art style/i);
  });
});
