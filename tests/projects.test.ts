import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAssetsByPrefix,
  deleteProject,
  getAsset,
  getProject,
  isProjectId,
  listAssetKeys,
  listProjects,
  memoryBackend,
  newProjectId,
  putAsset,
  putProject,
  setBackend,
  storageAvailable,
} from "@/lib/projects/db";
import { clearKey, getKey, hasKey, KEY_STORAGE, setKey } from "@/lib/projects/keyStore";
import type { ProjectRecord } from "@/lib/projects/types";
import { GET as keyGet } from "@/app/api/key/route";
import { _resetRateLimit } from "@/lib/rateLimit";
import { errorResponse, FAKE_KEY, mockFetch } from "./helpers";

function project(id: string, title = "গল্প"): ProjectRecord {
  return {
    id,
    title,
    createdAt: 0,
    updatedAt: 0,
    style: "cinematic",
    story: "",
    genre: null,
    episodes: [],
    settings: { narrator: "female", captionStyle: "box", format: "9:16", music: false },
  };
}

describe("projects db", () => {
  beforeEach(() => setBackend(memoryBackend()));
  afterEach(() => setBackend(null));

  it("makes valid, unique project ids", () => {
    const a = newProjectId();
    const b = newProjectId();
    expect(isProjectId(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(isProjectId("../x")).toBe(false);
  });

  it("puts, gets and lists projects newest first, setting timestamps", async () => {
    const a = await putProject(project("p-a"), 1000);
    expect(a.createdAt).toBe(1000);
    expect(a.updatedAt).toBe(1000);
    await putProject(project("p-b"), 2000);
    const again = await putProject({ ...a, title: "নতুন" }, 3000);
    expect(again.createdAt).toBe(1000);
    expect((await getProject("p-a"))?.title).toBe("নতুন");
    expect((await listProjects()).map((p) => p.id)).toEqual(["p-a", "p-b"]);
    expect(await getProject("p-missing")).toBeNull();
    await expect(putProject(project("bad id"))).rejects.toThrow();
  });

  it("stores blobs by key and lists them by prefix", async () => {
    await putAsset("p-a/0/voice/0", new Blob(["x"]));
    await putAsset("p-a/0/voice/1", new Blob(["y"]));
    await putAsset("p-a/0/video", new Blob(["v"]));
    await putAsset("p-ab/0/video", new Blob(["other"]));
    expect(await listAssetKeys("p-a/0/voice/")).toEqual(["p-a/0/voice/0", "p-a/0/voice/1"]);
    expect(await (await getAsset("p-a/0/voice/1"))!.text()).toBe("y");
    expect(await getAsset("nope")).toBeNull();
    expect(await deleteAssetsByPrefix("p-a/0/voice/")).toBe(2);
    expect(await listAssetKeys("p-a/")).toEqual(["p-a/0/video"]);
    await expect(deleteAssetsByPrefix("")).rejects.toThrow();
  });

  it("deleting a project removes only its own assets", async () => {
    await putProject(project("p-a"));
    await putProject(project("p-ab"));
    await putAsset("p-a/0/video", new Blob(["v"]));
    await putAsset("p-ab/0/video", new Blob(["w"]));
    await deleteProject("p-a");
    expect(await getProject("p-a")).toBeNull();
    expect(await listAssetKeys("")).toEqual(["p-ab/0/video"]);
  });

  it("does not crash without IndexedDB (SSR)", async () => {
    setBackend(null);
    expect(storageAvailable()).toBe(false);
    await expect(listProjects()).rejects.toThrow(/not available/);
  });
});

describe("key store", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is safe on the server", () => {
    expect(getKey()).toBe("");
    expect(hasKey()).toBe(false);
    expect(setKey("abc")).toBe(false);
    expect(() => clearKey()).not.toThrow();
  });

  it("saves, reads and clears the key in localStorage", () => {
    const m = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      },
    });
    expect(setKey("  sk-or-v1-abc  ")).toBe(true);
    expect(m.get(KEY_STORAGE)).toBe("sk-or-v1-abc");
    expect(getKey()).toBe("sk-or-v1-abc");
    expect(hasKey()).toBe(true);
    clearKey();
    expect(hasKey()).toBe(false);
    setKey("x");
    setKey("");
    expect(hasKey()).toBe(false);
  });
});

describe("GET /api/key", () => {
  beforeEach(() => _resetRateLimit());
  afterEach(() => vi.unstubAllGlobals());
  const req = (key: string | null) =>
    new Request("http://localhost/api/key", { headers: key ? { "x-openrouter-key": key } : {} });

  it("401 without a key and never calls OpenRouter", async () => {
    const { calls } = mockFetch(() => new Response("{}"));
    const res = await keyGet(req(null));
    expect(res.status).toBe(401);
    expect((await res.json()).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("returns label, remaining credit and usage", async () => {
    const { calls } = mockFetch(() =>
      Response.json({ data: { label: "my key", limit: 10, limit_remaining: 7.5, usage: 2.5 } }),
    );
    const res = await keyGet(req(FAKE_KEY));
    expect(await res.json()).toEqual({ ok: true, label: "my key", limitRemaining: 7.5, usage: 2.5 });
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/key");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
  });

  it("explains a rejected key", async () => {
    mockFetch(() => errorResponse(401, "User not found"));
    const res = await keyGet(req(FAKE_KEY));
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/did not accept/);
  });
});
