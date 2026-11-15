/**
 * Character rig: draws a CharacterAsset in a pose, with an engine-drawn face
 * (eyes, brows, mouth, blinking, tears, sweat). Rotations are radians; for a
 * character facing right a NEGATIVE arm/leg rotation swings it forward/up.
 */
import type { CharacterAsset, Face, Part, PartName, PropAsset } from "./types";
import { PALETTE } from "./styleGuide";
import { apply, clamp, drawShapes, getMat, mul, rotate, scale, setMat, translate, type Mat } from "./draw";
import { pathBounds } from "./path";

export interface PartXf {
  rot?: number;
  dx?: number;
  dy?: number;
  /** Scale along the part's length (foreshortening, e.g. a bent arm). */
  sy?: number;
  sx?: number;
}

export interface FaceState {
  face: Face;
  /** 0 open … 1 closed. */
  blink: number;
  /** 0 closed … 1 wide open (talking). */
  mouthOpen: number;
  /** -1 … 1 eye direction. */
  lookX: number;
  /** Seconds, animates tears and sweat. */
  t?: number;
}

export interface Pose {
  parts: Partial<Record<PartName, PartXf>>;
  /** Whole-body transform around the feet point. */
  root: { dx: number; dy: number; rot: number };
  face: FaceState;
}

export interface DrawCharacterOpts {
  /** Feet position in the current context coordinates. */
  x: number;
  y: number;
  /** Asset units → context units. */
  scale: number;
  facing?: "left" | "right";
  /** Prop held in the hand of `holdArm` (default arm_r). */
  prop?: PropAsset | null;
  holdArm?: "arm_l" | "arm_r";
  /** Prop scale relative to the character scale (default 1). */
  propScale?: number;
  alpha?: number;
}

export const NEUTRAL_POSE: Pose = {
  parts: {},
  root: { dx: 0, dy: 0, rot: 0 },
  face: { face: "neutral", blink: 0, mouthOpen: 0, lookX: 0 },
};

const HEAD_ATTACHED: PartName[] = ["hair", "hair_back"];

function isHeadAttached(asset: CharacterAsset, p: Part): boolean {
  if (HEAD_ATTACHED.includes(p.name)) return true;
  if (p.name !== "accessory") return false;
  const head = asset.parts.find((q) => q.name === "head");
  return !!head && p.pivot[1] <= head.pivot[1] + 4;
}

function partMat(p: Part, xf: PartXf | undefined): Mat {
  if (!xf) return [1, 0, 0, 1, 0, 0];
  const [px, py] = p.pivot;
  let m = translate(px + (xf.dx ?? 0), py + (xf.dy ?? 0));
  if (xf.rot) m = mul(m, rotate(xf.rot));
  if (xf.sx !== undefined || xf.sy !== undefined) m = mul(m, scale(xf.sx ?? 1, xf.sy ?? 1));
  return mul(m, translate(-px, -py));
}

/** Root matrix: asset coords → context coords (feet at x,y). */
export function rootMat(asset: CharacterAsset, pose: Pose, o: DrawCharacterOpts): Mat {
  const [w, h] = asset.size;
  const flip = o.facing === "left" ? -1 : 1;
  let m = translate(o.x, o.y);
  m = mul(m, scale(o.scale * flip, o.scale));
  m = mul(m, translate(pose.root.dx, pose.root.dy));
  if (pose.root.rot) m = mul(m, rotate(pose.root.rot));
  return mul(m, translate(-w / 2, -h));
}

const tipCache = new WeakMap<Part, [number, number]>();
/** Hand / foot end of a limb: explicit `tip`, else the far end of its shapes' bounds. */
export function partTip(p: Part): [number, number] {
  if (p.tip) return p.tip;
  const c = tipCache.get(p);
  if (c) return c;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const s of p.shapes) {
    const b = pathBounds(s.d);
    if (!b) continue;
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  const tip: [number, number] = Number.isFinite(x0) ? [(x0 + x1) / 2, y1 - Math.min(14, (y1 - y0) * 0.08)] : p.pivot;
  tipCache.set(p, tip);
  return tip;
}

/** Matrix of a part in asset coords (includes head chain for hair/accessories). */
export function partChain(asset: CharacterAsset, pose: Pose, p: Part): Mat {
  const own = partMat(p, pose.parts[p.name]);
  if (p.name !== "head" && isHeadAttached(asset, p)) {
    const head = asset.parts.find((q) => q.name === "head");
    if (head) return mul(partMat(head, pose.parts.head), own);
  }
  return own;
}

/** Where a limb's tip ends up, in context coords. */
export function limbPoint(asset: CharacterAsset, pose: Pose, o: DrawCharacterOpts, name: PartName): [number, number] | null {
  const p = asset.parts.find((q) => q.name === name);
  if (!p) return null;
  return apply(mul(rootMat(asset, pose, o), partChain(asset, pose, p)), partTip(p));
}

/** Top of the head and the face centre, in context coords. */
export function headPoints(asset: CharacterAsset, pose: Pose, o: DrawCharacterOpts) {
  const head = asset.parts.find((q) => q.name === "head");
  const m = mul(rootMat(asset, pose, o), head ? partMat(head, pose.parts.head) : [1, 0, 0, 1, 0, 0]);
  const f = asset.face;
  const eyeY = (f.eyeL[1] + f.eyeR[1]) / 2;
  const faceC: [number, number] = [(f.eyeL[0] + f.eyeR[0]) / 2, (eyeY + f.mouth[1]) / 2];
  const top = headTopY(asset);
  return {
    face: apply(m, faceC),
    top: apply(m, [faceC[0], top]),
    chin: apply(m, [faceC[0], f.mouth[1] + (f.mouth[1] - eyeY) * 0.9]),
  };
}

export function headTopY(asset: CharacterAsset): number {
  let y = Infinity;
  for (const p of asset.parts) {
    if (p.name !== "head" && p.name !== "hair") continue;
    for (const s of p.shapes) {
      const b = pathBounds(s.d);
      if (b) y = Math.min(y, b.y0);
    }
  }
  if (!Number.isFinite(y)) y = asset.face.eyeL[1] - asset.face.eyeSize * 8;
  return y;
}

/** Draw a character. The context transform is preserved. */
export function drawCharacter(ctx: CanvasRenderingContext2D, asset: CharacterAsset, pose: Pose, o: DrawCharacterOpts) {
  const base = getMat(ctx);
  const a0 = ctx.globalAlpha;
  if (o.alpha !== undefined) ctx.globalAlpha = a0 * clamp(o.alpha, 0, 1);
  const root = rootMat(asset, pose, o);
  const parts = [...asset.parts].sort((a, b) => a.z - b.z);
  let faceAfter = -1;
  parts.forEach((p, i) => {
    if (p.name === "head" || p.name === "hair" || p.name === "hair_back") faceAfter = i;
  });
  let faceDone = false;
  const holdArm = o.holdArm ?? "arm_r";
  const drawFaceNow = () => {
    const head = asset.parts.find((q) => q.name === "head");
    setMat(ctx, base, mul(root, head ? partMat(head, pose.parts.head) : [1, 0, 0, 1, 0, 0]));
    drawFace(ctx, asset, pose.face);
    faceDone = true;
  };
  for (const p of parts) {
    setMat(ctx, base, mul(root, partChain(asset, pose, p)));
    drawShapes(ctx, p.shapes);
    if (p.name === holdArm && o.prop) {
      const tip = apply(partChain(asset, pose, p), partTip(p));
      const ps = o.propScale ?? 1;
      const pa = o.prop.anchor;
      setMat(ctx, base, mul(root, mul(translate(tip[0], tip[1]), mul(scale(ps), translate(-pa[0], -pa[1])))));
      drawShapes(ctx, o.prop.shapes);
    }
    if (!faceDone && parts.indexOf(p) === faceAfter) drawFaceNow();
  }
  if (!faceDone) drawFaceNow();
  ctx.setTransform(base[0], base[1], base[2], base[3], base[4], base[5]);
  ctx.globalAlpha = a0;
}

/* ---------------------------------- face ---------------------------------- */

const BROWS: Record<Face, { lift: number; tilt: number }> = {
  neutral: { lift: 0, tilt: 0 },
  happy: { lift: -0.35, tilt: -0.1 },
  sad: { lift: 0.05, tilt: 0.8 },
  crying: { lift: 0.1, tilt: 1 },
  angry: { lift: 0.35, tilt: -1 },
  shocked: { lift: -1, tilt: 0.15 },
  scared: { lift: -0.7, tilt: 0.85 },
  worried: { lift: -0.25, tilt: 0.65 },
};

export const FACES = Object.keys(BROWS) as Face[];

function drop(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(x, y - r * 2.2);
  ctx.quadraticCurveTo(x + r * 1.1, y - r * 0.4, x + r, y);
  ctx.arc(x, y, r, 0, Math.PI);
  ctx.quadraticCurveTo(x - r * 1.1, y - r * 0.4, x, y - r * 2.2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawFace(ctx: CanvasRenderingContext2D, asset: CharacterAsset, s: FaceState) {
  const F = asset.face;
  const e = F.eyeSize;
  const ink = F.ink ?? PALETTE.ink;
  const face = s.face;
  const t = s.t ?? 0;
  const look = clamp(s.lookX, -1, 1) * e * 0.35;
  const blink = clamp(s.blink, 0, 1);
  const eyes: [number, number][] = [F.eyeL, F.eyeR];
  const midX = (F.eyeL[0] + F.eyeR[0]) / 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // blush
  if (face === "happy" || face === "crying") {
    ctx.fillStyle = face === "happy" ? "rgba(226,120,120,0.32)" : "rgba(226,110,110,0.38)";
    for (const [ex, ey] of eyes) {
      ctx.beginPath();
      ctx.ellipse(ex + (ex < midX ? -e * 0.6 : e * 0.6), ey + e * 2.2, e * 1.3, e * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // eyes
  for (const [ex0, ey] of eyes) {
    const ex = ex0 + look;
    if (face === "crying" || (face === "happy" && s.mouthOpen > 0.55)) {
      // squeezed / laughing eyes as arcs
      ctx.strokeStyle = ink;
      ctx.lineWidth = e * 0.45;
      ctx.beginPath();
      if (face === "crying") {
        ctx.moveTo(ex - e, ey - e * 0.1);
        ctx.quadraticCurveTo(ex, ey + e * 0.7, ex + e, ey - e * 0.1);
      } else {
        ctx.moveTo(ex - e, ey + e * 0.3);
        ctx.quadraticCurveTo(ex, ey - e * 0.9, ex + e, ey + e * 0.3);
      }
      ctx.stroke();
      continue;
    }
    const open = 1 - blink;
    if (open < 0.18) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = e * 0.4;
      ctx.beginPath();
      ctx.moveTo(ex - e * 0.85, ey + e * 0.1);
      ctx.quadraticCurveTo(ex, ey + e * 0.45, ex + e * 0.85, ey + e * 0.1);
      ctx.stroke();
      continue;
    }
    if (face === "shocked" || face === "scared") {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = ink;
      ctx.lineWidth = e * 0.22;
      ctx.beginPath();
      ctx.ellipse(ex0, ey, e * 1.15, e * 1.3 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.ellipse(ex0 + look * 0.8, ey, e * 0.45, e * 0.5 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const squash = face === "happy" ? 0.85 : face === "angry" ? 0.8 : 1;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.ellipse(ex, ey, e * 0.72, e * squash * open, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(ex + e * 0.25, ey - e * 0.35 * open, e * 0.24, 0, Math.PI * 2);
    ctx.fill();
  }

  // brows
  const b = BROWS[face] ?? BROWS.neutral;
  ctx.strokeStyle = ink;
  ctx.lineWidth = e * 0.42;
  for (const [ex, ey] of eyes) {
    const inner = ex < midX ? 1 : -1; // direction of the inner end
    const by = ey - e * 2.1 + b.lift * e;
    const tilt = b.tilt * e * 0.7;
    ctx.beginPath();
    ctx.moveTo(ex - inner * e * 0.95, by + tilt * 0.5);
    ctx.lineTo(ex + inner * e * 0.95, by - tilt * 0.5);
    ctx.stroke();
  }

  // mouth
  const [mx, my] = F.mouth;
  const mw = e * 3;
  const open = clamp(s.mouthOpen, 0, 1);
  ctx.strokeStyle = ink;
  ctx.lineWidth = e * 0.4;
  const inside = "#6e2e34";
  const fillOpen = (rx: number, ry: number, dy = 0) => {
    ctx.fillStyle = inside;
    ctx.beginPath();
    ctx.ellipse(mx, my + dy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = e * 0.28;
    ctx.stroke();
  };
  if (face === "shocked") {
    fillOpen(e * 0.75, e * (1.0 + 0.4 * open), e * 0.3);
  } else if (open > 0.08) {
    if (face === "happy") {
      // open smile: flat top, round bottom
      const ry = e * (0.6 + 1.3 * open);
      ctx.fillStyle = inside;
      ctx.beginPath();
      ctx.moveTo(mx - mw * 0.5, my);
      ctx.quadraticCurveTo(mx, my + ry * 2, mx + mw * 0.5, my);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = e * 0.28;
      ctx.stroke();
    } else {
      const rx = face === "scared" || face === "worried" ? mw * 0.28 : mw * 0.36;
      fillOpen(rx, e * (0.3 + 1.1 * open), face === "sad" || face === "crying" ? e * 0.25 : 0);
    }
  } else {
    ctx.beginPath();
    switch (face) {
      case "happy":
        ctx.moveTo(mx - mw * 0.5, my - e * 0.2);
        ctx.quadraticCurveTo(mx, my + e * 1.5, mx + mw * 0.5, my - e * 0.2);
        break;
      case "sad":
        ctx.moveTo(mx - mw * 0.4, my + e * 0.6);
        ctx.quadraticCurveTo(mx, my - e * 0.6, mx + mw * 0.4, my + e * 0.6);
        break;
      case "crying":
        ctx.moveTo(mx - mw * 0.45, my + e * 0.7);
        ctx.quadraticCurveTo(mx, my - e * 0.9, mx + mw * 0.45, my + e * 0.7);
        break;
      case "angry":
        ctx.moveTo(mx - mw * 0.42, my + e * 0.35);
        ctx.lineTo(mx - mw * 0.2, my);
        ctx.lineTo(mx + mw * 0.2, my);
        ctx.lineTo(mx + mw * 0.42, my + e * 0.35);
        break;
      case "scared":
        ctx.moveTo(mx - mw * 0.4, my + e * 0.2);
        ctx.quadraticCurveTo(mx - mw * 0.2, my - e * 0.4, mx, my + e * 0.2);
        ctx.quadraticCurveTo(mx + mw * 0.2, my + e * 0.7, mx + mw * 0.4, my);
        break;
      case "worried":
        ctx.moveTo(mx - mw * 0.32, my + e * 0.35);
        ctx.quadraticCurveTo(mx, my - e * 0.3, mx + mw * 0.32, my + e * 0.15);
        break;
      default:
        ctx.moveTo(mx - mw * 0.3, my);
        ctx.quadraticCurveTo(mx, my + e * 0.5, mx + mw * 0.3, my);
    }
    ctx.lineWidth = e * 0.4;
    ctx.stroke();
  }

  // tears
  if (face === "crying") {
    for (let i = 0; i < 2; i++) {
      const [ex, ey] = eyes[i];
      for (let k = 0; k < 2; k++) {
        const p = (t * 0.9 + i * 0.37 + k * 0.5) % 1;
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * (1 - p * 0.8);
        drop(ctx, ex + (i ? e * 0.4 : -e * 0.4), ey + e * 1.6 + p * e * 6, e * 0.5, "#8cc7e8");
        ctx.globalAlpha = a;
      }
    }
  } else if (face === "sad") {
    drop(ctx, F.eyeR[0] + e * 0.6, F.eyeR[1] + e * 1.5, e * 0.35, "#a5d3ee");
  }
  // sweat drop
  if (face === "scared" || face === "worried") {
    const wob = Math.sin(t * 3) * e * 0.2;
    drop(ctx, F.eyeL[0] - e * 3.4, F.eyeL[1] - e * 2.6 + wob, e * 0.6, "#9fd4f0");
  }
}
