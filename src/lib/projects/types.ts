/**
 * Project storage contracts (v2). Projects live in the browser (IndexedDB) so a
 * refresh never loses paid work. Binary assets (voice, pictures, video) are
 * stored separately by key so project records stay small.
 */
import type { Genre, StoryPlan } from "@/lib/storyPlan";
import type { EpisodePlan, CharacterAsset, PlaceAsset, PropAsset } from "@/lib/puppet/types";

export type VideoStyle = "puppet" | "cinematic" | "explainer";

export interface EpisodeRecord {
  index: number; // 0-based part index
  title: string;
  status: "draft" | "planned" | "voiced" | "ready";
  /** Puppet-style episode plan (v2). */
  plan?: EpisodePlan;
  /** Asset keys of saved blobs, see AssetKey. */
  assets: string[];
  updatedAt: number;
}

export interface ProjectRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  style: VideoStyle;
  story: string;
  genre: Genre | null;
  /** Series outline from the Story Editor (parts with hooks). */
  outline?: StoryPlan;
  episodes: EpisodeRecord[];
  /** Assets the asset maker built for this series (reused across episodes). */
  library?: {
    characters: Record<string, CharacterAsset>;
    places: Record<string, PlaceAsset>;
    props: Record<string, PropAsset>;
  };
  settings: {
    narrator: "female" | "male";
    captionStyle: "box" | "clean" | "headline" | "bubbles";
    format: "9:16" | "4:5";
    music: boolean;
    pageName?: string;
  };
  /** Free-form state the legacy Studio page wants to keep. */
  studio?: unknown;
}

/** Keys look like `${projectId}/${episodeIndex}/voice/${shot}` or `${projectId}/${episodeIndex}/video`. */
export type AssetKey = string;
