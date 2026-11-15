/**
 * Film-like camera for puppet shots. A View is a centre point in PLACE
 * coordinates plus a scale (output pixels per place unit). Framing turns a
 * ShotSize + the actors into a View; moves animate it over the shot; layers
 * get parallax by shifting their centre less (back) or more (front).
 */
import type { CameraMove, ShotSize, Transition } from "./types";
import { clamp, easeInOut, easeOut, hash, type Mat } from "./draw";

export interface View {
  cx: number;
  cy: number;
  /** Output pixels per place unit. */
  s: number;
}

/** An actor's vertical extent in place coordinates (used for framing). */
export interface ActorBox {
  x: number;
  headTop: number;
  faceY: number;
  feetY: number;
}

/** Width (place units) of the 9:16 base frame that actor x 0..1 spans. */
export const BASE_FRAME_W = 1080;
export const PARALLAX = { back: 0.6, mid: 1, front: 1.25 } as const;

/** Map an actor's frame x (0..1) to place x. */
export function frameXToPlace(x: number, placeW: number): number {
  const fw = Math.min(BASE_FRAME_W, placeW);
  return (placeW - fw) / 2 + clamp(x, -0.6, 1.6) * fw;
}

export function clampView(v: View, placeSize: [number, number], W: number, H: number): View {
  const [pw, ph] = placeSize;
  // never show outside the place: minimum scale covers the viewport
  const s = Math.max(v.s, W / pw, H / ph);
  const hw = W / s / 2,
    hh = H / s / 2;
  return { s, cx: clamp(v.cx, hw, pw - hw), cy: clamp(v.cy, hh, ph - hh) };
}

/** The establishing (wide) view, also the parallax reference. */
export function wideView(placeSize: [number, number], floorY: number, W: number, H: number): View {
  const [pw, ph] = placeSize;
  let vw = Math.min(BASE_FRAME_W, pw);
  if ((vw * H) / W > ph) vw = (ph * W) / H;
  const s = W / vw;
  const vh = H / s;
  return clampView({ s, cx: pw / 2, cy: floorY - 0.28 * vh }, placeSize, W, H);
}

/**
 * Framing for a shot size. `actors[0]` is the focus actor; two_shot and
 * over_shoulder use the second one too.
 */
export function frameShot(
  size: ShotSize,
  actors: ActorBox[],
  placeSize: [number, number],
  floorY: number,
  W: number,
  H: number,
): View {
  const wide = wideView(placeSize, floorY, W, H);
  if (!actors.length || size === "wide") return wide;
  const a = actors[0];
  const h = Math.max(120, a.feetY - a.headTop);
  const byH = (vh: number, top: number, cx: number): View => {
    let s = H / vh;
    // keep at least ~0.5 h of width so a body fits
    const minW = h * 0.42;
    if (W / s < minW) s = W / minW;
    const realH = H / s;
    return clampView({ s, cx, cy: top + realH / 2 }, placeSize, W, H);
  };
  switch (size) {
    case "medium": {
      const vh = h * 1.18;
      return byH(vh, a.headTop - vh * 0.1, a.x);
    }
    case "close":
    case "pov_hand": {
      const vh = h * 0.5;
      const v = byH(vh, a.headTop - vh * 0.12, a.x);
      return v;
    }
    case "extreme_close": {
      const vh = h * 0.27;
      const s = H / vh;
      return clampView({ s, cx: a.x, cy: a.faceY + vh * 0.04 }, placeSize, W, H);
    }
    case "two_shot": {
      const b = actors[1] ?? a;
      const span = Math.abs(b.x - a.x) + h * 0.55;
      const top = Math.min(a.headTop, b.headTop);
      let s = Math.min(W / (span * 1.15), H / (h * 1.2));
      s = Math.max(s, wide.s);
      const vh = H / s;
      return clampView({ s, cx: (a.x + b.x) / 2, cy: top - vh * 0.12 + vh / 2 }, placeSize, W, H);
    }
    case "over_shoulder": {
      const b = actors[1];
      const vh = h * 0.72;
      const cx = b ? b.x + (a.x - b.x) * 0.7 : a.x;
      return byH(vh, a.headTop - vh * 0.1, cx);
    }
  }
  return wide;
}

/** Animate a view over the shot. p = 0..1 progress of the camera beat, t = seconds into it. */
export function applyMove(v: View, move: CameraMove, p: number, t: number, seed = 0, W = 1080): View {
  const e = easeInOut(clamp(p, 0, 1));
  const vw = W / v.s; // view width in place units
  switch (move) {
    case "push_in":
      return { ...v, s: v.s * (1 + 0.14 * e) };
    case "pull_out":
      return { ...v, s: v.s * (1.14 - 0.14 * e) };
    case "pan_left":
      return { ...v, s: v.s * 1.08, cx: v.cx + (0.5 - e) * 0.14 * vw };
    case "pan_right":
      return { ...v, s: v.s * 1.08, cx: v.cx - (0.5 - e) * 0.14 * vw };
    case "shake": {
      const amp = vw * 0.012;
      const n = (k: number) => Math.sin(t * (23 + k * 7) + hash(seed, k) * 6.28) * 0.6 + Math.sin(t * (41 + k * 5)) * 0.4;
      return { ...v, s: v.s * 1.04, cx: v.cx + n(1) * amp, cy: v.cy + n(2) * amp };
    }
    case "whip": {
      const q = clamp(t / 0.28, 0, 1);
      const off = (1 - easeOut(q)) * vw * 0.7;
      return { ...v, cx: v.cx + off };
    }
    default:
      return v;
  }
}

/** Parallax: layer view for depth factor k relative to the wide reference. */
export function layerView(v: View, ref: View, k: number): View {
  return { s: v.s, cx: ref.cx + (v.cx - ref.cx) * k, cy: ref.cy + (v.cy - ref.cy) * k };
}

/** Matrix mapping place coords to output pixels for a viewport at (ox, oy) of size W×H. */
export function viewMatrix(v: View, W: number, H: number, ox = 0, oy = 0): Mat {
  return [v.s, 0, 0, v.s, ox + W / 2 - v.cx * v.s, oy + H / 2 - v.cy * v.s];
}

export function toScreen(v: View, W: number, H: number, p: [number, number], ox = 0, oy = 0): [number, number] {
  return [ox + W / 2 + (p[0] - v.cx) * v.s, oy + H / 2 + (p[1] - v.cy) * v.s];
}

export interface Overlay {
  color: string;
  alpha: number;
}

/**
 * Transition overlays: `incoming` is this shot's transition (drawn at its
 * start), `outgoing` the next shot's (dark fades at this shot's end).
 * t and dur are shot-relative seconds.
 */
export function transitionOverlay(incoming: Transition | undefined, outgoing: Transition | undefined, t: number, dur: number): Overlay | null {
  let best: Overlay | null = null;
  const add = (color: string, alpha: number) => {
    const a = clamp(alpha, 0, 1);
    if (a > 0.001 && (!best || a > best.alpha)) best = { color, alpha: a };
  };
  switch (incoming) {
    case "fade":
      add("#000000", 1 - easeInOut(clamp(t / 0.45, 0, 1)));
      break;
    case "flash":
      add("#ffffff", 1 - easeOut(clamp(t / 0.3, 0, 1)));
      break;
    case "dip_black":
      add("#000000", 1 - easeInOut(clamp(t / 0.35, 0, 1)));
      break;
  }
  const left = dur - t;
  if (outgoing === "dip_black") add("#000000", 1 - clamp(left / 0.35, 0, 1));
  else if (outgoing === "fade") add("#000000", 0.7 * (1 - clamp(left / 0.35, 0, 1)));
  return best;
}
