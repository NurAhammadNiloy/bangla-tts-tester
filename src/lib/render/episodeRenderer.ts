/**
 * Episode renderer (v2). One pre-mixed soundtrack is the master clock; every
 * frame asks the segment under the playhead to draw itself, then adds
 * subtitles / speech bubbles, the part badge, watermark and the end card.
 *
 * The pipeline builds the segments (cartoon shots, pictures, anything that can
 * draw a frame), so this file knows nothing about puppets or images.
 */
import { drawBubble, drawCaption, FONT, measurer, pickMimeType, roundRect, type CaptionStyle } from "./renderer";
import type { Caption } from "./timeline";
import { SAFE } from "./safeZone";

export interface Segment {
  start: number; // seconds on the final timeline
  end: number;
  /** Draw the picture for global time t. */
  draw: (ctx: CanvasRenderingContext2D, W: number, H: number, t: number) => void;
  /** Subtitle chunks with absolute times. */
  captions: Caption[];
  /** Show captions as a speech bubble (dialogue). */
  bubble?: boolean;
  /** Where the speaker's head is, for the bubble tail. */
  anchor?: (W: number, H: number, t: number) => { x: number; y: number } | null;
}

export interface EpisodeRenderInput {
  soundtrack: AudioBuffer;
  segments: Segment[];
  total: number;
  /** e.g. "পর্ব ১" shown top-left for the whole video. */
  badge?: string;
  /** Page name shown small at the bottom-right. */
  watermark?: string;
  /** Final card text ("পরের পর্ব দেখুন" / "শেষ"); drawn during the last endSeconds. */
  endCard?: { text: string; sub?: string; seconds: number };
  captionStyle?: CaptionStyle | "bubbles";
}

export interface EpisodeRenderOptions {
  width?: number;
  height?: number;
  fps?: number;
  subtitles?: boolean;
  highlightWords?: boolean;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
  /** Draw only, no recording (used for live preview). */
  previewCanvas?: HTMLCanvasElement;
}

export interface EpisodeRenderResult {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}

/** Find the segment for time t (segments are sorted and contiguous). */
export function segmentAt(segments: Segment[], t: number): Segment | null {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return s;
  }
  return segments.length && t >= segments[segments.length - 1].end ? segments[segments.length - 1] : null;
}

function drawBadge(ctx: CanvasRenderingContext2D, text: string, W: number) {
  const size = Math.round(W * 0.034);
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  const w = measurer(ctx)(text, size) + size * 1.4;
  const h = size * 1.8;
  const x = W * 0.04;
  const y = ((W * 16) / 9) * SAFE.top + W * 0.01; // just under the Facebook top bar
  ctx.fillStyle = "rgba(201,79,79,0.92)";
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, x + size * 0.7, y + h / 2);
  ctx.restore();
}

function drawWatermark(ctx: CanvasRenderingContext2D, text: string, W: number, H: number) {
  const size = Math.round(W * 0.026);
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.font = `700 ${size}px ${FONT}`;
  const w = measurer(ctx)(text, size);
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = size * 0.4;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, W - w - W * SAFE.right, H * SAFE.top + size * 1.6);
  ctx.restore();
}

/**
 * Quiet ending: the picture fades to black, then one centred question in plain
 * white text. No box, no button, no call-to-action animation. `alpha` 0..1 is
 * how far the fade has gone; the text appears once the screen is mostly black.
 */
export function drawEndCard(ctx: CanvasRenderingContext2D, W: number, H: number, card: { text: string; sub?: string }, alpha: number) {
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${Math.min(1, Math.max(0, alpha))})`;
  ctx.fillRect(0, 0, W, H);
  const textAlpha = Math.min(1, Math.max(0, (alpha - 0.6) / 0.4));
  if (textAlpha > 0 && card.text) {
    ctx.globalAlpha = textAlpha;
    const m = measurer(ctx);
    const maxW = W * (1 - 2 * SAFE.right);
    let size = Math.round(W * 0.07);
    while (size > 24 && m(card.text, size) > maxW * 1.9) size = Math.round(size * 0.92);
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const words = card.text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && m(next, size) > maxW) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    const lh = size * 1.45;
    lines.slice(0, 3).forEach((line, i, arr) => {
      const w = m(line, size);
      ctx.fillText(line, (W - w) / 2, H * 0.5 + (i - (arr.length - 1) / 2) * lh);
    });
  }
  ctx.restore();
}

/** Draw one complete frame at time t (shared by recording and live preview). */
export function drawEpisodeFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  input: EpisodeRenderInput,
  opts: { subtitles?: boolean; highlightWords?: boolean } = {},
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const seg = segmentAt(input.segments, Math.max(0, t));
  if (seg) {
    ctx.save();
    seg.draw(ctx, W, H, t);
    ctx.restore();
    if (opts.subtitles !== false) {
      const cap = seg.captions.find((c) => t >= c.start && t < c.end);
      const hl = opts.highlightWords !== false;
      if (cap) {
        const style = input.captionStyle ?? "box";
        if (seg.bubble && style === "bubbles") drawBubble(ctx, cap, t, W, H, hl, seg.anchor?.(W, H, t) ?? null);
        else if (seg.bubble) drawBubble(ctx, cap, t, W, H, hl, seg.anchor?.(W, H, t) ?? null);
        else drawCaption(ctx, cap, t, W, H, hl, style === "bubbles" ? "box" : style);
      }
    }
  }
  if (input.badge) drawBadge(ctx, input.badge, W);
  if (input.watermark) drawWatermark(ctx, input.watermark, W, H);
  if (input.endCard) {
    const from = input.total - input.endCard.seconds;
    if (t >= from) drawEndCard(ctx, W, H, input.endCard, Math.min(1, (t - from) / 1.0));
  }
}

export async function renderEpisode(
  ac: AudioContext,
  input: EpisodeRenderInput,
  opts: EpisodeRenderOptions = {},
): Promise<EpisodeRenderResult> {
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const fps = opts.fps ?? 24; // cinema rate; the brief asks for 24 fps
  const mimeType = pickMimeType();
  if (typeof MediaRecorder === "undefined" || !mimeType) {
    throw new Error("This browser cannot record video. Use Chrome, Edge, or Safari 15+.");
  }
  const total = input.total;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  drawEpisodeFrame(ctx, W, H, 0, input, opts);

  const dest = ac.createMediaStreamDestination();
  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: W >= 1080 ? 8_000_000 : 4_000_000,
    audioBitsPerSecond: 160_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));

  if (ac.state !== "running") {
    // Browsers only start audio after a real tap; never hang if that permission is missing.
    await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 3000))]);
    if ((ac.state as string) !== "running") throw new Error("The browser blocked sound. Tap “Make the video” again.");
  }
  const t0 = ac.currentTime + 0.25;
  const src = ac.createBufferSource();
  src.buffer = input.soundtrack;
  src.connect(dest);
  src.start(t0);
  await new Promise((r) => setTimeout(r, Math.max(0, (t0 - ac.currentTime) * 1000 - 20)));
  recorder.start(250);

  const preview = opts.previewCanvas?.getContext("2d") ?? null;
  try {
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (opts.signal?.aborted) return reject(new DOMException("Render cancelled", "AbortError"));
        const t = ac.currentTime - t0;
        if (t >= total) return resolve();
        drawEpisodeFrame(ctx, W, H, t, input, opts);
        if (preview && opts.previewCanvas) preview.drawImage(canvas, 0, 0, opts.previewCanvas.width, opts.previewCanvas.height);
        opts.onProgress?.(Math.min(1, Math.max(0, t / total)));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }).finally(() => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    });
  } catch (err) {
    if (recorder.state !== "inactive") recorder.stop();
    throw err;
  }
  await new Promise((r) => setTimeout(r, 300));
  recorder.stop();
  await stopped;
  opts.onProgress?.(1);
  return { blob: new Blob(chunks, { type: mimeType.split(";")[0] }), mimeType, durationSeconds: total };
}
