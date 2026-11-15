/**
 * Episode timeline (v2), audio first: each shot lasts as long as its trimmed
 * voice line plus a short breath (and any suspense pause the plan asks for).
 * Pure functions, unit-tested.
 */
import { captionsFor, type Caption } from "@/lib/render/timeline";
import type { EpisodePlan } from "@/lib/puppet/types";

export const LEAD_IN = 0.12;
export const TAIL = 0.28;
export const END_CARD_SECONDS = 2.6;
export const MIN_SHOT = 1.2;

export interface VoiceTiming {
  /** Seconds of usable speech after trimming. */
  seconds: number;
  /** Where speech starts inside the decoded clip (trim offset). */
  offset: number;
}

export interface ShotSlot {
  shot: number;
  start: number;
  end: number;
  audioStart: number;
  audioSeconds: number;
  captions: Caption[];
}

export interface EpisodeLayout {
  slots: ShotSlot[];
  total: number; // includes the end card
  endCardStart: number;
  voiceRegions: { start: number; end: number }[];
  silences: { start: number; end: number }[];
  sfx: { name: string; at: number }[];
}

export function layoutEpisode(plan: EpisodePlan, voices: VoiceTiming[], endCard = END_CARD_SECONDS): EpisodeLayout {
  const slots: ShotSlot[] = [];
  const silences: { start: number; end: number }[] = [];
  const sfx: { name: string; at: number }[] = [];
  let t = 0;
  plan.shots.forEach((shot, i) => {
    const v = voices[i] ?? { seconds: 0, offset: 0 };
    const pause = Math.max(0, Math.min(2, shot.pause ?? 0));
    const start = t;
    const audioStart = start + LEAD_IN;
    const body = LEAD_IN + v.seconds + TAIL;
    const end = start + Math.max(MIN_SHOT, body) + pause;
    if (pause > 0) silences.push({ start: audioStart + v.seconds, end });
    for (const name of shot.sfx ?? []) sfx.push({ name, at: start + 0.05 });
    slots.push({
      shot: i,
      start,
      end,
      audioStart,
      audioSeconds: v.seconds,
      captions: v.seconds > 0 ? captionsFor(shot.line, audioStart, v.seconds) : [],
    });
    t = end;
  });
  const endCardStart = t;
  return {
    slots,
    total: t + endCard,
    endCardStart,
    voiceRegions: slots.filter((s) => s.audioSeconds > 0).map((s) => ({ start: s.audioStart, end: s.audioStart + s.audioSeconds })),
    silences,
    sfx,
  };
}

/** Rough cost/time preview before anything is paid for. */
export function estimateEpisode(plan: EpisodePlan, lettersPerSecond = 12) {
  const speech = plan.shots.reduce((a, s) => a + [...s.line.replace(/\[[^\]]*\]/g, "")].length / lettersPerSecond, 0);
  const seconds = speech + plan.shots.length * (LEAD_IN + TAIL) + END_CARD_SECONDS;
  const newAssets =
    plan.cast.filter((c) => c.new).length + plan.places.filter((p) => p.new).length + (plan.props ?? []).filter((p) => p.new).length;
  return { seconds, shots: plan.shots.length, newAssets };
}
