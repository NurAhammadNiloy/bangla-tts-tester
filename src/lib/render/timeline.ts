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
  const sentences = clean.match(/[^।?!]+[।?!]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  const parts = sentences.flatMap((s) => chunkSentence(s));
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

/**
 * Break a long sentence into reel-sized chunks (~42 letters), preferring commas,
 * then spaces, so each subtitle fits in two short lines.
 */
export function chunkSentence(sentence: string, max = 42): string[] {
  const len = (t: string) => [...t].length;
  if (len(sentence) <= max) return [sentence];
  // Natural breaks first: clauses ending in a comma. Overlong clauses fall back to spaces.
  const clauses = sentence.split(/(?<=,)\s+/).flatMap((c) => {
    if (len(c) <= max) return [c];
    const words: string[] = [];
    let cur = "";
    for (const w of c.split(/\s+/)) {
      const next = cur ? `${cur} ${w}` : w;
      if (len(next) > max && cur) {
        words.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) words.push(cur);
    return words;
  });
  const out: string[] = [];
  let cur = "";
  for (const c of clauses) {
    const next = cur ? `${cur} ${c}` : c;
    if (len(next) > max && cur) {
      out.push(cur);
      cur = c;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
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

export interface CaptionWord {
  text: string;
  x: number;
  y: number;
  width: number;
  /** Index across the whole caption, for highlighting. */
  index: number;
}

export interface CaptionLayout {
  fontSize: number;
  words: CaptionWord[];
  box: { x: number; y: number; w: number; h: number };
}

/**
 * Lay out subtitle words with explicit positions (left-aligned drawing, each line
 * centred by measurement), so we never depend on canvas textAlign — which iOS
 * Safari renders wrongly for Bangla — and can colour single words.
 * `measure(text, fontSize)` returns the text width at that size.
 */
export function layoutCaption(
  text: string,
  W: number,
  H: number,
  measure: (s: string, size: number) => number,
  opts: { centerY?: number; maxWidthRatio?: number; sizeRatio?: number; maxLines?: number } = {},
): CaptionLayout {
  const maxW = W * (opts.maxWidthRatio ?? 0.84);
  const maxLines = opts.maxLines ?? 3;
  let size = Math.round(W * (opts.sizeRatio ?? 0.076));
  let lines: string[] = [];
  for (let i = 0; i < 10; i++) {
    lines = wrapLines(text, maxW, (t) => measure(t, size));
    const tooWide = lines.some((l) => measure(l, size) > maxW);
    if (!tooWide && lines.length <= maxLines) break;
    size = Math.max(18, Math.round(size * 0.9));
  }
  lines = lines.slice(0, maxLines); // last resort, never overflow the frame
  const lh = size * 1.42;
  const pad = size * 0.5;
  const space = measure(" ", size) || size * 0.28;
  const blockH = lines.length * lh;
  let top = H * (opts.centerY ?? 0.74) - blockH / 2;
  top = Math.min(top, H * 0.95 - blockH - pad);
  const words: CaptionWord[] = [];
  let widest = 0;
  let index = 0;
  lines.forEach((line, li) => {
    const parts = line.split(/\s+/).filter(Boolean);
    const widths = parts.map((p) => measure(p, size));
    const lineW = Math.min(maxW, widths.reduce((a, b) => a + b, 0) + space * Math.max(0, parts.length - 1));
    widest = Math.max(widest, lineW);
    let x = (W - lineW) / 2;
    const y = top + lh * (li + 0.5);
    parts.forEach((p, k) => {
      words.push({ text: p, x, y, width: widths[k], index: index++ });
      x += widths[k] + space;
    });
  });
  const boxW = widest + pad * 2;
  return { fontSize: size, words, box: { x: (W - boxW) / 2, y: top - pad, w: boxW, h: blockH + pad * 2 } };
}

/**
 * Which word is being spoken, estimated from progress through the caption and
 * word length (until real word timestamps are added). Returns -1 outside it.
 */
export function activeWordIndex(words: string[], progress: number): number {
  if (!words.length || progress < 0 || progress >= 1) return -1;
  const w = words.map((x) => Math.max(1, [...x].length));
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < w.length; i++) {
    acc += w[i];
    if (progress < acc / total) return i;
  }
  return w.length - 1;
}
