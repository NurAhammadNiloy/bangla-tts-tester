/**
 * Asset Maker (v2 "director"): asks an LLM for a NEW character, place or prop as
 * plain JSON in the puppet engine's format, then makes it safe to draw:
 * boxes are fixed, paths are limited to absolute M L H V C Q Z and clamped into
 * the box, colours checked, missing body parts replaced by simple placeholders.
 */
import type { CharacterAsset, Part, PartName, PlaceAsset, PropAsset, Shape } from "@/lib/puppet/types";
import { PALETTE, STYLE_GUIDE_TEXT } from "@/lib/puppet/styleGuide";

export type AssetKind = "character" | "place" | "prop";
export const ASSET_KINDS: readonly AssetKind[] = ["character", "place", "prop"];

export const CHARACTER_SIZE: [number, number] = [300, 600];
export const PLACE_SIZE: [number, number] = [1620, 1920];
export const PROP_MAX = 400;
export const DEFAULT_FLOOR_Y = 1500;

export const PART_NAMES: readonly PartName[] = ["body", "head", "hair_back", "hair", "arm_l", "arm_r", "leg_l", "leg_r", "accessory"];
export const REQUIRED_PARTS: readonly PartName[] = ["body", "head", "arm_l", "arm_r", "leg_l", "leg_r"];

/** Limits given to the model (prompt) and enforced (normalizer, a little looser). */
export const LIMITS = {
  prompt: { part: 8, layer: 30, prop: 6 },
  hard: { part: 12, layer: 40, prop: 8, pathChars: 4000 },
} as const;

/* --------------------------------- schemas -------------------------------- */

const str = { type: "string" } as const;
const numS = { type: "number" } as const;
const int = { type: "integer" } as const;
const pair = { type: "array", items: numS } as const;
const strArr = { type: "array", items: str } as const;

function obj(properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties } as const;
}

const SHAPE_SCHEMA = obj({ d: str, fill: str, stroke: str, strokeWidth: numS, opacity: numS });
const SHAPES = { type: "array", items: SHAPE_SCHEMA } as const;

export const ASSET_SCHEMAS = {
  character: obj({
    kind: { type: "string", enum: ["character"] },
    id: str,
    label: str,
    tags: strArr,
    size: pair,
    parts: {
      type: "array",
      items: obj({ name: { type: "string", enum: [...PART_NAMES] }, pivot: pair, z: int, shapes: SHAPES }),
    },
    face: obj({ eyeL: pair, eyeR: pair, mouth: pair, eyeSize: numS, skin: str, ink: str }),
  }),
  place: obj({
    kind: { type: "string", enum: ["place"] },
    id: str,
    label: str,
    tags: strArr,
    size: pair,
    floorY: numS,
    layers: obj({ back: SHAPES, mid: SHAPES, front: SHAPES }),
  }),
  prop: obj({
    kind: { type: "string", enum: ["prop"] },
    id: str,
    label: str,
    tags: strArr,
    size: pair,
    anchor: pair,
    shapes: SHAPES,
  }),
} as const;

/* --------------------------------- prompt --------------------------------- */

const EXAMPLE_PART = `{"name":"arm_r","pivot":[185,150],"z":7,"shapes":[
  {"d":"M178 140 L196 140 Q204 142 204 152 L202 300 Q201 310 192 310 L182 310 Q174 310 174 300 L172 152 Q172 142 178 140 Z","fill":"#3f6fa6","stroke":"#2b2730","strokeWidth":3,"opacity":1},
  {"d":"M176 305 C176 322 200 322 200 305 C200 296 176 296 176 305 Z","fill":"#e2b48f","stroke":"#2b2730","strokeWidth":3,"opacity":1}]}`;

const EXAMPLE_LAYER = `"back":[
  {"d":"M0 0 H1620 V1500 H0 Z","fill":"#e8dcc6","stroke":"","strokeWidth":0,"opacity":1},
  {"d":"M0 1500 H1620 V1920 H0 Z","fill":"#b98b5a","stroke":"","strokeWidth":0,"opacity":1},
  {"d":"M120 420 H420 V820 H120 Z","fill":"#24304a","stroke":"","strokeWidth":0,"opacity":1}]`;

export function buildAssetPrompt(kind: AssetKind, p: { id: string; look: string; styleGuide?: string }): string {
  const styleGuide = p.styleGuide ?? STYLE_GUIDE_TEXT;
  const common = [
    "You draw flat 2D cut-out cartoon assets as JSON for a code-drawn puppet animation engine. Every shape is an SVG path string `d`.",
    "",
    styleGuide,
    "",
    "PATH RULES",
    "- Only ABSOLUTE commands M L H V C Q Z (upper case). No lower-case commands, no A, S, T arcs, no transforms.",
    "- Numbers are plain decimals in the asset's own box. Close filled shapes with Z. Make circles from 4 C curves.",
    `- Each d under ${LIMITS.hard.pathChars} characters; keep shapes simple.`,
    `- Flat colours from the palette (hex like "#c94f4f"); outline "${PALETTE.ink}". Use "" for no stroke, strokeWidth 0 for none, opacity 1 unless see-through.`,
    "",
  ];
  let specific: string[];
  if (kind === "character") {
    specific = [
      "CHARACTER",
      `- size = [${CHARACTER_SIZE[0]}, ${CHARACTER_SIZE[1]}]. Feet at bottom centre (150, 600). Facing RIGHT (nose/feet point right).`,
      "- Head about 1/5 of the height: head roughly y 15–135, neck at about (150,135), shoulders y≈150, hips y≈370.",
      `- parts (at most ${LIMITS.prompt.part} shapes each), REQUIRED: body, head, arm_l, arm_r, leg_l, leg_r. Optional: hair_back, hair, accessory.`,
      "- pivot = rotation point: head at the neck (150,135); arm_l at (115,150), arm_r at (185,150) shoulders; leg_l at (130,370), leg_r at (170,370) hips; body at the hips (150,370); hair/hair_back/accessory at the neck too.",
      "- z (draw order, low first): arm_l 1, leg_l 2, leg_r 3, body 4, hair_back 5, head 6, hair 7, accessory 8, arm_r 9.",
      "- Each arm is drawn hanging straight down from its shoulder, hand included; each leg straight down from its hip, foot as a small oval at y≈600.",
      "- Do NOT draw eyes, brows or mouth: the engine draws them. face.eyeL / face.eyeR / face.mouth are points ON the head (eyes about 1/3 down the head, the eye nearer the facing side further right; mouth below them), eyeSize 5–8, skin = the head's fill, ink = \"#2b2730\".",
      "- tags: 3–6 lower-case words (age, gender, clothing, culture, era).",
      "",
      "Worked example of ONE valid part:",
      EXAMPLE_PART,
    ];
  } else if (kind === "place") {
    specific = [
      "PLACE",
      `- size = [${PLACE_SIZE[0]}, ${PLACE_SIZE[1]}], floorY ≈ ${DEFAULT_FLOOR_Y} (where feet stand).`,
      `- layers.back: sky or far wall plus floor/ground band (first shape covers the whole box). layers.mid: furniture, buildings, trees, windows, doors. layers.front: only small items at the far left/right edges. At most ${LIMITS.prompt.layer} shapes per layer.`,
      "- Keep the centre clear: nothing tall in x 324–1296 between y 900 and 1500 except the floor, so characters can stand there.",
      "- Background shapes have no outline (stroke \"\"); mid/front items may use a thin outline.",
      "- Time of day and era come from the description (night: dark sky #24304a, lit windows; village: mud walls, tin roof; etc).",
      "- tags: 3–6 lower-case words (indoor/outdoor, kind of place, era, time).",
      "",
      "Worked example of a valid back layer:",
      EXAMPLE_LAYER,
    ];
  } else {
    specific = [
      "PROP",
      `- size = a small box that fits the object, each side 20–${PROP_MAX} (a phone ≈ [60,110], a lantern ≈ [90,140]).`,
      `- anchor = the point that sits in a hand or on the floor (bottom centre for floor objects). 1–${LIMITS.prompt.prop} shapes, thin outline.`,
      "- tags: 2–5 lower-case words.",
    ];
  }
  return [
    ...common,
    ...specific,
    "",
    `Set kind = "${kind}" and id = "${p.id}". label = a short Bangla or English name.`,
    "Return ONLY the JSON.",
  ].join("\n");
}

export function buildAssetUserMessage(kind: AssetKind, id: string, look: string, problems?: string[]): string {
  const lines = [`Draw the ${kind} "${id}": ${look}`];
  if (problems?.length) {
    lines.push("", "Your previous answer had these problems; fix them all:", ...problems.map((x) => `- ${x}`));
  }
  return lines.join("\n");
}

/* ------------------------------- path checks ------------------------------ */

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, Z: 0 };

/**
 * Check a path uses only absolute M L H V C Q Z with the right number of values,
 * and rewrite it with every coordinate clamped into [0,w]×[0,h]. null = unusable.
 */
export function sanitizePath(d: unknown, w: number, h: number): string | null {
  if (typeof d !== "string" || !d.trim() || d.length > LIMITS.hard.pathChars) return null;
  if (/[^MLHVCQZ0-9eE.,\s+-]/.test(d)) return null;
  const tokens = d.match(/[MLHVCQZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens || tokens[0] !== "M") return null;
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    const k = ARITY[cmd];
    if (k === undefined) return null;
    const nums: number[] = [];
    while (i < tokens.length && ARITY[tokens[i]] === undefined) nums.push(Number(tokens[i++]));
    if (nums.some((x) => !Number.isFinite(x))) return null;
    if (k === 0) {
      if (nums.length) return null;
      out.push("Z");
      continue;
    }
    if (!nums.length || nums.length % k !== 0) return null;
    const c = nums.map((x, j) => {
      const isY = cmd === "V" || (cmd !== "H" && j % 2 === 1);
      return fmt(Math.min(isY ? h : w, Math.max(0, x)));
    });
    out.push(`${cmd}${c.join(" ")}`);
  }
  return out.join(" ");
}

function fmt(x: number): string {
  return String(Math.round(x * 10) / 10);
}

/** Rough bounding box of a sanitized path (control points included). */
export function pathBounds(d: string): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let cx = 0, cy = 0;
  for (const m of d.matchAll(/([MLHVCQZ])([^MLHVCQZ]*)/g)) {
    const cmd = m[1];
    const nums = m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [];
    const pts: [number, number][] = [];
    if (cmd === "H") nums.forEach((x) => pts.push([(cx = x), cy]));
    else if (cmd === "V") nums.forEach((y) => pts.push([cx, (cy = y)]));
    else for (let j = 0; j + 1 < nums.length; j += 2) pts.push([nums[j], nums[j + 1]]);
    if (pts.length && cmd !== "H" && cmd !== "V") [cx, cy] = pts[pts.length - 1];
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/* -------------------------------- normalize ------------------------------- */

type R = Record<string, unknown>;
const rec = (v: unknown): R => (v && typeof v === "object" && !Array.isArray(v) ? (v as R) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown, fb: number) => (typeof v === "number" && Number.isFinite(v) ? v : fb);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const COLOR_RE = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|rgba|hsl|hsla)\([\d\s.,%/+-]{3,40}\)|[a-z]{3,20})$/i;

export function cleanColor(v: unknown): string | undefined {
  const c = s(v, 50);
  return c && COLOR_RE.test(c) ? c : undefined;
}

function point(v: unknown, w: number, h: number, fb: [number, number]): [number, number] {
  const a = arr(v);
  return [clamp(num(a[0], fb[0]), 0, w), clamp(num(a[1], fb[1]), 0, h)];
}

function tags(v: unknown): string[] {
  return [...new Set(arr(v).map((t) => s(t, 30).toLowerCase().replace(/\s+/g, "_")).filter(Boolean))].slice(0, 10);
}

interface Counter {
  dropped: number;
  total: number;
}

function cleanShapes(raw: unknown, w: number, h: number, max: number, where: string, warnings: string[], cnt: Counter): Shape[] {
  const out: Shape[] = [];
  const list = arr(raw);
  cnt.total += list.length;
  let bad = 0;
  for (const x of list) {
    const r = rec(x);
    const d = sanitizePath(r.d, w, h);
    if (!d) {
      bad++;
      continue;
    }
    const shape: Shape = { d };
    const fill = cleanColor(r.fill);
    const stroke = cleanColor(r.stroke);
    if (fill) shape.fill = fill;
    if (stroke && stroke !== "none") {
      shape.stroke = stroke;
      shape.strokeWidth = clamp(num(r.strokeWidth, 3), 0.5, 20);
    }
    const op = num(r.opacity, 1);
    if (op < 1) shape.opacity = clamp(op, 0.05, 1);
    if (!shape.fill && !shape.stroke) shape.fill = PALETTE.cloth[6];
    out.push(shape);
  }
  if (bad) {
    warnings.push(`${where}: dropped ${bad} shape(s) with bad or forbidden path data.`);
    cnt.dropped += bad;
  }
  if (out.length > max) {
    warnings.push(`${where}: kept ${max} of ${out.length} shapes.`);
    out.length = max;
  }
  return out;
}

/* placeholders so the engine never crashes on a missing part */
const PIVOTS: Record<PartName, [number, number]> = {
  body: [150, 370],
  head: [150, 135],
  hair_back: [150, 135],
  hair: [150, 135],
  arm_l: [115, 150],
  arm_r: [185, 150],
  leg_l: [130, 370],
  leg_r: [170, 370],
  accessory: [150, 135],
};
export const DEFAULT_Z: Record<PartName, number> = {
  arm_l: 1, leg_l: 2, leg_r: 3, body: 4, hair_back: 5, head: 6, hair: 7, accessory: 8, arm_r: 9,
};

const outline = { stroke: PALETTE.ink, strokeWidth: 3 };

export function placeholderPart(name: PartName, skin: string = PALETTE.skin[1]): Part {
  const cloth = PALETTE.cloth[3];
  const shapes: Record<PartName, Shape[]> = {
    head: [{ d: "M150 20 C187 20 210 48 210 78 C210 110 187 135 150 135 C113 135 90 110 90 78 C90 48 113 20 150 20 Z", fill: skin, ...outline }],
    body: [
      { d: "M140 125 H160 V150 H140 Z", fill: skin, ...outline },
      { d: "M110 150 Q150 138 190 150 L196 375 H104 Z", fill: cloth, ...outline },
    ],
    arm_l: [{ d: "M106 150 H124 L122 305 H108 Z", fill: cloth, ...outline }, { d: "M106 305 C106 322 124 322 124 305 Z", fill: skin, ...outline }],
    arm_r: [{ d: "M176 150 H194 L192 305 H178 Z", fill: cloth, ...outline }, { d: "M176 305 C176 322 194 322 194 305 Z", fill: skin, ...outline }],
    leg_l: [{ d: "M118 370 H142 L140 585 H120 Z", fill: PALETTE.cloth[7], ...outline }, { d: "M116 585 H150 Q156 600 140 600 H116 Z", fill: PALETTE.ink }],
    leg_r: [{ d: "M158 370 H182 L180 585 H160 Z", fill: PALETTE.cloth[7], ...outline }, { d: "M156 585 H190 Q196 600 180 600 H156 Z", fill: PALETTE.ink }],
    hair_back: [{ d: "M92 70 C92 20 208 20 208 70 Z", fill: PALETTE.hair[0] }],
    hair: [{ d: "M95 60 C100 20 200 20 205 60 Q150 40 95 60 Z", fill: PALETTE.hair[0] }],
    accessory: [{ d: "M110 30 H190 V45 H110 Z", fill: PALETTE.cloth[1], ...outline }],
  };
  return { name, pivot: PIVOTS[name], z: DEFAULT_Z[name], shapes: shapes[name] };
}

export interface NormalizedAsset<T> {
  asset: T;
  warnings: string[];
  /** Problems bad enough to ask the model again (missing parts, most shapes dropped, empty layers). */
  major: string[];
}

function normCharacter(o: R, id: string): NormalizedAsset<CharacterAsset> {
  const warnings: string[] = [];
  const major: string[] = [];
  const [w, h] = CHARACTER_SIZE;
  const cnt: Counter = { dropped: 0, total: 0 };
  const sz = arr(o.size);
  if (sz.length && (num(sz[0], 0) !== w || num(sz[1], 0) !== h)) warnings.push(`size forced to [${w}, ${h}].`);

  const parts: Part[] = [];
  const seen = new Set<PartName>();
  for (const x of arr(o.parts)) {
    const p = rec(x);
    const name = p.name as PartName;
    if (!PART_NAMES.includes(name)) {
      warnings.push(`Unknown part "${s(p.name, 20)}" dropped.`);
      continue;
    }
    if (seen.has(name)) {
      warnings.push(`Duplicate part "${name}" dropped.`);
      continue;
    }
    const shapes = cleanShapes(p.shapes, w, h, LIMITS.hard.part, `part ${name}`, warnings, cnt);
    if (!shapes.length) continue;
    seen.add(name);
    parts.push({ name, pivot: point(p.pivot, w, h, PIVOTS[name]), z: Math.round(clamp(num(p.z, DEFAULT_Z[name]), -50, 50)), shapes });
  }

  const f = rec(o.face);
  const headPart = parts.find((p) => p.name === "head");
  const skin = cleanColor(f.skin) ?? headPart?.shapes[0]?.fill ?? PALETTE.skin[1];
  for (const name of REQUIRED_PARTS) {
    if (!seen.has(name)) {
      parts.push(placeholderPart(name, skin));
      major.push(`Required part "${name}" was missing or had no valid shapes.`);
    }
  }
  parts.sort((a, b) => a.z - b.z);

  // Face anchors must sit on the head.
  const head = parts.find((p) => p.name === "head")!;
  const hb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const sh of head.shapes) {
    const b = pathBounds(sh.d);
    if (!b) continue;
    hb.x0 = Math.min(hb.x0, b.x0); hb.y0 = Math.min(hb.y0, b.y0); hb.x1 = Math.max(hb.x1, b.x1); hb.y1 = Math.max(hb.y1, b.y1);
  }
  const hw = hb.x1 - hb.x0;
  const hh = hb.y1 - hb.y0;
  const def = {
    eyeL: [hb.x0 + hw * 0.45, hb.y0 + hh * 0.45] as [number, number],
    eyeR: [hb.x0 + hw * 0.72, hb.y0 + hh * 0.45] as [number, number],
    mouth: [hb.x0 + hw * 0.62, hb.y0 + hh * 0.75] as [number, number],
  };
  const inHead = (pt: [number, number]) => pt[0] >= hb.x0 && pt[0] <= hb.x1 && pt[1] >= hb.y0 && pt[1] <= hb.y1;
  const anchor = (k: "eyeL" | "eyeR" | "mouth"): [number, number] => {
    const pt = point(f[k], w, h, def[k]);
    if (!Array.isArray(f[k]) || !inHead(pt)) {
      warnings.push(`face.${k} was missing or off the head; moved onto the head.`);
      return def[k].map((v) => Math.round(v)) as [number, number];
    }
    return pt;
  };

  const asset: CharacterAsset = {
    kind: "character",
    id,
    tags: tags(o.tags),
    size: [w, h],
    parts,
    face: {
      eyeL: anchor("eyeL"),
      eyeR: anchor("eyeR"),
      mouth: anchor("mouth"),
      eyeSize: clamp(num(f.eyeSize, 6), 2, 16),
      skin,
      ink: cleanColor(f.ink) ?? PALETTE.ink,
    },
  };
  const label = s(o.label, 80);
  if (label) asset.label = label;
  if (cnt.total && cnt.dropped / cnt.total > 0.3) major.push(`${cnt.dropped} of ${cnt.total} shapes had invalid path data.`);
  return { asset, warnings, major };
}

function normPlace(o: R, id: string): NormalizedAsset<PlaceAsset> {
  const warnings: string[] = [];
  const major: string[] = [];
  const [w, h] = PLACE_SIZE;
  const cnt: Counter = { dropped: 0, total: 0 };
  const L = rec(o.layers);
  const layers = {
    back: cleanShapes(L.back, w, h, LIMITS.hard.layer, "layer back", warnings, cnt),
    mid: cleanShapes(L.mid, w, h, LIMITS.hard.layer, "layer mid", warnings, cnt),
    front: cleanShapes(L.front, w, h, LIMITS.hard.layer, "layer front", warnings, cnt),
  };
  const floorY = Math.round(clamp(num(o.floorY, DEFAULT_FLOOR_Y), 1300, 1700));
  if (!layers.back.length) {
    major.push("layers.back was empty or invalid.");
    layers.back = [
      { d: `M0 0 H${w} V${floorY} H0 Z`, fill: PALETTE.wall[0] },
      { d: `M0 ${floorY} H${w} V${h} H0 Z`, fill: PALETTE.ground[0] },
    ];
  }
  if (!layers.mid.length) major.push("layers.mid was empty or invalid.");
  if (cnt.total && cnt.dropped / cnt.total > 0.3) major.push(`${cnt.dropped} of ${cnt.total} shapes had invalid path data.`);
  const asset: PlaceAsset = { kind: "place", id, tags: tags(o.tags), size: [w, h], floorY, layers };
  const label = s(o.label, 80);
  if (label) asset.label = label;
  return { asset, warnings, major };
}

function normProp(o: R, id: string): NormalizedAsset<PropAsset> {
  const warnings: string[] = [];
  const major: string[] = [];
  const sz = arr(o.size);
  const w = Math.round(clamp(num(sz[0], 120), 20, PROP_MAX));
  const h = Math.round(clamp(num(sz[1], 120), 20, PROP_MAX));
  const cnt: Counter = { dropped: 0, total: 0 };
  let shapes = cleanShapes(o.shapes, w, h, LIMITS.hard.prop, "prop", warnings, cnt);
  if (!shapes.length) {
    major.push("The prop had no valid shapes.");
    shapes = [{ d: `M2 2 H${w - 2} V${h - 2} H2 Z`, fill: PALETTE.cloth[9], ...outline }];
  }
  const asset: PropAsset = { kind: "prop", id, tags: tags(o.tags), size: [w, h], anchor: point(o.anchor, w, h, [w / 2, h]), shapes };
  const label = s(o.label, 80);
  if (label) asset.label = label;
  return { asset, warnings, major };
}

export function normalizeAsset(kind: "character", obj: unknown, id: string): NormalizedAsset<CharacterAsset>;
export function normalizeAsset(kind: "place", obj: unknown, id: string): NormalizedAsset<PlaceAsset>;
export function normalizeAsset(kind: "prop", obj: unknown, id: string): NormalizedAsset<PropAsset>;
export function normalizeAsset(kind: AssetKind, obj: unknown, id: string): NormalizedAsset<CharacterAsset | PlaceAsset | PropAsset>;
export function normalizeAsset(kind: AssetKind, obj: unknown, id: string): NormalizedAsset<CharacterAsset | PlaceAsset | PropAsset> {
  const o = rec(obj);
  const r = kind === "character" ? normCharacter(o, id) : kind === "place" ? normPlace(o, id) : normProp(o, id);
  if (o.kind !== undefined && o.kind !== kind) r.warnings.unshift(`kind "${s(o.kind, 20)}" replaced by "${kind}".`);
  return r;
}
