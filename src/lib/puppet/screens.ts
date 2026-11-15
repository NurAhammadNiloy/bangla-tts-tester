/**
 * Code-drawn screens (phone UI, letter, TV news, calendar, map, photo, text
 * card). Content is data from a ScreenSpec. Bangla text is always measured and
 * drawn left-aligned at computed positions (never ctx.textAlign centring).
 */
import type { AssetLibrary, CharacterAsset, EpisodePlan, ScreenSpec, ShotSize } from "./types";
import { PALETTE } from "./styleGuide";
import { wrapLines } from "@/lib/render/timeline";
import { BN_FONT, clamp, easeOut, hash, roundRectPath } from "./draw";
import { drawCharacter, headPoints, NEUTRAL_POSE, type Pose } from "./rig";
import { blinkAt } from "./actions";

export interface ScreenOpts {
  t: number;
  dur?: number;
  shot?: ShotSize;
  plan?: EpisodePlan;
  lib?: AssetLibrary;
  /** Voice loudness for a video-call face. */
  talk?: number;
  /** Draws the scene behind a phone (it is dimmed). */
  background?: (ctx: CanvasRenderingContext2D) => void;
  /** Skin colour of the holding hand. */
  handSkin?: string;
  /** Clock shown on phone screens (Bangla digits), e.g. "২:০৭". */
  clock?: string;
}

export interface R {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PHONE_SCREENS: ScreenSpec["type"][] = ["notification", "incoming_call", "video_call", "chat"];

const INK = PALETTE.ink;
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const bnNum = (n: number | string) => String(n).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);

/* ---------------------------------- text ---------------------------------- */

export interface TextOpts {
  size: number;
  color?: string;
  weight?: number;
  maxW: number;
  align?: "left" | "center" | "right";
  lineH?: number;
  maxLines?: number;
  /** Per-line jitter for handwriting feel. */
  wobble?: number;
  /** 0..1 reveal (write-on), by characters. */
  reveal?: number;
  seed?: number;
}

export function setFont(ctx: CanvasRenderingContext2D, size: number, weight = 500) {
  ctx.font = `${weight} ${Math.round(size)}px ${BN_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
}

/** Draws wrapped text; returns the block height. (x is the left edge of the box.) */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOpts): number {
  setFont(ctx, o.size, o.weight);
  const measure = (s: string) => ctx.measureText(s).width;
  let lines = wrapLines(String(text ?? ""), o.maxW, measure);
  if (o.maxLines && lines.length > o.maxLines) {
    lines = lines.slice(0, o.maxLines);
    let last = lines[o.maxLines - 1];
    while (last.length > 1 && measure(last + "…") > o.maxW) last = last.slice(0, -1);
    lines[o.maxLines - 1] = last + "…";
  }
  const lh = o.lineH ?? o.size * 1.45;
  const total = lines.reduce((a, l) => a + [...l].length, 0);
  let budget = o.reveal === undefined ? Infinity : Math.floor(clamp(o.reveal, 0, 1) * total);
  ctx.fillStyle = o.color ?? INK;
  lines.forEach((line, i) => {
    if (budget <= 0) return;
    const chars = [...line];
    const shown = chars.length <= budget ? line : chars.slice(0, budget).join("");
    budget -= chars.length;
    const lw = Math.min(o.maxW, measure(line));
    let lx = x;
    if (o.align === "center") lx = x + (o.maxW - lw) / 2;
    else if (o.align === "right") lx = x + o.maxW - lw;
    const ly = y + lh * (i + 0.5);
    if (o.wobble) {
      const a = (hash(o.seed ?? 1, i) - 0.5) * 0.02 * o.wobble;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(a);
      ctx.fillText(shown, (hash(o.seed ?? 1, i, 2) - 0.5) * o.size * 0.3 * o.wobble, 0);
      ctx.restore();
    } else ctx.fillText(shown, lx, ly);
  });
  return lines.length * lh;
}

function textHeight(ctx: CanvasRenderingContext2D, text: string, o: TextOpts): number {
  setFont(ctx, o.size, o.weight);
  const n = wrapLines(String(text ?? ""), o.maxW, (s) => ctx.measureText(s).width).length;
  return Math.min(n, o.maxLines ?? n) * (o.lineH ?? o.size * 1.45);
}

/* --------------------------------- shapes --------------------------------- */

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function handset(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(-s, -s * 0.25);
  ctx.quadraticCurveTo(0, -s * 0.75, s, -s * 0.25);
  ctx.lineTo(s * 0.95, s * 0.2);
  ctx.lineTo(s * 0.5, s * 0.15);
  ctx.lineTo(s * 0.45, -s * 0.12);
  ctx.quadraticCurveTo(0, -s * 0.25, -s * 0.45, -s * 0.12);
  ctx.lineTo(-s * 0.5, s * 0.15);
  ctx.lineTo(-s * 0.95, s * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function castAsset(o: ScreenOpts, who: string): CharacterAsset | null {
  if (!o.lib) return null;
  const m = o.plan?.cast.find((c) => c.id === who);
  const id = m?.asset ?? who;
  return o.lib.characters[id] ?? Object.values(o.lib.characters)[0] ?? null;
}

function castName(o: ScreenOpts, who: string): string {
  return o.plan?.cast.find((c) => c.id === who)?.name ?? who;
}

/* ------------------------------ screen bodies ----------------------------- */

function wallpaper(ctx: CanvasRenderingContext2D, r: R) {
  ctx.fillStyle = "#33496b";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  circle(ctx, r.x + r.w * 0.85, r.y + r.h * 0.25, r.w * 0.5, "#3f6fa6");
  circle(ctx, r.x + r.w * 0.1, r.y + r.h * 0.85, r.w * 0.6, "#2f3e4f");
}

let CLOCK = "১০:১০";
function statusBar(ctx: CanvasRenderingContext2D, r: R, color = "#ffffff") {
  const u = r.w / 100;
  ctx.fillStyle = color;
  setFont(ctx, 4.2 * u, 600);
  ctx.fillText(CLOCK, r.x + 6 * u, r.y + 5 * u);
  for (let i = 0; i < 4; i++) ctx.fillRect(r.x + r.w - 22 * u + i * 2.6 * u, r.y + (6.5 - i) * u, 1.8 * u, (1 + i) * u);
  ctx.fillRect(r.x + r.w - 10 * u, r.y + 3.6 * u, 6 * u, 3 * u);
}

function drawNotification(ctx: CanvasRenderingContext2D, s: Extract<ScreenSpec, { type: "notification" }>, r: R, o: ScreenOpts) {
  const u = r.w / 100;
  wallpaper(ctx, r);
  statusBar(ctx, r);
  // big clock
  setFont(ctx, 20 * u, 700);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const clock = CLOCK;
  ctx.fillText(clock, r.x + (r.w - ctx.measureText(clock).width) / 2, r.y + r.h * 0.2);
  // banner slides down
  const p = easeOut(clamp(o.t / 0.45, 0, 1));
  const bw = r.w - 10 * u;
  const tOpts: TextOpts = { size: 5.4 * u, weight: 700, maxW: bw - 22 * u, maxLines: 2 };
  const bOpts: TextOpts = { size: 4.8 * u, weight: 500, maxW: bw - 22 * u, maxLines: 4, color: "#3a3a44" };
  const bh = 14 * u + textHeight(ctx, s.title, tOpts) + textHeight(ctx, s.body, bOpts);
  const by = r.y + r.h * 0.32 - (1 - p) * (r.h * 0.4);
  ctx.save();
  ctx.globalAlpha *= p;
  ctx.fillStyle = "rgba(250,248,244,0.97)";
  roundRectPath(ctx, r.x + 5 * u, by, bw, bh, 5 * u);
  ctx.fill();
  circle(ctx, r.x + 13 * u, by + 9 * u, 4.5 * u, PALETTE.cloth[0]);
  setFont(ctx, 4 * u, 700);
  ctx.fillStyle = "#ffffff";
  const ini = [...(s.app || "অ")][0];
  ctx.fillText(ini, r.x + 13 * u - ctx.measureText(ini).width / 2, by + 9 * u);
  setFont(ctx, 3.8 * u, 600);
  ctx.fillStyle = "#6a6a74";
  ctx.fillText(s.app || "অ্যাপ", r.x + 20 * u, by + 9 * u);
  const h1 = drawText(ctx, s.title, r.x + 20 * u, by + 13 * u, tOpts);
  drawText(ctx, s.body, r.x + 20 * u, by + 13 * u + h1, bOpts);
  ctx.restore();
}

function drawIncomingCall(ctx: CanvasRenderingContext2D, s: Extract<ScreenSpec, { type: "incoming_call" }>, r: R, o: ScreenOpts) {
  const u = r.w / 100;
  ctx.fillStyle = "#1d2636";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  circle(ctx, r.x + r.w * 0.5, r.y + r.h * 0.05, r.w * 0.9, "#24324a");
  statusBar(ctx, r);
  drawText(ctx, "ইনকামিং কল…", r.x, r.y + r.h * 0.1, { size: 4.8 * u, maxW: r.w, align: "center", color: "#b8c4d8" });
  const ay = r.y + r.h * 0.36;
  for (let k = 0; k < 3; k++) {
    const ph = (o.t * 0.8 + k / 3) % 1;
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * (1 - ph) * 0.45;
    circle(ctx, r.x + r.w / 2, ay, r.w * (0.18 + ph * 0.18), "#7fa0d0");
    ctx.globalAlpha = a;
  }
  circle(ctx, r.x + r.w / 2, ay, r.w * 0.18, "#e0a43c");
  setFont(ctx, 16 * u, 700);
  const ini = [...(s.caller || "?")][0];
  ctx.fillStyle = "#ffffff";
  ctx.fillText(ini, r.x + r.w / 2 - ctx.measureText(ini).width / 2, ay + u);
  const nh = drawText(ctx, s.caller, r.x + 6 * u, r.y + r.h * 0.52, { size: 8 * u, weight: 700, maxW: r.w - 12 * u, align: "center", color: "#ffffff", maxLines: 2 });
  if (s.subtitle) drawText(ctx, s.subtitle, r.x + 6 * u, r.y + r.h * 0.52 + nh, { size: 4.8 * u, maxW: r.w - 12 * u, align: "center", color: "#b8c4d8", maxLines: 2 });
  const by = r.y + r.h * 0.84;
  const bounce = Math.sin(o.t * 6) * 1.2 * u;
  circle(ctx, r.x + r.w * 0.27, by, 9 * u, "#d9534f");
  handset(ctx, r.x + r.w * 0.27, by, 4.5 * u, Math.PI * 0.75);
  circle(ctx, r.x + r.w * 0.73, by + bounce, 9 * u, "#4caf6a");
  handset(ctx, r.x + r.w * 0.73, by + bounce, 4.5 * u, 0);
}

function drawHeadInRect(ctx: CanvasRenderingContext2D, asset: CharacterAsset, r: R, o: ScreenOpts, headFrac: number, face: Pose["face"]["face"] = "neutral") {
  const pose: Pose = {
    ...NEUTRAL_POSE,
    face: { face, blink: blinkAt(o.t, 4.2), mouthOpen: o.talk ?? 0, lookX: -0.2, t: o.t },
  };
  const probe = headPoints(asset, pose, { x: 0, y: 0, scale: 1 });
  const hh = Math.max(20, probe.chin[1] - probe.top[1]);
  const sc = (r.h * headFrac) / hh;
  const fx = r.x + r.w / 2,
    fy = r.y + r.h * 0.42;
  drawCharacter(ctx, asset, pose, { x: fx - probe.face[0] * sc, y: fy - probe.face[1] * sc, scale: sc });
}

function drawVideoCall(ctx: CanvasRenderingContext2D, s: Extract<ScreenSpec, { type: "video_call" }>, r: R, o: ScreenOpts) {
  const u = r.w / 100;
  ctx.fillStyle = PALETTE.wall[1];
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = PALETTE.wall[3];
  ctx.fillRect(r.x, r.y + r.h * 0.6, r.w, r.h * 0.4);
  const a = castAsset(o, s.who);
  if (a) drawHeadInRect(ctx, a, r, o, 0.38);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(r.x, r.y, r.w, 16 * u);
  statusBar(ctx, r);
  drawText(ctx, s.caller || castName(o, s.who), r.x, r.y + 8 * u, { size: 5.2 * u, weight: 700, maxW: r.w, align: "center", color: "#ffffff", maxLines: 1 });
  // self preview
  ctx.fillStyle = "#5a5a66";
  roundRectPath(ctx, r.x + r.w - 30 * u, r.y + 20 * u, 24 * u, 36 * u, 3 * u);
  ctx.fill();
  circle(ctx, r.x + r.w - 18 * u, r.y + 34 * u, 6 * u, "#9a8a7a");
  ctx.fillStyle = "#9a8a7a";
  roundRectPath(ctx, r.x + r.w - 27 * u, r.y + 42 * u, 18 * u, 14 * u, 6 * u);
  ctx.fill();
  const by = r.y + r.h * 0.88;
  circle(ctx, r.x + r.w / 2, by, 8.5 * u, "#d9534f");
  handset(ctx, r.x + r.w / 2, by, 4.2 * u, Math.PI * 0.75);
  // call timer
  const sec = Math.floor(o.t) + 12;
  drawText(ctx, bnNum(`00:${String(sec).padStart(2, "0")}`), r.x, r.y + r.h * 0.76, { size: 4.4 * u, maxW: r.w, align: "center", color: "#ffffff" });
}

function drawChat(ctx: CanvasRenderingContext2D, s: Extract<ScreenSpec, { type: "chat" }>, r: R, o: ScreenOpts) {
  const u = r.w / 100;
  ctx.fillStyle = "#efe7d6";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = "#2f3e4f";
  ctx.fillRect(r.x, r.y, r.w, 20 * u);
  statusBar(ctx, r);
  circle(ctx, r.x + 12 * u, r.y + 13.5 * u, 4.5 * u, PALETTE.cloth[1]);
  drawText(ctx, s.title, r.x + 20 * u, r.y + 9.5 * u, { size: 5 * u, weight: 700, maxW: r.w - 26 * u, color: "#ffffff", maxLines: 1 });
  const msgs = s.messages ?? [];
  const shown = Math.min(msgs.length, 1 + Math.floor(Math.max(0, o.t) / 0.9));
  const bubbleMax = r.w * 0.66;
  const size = 4.8 * u;
  // lay out from the bottom so the latest is visible
  const items = msgs.slice(0, shown).map((m) => {
    const tOpts: TextOpts = { size, maxW: bubbleMax - 8 * u, maxLines: 5, weight: 500 };
    setFont(ctx, size, 500);
    const lines = wrapLines(m.text, tOpts.maxW, (q) => ctx.measureText(q).width).slice(0, 5);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 6 * u) + 8 * u;
    return { m, tOpts, w: Math.min(bubbleMax, w), h: textHeight(ctx, m.text, tOpts) + 5 * u };
  });
  const typing = shown < msgs.length;
  let y = r.y + r.h - 8 * u - (typing ? 12 * u : 0);
  const pos: number[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    y -= items[i].h;
    pos[i] = y;
    y -= 3 * u;
  }
  items.forEach((it, i) => {
    if (pos[i] < r.y + 20 * u) return;
    const me = it.m.from === "me";
    const bx = me ? r.x + r.w - 5 * u - it.w : r.x + 5 * u;
    const appear = i === shown - 1 ? easeOut(clamp((o.t - (shown - 1) * 0.9) / 0.25, 0, 1)) : 1;
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * appear;
    ctx.fillStyle = me ? "#cfe8c0" : "#ffffff";
    roundRectPath(ctx, bx, pos[i] + (1 - appear) * 4 * u, it.w, it.h, 3.5 * u);
    ctx.fill();
    drawText(ctx, it.m.text, bx + 4 * u, pos[i] + 2.5 * u + (1 - appear) * 4 * u, { ...it.tOpts, color: INK });
    ctx.globalAlpha = a;
  });
  if (typing) {
    const next = msgs[shown];
    const me = next.from === "me";
    const bx = me ? r.x + r.w - 25 * u : r.x + 5 * u;
    ctx.fillStyle = me ? "#cfe8c0" : "#ffffff";
    roundRectPath(ctx, bx, r.y + r.h - 18 * u, 20 * u, 9 * u, 4 * u);
    ctx.fill();
    for (let k = 0; k < 3; k++) {
      const b = Math.max(0, Math.sin(o.t * 8 - k));
      circle(ctx, bx + 5 * u + k * 5 * u, r.y + r.h - 13.5 * u - b * u, 1.4 * u, "#8a8a94");
    }
  }
}

function drawLetter(ctx: CanvasRenderingContext2D, s: Extract<ScreenSpec, { type: "letter" }>, r: R, o: ScreenOpts) {
  const u = r.w / 100;
  ctx.fillStyle = "#3b2f28";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.save();
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  ctx.rotate(-0.025);
  const pw = r.w * 0.86,
    ph = Math.min(r.h * 0.82, pw * 1.45);
  const px = -pw / 2,
    py = -ph / 2;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(px + 2 * u, py + 2.5 * u, pw, ph);
  ctx.fillStyle = "#f3e6c8";
  ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = "rgba(160,120,70,0.18)";
  ctx.fillRect(px, py + ph * 0.48, pw, 0.6 * u);
  ctx.strokeStyle = "rgba(90,110,160,0.25)";
  ctx.lineWidth = 0.35 * u;
  const lh = 7.4 * u;
  for (let y = py + 14 * u; y < py + ph - 6 * u; y += lh) {
    ctx.beginPath();
    ctx.moveTo(px + 6 * u, y + lh * 0.5 + 1.8 * u);
    ctx.lineTo(px + pw - 6 * u, y + lh * 0.5 + 1.8 * u);
    ctx.stroke();
  }
  const dur = o.dur ?? 3;
  const h = drawText(ctx, s.text, px + 8 * u, py + 14 * u, {
    size: 5 * u,
    weight: 500,
    maxW: pw - 16 * u,
    lineH: lh,
    color: "#2f3e6f",
    wobble: 1,
    seed: 3,
    maxLines: Math.floor((ph - 34 * u) / lh),
    reveal: 0.15 + o.t / Math.max(0.5, dur * 0.7),
  });
  if (s.signature) {
    const sy = Math.min(py + 14 * u + h + 5 * u, py + ph - 14 * u);
    drawText(ctx, "— " + s.signature, px + 8 * u, sy, { size: 5.4 * u, weight: 600, maxW: pw - 16 * u, align: "right", color: "#2f3e6f", maxLines: 1 });
  }
  ctx.restore();
}

function drawTvNews(ctx: CanvasRenderingContext2D, s: Extract<ScreenSpec, { type: "tv_news" }>, r: R, o: ScreenOpts) {
  const u = r.w / 100;
  ctx.fillStyle = "#1b2a4a";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // studio graphics
  circle(ctx, r.x + r.w * 0.5, r.y + r.h * 0.36, r.w * 0.34, "#24406e");
  ctx.strokeStyle = "rgba(160,190,230,0.35)";
  ctx.lineWidth = 0.6 * u;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.ellipse(r.x + r.w * 0.5, r.y + r.h * 0.36, r.w * 0.34, r.w * 0.34 * Math.abs(i / 2.5), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i < 6; i++) ctx.fillRect(r.x + i * r.w * 0.18 + ((o.t * 6 * u) % (r.w * 0.18)), r.y, r.w * 0.05, r.h * 0.6);
  // live badge
  ctx.fillStyle = "#d9534f";
  roundRectPath(ctx, r.x + 6 * u, r.y + 8 * u, 18 * u, 7 * u, 1.5 * u);
  ctx.fill();
  drawText(ctx, "লাইভ", r.x + 6 * u, r.y + 8.2 * u, { size: 4.2 * u, weight: 700, maxW: 18 * u, align: "center", color: "#ffffff" });
  if (Math.floor(o.t * 2) % 2 === 0) circle(ctx, r.x + 27 * u, r.y + 11.5 * u, 1.6 * u, "#d9534f");
  // lower third
  const ly = r.y + r.h * 0.66;
  const slide = easeOut(clamp(o.t / 0.5, 0, 1));
  ctx.fillStyle = "#c62f2f";
  ctx.fillRect(r.x, ly - 9 * u, (36 * u) * slide, 9 * u);
  drawText(ctx, "ব্রেকিং নিউজ", r.x + 3 * u, ly - 9 * u, { size: 4.4 * u, weight: 700, maxW: 33 * u, color: "#ffffff", maxLines: 1 });
  const hOpts: TextOpts = { size: 6.2 * u, weight: 700, maxW: r.w - 10 * u, maxLines: 3, color: INK };
  const hh = textHeight(ctx, s.headline, hOpts) + 6 * u;
  ctx.fillStyle = "#f7f3ea";
  ctx.fillRect(r.x, ly, r.w * slide, hh);
  if (slide > 0.9) drawText(ctx, s.headline, r.x + 5 * u, ly + 3 * u, hOpts);
  // ticker
  const ty = ly + hh;
  ctx.fillStyle = "#0f1a30";
  ctx.fillRect(r.x, ty, r.w, 8 * u);
  const tick = (s.ticker || s.headline) + "   •   ";
  setFont(ctx, 4.4 * u, 500);
  const tw = Math.max(10, ctx.measureText(tick).width);
  const off = (o.t * 14 * u) % tw;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, ty, r.w, 8 * u);
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  for (let x = r.x - off; x < r.x + r.w; x += tw) ctx.fillText(tick, x, ty + 4 * u);
  ctx.restore();
}

function drawCalendar(ctx: CanvasRenderingContext2D, s: Extract<ScreenSpec, { type: "calendar" }>, r: R, o: ScreenOpts) {
  const u = r.w / 100;
  ctx.fillStyle = PALETTE.wall[1];
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const cw = r.w * 0.86,
    ch = Math.min(r.h * 0.7, cw * 1.15);
  const cx = r.x + (r.w - cw) / 2,
    cy = r.y + (r.h - ch) / 2;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(cx + 1.5 * u, cy + 2 * u, cw, ch);
  ctx.fillStyle = "#fbf7ef";
  ctx.fillRect(cx, cy, cw, ch);
  ctx.fillStyle = "#c94f4f";
  ctx.fillRect(cx, cy, cw, 16 * u);
  for (let i = 0; i < 2; i++) circle(ctx, cx + cw * (0.3 + i * 0.4), cy, 2.4 * u, "#5a5a66");
  drawText(ctx, s.title, cx, cy + 3 * u, { size: 6.4 * u, weight: 700, maxW: cw, align: "center", color: "#ffffff", maxLines: 1 });
  const wd = ["র", "সো", "ম", "বু", "বৃ", "শু", "শ"];
  const gw = cw / 7;
  wd.forEach((d, i) => drawText(ctx, d, cx + i * gw, cy + 18 * u, { size: 3.8 * u, weight: 600, maxW: gw, align: "center", color: "#8a7a6a" }));
  const days = clamp(Math.round(s.days || 30), 1, 31);
  const gh = (ch - 28 * u) / 5;
  for (let d = 1; d <= days; d++) {
    const i = (d + 1) % 7,
      row = Math.floor((d + 1) / 7);
    const x = cx + i * gw,
      y = cy + 26 * u + row * gh;
    if (row > 4) continue;
    const past = d < s.marked;
    drawText(ctx, bnNum(d), x, y + gh * 0.1, { size: 4.6 * u, weight: d === s.marked ? 700 : 500, maxW: gw, align: "center", color: past ? "#a59a8c" : INK });
    if (past) {
      ctx.strokeStyle = "rgba(201,79,79,0.5)";
      ctx.lineWidth = 0.6 * u;
      ctx.beginPath();
      ctx.moveTo(x + gw * 0.28, y + gh * 0.6);
      ctx.lineTo(x + gw * 0.72, y + gh * 0.15);
      ctx.stroke();
    }
    if (d === s.marked) {
      const p = easeOut(clamp(o.t / 0.8, 0, 1));
      ctx.strokeStyle = "#c62f2f";
      ctx.lineWidth = 1.1 * u;
      ctx.beginPath();
      ctx.ellipse(x + gw / 2, y + gh * 0.38, gw * 0.42, gh * 0.4, -0.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.stroke();
    }
  }
}

function drawMap(ctx: CanvasRenderingContext2D, s: Extract<ScreenSpec, { type: "map" }>, r: R, o: ScreenOpts) {
  const u = r.w / 100;
  ctx.fillStyle = "#e9e4d4";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // blocks and roads
  ctx.fillStyle = "#dcd5bf";
  for (let i = 0; i < 18; i++) ctx.fillRect(r.x + hash(5, i) * r.w, r.y + hash(6, i) * r.h, 12 * u + hash(7, i) * 16 * u, 8 * u + hash(8, i) * 12 * u);
  ctx.fillStyle = "#bfd6a4";
  ctx.beginPath();
  ctx.ellipse(r.x + r.w * 0.75, r.y + r.h * 0.72, 16 * u, 10 * u, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#9cc3df";
  ctx.lineWidth = 6 * u;
  ctx.beginPath();
  ctx.moveTo(r.x - 5 * u, r.y + r.h * 0.48);
  ctx.bezierCurveTo(r.x + r.w * 0.3, r.y + r.h * 0.38, r.x + r.w * 0.6, r.y + r.h * 0.62, r.x + r.w + 5 * u, r.y + r.h * 0.52);
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.6 * u;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(r.x, r.y + r.h * (0.12 + i * 0.2));
    ctx.lineTo(r.x + r.w, r.y + r.h * (0.18 + i * 0.19));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r.x + r.w * (0.1 + i * 0.22), r.y);
    ctx.lineTo(r.x + r.w * (0.16 + i * 0.2), r.y + r.h);
    ctx.stroke();
  }
  const A: [number, number] = [r.x + r.w * 0.24, r.y + r.h * 0.74];
  const B: [number, number] = [r.x + r.w * 0.72, r.y + r.h * 0.3];
  const C: [number, number] = [r.x + r.w * 0.2, r.y + r.h * 0.3];
  const p = clamp(o.t / 1.6, 0, 1);
  ctx.strokeStyle = "#3f6fa6";
  ctx.lineWidth = 1.6 * u;
  ctx.setLineDash([2.5 * u, 2.5 * u]);
  ctx.beginPath();
  const N = 40;
  for (let i = 0; i <= Math.round(N * p); i++) {
    const q = i / N;
    const x = (1 - q) * (1 - q) * A[0] + 2 * q * (1 - q) * C[0] + q * q * B[0];
    const y = (1 - q) * (1 - q) * A[1] + 2 * q * (1 - q) * C[1] + q * q * B[1];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  const pin = (x: number, y: number, color: string, label: string, drop: number) => {
    const yy = y - (1 - easeOut(drop)) * 10 * u;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.bezierCurveTo(x - 7 * u, yy - 8 * u, x - 6 * u, yy - 15 * u, x, yy - 15 * u);
    ctx.bezierCurveTo(x + 6 * u, yy - 15 * u, x + 7 * u, yy - 8 * u, x, yy);
    ctx.fill();
    circle(ctx, x, yy - 10 * u, 2.4 * u, "#ffffff");
    setFont(ctx, 4.6 * u, 700);
    const w = Math.min(ctx.measureText(label).width, r.w * 0.6) + 5 * u;
    const lx = clamp(x - w / 2, r.x + 2 * u, r.x + r.w - w - 2 * u);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    roundRectPath(ctx, lx, yy + 2 * u, w, 7.5 * u, 2 * u);
    ctx.fill();
    drawText(ctx, label, lx + 2.5 * u, yy + 2 * u, { size: 4.6 * u, weight: 700, maxW: w - 5 * u, maxLines: 1, lineH: 7.5 * u });
  };
  pin(A[0], A[1], "#3f6fa6", s.from, clamp(o.t / 0.4, 0, 1));
  pin(B[0], B[1], "#c62f2f", s.to, clamp((o.t - 1.4) / 0.4, 0, 1));
}

function drawPhoto(ctx: CanvasRenderingContext2D, s: Extract<ScreenSpec, { type: "photo" }>, r: R, o: ScreenOpts) {
  const u = r.w / 100;
  ctx.fillStyle = "#5f4a3c";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.save();
  ctx.translate(r.x + r.w / 2, r.y + r.h * 0.47);
  ctx.rotate(-0.06 + Math.sin(o.t * 0.6) * 0.005);
  const cw = r.w * 0.78,
    ch = cw * 1.2;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(-cw / 2 + 2 * u, -ch / 2 + 2.5 * u, cw, ch);
  ctx.fillStyle = "#fbf8f1";
  ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
  const pr: R = { x: -cw / 2 + 5 * u, y: -ch / 2 + 5 * u, w: cw - 10 * u, h: cw - 10 * u };
  ctx.save();
  ctx.beginPath();
  ctx.rect(pr.x, pr.y, pr.w, pr.h);
  ctx.clip();
  ctx.fillStyle = PALETTE.sky.day;
  ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
  ctx.fillStyle = PALETTE.ground[1];
  ctx.fillRect(pr.x, pr.y + pr.h * 0.7, pr.w, pr.h * 0.3);
  const who = (s.who ?? []).slice(0, 4);
  who.forEach((id, i) => {
    const a = castAsset(o, id);
    if (!a) return;
    const n = who.length;
    const sc = (pr.h * 0.78) / a.size[1];
    const x = pr.x + pr.w * ((i + 0.5) / n) * 0.9 + pr.w * 0.05;
    drawCharacter(ctx, a, { ...NEUTRAL_POSE, face: { face: "happy", blink: 0, mouthOpen: 0, lookX: 0 } }, { x, y: pr.y + pr.h * 0.92, scale: sc });
  });
  ctx.fillStyle = "rgba(240,200,140,0.14)";
  ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
  ctx.restore();
  if (s.caption) drawText(ctx, s.caption, -cw / 2 + 5 * u, pr.y + pr.h + 2 * u, { size: 5 * u, weight: 600, maxW: cw - 10 * u, align: "center", color: "#2f3e6f", maxLines: 2, wobble: 1, seed: 9 });
  ctx.restore();
}

function drawTextCard(ctx: CanvasRenderingContext2D, s: Extract<ScreenSpec, { type: "text_card" }>, r: R, o: ScreenOpts) {
  const u = r.w / 100;
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = "rgba(43,39,48,0.15)";
  ctx.lineWidth = u;
  ctx.strokeRect(r.x + 5 * u, r.y + 5 * u, r.w - 10 * u, r.h - 10 * u);
  let size = 9 * u;
  const maxW = r.w * 0.8;
  let h = 0;
  for (let i = 0; i < 8; i++) {
    h = textHeight(ctx, s.text, { size, weight: 700, maxW });
    if (h < r.h * 0.6) break;
    size *= 0.88;
  }
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * easeOut(clamp(o.t / 0.5, 0, 1));
  drawText(ctx, s.text, r.x + (r.w - maxW) / 2, r.y + (r.h - h) / 2, { size, weight: 700, maxW, align: "center", color: INK, maxLines: 8 });
  ctx.globalAlpha = a;
}

/** Draw a screen's content into rect r (clipped). */
export function drawScreenContent(ctx: CanvasRenderingContext2D, spec: ScreenSpec, r: R, o: ScreenOpts) {
  CLOCK = o.clock ?? "১০:১০";
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  try {
    switch (spec.type) {
      case "notification":
        drawNotification(ctx, spec, r, o);
        break;
      case "incoming_call":
        drawIncomingCall(ctx, spec, r, o);
        break;
      case "video_call":
        drawVideoCall(ctx, spec, r, o);
        break;
      case "chat":
        drawChat(ctx, spec, r, o);
        break;
      case "letter":
        drawLetter(ctx, spec, r, o);
        break;
      case "tv_news":
        drawTvNews(ctx, spec, r, o);
        break;
      case "calendar":
        drawCalendar(ctx, spec, r, o);
        break;
      case "map":
        drawMap(ctx, spec, r, o);
        break;
      case "photo":
        drawPhoto(ctx, spec, r, o);
        break;
      case "text_card":
      default:
        drawTextCard(ctx, spec as Extract<ScreenSpec, { type: "text_card" }>, r, o);
    }
  } finally {
    ctx.restore();
  }
}

/** Whether this screen is shown inside a phone for this shot size. */
export function screenInPhone(spec: ScreenSpec, shot?: ShotSize): boolean {
  return PHONE_SCREENS.includes(spec.type) || ((shot === "pov_hand" || shot === "extreme_close") && spec.type === "map");
}

function drawHand(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number, skin: string, H: number) {
  ctx.fillStyle = skin;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, pw * 0.012);
  // palm and wrist from the bottom
  ctx.beginPath();
  ctx.moveTo(px + pw * 0.05, py + ph * 0.62);
  ctx.quadraticCurveTo(px - pw * 0.12, py + ph * 0.8, px + pw * 0.08, py + ph * 1.02);
  ctx.lineTo(px + pw * 0.2, H + 10);
  ctx.lineTo(px + pw * 0.95, H + 10);
  ctx.quadraticCurveTo(px + pw * 1.0, py + ph * 1.0, px + pw * 1.06, py + ph * 0.86);
  ctx.lineTo(px + pw * 0.92, py + ph * 0.84);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // fingers wrapping the right edge
  for (let i = 0; i < 3; i++) {
    const fy = py + ph * (0.5 + i * 0.11);
    ctx.beginPath();
    ctx.ellipse(px + pw * 1.0, fy, pw * 0.09, ph * 0.045, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // thumb over the left edge
  ctx.beginPath();
  ctx.ellipse(px + pw * 0.06, py + ph * 0.66, pw * 0.08, ph * 0.1, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * Draw a full-frame screen: inside a phone (with a hand for pov_hand /
 * extreme_close) or full-screen content.
 */
export function drawScreen(ctx: CanvasRenderingContext2D, spec: ScreenSpec, W: number, H: number, o: ScreenOpts) {
  const inPhone = screenInPhone(spec, o.shot);
  if (!inPhone) {
    drawScreenContent(ctx, spec, { x: 0, y: 0, w: W, h: H }, o);
    return;
  }
  const hand = o.shot === "pov_hand" || o.shot === "extreme_close";
  if (o.background) {
    ctx.save();
    o.background(ctx);
    ctx.restore();
    ctx.fillStyle = "rgba(10,12,20,0.55)";
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = "#1a1c24";
    ctx.fillRect(0, 0, W, H);
  }
  const pw = Math.min(W * (hand ? 0.74 : 0.64), (H * 0.8) / 2.05);
  const ph = pw * 2.05;
  const sway = Math.sin(o.t * 1.3) * 0.012;
  const px = (W - pw) / 2,
    py = hand ? H * 0.11 : (H - ph) / 2;
  ctx.save();
  ctx.translate(W / 2, py + ph * 0.9);
  ctx.rotate(sway + (hand ? -0.03 : 0));
  ctx.translate(-W / 2, -(py + ph * 0.9));
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRectPath(ctx, px + pw * 0.03, py + pw * 0.04, pw, ph, pw * 0.12);
  ctx.fill();
  ctx.fillStyle = "#23262f";
  roundRectPath(ctx, px, py, pw, ph, pw * 0.12);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, pw * 0.01);
  ctx.stroke();
  const bz = pw * 0.035;
  const sr: R = { x: px + bz, y: py + bz * 1.2, w: pw - bz * 2, h: ph - bz * 2.4 };
  ctx.save();
  roundRectPath(ctx, sr.x, sr.y, sr.w, sr.h, pw * 0.09);
  ctx.clip();
  drawScreenContent(ctx, spec, sr, o);
  // glass sheen
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(sr.x, sr.y);
  ctx.lineTo(sr.x + sr.w * 0.55, sr.y);
  ctx.lineTo(sr.x, sr.y + sr.h * 0.4);
  ctx.fill();
  ctx.restore();
  // camera notch
  circle(ctx, px + pw / 2, sr.y + pw * 0.04, pw * 0.014, "#0b0c10");
  if (hand) drawHand(ctx, px, py, pw, ph, o.handSkin ?? PALETTE.skin[2], H);
  ctx.restore();
}
