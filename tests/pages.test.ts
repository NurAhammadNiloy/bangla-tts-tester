import { describe, expect, it } from "vitest";
import { episodesLabel, projectStatus, projectTitle, sortProjects, styleLabel, timeAgo } from "@/components/projects/projectInfo";
import { maskKey } from "@/components/settings/maskKey";
import type { EpisodeRecord } from "@/lib/projects/types";

const ep = (status: EpisodeRecord["status"]): EpisodeRecord => ({ index: 0, title: "", status, assets: [], updatedAt: 0 });

describe("project labels", () => {
  it("derives a status from episodes", () => {
    expect(projectStatus({ episodes: [] }).label).toBe("Story only");
    expect(projectStatus({ episodes: [ep("draft")] }).label).toBe("Draft");
    expect(projectStatus({ episodes: [ep("planned"), ep("draft")] }).label).toBe("In progress");
    expect(projectStatus({ episodes: [ep("ready"), ep("voiced")] })).toEqual({ label: "1 of 2 ready", tone: "working" });
    expect(projectStatus({ episodes: [ep("ready")] }).tone).toBe("ready");
  });
  it("names styles, counts and times", () => {
    expect(styleLabel("puppet").label).toBe("Cartoon");
    expect(styleLabel("weird").label).toBe("Video");
    expect(episodesLabel(1)).toBe("1 episode");
    expect(episodesLabel(3)).toBe("3 episodes");
    const now = 1_700_000_000_000;
    expect(timeAgo(now - 10_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 3 * 3600_000, now)).toBe("3 h ago");
    expect(timeAgo(now - 26 * 3600_000, now)).toBe("yesterday");
    expect(timeAgo(now - 4 * 86400_000, now)).toBe("4 days ago");
    expect(timeAgo(now - 40 * 86400_000, now)).toMatch(/2023/);
  });
  it("falls back to the story start for a title and sorts latest first", () => {
    expect(projectTitle({ title: " ", story: "এক গ্রামে এক মেয়ে ছিল" })).toBe("এক গ্রামে এক মেয়ে ছিল…");
    expect(projectTitle({ title: "", story: "" })).toBe("Untitled story");
    expect(sortProjects([{ updatedAt: 1 }, { updatedAt: 3 }, { updatedAt: 2 }]).map((p) => p.updatedAt)).toEqual([3, 2, 1]);
  });
});

describe("maskKey", () => {
  it("shows only the start and the last 4", () => {
    expect(maskKey("sk-or-v1-0123456789abcdef0123456789abcdef")).toBe("sk-or-v1-••••cdef");
    expect(maskKey("")).toBe("");
    expect(maskKey("short")).toBe("••••");
  });
});

import { fitSize } from "@/components/settings/logoFile";
describe("fitSize", () => {
  it("fits inside 256 without upscaling", () => {
    expect(fitSize(1024, 512)).toEqual({ w: 256, h: 128 });
    expect(fitSize(100, 300)).toEqual({ w: 85, h: 256 });
    expect(fitSize(64, 64)).toEqual({ w: 64, h: 64 });
    expect(fitSize(0, 0)).toEqual({ w: 256, h: 256 });
  });
});
