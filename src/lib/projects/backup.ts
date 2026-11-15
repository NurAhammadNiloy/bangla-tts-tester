/**
 * Project backup and restore. Projects live in this browser (IndexedDB), which
 * the browser can clear. A backup is one .json file holding the project and every
 * saved asset (voices, pictures, videos). The OpenRouter key is never included.
 */
import { getAsset, getProject, isProjectId, listAssetKeys, newProjectId, putAsset, putProject } from "./db";
import type { ProjectRecord } from "./types";

export const BACKUP_FORMAT = "golpo-backup";
export const BACKUP_VERSION = 1;

export interface BackupAsset {
  key: string;
  type: string;
  /** base64 */
  data: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  project: ProjectRecord;
  assets: BackupAsset[];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function buildBackup(id: string, now = Date.now()): Promise<BackupFile> {
  const project = await getProject(id);
  if (!project) throw new Error("That project was not found in this browser.");
  const keys = await listAssetKeys(`${id}/`);
  const assets: BackupAsset[] = [];
  for (const key of keys) {
    const blob = await getAsset(key);
    if (!blob) continue;
    assets.push({ key, type: blob.type || "application/octet-stream", data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, project, assets };
}

export async function exportProject(id: string): Promise<{ blob: Blob; fileName: string }> {
  const file = await buildBackup(id);
  const safe = (file.project.title || "story").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "story";
  return { blob: new Blob([JSON.stringify(file)], { type: "application/json" }), fileName: `golpo-${safe}.json` };
}

/** Read and check a backup file's text. Throws a plain-English error when it is not a usable backup. */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file is not a Golpo backup (it could not be read).");
  }
  const o = raw as Partial<BackupFile> | null;
  if (!o || o.format !== BACKUP_FORMAT) throw new Error("This file is not a Golpo backup.");
  if (typeof o.version !== "number" || o.version > BACKUP_VERSION) throw new Error("This backup is from a newer version of Golpo Studio.");
  if (!o.project || !isProjectId(o.project.id) || !Array.isArray(o.project.episodes)) throw new Error("This backup has no valid project in it.");
  const assets = Array.isArray(o.assets) ? o.assets : [];
  for (const a of assets) {
    if (!a || typeof a.key !== "string" || !a.key.startsWith(`${o.project.id}/`) || typeof a.data !== "string") {
      throw new Error("This backup contains a damaged picture or voice entry.");
    }
  }
  return { format: BACKUP_FORMAT, version: o.version, exportedAt: Number(o.exportedAt) || 0, project: o.project, assets };
}

/**
 * Restore a backup. If a project with the same id already exists here, the
 * backup is saved as a new project (nothing is overwritten).
 */
export async function importBackup(text: string): Promise<ProjectRecord> {
  const file = parseBackup(text);
  const oldId = file.project.id;
  const exists = !!(await getProject(oldId));
  const id = exists ? newProjectId() : oldId;
  for (const a of file.assets) {
    const key = id === oldId ? a.key : `${id}/${a.key.slice(oldId.length + 1)}`;
    await putAsset(key, new Blob([base64ToBytes(a.data) as BlobPart], { type: a.type }));
  }
  return putProject({ ...file.project, id, title: exists ? `${file.project.title} (restored)` : file.project.title });
}
