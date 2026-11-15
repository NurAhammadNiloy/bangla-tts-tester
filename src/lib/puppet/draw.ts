/** Low-level drawing helpers shared by the puppet modules. */
import type { Shape } from "./types";
import { path2d } from "./path";

/** 2D affine matrix [a, b, c, d, e, f] (same order as ctx.transform). */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0];
export const rotate = (a: number): Mat => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
export function apply(m: Mat, p: [number, number]): [number, number] {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}
export function setMat(ctx: CanvasRenderingContext2D, base: Mat, m: Mat) {
  const r = mul(base, m);
  ctx.setTransform(r[0], r[1], r[2], r[3], r[4], r[5]);
}

/** Read the context's current transform as a Mat (identity if unsupported). */
export function getMat(ctx: CanvasRenderingContext2D): Mat {
  const t = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  return t ? [t.a, t.b, t.c, t.d, t.e, t.f] : [...IDENTITY];
}

/** Colour tokens for places, e.g. "$sky" becomes the time-of-day sky colour. */
export type ColorMap = (c: string) => string;
const SAME: ColorMap = (c) => c;

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], color: ColorMap = SAME) {
  for (const s of shapes) {
    const p = path2d(s.d);
    const a0 = ctx.globalAlpha;
    if (s.opacity !== undefined && s.opacity < 1) ctx.globalAlpha = a0 * Math.max(0, s.opacity);
    if (s.fill && s.fill !== "none") {
      ctx.fillStyle = color(s.fill);
      ctx.fill(p);
    }
    if (s.stroke && s.stroke !== "none" && (s.strokeWidth ?? 0) > 0) {
      ctx.strokeStyle = color(s.stroke);
      ctx.lineWidth = s.strokeWidth as number;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke(p);
    }
    ctx.globalAlpha = a0;
  }
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Deterministic hash → 0..1. */
export function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.floor(v * 1000) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function strSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h % 100000) / 7;
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export const BN_FONT = '"Noto Sans Bengali", "Hind Siliguri", "Nirmala UI", sans-serif';
