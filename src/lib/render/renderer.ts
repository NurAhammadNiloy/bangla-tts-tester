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
}

export interface RenderOptions {
  width?: number;
  height?: number;
  fps?: number;
  subtitles?: boolean;
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

const FONT =
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

function drawCaption(ctx: CanvasRenderingContext2D, text: string, W: number, H: number) {
  const measure = (t: string, size: number) => {
    ctx.font = `700 ${size}px ${FONT}`;
    const m = ctx.measureText(t).width;
    // Guard against engines that under-report complex-script widths.
    const estimate = [...t].length * size * 0.5;
    return m < estimate * 0.4 ? estimate : m;
  };
  const L = layoutCaption(text, W, H, measure);
  ctx.font = `700 ${L.fontSize}px ${FONT}`;
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(L.box.x, L.box.y, L.box.w, L.box.h, L.fontSize * 0.4);
  else ctx.rect(L.box.x, L.box.y, L.box.w, L.box.h);
  ctx.fill();
  ctx.lineJoin = "round";
  for (const ln of L.lines) {
    ctx.lineWidth = L.fontSize * 0.14;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(ln.text, ln.x, ln.y);
    ctx.fillStyle = "#fff";
    ctx.fillText(ln.text, ln.x, ln.y);
  }
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
          if (cap) drawCaption(ctx, cap.text, W, H);
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
