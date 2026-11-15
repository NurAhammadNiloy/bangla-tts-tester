/** Plain-words labels for a saved project (pure, unit-tested). */
import type { ProjectRecord, VideoStyle } from "@/lib/projects/types";

export const STYLE_LABELS: Record<VideoStyle, { label: string; icon: string }> = {
  puppet: { label: "Cartoon", icon: "🎭" },
  cinematic: { label: "Cinematic", icon: "🎥" },
  explainer: { label: "Explainer", icon: "📖" },
};

export function styleLabel(style: VideoStyle | string | undefined): { label: string; icon: string } {
  return STYLE_LABELS[style as VideoStyle] ?? { label: "Video", icon: "🎬" };
}

export type ProjectStatus = { label: string; tone: "draft" | "working" | "ready" };

export function projectStatus(p: Pick<ProjectRecord, "episodes">): ProjectStatus {
  const eps = p.episodes ?? [];
  if (eps.length === 0) return { label: "Story only", tone: "draft" };
  const ready = eps.filter((e) => e.status === "ready").length;
  if (ready === eps.length) return { label: eps.length === 1 ? "Video ready" : "All videos ready", tone: "ready" };
  if (ready > 0) return { label: `${ready} of ${eps.length} ready`, tone: "working" };
  if (eps.some((e) => e.status !== "draft")) return { label: "In progress", tone: "working" };
  return { label: "Draft", tone: "draft" };
}

export function episodesLabel(n: number): string {
  return n === 1 ? "1 episode" : `${n} episodes`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then a date. */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function projectTitle(p: Pick<ProjectRecord, "title" | "story">): string {
  const t = p.title?.trim();
  if (t) return t;
  const first = [...(p.story ?? "").trim()].slice(0, 40).join("").trim();
  return first ? `${first}…` : "Untitled story";
}

/** Latest first. */
export function sortProjects<T extends { updatedAt: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}
