/**
 * Audio-first timeline. Narration durations decide everything; visuals are fitted to them.
 */

export interface Slot {
  index: number;
  start: number; // seconds on the final timeline
  end: number;
  audioStart: number; // when this scene's narration begins (= start + lead-in)
  audioDuration: number;
}

/**
 * Lay scenes end to end. Each scene = leadIn + narration + tail, so there is a
 * short breath between lines and the cut never clips the last syllable.
 */
export function buildTimeline(audioDurations: number[], leadIn = 0.15, tail = 0.35): Slot[] {
  const slots: Slot[] = [];
  let t = 0;
  audioDurations.forEach((d, index) => {
    const dur = Math.max(0, d);
    const start = t;
    const end = start + leadIn + dur + tail;
    slots.push({ index, start, end, audioStart: start + leadIn, audioDuration: dur });
    t = end;
  });
  return slots;
}

export function totalDuration(slots: Slot[]): number {
  return slots.length ? slots[slots.length - 1].end : 0;
}

export function slotAt(slots: Slot[], t: number): Slot | null {
  for (const s of slots) if (t >= s.start && t < s.end) return s;
  return null;
}

/**
 * Playback rate that makes a clip exactly fill its slot.
 * Clamped to a range that still looks natural; outside it we trim (rate too high
 * would look sped up) or hold the last frame (rate too low would look slow-mo).
 */
export function fitRate(clipSeconds: number, slotSeconds: number, min = 0.8, max = 1.25): number {
  if (clipSeconds <= 0 || slotSeconds <= 0) return 1;
  const r = clipSeconds / slotSeconds;
  return Math.min(max, Math.max(min, r));
}

/** Remove [tags] for on-screen subtitles. */
export function cleanSubtitle(text: string): string {
  return text.replace(/\[[^\]\n]{1,40}\]/g, " ").replace(/\s+/g, " ").replace(/\s+([,।?!])/g, "$1").trim();
}

export interface Caption {
  text: string;
  start: number;
  end: number;
}

/**
 * Split narration into sentences (। ? !) and give each a share of the narration
 * time proportional to its length. Good enough until word timestamps arrive.
 */
export function captionsFor(narration: string, audioStart: number, audioDuration: number): Caption[] {
  const clean = cleanSubtitle(narration);
  if (!clean) return [];
  const parts = clean.match(/[^।?!]+[।?!]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  const weights = parts.map((p) => Math.max(1, [...p].length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = audioStart;
  return parts.map((text, i) => {
    const d = (weights[i] / sum) * audioDuration;
    const c = { text, start: t, end: t + d };
    t += d;
    return c;
  });
}

/** Ken Burns: gentle zoom in (even scenes) or out (odd), slight drift. p is 0..1 through the slot. */
export function kenBurns(index: number, p: number): { scale: number; dx: number; dy: number } {
  const e = p * p * (3 - 2 * p); // smoothstep
  const zoomIn = index % 2 === 0;
  const scale = zoomIn ? 1.0 + 0.12 * e : 1.12 - 0.12 * e;
  const dir = index % 4 < 2 ? 1 : -1;
  return { scale, dx: dir * 0.03 * (e - 0.5), dy: -0.02 * (e - 0.5) };
}

/** Wrap text into lines that fit maxWidth using a measure function (canvas measureText in the app). */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (measure(next) <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}
