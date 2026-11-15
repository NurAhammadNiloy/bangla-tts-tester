import { beforeEach, describe, expect, it } from "vitest";
import { getAsset, getProject, memoryBackend, putAsset, putProject, setBackend } from "@/lib/projects/db";
import { buildBackup, importBackup, parseBackup } from "@/lib/projects/backup";
import type { ProjectRecord } from "@/lib/projects/types";

const project = (id: string): ProjectRecord => ({
  id, title: "খালি ঘরের ফ্যান", createdAt: 1, updatedAt: 1, style: "puppet", story: "গল্প", genre: "emotional",
  episodes: [], settings: { narrator: "male", captionStyle: "clean", format: "9:16", music: true },
});

describe("project backup and restore", () => {
  beforeEach(() => setBackend(memoryBackend()));

  it("round-trips a project with its voices and pictures", async () => {
    const id = "p-abc-123456";
    await putProject(project(id));
    await putAsset(`${id}/0/voice/1/x`, new Blob([new Uint8Array([1, 2, 3, 250])], { type: "audio/mpeg" }));
    await putAsset(`other-project/0/voice/1/y`, new Blob(["no"]));
    const file = await buildBackup(id);
    expect(file.assets).toHaveLength(1); // only this project's assets
    expect(JSON.stringify(file)).not.toMatch(/sk-or-/);
    setBackend(memoryBackend()); // a fresh browser
    const back = await importBackup(JSON.stringify(file));
    expect(back.id).toBe(id);
    const blob = await getAsset(`${id}/0/voice/1/x`);
    expect(blob?.type).toBe("audio/mpeg");
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([1, 2, 3, 250]);
  });

  it("never overwrites: a project that already exists is restored as a copy", async () => {
    const id = "p-abc-123456";
    await putProject(project(id));
    await putAsset(`${id}/0/video`, new Blob(["v"], { type: "video/mp4" }));
    const file = await buildBackup(id);
    const copy = await importBackup(JSON.stringify(file));
    expect(copy.id).not.toBe(id);
    expect(copy.title).toContain("(restored)");
    expect(await getAsset(`${copy.id}/0/video`)).not.toBeNull();
    expect((await getProject(id))?.title).toBe("খালি ঘরের ফ্যান");
  });

  it("rejects files that are not backups, with plain messages", () => {
    expect(() => parseBackup("not json")).toThrow(/not a Golpo backup/);
    expect(() => parseBackup('{"format":"other"}')).toThrow(/not a Golpo backup/);
    expect(() => parseBackup(JSON.stringify({ format: "golpo-backup", version: 99, project: project("p-a-b") }))).toThrow(/newer version/);
    const bad = { format: "golpo-backup", version: 1, project: project("p-abc-123456"), assets: [{ key: "someone-else/0/video", type: "x", data: "" }] };
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/damaged/);
  });
});
