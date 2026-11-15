/** Time-of-day tint, deterministic weather particles and a soft vignette. */
import type { TimeOfDay, Weather } from "./types";
import { PALETTE } from "./styleGuide";
import { hash } from "./draw";

export function skyColor(time: TimeOfDay | undefined): string {
  return PALETTE.sky[time ?? "day"] ?? PALETTE.sky.day;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function withComposite(ctx: CanvasRenderingContext2D, op: GlobalCompositeOperation, alpha: number, color: string, r: Rect) {
  const o = ctx.globalCompositeOperation;
  const a = ctx.globalAlpha;
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = a * alpha;
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.globalCompositeOperation = o;
  ctx.globalAlpha = a;
}

/** Colour grade for the time of day (drawn over the scene, under screens/UI). */
export function drawTimeTint(ctx: CanvasRenderingContext2D, time: TimeOfDay | undefined, r: Rect) {
  switch (time) {
    case "morning":
      withComposite(ctx, "soft-light", 0.35, "#ffc27a", r);
      withComposite(ctx, "source-over", 0.06, "#fff0d8", r);
      break;
    case "evening":
      withComposite(ctx, "multiply", 0.3, "#f0a060", r);
      withComposite(ctx, "source-over", 0.06, "#ff8a3d", r);
      break;
    case "night":
      withComposite(ctx, "multiply", 0.72, "#2c3d6e", r);
      withComposite(ctx, "source-over", 0.12, "#0b1024", r);
      break;
    default:
      break;
  }
}

/** Weather particles; deterministic for a given t and seed. */
export function drawWeather(ctx: CanvasRenderingContext2D, weather: Weather | undefined, t: number, r: Rect, seed = 1) {
  if (!weather || weather === "clear") return;
  const k = r.h / 1920;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const a0 = ctx.globalAlpha;
  switch (weather) {
    case "rain": {
      ctx.strokeStyle = "rgba(205,218,240,0.55)";
      ctx.lineWidth = Math.max(1, 2.2 * k);
      ctx.lineCap = "round";
      ctx.beginPath();
      const n = 150;
      for (let i = 0; i < n; i++) {
        const sp = (1700 + hash(seed, i, 1) * 900) * k;
        const len = (40 + hash(seed, i, 2) * 50) * k;
        const x = r.x + ((hash(seed, i, 3) * (r.w + 200) + t * sp * 0.18) % (r.w + 200)) - 100;
        const y = r.y + ((hash(seed, i, 4) * (r.h + 200) + t * sp) % (r.h + 200)) - 100;
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * 0.18, y - len);
      }
      ctx.stroke();
      // splashes near the bottom
      ctx.fillStyle = "rgba(205,218,240,0.35)";
      for (let i = 0; i < 18; i++) {
        const ph = (t * 2.2 + hash(seed, i, 5)) % 1;
        const x = r.x + hash(seed, i, 6) * r.w;
        const y = r.y + r.h * (0.82 + hash(seed, i, 7) * 0.16);
        ctx.globalAlpha = a0 * (1 - ph);
        ctx.beginPath();
        ctx.ellipse(x, y, (6 + ph * 18) * k, (2 + ph * 4) * k, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = a0;
      ctx.fillStyle = "rgba(40,55,80,0.12)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      break;
    }
    case "fog": {
      ctx.fillStyle = "rgba(205,212,225,0.14)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // soft drifting bands: each band is a stack of faint, wide ellipses
      for (let i = 0; i < 6; i++) {
        const w = r.w * (1.1 + hash(seed, i, 1) * 0.8);
        const x = r.x + ((hash(seed, i, 2) * (r.w + w) + t * (10 + 16 * hash(seed, i, 3)) * k) % (r.w + w)) - w / 2;
        const y = r.y + r.h * (0.3 + hash(seed, i, 4) * 0.62);
        const hgt = r.h * (0.05 + hash(seed, i, 5) * 0.05);
        for (let j = 0; j < 4; j++) {
          ctx.fillStyle = "rgba(215,222,234,0.045)";
          ctx.beginPath();
          ctx.ellipse(x, y, (w / 2) * (1 - j * 0.18), hgt * (1 - j * 0.2), 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "snow": {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (let i = 0; i < 110; i++) {
        const sp = (80 + hash(seed, i, 1) * 120) * k;
        const rad = (3 + hash(seed, i, 2) * 6) * k;
        const x = r.x + ((hash(seed, i, 3) * r.w + Math.sin(t * 1.3 + i) * 30 * k) % r.w + r.w) % r.w;
        const y = r.y + ((hash(seed, i, 4) * (r.h + 40) + t * sp) % (r.h + 40)) - 20;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "dust": {
      ctx.fillStyle = "rgba(201,178,138,0.16)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "rgba(170,140,100,0.55)";
      for (let i = 0; i < 80; i++) {
        const sp = (60 + hash(seed, i, 1) * 140) * k;
        const x = r.x + ((hash(seed, i, 2) * (r.w + 40) + t * sp) % (r.w + 40)) - 20;
        const y = r.y + hash(seed, i, 3) * r.h + Math.sin(t * 2 + i) * 10 * k;
        ctx.beginPath();
        ctx.arc(x, y, (2 + hash(seed, i, 4) * 4) * k, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "smoke": {
      for (let i = 0; i < 14; i++) {
        const ph = (t * 0.12 + hash(seed, i, 1)) % 1;
        const x = r.x + r.w * hash(seed, i, 2) + Math.sin(t * 0.7 + i) * 40 * k;
        const y = r.y + r.h * (1.05 - ph * 1.1);
        const rad = (90 + ph * 260) * k;
        ctx.fillStyle = `rgba(110,110,120,${0.22 * (1 - ph)})`;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  ctx.globalAlpha = a0;
  ctx.restore();
}

export function drawVignette(ctx: CanvasRenderingContext2D, r: Rect, strength = 0.35) {
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  const g = ctx.createRadialGradient(cx, cy, Math.min(r.w, r.h) * 0.35, cx, cy, Math.hypot(r.w, r.h) * 0.6);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}
