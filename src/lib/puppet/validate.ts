/**
 * Validation for LLM-written puppet assets and episode plans.
 * - validateAsset: strict structure checks, soft fixes for small things.
 * - normalizePlan: turns any plan-ish JSON into a safe EpisodePlan.
 * - splitLongShots: render beats so long lines get 2–3 camera angles.
 */
import type {
  Action,
  Asset,
  AssetLibrary,
  CameraMove,
  CastMember,
  CharacterAsset,
  EpisodePlan,
  Face,
  Part,
  PartName,
  PlaceAsset,
  PlaceRef,
  PropAsset,
  RenderBeat,
  ScreenSpec,
  Shape,
  Shot,
  ShotSize,
  TimeOfDay,
  Transition,
  Weather,
  ActorInShot,
} from "./types";
import type { Genre } from "@/lib/storyPlan";
import { parsePath } from "./path";

/* --------------------------------- enums ---------------------------------- */

export const ACTION_LIST: Action[] = ["idle", "talk", "walk_in", "walk_out", "walk_to", "turn", "sit", "stand", "cry", "laugh", "shock", "angry", "hug", "phone_ear", "point", "nod", "shake_head", "lie_down", "pray", "fall", "wave", "run"];
export const FACE_LIST: Face[] = ["neutral", "happy", "sad", "crying", "angry", "shocked", "scared", "worried"];
export const SHOT_LIST: ShotSize[] = ["wide", "medium", "close", "extreme_close", "two_shot", "over_shoulder", "pov_hand"];
export const MOVE_LIST: CameraMove[] = ["hold", "push_in", "pull_out", "pan_left", "pan_right", "shake", "whip"];
export const TRANSITION_LIST: Transition[] = ["cut", "fade", "flash", "dip_black"];
export const TIME_LIST: TimeOfDay[] = ["morning", "day", "evening", "night"];
export const WEATHER_LIST: Weather[] = ["clear", "rain", "fog", "snow", "dust", "smoke"];
const GENRES: Genre[] = ["emotional", "drama", "horror", "comedy", "scifi", "explainer", "historical"];
const VOICES: CastMember["voice"][] = ["narrator", "female", "male", "female_old", "male_old", "child"];
const PART_NAMES: PartName[] = ["body", "head", "hair_back", "hair", "arm_l", "arm_r", "leg_l", "leg_r", "accessory"];
const REQUIRED_PARTS: PartName[] = ["body", "head", "arm_l", "arm_r", "leg_l", "leg_r"];
const SCREEN_TYPES: ScreenSpec["type"][] = ["notification", "incoming_call", "video_call", "chat", "letter", "tv_news", "calendar", "map", "photo", "text_card"];

const SYN: Record<string, Record<string, string>> = {
  action: {
    walk: "walk_in", walking: "walk_in", enter: "walk_in", enters: "walk_in", arrive: "walk_in", come_in: "walk_in",
    exit: "walk_out", leave: "walk_out", leaves: "walk_out", go: "walk_out", walk_away: "walk_out",
    move: "walk_to", approach: "walk_to", go_to: "walk_to",
    speak: "talk", speaking: "talk", talking: "talk", say: "talk", says: "talk", explain: "talk", whisper: "talk", ask: "talk",
    sitting: "sit", seated: "sit", sit_down: "sit", standing: "idle", stand_up: "stand", get_up: "stand", rise: "stand",
    crying: "cry", sob: "cry", sobbing: "cry", weep: "cry", weeping: "cry", tears: "cry",
    laughing: "laugh", giggle: "laugh", smile: "laugh", chuckle: "laugh",
    surprised: "shock", shocked: "shock", gasp: "shock", startle: "shock", startled: "shock", jump: "shock",
    shout: "angry", yell: "angry", scream: "angry", rage: "angry", argue: "angry",
    hugging: "hug", embrace: "hug", embracing: "hug", cuddle: "hug",
    phone: "phone_ear", call: "phone_ear", calling: "phone_ear", on_phone: "phone_ear", phone_call: "phone_ear", answer_phone: "phone_ear",
    pointing: "point", show: "point", nodding: "nod", agree: "nod", yes: "nod", no: "shake_head", refuse: "shake_head", deny: "shake_head",
    sleep: "lie_down", sleeping: "lie_down", lying: "lie_down", lie: "lie_down", lay: "lie_down", dead: "lie_down", sick: "lie_down",
    praying: "pray", dua: "pray", namaz: "pray", worship: "pray",
    falling: "fall", collapse: "fall", faint: "fall", fainting: "fall", trip: "fall",
    waving: "wave", greet: "wave", bye: "wave", hello: "wave",
    running: "run", flee: "run", chase: "run", rush: "run", hurry: "run",
    turn_around: "turn", look_back: "turn", stand: "stand", wait: "idle", waiting: "idle", look: "idle", listen: "idle", watch: "idle", think: "idle", still: "idle",
  },
  face: {
    smile: "happy", smiling: "happy", joy: "happy", joyful: "happy", glad: "happy", excited: "happy", calm: "neutral", normal: "neutral",
    cry: "crying", tearful: "crying", sobbing: "crying", unhappy: "sad", upset: "sad", grief: "sad", lonely: "sad",
    fear: "scared", afraid: "scared", terrified: "scared", frightened: "scared", horror: "scared",
    surprise: "shocked", surprised: "shocked", shock: "shocked", amazed: "shocked",
    anxious: "worried", nervous: "worried", concerned: "worried", confused: "worried", tense: "worried",
    mad: "angry", furious: "angry", annoyed: "angry", rage: "angry",
  },
  shot: {
    wide_shot: "wide", establishing: "wide", long: "wide", long_shot: "wide", full: "wide", full_shot: "wide",
    mid: "medium", medium_shot: "medium", mid_shot: "medium", ms: "medium",
    closeup: "close", close_up: "close", cu: "close", face: "close",
    ecu: "extreme_close", extreme_closeup: "extreme_close", extreme_close_up: "extreme_close", insert: "extreme_close", macro: "extreme_close",
    two: "two_shot", "2shot": "two_shot", "2_shot": "two_shot", twoshot: "two_shot",
    ots: "over_shoulder", over_the_shoulder: "over_shoulder", pov: "pov_hand", phone: "pov_hand", hand: "pov_hand",
  },
  move: {
    static: "hold", none: "hold", still: "hold", fixed: "hold", locked: "hold",
    zoom_in: "push_in", dolly_in: "push_in", zoom: "push_in", push: "push_in", slow_zoom: "push_in",
    zoom_out: "pull_out", dolly_out: "pull_out", pull: "pull_out", pull_back: "pull_out",
    pan: "pan_right", track_right: "pan_right", track_left: "pan_left", truck_left: "pan_left", truck_right: "pan_right",
    handheld: "shake", shaky: "shake", tremble: "shake", earthquake: "shake", whip_pan: "whip", swish: "whip",
  },
  transition: {
    crossfade: "fade", dissolve: "fade", fade_in: "fade", fade_out: "dip_black", white: "flash", flash_white: "flash", white_flash: "flash",
    fade_black: "dip_black", black: "dip_black", fade_to_black: "dip_black", hard_cut: "cut", none: "cut",
  },
  time: { midnight: "night", late_night: "night", dark: "night", dawn: "morning", sunrise: "morning", early_morning: "morning", noon: "day", afternoon: "day", daytime: "day", dusk: "evening", sunset: "evening", twilight: "evening" },
  weather: { rainy: "rain", storm: "rain", drizzle: "rain", monsoon: "rain", thunderstorm: "rain", mist: "fog", misty: "fog", foggy: "fog", haze: "fog", snowy: "snow", dusty: "dust", sandstorm: "dust", smoky: "smoke", fire: "smoke", sunny: "clear", none: "clear", cloudy: "clear" },
};

function lev(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** Map any value to the closest member of `valid` (synonyms, substrings, edit distance). */
export function closestEnum<T extends string>(value: unknown, valid: readonly T[], kind: keyof typeof SYN | null, fallback: T): T {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!v) return fallback;
  if ((valid as readonly string[]).includes(v)) return v as T;
  const syn = kind ? SYN[kind][v] : undefined;
  if (syn && (valid as readonly string[]).includes(syn)) return syn as T;
  for (const c of valid) if (v.includes(c) || (c.length > 3 && c.includes(v) && v.length >= 3)) return c;
  if (kind) for (const [k, s] of Object.entries(SYN[kind])) if (k.length > 3 && v.includes(k)) return s as T;
  let best = fallback,
    bd = Infinity;
  for (const c of valid) {
    const d = lev(v, c);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return bd <= Math.max(1, Math.floor(best.length / 3)) ? best : fallback;
}

/* --------------------------------- assets --------------------------------- */

export interface AssetResult {
  ok: boolean;
  asset?: Asset;
  errors: string[];
}

export const LIMITS = {
  pathLength: 6000,
  characterShapes: 160,
  propShapes: 40,
  placeShapes: 900,
  totalPathChars: 250000,
};

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isPt = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && isNum(x[0]) && isNum(x[1]);

export function isColor(c: unknown): boolean {
  if (typeof c !== "string") return false;
  const s = c.trim();
  return (
    /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ||
    /^(rgb|rgba|hsl|hsla)\(\s*[-\d.%\s,/]+\)$/i.test(s) ||
    /^[a-z]{3,20}$/i.test(s) ||
    /^\$(sky|skyDark)$/.test(s)
  );
}

function checkShapes(raw: unknown, where: string, errors: string[], budget: { chars: number }): Shape[] {
  if (!Array.isArray(raw)) {
    errors.push(`${where}: shapes must be an array`);
    return [];
  }
  const out: Shape[] = [];
  raw.forEach((s, i) => {
    const w = `${where}[${i}]`;
    if (!isObj(s)) return void errors.push(`${w}: not an object`);
    if (typeof s.d !== "string" || s.d.length > LIMITS.pathLength) return void errors.push(`${w}: path missing or too long`);
    if (!parsePath(s.d)) return void errors.push(`${w}: path is not valid SVG path data`);
    budget.chars += s.d.length;
    const sh: Shape = { d: s.d };
    if (s.fill !== undefined) {
      if (!isColor(s.fill)) return void errors.push(`${w}: bad fill colour`);
      sh.fill = String(s.fill);
    }
    if (s.stroke !== undefined) {
      if (!isColor(s.stroke)) return void errors.push(`${w}: bad stroke colour`);
      sh.stroke = String(s.stroke);
    }
    if (s.strokeWidth !== undefined) {
      if (!isNum(s.strokeWidth) || s.strokeWidth < 0 || s.strokeWidth > 60) return void errors.push(`${w}: bad strokeWidth`);
      sh.strokeWidth = s.strokeWidth;
    }
    if (s.opacity !== undefined) {
      if (!isNum(s.opacity)) return void errors.push(`${w}: bad opacity`);
      sh.opacity = Math.max(0, Math.min(1, s.opacity));
    }
    if (sh.fill === undefined && sh.stroke === undefined) sh.fill = "#000000";
    out.push(sh);
  });
  return out;
}

function inBox(p: [number, number], size: [number, number], tol = 0.1): boolean {
  const [w, h] = size;
  return p[0] >= -w * tol && p[0] <= w * (1 + tol) && p[1] >= -h * tol && p[1] <= h * (1 + tol);
}

/** Validate an asset (character, place or prop) written by hand or by an LLM. */
export function validateAsset(obj: unknown): AssetResult {
  const errors: string[] = [];
  if (!isObj(obj)) return { ok: false, errors: ["asset is not an object"] };
  const kind = obj.kind;
  if (kind !== "character" && kind !== "place" && kind !== "prop") return { ok: false, errors: [`unknown kind ${String(kind)}`] };
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) errors.push("id must be 1–64 letters, digits, _ or -");
  const tags = Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 40)).slice(0, 30) : [];
  const label = typeof obj.label === "string" ? obj.label.slice(0, 200) : undefined;
  const size = obj.size;
  if (!isPt(size) || size[0] <= 0 || size[1] <= 0 || size[0] > 5000 || size[1] > 5000) {
    errors.push("size must be [w, h] with positive numbers");
    return { ok: false, errors };
  }
  const budget = { chars: 0 };
  const common = { id, tags, ...(label ? { label } : {}), size: [size[0], size[1]] as [number, number] };

  if (kind === "character") {
    const parts: Part[] = [];
    if (!Array.isArray(obj.parts)) errors.push("parts must be an array");
    const seen = new Set<string>();
    let count = 0;
    (Array.isArray(obj.parts) ? obj.parts : []).forEach((p, i) => {
      if (!isObj(p)) return void errors.push(`parts[${i}]: not an object`);
      const name = p.name as PartName;
      if (!PART_NAMES.includes(name)) return void errors.push(`parts[${i}]: unknown part name ${String(p.name)}`);
      if (seen.has(name) && name !== "accessory") errors.push(`parts[${i}]: duplicate ${name}`);
      seen.add(name);
      if (!isPt(p.pivot) || !inBox(p.pivot, size)) errors.push(`parts[${i}] (${name}): pivot must be inside the box`);
      const shapes = checkShapes(p.shapes, `parts[${i}].shapes`, errors, budget);
      count += shapes.length;
      const part: Part = { name, pivot: isPt(p.pivot) ? [p.pivot[0], p.pivot[1]] : [0, 0], z: isNum(p.z) ? p.z : i, shapes };
      if (p.tip !== undefined) {
        if (isPt(p.tip) && inBox(p.tip, size)) part.tip = [p.tip[0], p.tip[1]];
        else errors.push(`parts[${i}] (${name}): tip must be inside the box`);
      }
      parts.push(part);
    });
    for (const r of REQUIRED_PARTS) if (!seen.has(r)) errors.push(`missing required part ${r}`);
    if (count > LIMITS.characterShapes) errors.push(`too many shapes (${count} > ${LIMITS.characterShapes})`);
    const f = obj.face;
    let face: CharacterAsset["face"] | null = null;
    if (!isObj(f)) errors.push("face anchors missing");
    else {
      for (const k of ["eyeL", "eyeR", "mouth"] as const) if (!isPt(f[k]) || !inBox(f[k] as [number, number], size, 0)) errors.push(`face.${k} must be a point inside the box`);
      if (!isNum(f.eyeSize) || f.eyeSize <= 0 || f.eyeSize > size[0] / 4) errors.push("face.eyeSize must be a small positive number");
      if (!isColor(f.skin)) errors.push("face.skin must be a colour");
      if (f.ink !== undefined && !isColor(f.ink)) errors.push("face.ink must be a colour");
      if (!errors.length)
        face = { eyeL: f.eyeL as [number, number], eyeR: f.eyeR as [number, number], mouth: f.mouth as [number, number], eyeSize: f.eyeSize as number, skin: f.skin as string, ...(f.ink ? { ink: f.ink as string } : {}) };
    }
    if (budget.chars > LIMITS.totalPathChars) errors.push("path data too large");
    if (errors.length || !face) return { ok: false, errors };
    return { ok: true, errors, asset: { kind: "character", ...common, parts, face } };
  }

  if (kind === "place") {
    const floorY = obj.floorY;
    if (!isNum(floorY) || floorY <= 0 || floorY > size[1]) errors.push("floorY must be inside the place height");
    const L = isObj(obj.layers) ? obj.layers : null;
    if (!L) errors.push("layers {back, mid, front} missing");
    const layer = (k: "back" | "mid" | "front") => (L && L[k] !== undefined ? checkShapes(L[k], `layers.${k}`, errors, budget) : []);
    const layers = { back: layer("back"), mid: layer("mid"), front: layer("front") };
    const n = layers.back.length + layers.mid.length + layers.front.length;
    if (!layers.back.length) errors.push("layers.back must have shapes");
    if (n > LIMITS.placeShapes) errors.push(`too many shapes (${n} > ${LIMITS.placeShapes})`);
    if (budget.chars > LIMITS.totalPathChars) errors.push("path data too large");
    if (errors.length) return { ok: false, errors };
    const asset: PlaceAsset = { kind: "place", ...common, floorY: floorY as number, layers };
    return { ok: true, errors, asset };
  }

  // prop
  const anchor = obj.anchor;
  if (!isPt(anchor) || !inBox(anchor, size)) errors.push("anchor must be a point inside the box");
  const shapes = checkShapes(obj.shapes, "shapes", errors, budget);
  if (!shapes.length) errors.push("prop needs at least one shape");
  if (shapes.length > LIMITS.propShapes) errors.push(`too many shapes (${shapes.length} > ${LIMITS.propShapes})`);
  if (obj.seatY !== undefined && (!isNum(obj.seatY) || obj.seatY < 0 || obj.seatY > size[1])) errors.push("seatY must be inside the prop height");
  if (errors.length) return { ok: false, errors };
  const prop: PropAsset = { kind: "prop", ...common, anchor: anchor as [number, number], shapes, ...(isNum(obj.seatY) ? { seatY: obj.seatY } : {}) };
  return { ok: true, errors, asset: prop };
}

/* --------------------------------- plans ---------------------------------- */

const words = (s: string) => {
  const w = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set(w);
  for (let i = 0; i < w.length - 1; i++) out.add(`${w[i]}_${w[i + 1]}`);
  return out;
};

/** Closest library item by tag overlap with a description. */
export function closestByTags<T extends { id: string; tags: string[] }>(items: T[], text: string): T | null {
  if (!items.length) return null;
  const ws = words(text);
  let best = items[0],
    bs = -1;
  for (const it of items) {
    let s = 0;
    for (const t of it.tags) if (ws.has(t.toLowerCase())) s += t.includes("_") ? 2 : 1;
    if (ws.has(it.id.toLowerCase())) s += 3;
    if (s > bs) {
      bs = s;
      best = it;
    }
  }
  return best;
}

const str = (x: unknown, d = "", max = 2000) => (typeof x === "string" ? x.slice(0, max) : typeof x === "number" ? String(x) : d);
const num = (x: unknown, d: number) => (isNum(x) ? x : typeof x === "string" && x.trim() && Number.isFinite(Number(x)) ? Number(x) : d);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const slug = (s: string, d: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || d;

const ALT_SHOT: Record<ShotSize, ShotSize> = {
  wide: "medium",
  medium: "close",
  close: "medium",
  extreme_close: "close",
  two_shot: "medium",
  over_shoulder: "close",
  pov_hand: "extreme_close",
};

function normScreen(x: unknown, line: string, castIds: string[]): ScreenSpec | undefined {
  if (!isObj(x)) return undefined;
  const type = closestEnum(x.type, SCREEN_TYPES, null, "text_card");
  const S = (k: string, d = "") => str(x[k], d, 400);
  switch (type) {
    case "notification":
      return { type, app: S("app") || undefined, title: S("title", "নতুন বার্তা"), body: S("body", line) };
    case "incoming_call":
      return { type, caller: S("caller", "অচেনা নম্বর"), subtitle: S("subtitle") || undefined };
    case "video_call": {
      const who = castIds.includes(S("who")) ? S("who") : castIds[0] ?? "";
      return { type, caller: S("caller", who), who };
    }
    case "chat": {
      const msgs = Array.isArray(x.messages) ? x.messages : [];
      const messages = msgs
        .filter(isObj)
        .slice(0, 12)
        .map((m) => ({ from: (m.from === "me" ? "me" : "them") as "me" | "them", text: str(m.text, "", 300) }))
        .filter((m) => m.text);
      return { type, title: S("title", "চ্যাট"), messages: messages.length ? messages : [{ from: "them", text: line || "…" }] };
    }
    case "letter":
      return { type, text: S("text", line) || "…", signature: S("signature") || undefined };
    case "tv_news":
      return { type, headline: S("headline", line) || "…", ticker: S("ticker") || undefined };
    case "calendar": {
      const days = Math.round(Math.max(28, Math.min(31, num(x.days, 30))));
      return { type, title: S("title", "ক্যালেন্ডার"), days, marked: Math.round(Math.max(1, Math.min(days, num(x.marked, 1)))) };
    }
    case "map":
      return { type, from: S("from", "এখান"), to: S("to", "গন্তব্য") };
    case "photo": {
      const who = (Array.isArray(x.who) ? x.who : []).map((w) => str(w)).filter((w) => castIds.includes(w)).slice(0, 4);
      return { type, caption: S("caption") || undefined, who: who.length ? who : castIds.slice(0, 2) };
    }
    default:
      return { type: "text_card", text: S("text", line) || line || "…" };
  }
}

function normActors(raw: unknown, castIds: string[], warn: (s: string) => void, propOk: (id: string) => boolean, where: string): ActorInShot[] {
  if (!Array.isArray(raw)) return [];
  const out: ActorInShot[] = [];
  const seen = new Set<string>();
  raw.forEach((a, i) => {
    if (!isObj(a)) return;
    const id = str(a.id);
    if (!castIds.includes(id)) return void warn(`${where}: actor "${id}" is not in the cast — dropped`);
    if (seen.has(id)) return void warn(`${where}: actor "${id}" listed twice — dropped`);
    seen.add(id);
    const n = Array.isArray(raw) ? raw.length : 1;
    const act: ActorInShot = {
      id,
      x: clamp01(num(a.x, n === 1 ? 0.5 : 0.3 + (0.4 * i) / Math.max(1, n - 1))),
      action: closestEnum(a.action, ACTION_LIST, "action", "idle"),
      face: closestEnum(a.face, FACE_LIST, "face", "neutral"),
    };
    if (a.facing === "left" || a.facing === "right") act.facing = a.facing;
    if (a.toX !== undefined) act.toX = clamp01(num(a.toX, act.x));
    if (typeof a.prop === "string" && a.prop) {
      if (propOk(a.prop)) act.prop = a.prop;
      else warn(`${where}: prop "${a.prop}" unknown — dropped`);
    }
    out.push(act);
  });
  return out;
}

/** Make any plan-like JSON safe to render with `lib`. */
export function normalizePlan(obj: unknown, lib: AssetLibrary): { plan: EpisodePlan; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);
  const o = isObj(obj) ? obj : (warn("plan is not an object"), {} as Record<string, unknown>);
  const chars = Object.values(lib.characters);
  const placesLib = Object.values(lib.places);
  const propsLib = Object.values(lib.props);

  /* cast */
  const cast: CastMember[] = [];
  (Array.isArray(o.cast) ? o.cast : []).forEach((c, i) => {
    if (!isObj(c)) return;
    let id = slug(str(c.id, str(c.name)), `cast${i + 1}`);
    while (cast.some((m) => m.id === id) || id === "narrator") id = `${id}_${i + 1}`;
    const look = str(c.look, "", 300);
    const isNew = c.new === true;
    let asset = str(c.asset);
    if (!lib.characters[asset] && !isNew) {
      const best = closestByTags(chars, `${look} ${asset} ${str(c.voice)}`);
      if (best) {
        if (asset) warn(`cast "${id}": asset "${asset}" not in library — using ${best.id}`);
        asset = best.id;
      }
    }
    const voice = closestEnum(c.voice, VOICES, null, "male");
    cast.push({ id, name: str(c.name, id, 80), asset, look, voice, ...(isNew ? { new: true } : {}) });
  });
  const castIds = cast.map((c) => c.id);

  /* places */
  const places: PlaceRef[] = [];
  (Array.isArray(o.places) ? o.places : []).forEach((p, i) => {
    if (!isObj(p)) return;
    let id = slug(str(p.id), `place${i + 1}`);
    while (places.some((q) => q.id === id)) id = `${id}_${i + 1}`;
    const look = str(p.look, "", 300);
    const isNew = p.new === true;
    let asset = str(p.asset);
    if (!lib.places[asset] && !isNew) {
      const best = closestByTags(placesLib, `${look} ${asset} ${id}`);
      if (best) {
        if (asset) warn(`place "${id}": asset "${asset}" not in library — using ${best.id}`);
        asset = best.id;
      }
    }
    const ref: PlaceRef = { id, asset, look, time: closestEnum(p.time, TIME_LIST, "time", "day") };
    if (p.weather !== undefined) ref.weather = closestEnum(p.weather, WEATHER_LIST, "weather", "clear");
    if (typeof p.label === "string" && p.label.trim()) ref.label = p.label.slice(0, 60);
    if (isNew) ref.new = true;
    places.push(ref);
  });
  if (!places.length && placesLib.length) {
    warn("no places — using the first library place");
    places.push({ id: "place1", asset: placesLib[0].id, look: placesLib[0].label ?? placesLib[0].id, time: "day" });
  }
  const placeIds = places.map((p) => p.id);

  /* props */
  const props: NonNullable<EpisodePlan["props"]> = [];
  (Array.isArray(o.props) ? o.props : []).forEach((p, i) => {
    if (!isObj(p)) return;
    const id = slug(str(p.id), `prop${i + 1}`);
    if (props.some((q) => q.id === id)) return;
    const look = str(p.look, "", 200);
    const isNew = p.new === true;
    let asset = str(p.asset);
    if (!lib.props[asset] && !isNew) {
      const best = closestByTags(propsLib, `${look} ${asset} ${id}`);
      if (best) {
        if (asset) warn(`prop "${id}": asset "${asset}" not in library — using ${best.id}`);
        asset = best.id;
      }
    }
    props.push({ id, asset, look, ...(isNew ? { new: true } : {}) });
  });
  const propOk = (id: string) => props.some((p) => p.id === id) || !!lib.props[id];

  /* shots */
  const shots: Shot[] = [];
  const rawShots = Array.isArray(o.shots) ? o.shots : [];
  rawShots.forEach((s, i) => {
    if (!isObj(s)) return void warn(`shots[${i}]: not an object — dropped`);
    const where = `shots[${i}]`;
    const line = str(s.line, "", 1000);
    let speaker = str(s.speaker, "narrator");
    if (speaker !== "narrator" && !castIds.includes(speaker)) {
      warn(`${where}: speaker "${speaker}" not in cast — narrator`);
      speaker = "narrator";
    }
    const shot: Shot = { line, speaker, camera: { shot: "medium", move: "hold" } };
    const placeOf = (x: unknown) => {
      const p = str(x);
      if (!p) return undefined;
      if (placeIds.includes(p)) return p;
      warn(`${where}: place "${p}" unknown — ignored`);
      return undefined;
    };
    const pl = placeOf(s.place);
    if (pl) shot.place = pl;
    const cam = isObj(s.camera) ? s.camera : {};
    shot.camera = {
      shot: closestEnum(cam.shot ?? s.shot, SHOT_LIST, "shot", "medium"),
      move: closestEnum(cam.move ?? s.move, MOVE_LIST, "move", "hold"),
    };
    const layout = s.layout === "split" || (isObj(s.top) && isObj(s.bottom)) ? "split" : "single";
    if (layout === "split") {
      shot.layout = "split";
      const fallbackPlace = pl ?? (shots.length ? shots[shots.length - 1].place : undefined) ?? placeIds[0];
      let top = isObj(s.top) ? s.top : null;
      let bottom = isObj(s.bottom) ? s.bottom : null;
      if (!top || !bottom) {
        const acts = Array.isArray(s.actors) ? s.actors : [];
        top = top ?? { place: fallbackPlace, actors: acts.slice(0, 1) };
        bottom = bottom ?? { place: placeIds[1] ?? fallbackPlace, actors: acts.slice(1, 2) };
        warn(`${where}: split shot without top/bottom — built from actors`);
      }
      shot.top = { place: placeOf(top.place) ?? fallbackPlace ?? "", actors: normActors(top.actors, castIds, warn, propOk, `${where}.top`) };
      shot.bottom = { place: placeOf(bottom.place) ?? fallbackPlace ?? "", actors: normActors(bottom.actors, castIds, warn, propOk, `${where}.bottom`) };
    } else {
      shot.actors = normActors(s.actors, castIds, warn, propOk, where);
    }
    const scr = normScreen(s.screen, line, castIds);
    if (scr) shot.screen = scr;
    const inShot = [...(shot.actors ?? []), ...(shot.top?.actors ?? []), ...(shot.bottom?.actors ?? [])].map((a) => a.id);
    const focus = str(cam.focus);
    if (focus && inShot.includes(focus)) shot.camera.focus = focus;
    if (s.transition !== undefined) shot.transition = closestEnum(s.transition, TRANSITION_LIST, "transition", "cut");
    if (Array.isArray(s.sfx)) shot.sfx = s.sfx.map((x) => str(x, "", 40)).filter(Boolean).slice(0, 6);
    if (s.bubble === true) shot.bubble = true;
    if (s.pause !== undefined) shot.pause = Math.max(0, Math.min(5, num(s.pause, 0)));
    if (s.hook === true) shot.hook = true;
    if (Array.isArray(s.props)) {
      shot.props = s.props
        .filter(isObj)
        .map((p) => ({ id: str(p.id), x: clamp01(num(p.x, 0.5)) }))
        .filter((p) => {
          if (propOk(p.id)) return true;
          warn(`${where}: placed prop "${p.id}" unknown — dropped`);
          return false;
        })
        .slice(0, 8);
    }
    // two_shot / over_shoulder need two actors
    if ((shot.camera.shot === "two_shot" || shot.camera.shot === "over_shoulder") && inShot.length < 2) shot.camera.shot = "medium";
    if (shot.camera.shot === "pov_hand" && !shot.screen) shot.camera.shot = "close";
    shots.push(shot);
  });
  if (!shots.length) {
    warn("no shots — added one narrator shot");
    shots.push({ line: str(o.title, "…"), speaker: "narrator", camera: { shot: "wide", move: "push_in" }, place: placeIds[0], actors: [] });
  }
  // the first shot needs a place
  if (!shots[0].place && shots[0].layout !== "split" && placeIds[0]) shots[0].place = placeIds[0];
  // no two consecutive shots with the same size
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1].camera.shot,
      b = shots[i].camera.shot;
    if (a === b) {
      let alt = ALT_SHOT[b];
      if (b === "extreme_close" && shots[i].screen) alt = "pov_hand";
      if ((alt === "two_shot" || alt === "over_shoulder") && (shots[i].actors?.length ?? 0) < 2) alt = "medium";
      if (alt === "pov_hand" && !shots[i].screen) alt = "close";
      shots[i].camera.shot = alt === a ? "wide" : alt;
    }
  }

  const endRaw = isObj(o.end) ? o.end : {};
  const plan: EpisodePlan = {
    version: 2,
    series: str(o.series, "", 120),
    episode: Math.max(1, Math.round(num(o.episode, 1))),
    title: str(o.title, "", 200),
    caption: str(o.caption, "", 500),
    mood: closestEnum(o.mood, GENRES, null, "emotional"),
    format: o.format === "4:5" ? "4:5" : "9:16",
    cast,
    places,
    ...(props.length ? { props } : {}),
    shots,
    end: { type: endRaw.type === "the_end" ? "the_end" : "next_part", text: str(endRaw.text, endRaw.type === "the_end" ? "সমাপ্ত" : "পরের পর্বে…", 200) },
  };
  return { plan, warnings };
}

/* ------------------------------ render beats ------------------------------ */

const NEXT_SIZES: Record<ShotSize, ShotSize[]> = {
  wide: ["medium", "close"],
  medium: ["close", "wide"],
  close: ["medium", "extreme_close"],
  extreme_close: ["close", "medium"],
  two_shot: ["over_shoulder", "close"],
  over_shoulder: ["close", "two_shot"],
  pov_hand: ["extreme_close", "pov_hand"],
};
const BEAT_MOVES: CameraMove[] = ["push_in", "hold", "pull_out"];

/**
 * Split shots longer than maxSeconds into 2–3 beats of the same moment with
 * different camera sizes / moves. durations[i] = length of shot i in seconds.
 * start/end are shot-relative seconds.
 */
export function splitLongShots(plan: EpisodePlan, durations: number[], maxSeconds = 4): RenderBeat[] {
  const beats: RenderBeat[] = [];
  plan.shots.forEach((shot, i) => {
    const d = Math.max(0.1, durations[i] ?? 2.5);
    const splittable = !shot.screen && shot.layout !== "split" && (shot.actors?.length ?? 0) > 0;
    const n = !splittable || d <= maxSeconds ? 1 : Math.min(3, Math.ceil(d / maxSeconds));
    let prev = shot.camera;
    for (let k = 0; k < n; k++) {
      const start = (d * k) / n,
        end = (d * (k + 1)) / n;
      const beat: RenderBeat = { shotIndex: i, start, end };
      if (k > 0) {
        let size = NEXT_SIZES[shot.camera.shot][k - 1] ?? "medium";
        if ((size === "two_shot" || size === "over_shoulder") && (shot.actors?.length ?? 0) < 2) size = "close";
        if (size === prev.shot) size = size === "close" ? "medium" : "close";
        let move = BEAT_MOVES[(i + k) % 3];
        if (move === prev.move) move = BEAT_MOVES[(i + k + 1) % 3];
        beat.cameraOverride = { shot: size, move, ...(shot.camera.focus ? { focus: shot.camera.focus } : {}) };
        prev = beat.cameraOverride;
      }
      beats.push(beat);
    }
  });
  return beats;
}
