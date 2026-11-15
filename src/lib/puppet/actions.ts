/**
 * Actions as keyframe DATA. A recipe lists keys over a cycle (loop) or over a
 * one-off movement (once, then the last key holds). poseAt() samples a recipe
 * and layers breathing, blinking, eye drift and talking on top.
 *
 * Angles are radians, for a character facing right: a negative arm/leg angle
 * swings it forward/up; a positive root.rot leans the body forward.
 */
import type { Action, Face, PartName } from "./types";
import type { PartXf, Pose } from "./rig";
import { clamp, easeInOut, hash } from "./draw";

export interface RecipeKey {
  at: number; // 0..1 phase
  parts?: Partial<Record<PartName, PartXf>>;
  root?: { dx?: number; dy?: number; rot?: number; sit?: number; lie?: number };
}

export interface Recipe {
  mode: "loop" | "once";
  /** Seconds for one cycle (loop) or for the whole movement (once). */
  period: number;
  keys: RecipeKey[];
  /** Face forced by the action (else the actor's face). */
  face?: Face;
  /** Mouth opening forced by the action (laughing). */
  mouth?: number;
  eyesClosed?: boolean;
  /** Pose (another action) used while not travelling, for walk/run actions. */
  rest?: Action;
}

const A = (rot: number, sy?: number): PartXf => (sy === undefined ? { rot } : { rot, sy });

const WALK: RecipeKey[] = [
  { at: 0, parts: { leg_l: A(0.42), leg_r: A(-0.42), arm_l: A(-0.38), arm_r: A(0.38) }, root: { dy: 0 } },
  { at: 0.25, parts: { leg_l: A(0), leg_r: A(0), arm_l: A(0), arm_r: A(0) }, root: { dy: -9 } },
  { at: 0.5, parts: { leg_l: A(-0.42), leg_r: A(0.42), arm_l: A(0.38), arm_r: A(-0.38) }, root: { dy: 0 } },
  { at: 0.75, parts: { leg_l: A(0), leg_r: A(0), arm_l: A(0), arm_r: A(0) }, root: { dy: -9 } },
  { at: 1, parts: { leg_l: A(0.42), leg_r: A(-0.42), arm_l: A(-0.38), arm_r: A(0.38) }, root: { dy: 0 } },
];
const RUN: RecipeKey[] = [
  { at: 0, parts: { leg_l: A(0.8), leg_r: A(-0.8), arm_l: A(-0.9, 0.75), arm_r: A(0.9, 0.75) }, root: { dy: 0, rot: 0.14 } },
  { at: 0.25, parts: { leg_l: A(0.05), leg_r: A(-0.05), arm_l: A(0, 0.75), arm_r: A(0, 0.75) }, root: { dy: -22, rot: 0.14 } },
  { at: 0.5, parts: { leg_l: A(-0.8), leg_r: A(0.8), arm_l: A(0.9, 0.75), arm_r: A(-0.9, 0.75) }, root: { dy: 0, rot: 0.14 } },
  { at: 0.75, parts: { leg_l: A(-0.05), leg_r: A(0.05), arm_l: A(0, 0.75), arm_r: A(0, 0.75) }, root: { dy: -22, rot: 0.14 } },
  { at: 1, parts: { leg_l: A(0.8), leg_r: A(-0.8), arm_l: A(-0.9, 0.75), arm_r: A(0.9, 0.75) }, root: { dy: 0, rot: 0.14 } },
];
const SIT_PARTS = { leg_l: A(-1.2), leg_r: A(-1.15), arm_l: A(-0.55), arm_r: A(-0.6) };
const LIE_PARTS = { arm_l: A(0.08), arm_r: A(-0.05), head: { rot: -0.1 } };

export const RECIPES: Record<Action, Recipe> = {
  idle: {
    mode: "loop",
    period: 4,
    keys: [
      { at: 0, parts: { arm_l: A(0.02), arm_r: A(-0.02) } },
      { at: 0.5, parts: { arm_l: A(0.05), arm_r: A(-0.05) } },
      { at: 1, parts: { arm_l: A(0.02), arm_r: A(-0.02) } },
    ],
  },
  talk: {
    mode: "loop",
    period: 2.6,
    keys: [
      { at: 0, parts: { arm_r: A(-0.05), head: { rot: 0 } } },
      { at: 0.3, parts: { arm_r: A(-0.55, 0.82), head: { rot: -0.05 } } },
      { at: 0.55, parts: { arm_r: A(-0.4, 0.85), head: { rot: 0.03 } } },
      { at: 0.8, parts: { arm_r: A(-0.08), head: { rot: 0 } } },
      { at: 1, parts: { arm_r: A(-0.05), head: { rot: 0 } } },
    ],
  },
  walk_in: { mode: "loop", period: 0.9, keys: WALK, rest: "idle" },
  walk_out: { mode: "loop", period: 0.9, keys: WALK, rest: "idle" },
  walk_to: { mode: "loop", period: 0.9, keys: WALK, rest: "idle" },
  run: { mode: "loop", period: 0.5, keys: RUN, rest: "idle" },
  turn: {
    mode: "once",
    period: 0.6,
    keys: [
      { at: 0, parts: {} },
      { at: 0.5, parts: { head: { rot: -0.06 }, arm_l: A(0.2), arm_r: A(-0.2) }, root: { dy: -6 } },
      { at: 1, parts: {} },
    ],
  },
  sit: {
    mode: "once",
    period: 0.5,
    keys: [
      { at: 0, parts: SIT_PARTS, root: { sit: 1 } },
      { at: 1, parts: SIT_PARTS, root: { sit: 1 } },
    ],
  },
  stand: {
    mode: "once",
    period: 0.7,
    keys: [
      { at: 0, parts: SIT_PARTS, root: { sit: 1 } },
      { at: 0.5, parts: { leg_l: A(-0.4), leg_r: A(-0.4), arm_l: A(-0.3), arm_r: A(-0.3) }, root: { sit: 0.35, rot: 0.15 } },
      { at: 1, parts: {}, root: { sit: 0 } },
    ],
  },
  cry: {
    mode: "loop",
    period: 0.42,
    face: "crying",
    keys: [
      { at: 0, parts: { head: { rot: 0.16 }, arm_r: A(-2.73, 0.49), arm_l: A(-2.43, 0.52) }, root: { dy: 0 } },
      { at: 0.5, parts: { head: { rot: 0.2, dy: 2 }, arm_r: A(-2.68, 0.49), arm_l: A(-2.38, 0.52) }, root: { dy: 3 } },
      { at: 1, parts: { head: { rot: 0.16 }, arm_r: A(-2.73, 0.49), arm_l: A(-2.43, 0.52) }, root: { dy: 0 } },
    ],
  },
  laugh: {
    mode: "loop",
    period: 0.38,
    face: "happy",
    mouth: 0.8,
    keys: [
      { at: 0, parts: { head: { rot: -0.14 }, arm_l: A(-0.7, 0.7), arm_r: A(-0.5, 0.7) }, root: { dy: 0 } },
      { at: 0.5, parts: { head: { rot: -0.2 }, arm_l: A(-0.75, 0.7), arm_r: A(-0.55, 0.7) }, root: { dy: -5 } },
      { at: 1, parts: { head: { rot: -0.14 }, arm_l: A(-0.7, 0.7), arm_r: A(-0.5, 0.7) }, root: { dy: 0 } },
    ],
  },
  shock: {
    mode: "once",
    period: 0.8,
    face: "shocked",
    keys: [
      { at: 0, parts: {} },
      { at: 0.25, parts: { arm_l: A(-2.6), arm_r: A(-2.5), leg_l: A(0.15), leg_r: A(-0.15), head: { rot: -0.08 } }, root: { dy: -44 } },
      { at: 0.55, parts: { arm_l: A(-1.4, 0.8), arm_r: A(-1.3, 0.8), head: { rot: -0.04 } }, root: { dy: 0 } },
      { at: 1, parts: { arm_l: A(-1.1, 0.75), arm_r: A(-1.0, 0.75) }, root: { dy: 0, rot: -0.04 } },
    ],
  },
  angry: {
    mode: "loop",
    period: 0.18,
    face: "angry",
    keys: [
      { at: 0, parts: { arm_l: A(0.18), arm_r: A(0.22), head: { rot: 0.05 } }, root: { dx: -4, rot: 0.04 } },
      { at: 0.5, parts: { arm_l: A(0.22), arm_r: A(0.18), head: { rot: 0.07 } }, root: { dx: 4, rot: 0.04 } },
      { at: 1, parts: { arm_l: A(0.18), arm_r: A(0.22), head: { rot: 0.05 } }, root: { dx: -4, rot: 0.04 } },
    ],
  },
  hug: {
    mode: "once",
    period: 0.7,
    keys: [
      { at: 0, parts: {} },
      { at: 1, parts: { arm_l: A(-1.4, 0.72), arm_r: A(-1.25, 0.6), head: { rot: 0.1 } }, root: { rot: 0.08 } },
    ],
  },
  phone_ear: {
    mode: "loop",
    period: 3,
    keys: [
      { at: 0, parts: { arm_r: A(2.53, 0.5), head: { rot: 0.04 } } },
      { at: 0.5, parts: { arm_r: A(2.5, 0.5), head: { rot: 0.07 } } },
      { at: 1, parts: { arm_r: A(2.53, 0.5), head: { rot: 0.04 } } },
    ],
  },
  point: {
    mode: "once",
    period: 0.4,
    keys: [
      { at: 0, parts: {} },
      { at: 1, parts: { arm_r: A(-1.55), head: { rot: -0.03 } } },
    ],
  },
  nod: {
    mode: "loop",
    period: 0.7,
    keys: [
      { at: 0, parts: { head: { rot: 0 } } },
      { at: 0.45, parts: { head: { rot: 0.16, dy: 2 } } },
      { at: 1, parts: { head: { rot: 0 } } },
    ],
  },
  shake_head: {
    mode: "loop",
    period: 0.5,
    keys: [
      { at: 0, parts: { head: { rot: -0.05, dx: -4 } } },
      { at: 0.5, parts: { head: { rot: 0.05, dx: 4 } } },
      { at: 1, parts: { head: { rot: -0.05, dx: -4 } } },
    ],
  },
  lie_down: {
    mode: "once",
    period: 0.01,
    keys: [
      { at: 0, parts: LIE_PARTS, root: { lie: 1 } },
      { at: 1, parts: LIE_PARTS, root: { lie: 1 } },
    ],
  },
  pray: {
    mode: "loop",
    period: 3,
    eyesClosed: true,
    keys: [
      { at: 0, parts: { arm_r: A(-0.95, 0.42), arm_l: A(-1.23, 0.62), head: { rot: 0.12 } } },
      { at: 0.5, parts: { arm_r: A(-0.95, 0.42), arm_l: A(-1.23, 0.62), head: { rot: 0.16 } } },
      { at: 1, parts: { arm_r: A(-0.95, 0.42), arm_l: A(-1.23, 0.62), head: { rot: 0.12 } } },
    ],
  },
  fall: {
    mode: "once",
    period: 0.9,
    keys: [
      { at: 0, parts: {} },
      { at: 0.25, parts: { arm_l: A(-2.2), arm_r: A(-2.0), leg_r: A(-0.4) }, root: { rot: -0.3, dx: 10 } },
      { at: 0.7, parts: { arm_l: A(-2.6), arm_r: A(-2.4) }, root: { lie: 1, dy: -14 } },
      { at: 0.85, parts: { arm_l: A(-0.4), arm_r: A(-0.3) }, root: { lie: 1, dy: -4 } },
      { at: 1, parts: LIE_PARTS, root: { lie: 1 } },
    ],
  },
  wave: {
    mode: "loop",
    period: 0.6,
    face: "happy",
    keys: [
      { at: 0, parts: { arm_r: A(-2.55) } },
      { at: 0.5, parts: { arm_r: A(-3.0) } },
      { at: 1, parts: { arm_r: A(-2.55) } },
    ],
  },
};

export const ACTIONS = Object.keys(RECIPES) as Action[];

/* ------------------------------- travelling ------------------------------- */

/** Travel progress for moving actions (0..1) and whether the legs are walking. */
export function travelAt(action: Action, t: number, dur: number): { p: number; moving: boolean } {
  const win = (a: number, b: number) => {
    if (b <= a) return { p: t >= a ? 1 : 0, moving: false };
    const p = clamp((t - a) / (b - a), 0, 1);
    return { p, moving: t >= a && t < b };
  };
  switch (action) {
    case "walk_in":
      return win(0, Math.min(Math.max(dur * 0.7, 0.8), 2.4));
    case "walk_out":
      return win(Math.min(dur * 0.2, 0.6), dur);
    case "walk_to":
      return win(0, Math.min(Math.max(dur * 0.8, 0.8), 2.8));
    case "run":
      return win(0, dur);
    default:
      return { p: 0, moving: false };
  }
}

/** Distance walked per second as a fraction of the frame width, to pick a natural stride. */
export const WALK_SPEED = 0.42;

/* --------------------------------- blinks --------------------------------- */

export function blinkAt(t: number, seed: number): number {
  let at = 0.6 + hash(seed, 99) * 2.5;
  for (let k = 0; k < 400 && at < t + 0.2; k++) {
    const d = t - at;
    if (d >= 0 && d < 0.16) return d < 0.08 ? d / 0.08 : 1 - (d - 0.08) / 0.08;
    at += 3 + 2 * hash(seed, k);
  }
  return 0;
}

/* --------------------------------- poseAt --------------------------------- */

export interface PoseOpts {
  /** Actor's planned face. */
  face?: Face;
  /** Hip height above the feet in asset units (from the leg pivot). Default 214. */
  hipHeight?: number;
  /** Height of the seat / bed top above the floor in asset units (sit / lie on furniture). */
  seat?: number;
  /** Holding a prop: bend the holding arm a little. */
  holding?: boolean;
}

function sample(r: Recipe, t: number, seed: number): RecipeKey {
  const keys = r.keys;
  let ph: number;
  if (r.mode === "loop") ph = (((t / r.period + hash(seed, 7) * (r.period > 1 ? 1 : 0)) % 1) + 1) % 1;
  else ph = clamp(t / Math.max(0.001, r.period), 0, 1);
  let i = 0;
  while (i < keys.length - 2 && ph > keys[i + 1].at) i++;
  const a = keys[i],
    b = keys[Math.min(i + 1, keys.length - 1)];
  const span = b.at - a.at;
  const u = span > 0 ? easeInOut(clamp((ph - a.at) / span, 0, 1)) : 1;
  const parts: Partial<Record<PartName, PartXf>> = {};
  const names = new Set([...Object.keys(a.parts ?? {}), ...Object.keys(b.parts ?? {})]) as Set<PartName>;
  for (const n of names) {
    const pa = a.parts?.[n] ?? {},
      pb = b.parts?.[n] ?? {};
    const L = (k: keyof PartXf, d: number) => (pa[k] ?? d) + ((pb[k] ?? d) - (pa[k] ?? d)) * u;
    parts[n] = { rot: L("rot", 0), dx: L("dx", 0), dy: L("dy", 0), sx: L("sx", 1), sy: L("sy", 1) };
  }
  const ra = a.root ?? {},
    rb = b.root ?? {};
  const R = (k: keyof NonNullable<RecipeKey["root"]>) => (ra[k] ?? 0) + ((rb[k] ?? 0) - (ra[k] ?? 0)) * u;
  return { at: ph, parts, root: { dx: R("dx"), dy: R("dy"), rot: R("rot"), sit: R("sit"), lie: R("lie") } };
}

/**
 * Pose of an actor doing `action`, `tLocal` seconds into a shot of `dur`
 * seconds. `talk` 0..1 is voice loudness (0 for non-speakers); `seed` keeps
 * blinks and idle phases different per actor. Deterministic.
 */
export function poseAt(action: Action, tLocal: number, dur: number, talk: number, seed: number, opts: PoseOpts = {}): Pose {
  const t = Math.max(0, tLocal);
  let recipe = RECIPES[action] ?? RECIPES.idle;
  if (recipe.rest) {
    const tr = travelAt(action, t, dur);
    if (!tr.moving) recipe = RECIPES[recipe.rest];
  }
  const k = sample(recipe, t, seed);
  const parts = k.parts ?? {};
  const root = k.root ?? {};
  const hip = opts.hipHeight ?? 214;

  // breathing (all actions)
  const br = Math.sin((t / 3.6 + hash(seed, 3)) * Math.PI * 2);
  for (const n of ["arm_l", "arm_r", "head"] as PartName[]) {
    const p = (parts[n] = { ...(parts[n] ?? {}) });
    p.dy = (p.dy ?? 0) - 1.2 - br * 1.2;
  }
  // talking: small head bob driven by loudness
  if (talk > 0) {
    const h = (parts.head = { ...(parts.head ?? {}) });
    h.dy = (h.dy ?? 0) - talk * 3;
    h.rot = (h.rot ?? 0) + Math.sin(t * 7 + seed) * 0.025 * talk;
  }
  // holding a prop bends the arm (unless the action already moves it)
  if (opts.holding && action !== "phone_ear" && !(RECIPES[action]?.keys.some((q) => q.parts?.arm_r))) {
    parts.arm_r = { ...(parts.arm_r ?? {}), rot: -0.55, sy: 0.78 };
  }

  // sitting / lying offsets
  let dy = root.dy ?? 0;
  let rot = root.rot ?? 0;
  const sit = root.sit ?? 0;
  const lie = root.lie ?? 0;
  if (sit) {
    const seat = opts.seat ?? 12;
    dy += (hip - seat) * sit;
    if (opts.seat === undefined) {
      // floor sitting: legs straight out
      parts.leg_l = { ...(parts.leg_l ?? {}), rot: -1.45 * sit };
      parts.leg_r = { ...(parts.leg_r ?? {}), rot: -1.4 * sit };
    }
  }
  if (lie) {
    rot += -Math.PI / 2 * lie;
    dy -= (52 + (opts.seat ?? 0)) * lie;
  }

  const face = recipe.face ?? opts.face ?? "neutral";
  const blink = recipe.eyesClosed ? 1 : blinkAt(t, seed);
  const mouthOpen = clamp(Math.max(talk, recipe.mouth ? recipe.mouth * (0.7 + 0.3 * Math.sin(t * 16)) : 0), 0, 1);
  const lookX = Math.sin(t * 0.45 + seed * 1.7) * 0.35;
  return { parts, root: { dx: root.dx ?? 0, dy, rot }, face: { face, blink, mouthOpen, lookX, t } };
}
