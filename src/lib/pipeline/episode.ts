/**
 * Episode pipeline (v2), client side:
 *   story outline → episode plan → new assets → voices → mix → segments → video.
 * Every network call goes through our own /api routes with the user's key.
 */
import type { Genre, StoryPlan } from "@/lib/storyPlan";
import { partText } from "@/lib/storyPlan";
import type { AssetLibrary, EpisodePlan, CastMember, PlaceRef, ShotFrame } from "@/lib/puppet/types";
import { STARTER_LIBRARY, summarizeLibrary } from "@/lib/puppet/library";
import { normalizePlan, splitLongShots, validateAsset } from "@/lib/puppet/validate";
import { createShotDrawer, speakerAnchor } from "@/lib/puppet/engine";
import { envelope, mixBed, trimSilence } from "@/lib/audio/mix";
import type { AmbienceName, SfxName } from "@/lib/audio/mix/types";
import type { Segment } from "@/lib/render/episodeRenderer";
import { layoutEpisode, type EpisodeLayout, type VoiceTiming } from "./layout";

export type Status = (text: string, progress?: number) => void;

async function postJson<T>(url: string, key: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-openrouter-key": key },
    body: JSON.stringify(body),
    signal,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Request failed (HTTP ${res.status}).`);
  return j as T;
}

/* --------------------------------- library -------------------------------- */

export function mergeLibrary(extra?: Partial<AssetLibrary> | null): AssetLibrary {
  return {
    characters: { ...STARTER_LIBRARY.characters, ...(extra?.characters ?? {}) },
    places: { ...STARTER_LIBRARY.places, ...(extra?.places ?? {}) },
    props: { ...STARTER_LIBRARY.props, ...(extra?.props ?? {}) },
  };
}

/* ---------------------------------- plan ---------------------------------- */

export async function planSeries(story: string, key: string, partMinutes: number | null, signal?: AbortSignal) {
  const r = await postJson<{ plan: StoryPlan; model: string }>("/api/plan", key, { mode: "outline", story, partMinutes }, signal);
  return r.plan;
}

export async function planEpisode(
  outline: StoryPlan,
  partIndex: number,
  lib: AssetLibrary,
  key: string,
  opts: { narrator: "female" | "male"; previous?: EpisodePlan | null; signal?: AbortSignal },
): Promise<{ plan: EpisodePlan; warnings: string[] }> {
  const part = outline.parts[partIndex];
  const r = await postJson<{ plan: unknown; warnings?: string[] }>(
    "/api/episode",
    key,
    {
      text: partText(outline, part),
      genre: outline.genre,
      partTitle: part.title,
      partIndex,
      partsTotal: outline.parts.length,
      hook: part.hook,
      isLast: partIndex === outline.parts.length - 1,
      characters: outline.characters,
      setting: outline.setting,
      librarySummary: summarizeLibrary(lib),
      previousCast: opts.previous?.cast,
      previousPlaces: opts.previous?.places,
      narrator: opts.narrator,
    },
    opts.signal,
  );
  const n = normalizePlan(r.plan, lib);
  return { plan: n.plan, warnings: [...(r.warnings ?? []), ...n.warnings] };
}

/* --------------------------------- assets --------------------------------- */

interface NeededAsset {
  kind: "character" | "place" | "prop";
  id: string;
  look: string;
}

export function neededAssets(plan: EpisodePlan, lib: AssetLibrary): NeededAsset[] {
  const out: NeededAsset[] = [];
  const has = (kind: NeededAsset["kind"], id: string) =>
    kind === "character" ? !!lib.characters[id] : kind === "place" ? !!lib.places[id] : !!lib.props[id];
  for (const c of plan.cast) if (c.new && !has("character", c.asset)) out.push({ kind: "character", id: c.asset, look: c.look });
  for (const p of plan.places) if (p.new && !has("place", p.asset)) out.push({ kind: "place", id: p.asset, look: p.look });
  for (const p of plan.props ?? []) if (p.new && !has("prop", p.asset)) out.push({ kind: "prop", id: p.asset, look: p.look });
  return out;
}

/** Ask the asset maker for every new character/place/prop. Returns only the newly made assets. */
export async function buildAssets(
  plan: EpisodePlan,
  lib: AssetLibrary,
  key: string,
  status: Status,
  signal?: AbortSignal,
): Promise<{ made: Partial<AssetLibrary>; failed: string[] }> {
  const need = neededAssets(plan, lib);
  const made: AssetLibrary = { characters: {}, places: {}, props: {} };
  const failed: string[] = [];
  for (let i = 0; i < need.length; i++) {
    const n = need[i];
    status(`Drawing ${n.kind} ${i + 1} of ${need.length}…`, i / Math.max(1, need.length));
    try {
      const r = await postJson<{ asset: unknown }>("/api/asset", key, { kind: n.kind, id: n.id, look: n.look }, signal);
      const v = validateAsset(r.asset);
      if (!v.ok || !v.asset) throw new Error(v.errors.join("; "));
      const a = v.asset;
      if (a.kind === "character") made.characters[n.id] = { ...a, id: n.id };
      else if (a.kind === "place") made.places[n.id] = { ...a, id: n.id };
      else made.props[n.id] = { ...a, id: n.id };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      failed.push(`${n.kind} "${n.id}"`);
    }
  }
  return { made, failed };
}

/** After asset making, re-run the library-aware normaliser so failed new items fall back to the closest library item. */
export function finalizePlan(plan: EpisodePlan, lib: AssetLibrary): EpisodePlan {
  const cleared: EpisodePlan = {
    ...plan,
    cast: plan.cast.map((c): CastMember => ({ ...c, new: lib.characters[c.asset] ? false : c.new })),
    places: plan.places.map((p): PlaceRef => ({ ...p, new: lib.places[p.asset] ? false : p.new })),
    props: (plan.props ?? []).map((p) => ({ ...p, new: lib.props[p.asset] ? false : p.new })),
  };
  // Anything still marked new that the library lacks gets mapped to the closest item.
  const forNorm = {
    ...cleared,
    cast: cleared.cast.map((c) => ({ ...c, new: false })),
    places: cleared.places.map((p) => ({ ...p, new: false })),
    props: cleared.props?.map((p) => ({ ...p, new: false })),
  };
  return normalizePlan(forNorm, lib).plan;
}

/* --------------------------------- voices --------------------------------- */

export interface ShotVoice {
  blob: Blob | null;
  buffer: AudioBuffer | null; // trimmed
  timing: VoiceTiming;
  env: Float32Array | null; // loudness per frame (30 fps)
}

export function sliceBuffer(ac: BaseAudioContext, buf: AudioBuffer, start: number, end: number): AudioBuffer {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor(start * sr));
  const b = Math.min(buf.length, Math.ceil(end * sr));
  const out = ac.createBuffer(buf.numberOfChannels, Math.max(1, b - a), sr);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}

export async function decodeVoice(ac: BaseAudioContext, blob: Blob): Promise<ShotVoice> {
  const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
  const mono = decoded.getChannelData(0);
  const tr = trimSilence(mono, decoded.sampleRate, { keep: 0.08 });
  const buffer = sliceBuffer(ac, decoded, tr.start, tr.end);
  return {
    blob,
    buffer,
    timing: { seconds: buffer.duration, offset: tr.start },
    env: envelope(buffer.getChannelData(0), buffer.sampleRate, 30),
  };
}

export async function speakLine(
  key: string,
  body: { model: string; text: string; voice: string | null; instructions?: string },
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-openrouter-key": key },
    body: JSON.stringify({ model: body.model, text: body.text, voice: body.voice ?? undefined, format: "auto", instructions: body.instructions }),
    signal,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `Voice failed (HTTP ${res.status}).`);
  }
  return res.blob();
}

/* ---------------------------------- mix ----------------------------------- */

function ambienceFor(plan: EpisodePlan, placeId: string | undefined): AmbienceName {
  const p = plan.places.find((x) => x.id === placeId);
  if (!p) return "none";
  if (p.weather === "rain") return "rain";
  if (p.weather === "fog" || p.weather === "snow") return "wind";
  if (p.time === "night") return "night";
  const look = `${p.asset} ${p.look}`.toLowerCase();
  if (/street|city|road|market|bazaar|station/.test(look)) return "city";
  if (/village|field|country|farm|river|garden/.test(look)) return "village";
  if (/sea|beach|boat|ship/.test(look)) return "sea";
  return "room_hum";
}

export async function mixEpisode(
  plan: EpisodePlan,
  layout: EpisodeLayout,
  voices: ShotVoice[],
  opts: { music: boolean },
): Promise<AudioBuffer> {
  const ambience: { name: AmbienceName; start: number; end: number }[] = [];
  layout.slots.forEach((s) => {
    const shot = plan.shots[s.shot];
    const name = ambienceFor(plan, shot.place ?? shot.top?.place);
    const last = ambience[ambience.length - 1];
    if (last && last.name === name && Math.abs(last.end - s.start) < 1e-6) last.end = s.end;
    else if (name !== "none") ambience.push({ name, start: s.start, end: s.end });
  });
  return mixBed(
    {
      total: layout.total,
      voice: voices.flatMap((v, i) => (v.buffer ? [{ buffer: v.buffer, start: layout.slots[i].audioStart }] : [])),
      music: opts.music ? { mood: plan.mood } : null,
      sfx: layout.sfx.map((x) => ({ name: x.name as SfxName, at: x.at })),
      ambience,
      silences: layout.silences,
    },
    (channels, length, sampleRate) => new AudioBuffer({ numberOfChannels: channels, length, sampleRate }),
  );
}

/* -------------------------------- segments -------------------------------- */

export function buildSegments(plan: EpisodePlan, lib: AssetLibrary, layout: EpisodeLayout, voices: ShotVoice[]): Segment[] {
  const durations = layout.slots.map((s) => s.end - s.start);
  const beats = splitLongShots(plan, durations, 4);
  return beats.map((beat) => {
    const slot = layout.slots[beat.shotIndex];
    const shot = plan.shots[beat.shotIndex];
    const v = voices[beat.shotIndex];
    const draw = createShotDrawer(plan, beat.shotIndex, lib, { beat });
    const dur = slot.end - slot.start;
    const frame = (t: number): ShotFrame => {
      let talk = 0;
      if (v?.env && shot.speaker !== "narrator") {
        const k = Math.floor((t - slot.audioStart) * 30);
        if (k >= 0 && k < v.env.length) talk = v.env[k];
      }
      return { t: t - slot.start, dur, talk };
    };
    return {
      start: slot.start + beat.start,
      end: slot.start + beat.end,
      draw: (ctx, W, H, t) => draw(ctx, W, H, frame(t)),
      captions: slot.captions,
      bubble: !!shot.bubble && shot.speaker !== "narrator",
      anchor: (W, H, t) => speakerAnchor(plan, beat.shotIndex, lib, W, H, frame(t)),
    } satisfies Segment;
  });
}

/** Last segment holds through the end card so the picture never goes black. */
export function withEndHold(segments: Segment[], total: number): Segment[] {
  if (!segments.length) return segments;
  const last = segments[segments.length - 1];
  return [...segments.slice(0, -1), { ...last, end: total, captions: last.captions }];
}

export { layoutEpisode };
export type { Genre };
