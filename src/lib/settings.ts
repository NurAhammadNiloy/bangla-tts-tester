/**
 * App settings that live in this browser (localStorage): the optional page
 * branding and the defaults a new video starts with. SSR-safe: on the server,
 * or when storage is blocked, every read returns DEFAULT_SETTINGS.
 */
import type { ProjectRecord } from "@/lib/projects/types";
import { sanitizeSvg, svgFromDataUrl, cleanBrandName } from "@/lib/brand";

export type Narrator = ProjectRecord["settings"]["narrator"];
export type CaptionStyle = ProjectRecord["settings"]["captionStyle"];
export type VideoFormat = ProjectRecord["settings"]["format"];

export interface BrandSettings {
  /** Page name shown on the end card / watermark. Empty = no branding. */
  name: string;
  /** PNG/JPEG (max 256px) or sanitised SVG as a data URL, or null. */
  logoDataUrl: string | null;
}

export interface VideoDefaults {
  narrator: Narrator;
  captionStyle: CaptionStyle;
  format: VideoFormat;
  music: boolean;
}

export interface AppSettings {
  brand: BrandSettings;
  defaults: VideoDefaults;
}

export const SETTINGS_STORAGE = "golpo.settings.v1";
export const MAX_LOGO_DATA_URL = 400_000;

export const NARRATORS: readonly Narrator[] = ["female", "male"];
export const CAPTION_STYLES: readonly CaptionStyle[] = ["box", "clean", "headline", "bubbles"];
export const FORMATS: readonly VideoFormat[] = ["9:16", "4:5"];

export const DEFAULT_SETTINGS: AppSettings = Object.freeze({
  brand: Object.freeze({ name: "", logoDataUrl: null }),
  defaults: Object.freeze({ narrator: "female", captionStyle: "box", format: "9:16", music: true }),
}) as AppSettings;

const RASTER_LOGO = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

/** Accepts a raster data URL, or an SVG data URL whose markup passes the sanitiser unchanged. */
export function isValidLogoDataUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > MAX_LOGO_DATA_URL) return false;
  if (RASTER_LOGO.test(v)) return true;
  const svg = svgFromDataUrl(v);
  return svg !== null && sanitizeSvg(svg) === svg;
}

const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Coerce anything (old/broken JSON) into a full, valid AppSettings. */
export function normalizeSettings(raw: unknown): AppSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as { brand?: Record<string, unknown>; defaults?: Record<string, unknown> };
  const b = r.brand && typeof r.brand === "object" ? r.brand : {};
  const d = r.defaults && typeof r.defaults === "object" ? r.defaults : {};
  const D = DEFAULT_SETTINGS.defaults;
  return {
    brand: {
      name: cleanBrandName(b.name),
      logoDataUrl: isValidLogoDataUrl(b.logoDataUrl) ? b.logoDataUrl : null,
    },
    defaults: {
      narrator: pick(d.narrator, NARRATORS, D.narrator),
      captionStyle: pick(d.captionStyle, CAPTION_STYLES, D.captionStyle),
      format: pick(d.format, FORMATS, D.format),
      music: typeof d.music === "boolean" ? d.music : D.music,
    },
  };
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

// Snapshot cache so getSettings() returns the same object until storage changes
// (lets components use it with useSyncExternalStore).
let cache: { raw: string | null; value: AppSettings } | null = null;

export function getSettings(): AppSettings {
  const s = storage();
  if (!s) return DEFAULT_SETTINGS;
  let raw: string | null = null;
  try {
    raw = s.getItem(SETTINGS_STORAGE);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (cache && cache.raw === raw) return cache.value;
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  cache = { raw, value: raw ? normalizeSettings(parsed) : DEFAULT_SETTINGS };
  return cache.value;
}

/** Server/first-render snapshot. */
export function getServerSettings(): AppSettings {
  return DEFAULT_SETTINGS;
}

export type SettingsPatch = { brand?: Partial<BrandSettings>; defaults?: Partial<VideoDefaults> };

const listeners = new Set<() => void>();

/** Merge a patch into the saved settings. Returns the saved value; false-y storage = not persisted. */
export function saveSettings(patch: SettingsPatch): { ok: boolean; settings: AppSettings } {
  const cur = getSettings();
  const next = normalizeSettings({
    brand: { ...cur.brand, ...patch.brand },
    defaults: { ...cur.defaults, ...patch.defaults },
  });
  const s = storage();
  let ok = false;
  if (s) {
    try {
      s.setItem(SETTINGS_STORAGE, JSON.stringify(next));
      ok = true;
    } catch {
      ok = false; // quota or private mode
    }
  }
  listeners.forEach((l) => l());
  return { ok, settings: ok ? getSettings() : next };
}

/** Call fn when settings change in this tab (saveSettings) or another tab (storage event). */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SETTINGS_STORAGE) fn();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
