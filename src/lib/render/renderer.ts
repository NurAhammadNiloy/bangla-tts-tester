/**
 * In-browser renderer: audio is the master clock.
 *
 *  - Narration buffers are scheduled on one AudioContext at their slot times.
 *  - Every frame reads audioContext.currentTime to decide what to draw, so
 *    picture and sound cannot drift apart.
 *  - Canvas video + WebAudio stream → MediaRecorder (MP4 where supported, else WebM).
 *
 * Runs in real time (a 30 s video takes ~30 s). Keep the tab visible while it runs.
 */
import {
  captionsFor,
  fitRate,
  activeWordIndex,
  kenBurns,
  layoutCaption,
  slotAt,
  totalDuration,
  type Caption,
  type Slot,
} from "./timeline";

export type Visual =
  | { kind: "image"; image: HTMLImageElement }
  | { kind: "video"; video: HTMLVideoElement; clipSeconds: number };

export interface RenderScene {
  audio: AudioBuffer;
  visual: Visual;
  narration: string;
  /** Character name when the narration is spoken dialogue: shown as a speech bubble. */
  speaker?: string;
  /** Short Bangla tag at the top for time/place jumps. */
  titleTag?: string;
}

export interface RenderOptions {
  width?: number;
  height?: number;
  fps?: number;
  subtitles?: boolean;
  /** Colour the word being spoken yellow (reel style). Default true. */
  highlightWords?: boolean;
  captionStyle?: CaptionStyle;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  report: SyncReport[];
}

export interface SyncReport {
  scene: number;
  audioSeconds: number;
  slotStart: number;
  slotEnd: number;
  visual: string;
  playbackRate?: number;
}

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickMimeType(
  isSupported: (t: string) => boolean = (t) => MediaRecorder.isTypeSupported(t),
): string {
  return (
    MIME_CANDIDATES.find((t) => {
      try {
        return isSupported(t);
      } catch {
        return false;
      }
    }) ?? ""
  );
}

export const FONT =
  '"Noto Sans Bengali", "Hind Siliguri", "Kohinoor Bangla", "Bangla Sangam MN", "Nirmala UI", "Vrinda", sans-serif';

function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  W: number,
  H: number,
  kb: { scale: number; dx: number; dy: number },
) {
  if (!sw || !sh) return;
  const base = Math.max(W / sw, H / sh);
  const s = base * kb.scale;
  const dw = sw * s;
  const dh = sh * s;
  const x = (W - dw) / 2 + kb.dx * W;
  const y = (H - dh) / 2 + kb.dy * H;
  ctx.drawImage(src, x, y, dw, dh);
}

const HIGHLIGHT = "#FFD43B";
export type CaptionStyle = "box" | "clean" | "headline";

export function measurer(ctx: CanvasRenderingContext2D) {
  return (t: string, size: number) => {
    ctx.font = `700 ${size}px ${FONT}`;
    const m = ctx.measureText(t).width;
    // Only fall back when the engine reports nothing at all. Bangla conjuncts (e.g. বৃষ্টি)
    // pack many code points into a narrow glyph, so a per-letter estimate over-reserves space.
    return m > 0 ? m : [...t].length * size * 0.5;
  };
}

function activeIndex(L: ReturnType<typeof layoutCaption>, cap: Caption, t: number, highlight: boolean) {
  return highlight
    ? activeWordIndex(
        L.words.map((w) => w.text),
        (t - cap.start) / Math.max(0.01, cap.end - cap.start),
      )
    : -1;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawWords(
  ctx: CanvasRenderingContext2D,
  L: ReturnType<typeof layoutCaption>,
  active: number,
  o: { fill: string; hi: string; stroke?: string; strokeRatio?: number; shadow?: boolean },
) {
  ctx.font = `700 ${L.fontSize}px ${FONT}`;
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const w of L.words) {
    if (o.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = L.fontSize * 0.35;
    }
    if (o.stroke) {
      ctx.lineWidth = L.fontSize * (o.strokeRatio ?? 0.12);
      ctx.strokeStyle = o.stroke;
      ctx.strokeText(w.text, w.x, w.y);
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = w.index === active ? o.hi : o.fill;
    ctx.fillText(w.text, w.x, w.y);
  }
  ctx.shadowBlur = 0;
}

export function drawCaption(ctx: CanvasRenderingContext2D, cap: Caption, t: number, W: number, H: number, highlight: boolean, style: CaptionStyle) {
  const m = measurer(ctx);
  if (style === "headline") {
    const L = layoutCaption(cap.text, W, H, m, { centerY: 0.2, sizeRatio: 0.088, maxWidthRatio: 0.86, maxLines: 3 });
    drawWords(ctx, L, activeIndex(L, cap, t, highlight), { fill: "#fff", hi: HIGHLIGHT, stroke: "rgba(0,0,0,0.75)", strokeRatio: 0.1, shadow: true });
    return;
  }
  if (style === "clean") {
    // Reel subtitles: white text, thin black outline, no box, two lines at most.
    const L = layoutCaption(cap.text, W, H, m, { centerY: 0.74, sizeRatio: 0.07 });
    drawWords(ctx, L, activeIndex(L, cap, t, highlight), { fill: "#fff", hi: HIGHLIGHT, stroke: "#000", strokeRatio: 0.1 });
    return;
  }
  const L = layoutCaption(cap.text, W, H, m);
  ctx.fillStyle = "rgba(20,14,10,0.72)";
  roundRect(ctx, L.box.x, L.box.y, L.box.w, L.box.h, L.fontSize * 0.45);
  ctx.fill();
  drawWords(ctx, L, activeIndex(L, cap, t, highlight), { fill: "#fff", hi: HIGHLIGHT, stroke: "rgba(0,0,0,0.8)" });
}

/**
 * White speech bubble for lines a character says aloud. With an anchor (the
 * speaker's head on screen) the tail points at them; otherwise it sits near the top.
 */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  cap: Caption,
  t: number,
  W: number,
  H: number,
  highlight: boolean,
  anchor?: { x: number; y: number } | null,
) {
  // anchor = top of the speaker's head. Sit fully above it when there is room, otherwise
  // drop below the face (over the body) so the bubble never covers a face.
  const above = anchor ? anchor.y / H - 0.085 : 0.25;
  const centerY = !anchor ? 0.25 : above >= 0.1 ? Math.min(0.42, above) : 0.62;
  const L = layoutCaption(cap.text, W, H, measurer(ctx), { centerY, sizeRatio: 0.058, maxWidthRatio: 0.76, maxLines: 3 });
  const r = L.fontSize * 0.7;
  ctx.fillStyle = "#fbfaf7";
  ctx.strokeStyle = "#2a2a35";
  ctx.lineWidth = Math.max(3, W * 0.005);
  roundRect(ctx, L.box.x, L.box.y, L.box.w, L.box.h, r);
  ctx.fill();
  ctx.stroke();
  // tail, pointing towards the speaker when we know where they are
  const tx = anchor ? Math.min(L.box.x + L.box.w - r * 1.5, Math.max(L.box.x + r * 1.5, anchor.x)) : W / 2;
  const up = !!anchor && anchor.y < L.box.y; // bubble sits below the speaker: tail points up
  const ty = up ? L.box.y : L.box.y + L.box.h;
  const dir = up ? -1 : 1;
  const tw = L.fontSize * 0.55;
  ctx.beginPath();
  ctx.moveTo(tx - tw, ty - dir);
  ctx.lineTo(tx, ty + dir * tw * 1.1);
  ctx.lineTo(tx + tw, ty - dir);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tx - tw, ty);
  ctx.lineTo(tx, ty + dir * tw * 1.1);
  ctx.lineTo(tx + tw, ty);
  ctx.stroke();
  drawWords(ctx, L, activeIndex(L, cap, t, highlight), { fill: "#1d1d26", hi: "#c47f00" });
}

/** Small pill at the top for time/place jumps, e.g. "৩ মাস পর • বৃষ্টির দুপুর". */
export function drawTitleTag(ctx: CanvasRenderingContext2D, text: string, W: number, H: number, alpha: number) {
  const size = Math.round(W * 0.042);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `700 ${size}px ${FONT}`;
  const m = measurer(ctx)(text, size);
  const padX = size * 0.9;
  const w = Math.min(W * 0.9, m + padX * 2);
  const h = size * 1.9;
  const x = (W - w) / 2;
  const y = H * 0.07;
  ctx.fillStyle = "rgba(236,237,246,0.95)";
  ctx.strokeStyle = "#2a2a35";
  ctx.lineWidth = Math.max(2, W * 0.004);
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#1d1d26";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.direction = "ltr";
  ctx.fillText(text, (W - Math.min(m, w - padX * 2)) / 2, y + h / 2, w - padX * 2);
  ctx.restore();
}

export async function renderVideo(
  ac: AudioContext,
  scenes: RenderScene[],
  slots: Slot[],
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const W = opts.width ?? 720;
  const H = opts.height ?? 1280;
  const fps = opts.fps ?? 30;
  const mimeType = pickMimeType();
  if (typeof MediaRecorder === "undefined" || !mimeType) {
    throw new Error(
      "This browser cannot record video. Use Chrome, Edge, or Safari 15+.",
    );
  }
  const total = totalDuration(slots);
  const captions: Caption[][] = scenes.map((s, i) =>
    opts.subtitles === false
      ? []
      : captionsFor(s.narration, slots[i].audioStart, slots[i].audioDuration),
  );

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  // Audio graph → recorder (not to speakers).
  const dest = ac.createMediaStreamDestination();
  const stream = new MediaStream([
    ...canvas.captureStream(fps).getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));

  if (ac.state !== "running") await ac.resume();
  const t0 = ac.currentTime + 0.25; // small lead so scheduling is never late
  const sources = scenes.map((s, i) => {
    const src = ac.createBufferSource();
    src.buffer = s.audio;
    src.connect(dest);
    src.start(t0 + slots[i].audioStart);
    return src;
  });

  // Start recording right at t0 so the file has no blank lead-in. Narration starts at t0 + leadIn.
  await new Promise((r) => setTimeout(r, Math.max(0, (t0 - ac.currentTime) * 1000 - 20)));
  recorder.start(250);

  const report: SyncReport[] = scenes.map((s, i) => ({
    scene: i + 1,
    audioSeconds: +s.audio.duration.toFixed(3),
    slotStart: +slots[i].start.toFixed(3),
    slotEnd: +slots[i].end.toFixed(3),
    visual: s.visual.kind,
  }));

  let activeVideo = -1;
  try {
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (opts.signal?.aborted) {
          reject(new DOMException("Render cancelled", "AbortError"));
          return;
        }
        const t = ac.currentTime - t0;
        if (t >= total) return resolve();
        const slot = t >= 0 ? slotAt(slots, t) : slots[0];
        if (slot) {
          const scene = scenes[slot.index];
          const span = slot.end - slot.start;
          const p = Math.min(1, Math.max(0, (t - slot.start) / span));
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, W, H);
          if (scene.visual.kind === "image") {
            const img = scene.visual.image;
            drawCover(
              ctx,
              img,
              img.naturalWidth,
              img.naturalHeight,
              W,
              H,
              kenBurns(slot.index, p),
            );
          } else {
            const v = scene.visual.video;
            if (activeVideo !== slot.index) {
              activeVideo = slot.index;
              const rate = fitRate(scene.visual.clipSeconds, span);
              report[slot.index].playbackRate = +rate.toFixed(3);
              v.playbackRate = rate;
              v.currentTime = 0;
              void v.play().catch(() => {});
            }
            drawCover(ctx, v, v.videoWidth, v.videoHeight, W, H, {
              scale: 1,
              dx: 0,
              dy: 0,
            });
          }
          // Short fade between scenes.
          const fade = 0.25;
          const edge = Math.min(t - slot.start, slot.end - t);
          if (edge < fade && slot.index > 0) {
            ctx.fillStyle = `rgba(0,0,0,${(1 - edge / fade) * 0.6})`;
            ctx.fillRect(0, 0, W, H);
          }
          const cap = captions[slot.index].find(
            (c) => t >= c.start && t < c.end,
          );
          const hl = opts.highlightWords !== false;
          if (cap) {
            if (scene.speaker) drawBubble(ctx, cap, t, W, H, hl);
            else drawCaption(ctx, cap, t, W, H, hl, opts.captionStyle ?? "box");
          }
          if (scene.titleTag) {
            const into = t - slot.start;
            const left = slot.end - t;
            drawTitleTag(ctx, scene.titleTag, W, H, Math.min(1, into / 0.4, left / 0.4));
          }
        }
        opts.onProgress?.(Math.min(1, Math.max(0, t / total)));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }).finally(() => {
      sources.forEach((s) => {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      });
      scenes.forEach(
        (s) => s.visual.kind === "video" && s.visual.video.pause(),
      );
    });
  } catch (err) {
    if (recorder.state !== "inactive") recorder.stop();
    throw err;
  }

  // Let the last frames flush.
  await new Promise((r) => setTimeout(r, 300));
  recorder.stop();
  await stopped;
  opts.onProgress?.(1);
  return {
    blob: new Blob(chunks, { type: mimeType.split(";")[0] }),
    mimeType,
    durationSeconds: total,
    report,
  };
}
