/**
 * Browser storage for projects (IndexedDB, database "golpo").
 *  - store `projects`: ProjectRecord by id
 *  - store `assets`:   Blob by AssetKey (`${projectId}/...`)
 *
 * All calls are promise-based and safe to import during SSR: they only touch
 * indexedDB when called, and reject with a clear error when it is missing.
 * The storage engine sits behind a tiny Backend interface so the logic can be
 * tested with the in-memory backend (no fake IndexedDB needed).
 */
import type { AssetKey, ProjectRecord } from "./types";

export const DB_NAME = "golpo";
export const DB_VERSION = 1;
type StoreName = "projects" | "assets";

export interface Backend {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  /** All keys starting with prefix ("" = every key), sorted. */
  keys(store: StoreName, prefix: string): Promise<string[]>;
  values<T>(store: StoreName): Promise<T[]>;
}

/* ------------------------------ IndexedDB backend ------------------------------ */

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("Browser storage request failed."));
  });
}

function prefixRange(prefix: string): IDBKeyRange | undefined {
  return prefix ? IDBKeyRange.bound(prefix, `${prefix}￿`) : undefined;
}

export function indexedDbBackend(factory: IDBFactory): Backend {
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!dbp) {
      dbp = new Promise<IDBDatabase>((resolve, reject) => {
        const r = factory.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects");
          if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
        };
        r.onsuccess = () => {
          const db = r.result;
          db.onversionchange = () => {
            db.close();
            dbp = null;
          };
          resolve(db);
        };
        r.onerror = () => {
          dbp = null;
          reject(r.error ?? new Error("Could not open browser storage."));
        };
        r.onblocked = () => reject(new Error("Browser storage is busy in another tab. Close other Golpo Studio tabs and retry."));
      });
    }
    return dbp;
  };
  const run = async <T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    const tx = db.transaction(store, mode);
    const result = req(fn(tx.objectStore(store)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Browser storage write failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Browser storage write was cancelled (storage may be full)."));
    });
    return result;
  };
  return {
    get: <T>(store: StoreName, key: string) => run(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
    put: async (store, key, value) => {
      await run(store, "readwrite", (s) => s.put(value, key));
    },
    delete: async (store, key) => {
      await run(store, "readwrite", (s) => s.delete(key));
    },
    keys: async (store, prefix) => {
      const ks = await run(store, "readonly", (s) => s.getAllKeys(prefixRange(prefix)));
      return ks.map(String).sort();
    },
    values: <T>(store: StoreName) => run(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
  };
}

/* ------------------------------ memory backend (tests) ------------------------------ */

export function memoryBackend(): Backend {
  const data: Record<StoreName, Map<string, unknown>> = { projects: new Map(), assets: new Map() };
  return {
    get: async <T>(store: StoreName, key: string) => data[store].get(key) as T | undefined,
    put: async (store, key, value) => {
      data[store].set(key, structuredClone(value));
    },
    delete: async (store, key) => {
      data[store].delete(key);
    },
    keys: async (store, prefix) => [...data[store].keys()].filter((k) => k.startsWith(prefix)).sort(),
    values: async <T>(store: StoreName) => [...data[store].values()] as T[],
  };
}

/* ------------------------------ active backend ------------------------------ */

let active: Backend | null = null;

/** Tests (or a future sync layer) can swap the storage engine. Pass null to reset. */
export function setBackend(b: Backend | null): void {
  active = b;
}

export function storageAvailable(): boolean {
  return active !== null || typeof indexedDB !== "undefined";
}

function backend(): Backend {
  if (active) return active;
  if (typeof indexedDB === "undefined") throw new Error("Browser storage (IndexedDB) is not available here.");
  active = indexedDbBackend(indexedDB);
  return active;
}

/* ------------------------------ public API ------------------------------ */

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Short, sortable, URL-safe id, e.g. "p-lq3x9a-4f7k2c". */
export function newProjectId(now = Date.now(), rand: () => number = Math.random): string {
  const r = Array.from({ length: 6 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)]).join("");
  return `p-${now.toString(36)}-${r}`;
}

export function isProjectId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/** All projects, newest change first. */
export async function listProjects(): Promise<ProjectRecord[]> {
  const all = await backend().values<ProjectRecord>("projects");
  return all.filter((p) => p && isProjectId(p.id)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  if (!isProjectId(id)) return null;
  return (await backend().get<ProjectRecord>("projects", id)) ?? null;
}

/** Save a project. Sets updatedAt (and createdAt if missing). Returns the stored record. */
export async function putProject(p: ProjectRecord, now = Date.now()): Promise<ProjectRecord> {
  if (!isProjectId(p.id)) throw new Error("Invalid project id.");
  const rec: ProjectRecord = { ...p, createdAt: p.createdAt || now, updatedAt: now };
  await backend().put("projects", rec.id, rec);
  return rec;
}

/** Delete a project and every asset whose key starts with `${id}/`. */
export async function deleteProject(id: string): Promise<void> {
  if (!isProjectId(id)) return;
  await deleteAssetsByPrefix(`${id}/`);
  await backend().delete("projects", id);
}

export async function putAsset(key: AssetKey, blob: Blob): Promise<void> {
  if (!key) throw new Error("Empty asset key.");
  await backend().put("assets", key, blob);
}

export async function getAsset(key: AssetKey): Promise<Blob | null> {
  return (await backend().get<Blob>("assets", key)) ?? null;
}

export async function listAssetKeys(prefix: string): Promise<AssetKey[]> {
  return backend().keys("assets", prefix);
}

export async function deleteAsset(key: AssetKey): Promise<void> {
  await backend().delete("assets", key);
}

/** Delete every asset under prefix. An empty prefix is refused (it would wipe everything). */
export async function deleteAssetsByPrefix(prefix: string): Promise<number> {
  if (!prefix) throw new Error("Refusing to delete every asset: give a prefix.");
  const b = backend();
  const keys = await b.keys("assets", prefix);
  for (const k of keys) await b.delete("assets", k);
  return keys.length;
}
