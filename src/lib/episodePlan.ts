/**
 * Episode Planner (v2 "director"): one part of a Bangla story → an EpisodePlan
 * for the code-drawn puppet cartoon engine.
 *
 * The LLM answers in a STRICT json_schema shape (every key present, empty
 * strings/arrays for "nothing", one flat `screen` object with a `type` enum that
 * includes "none"). normalizeEpisode() turns that into the exact TS contract.
 * A library-aware normalizer (engine side) can run after this one.
 */
import type {
  Action,
  ActorInShot,
  CameraMove,
  CastMember,
  EpisodePlan,
  Face,
  PlaceRef,
  ScreenSpec,
  Shot,
  ShotSize,
  TimeOfDay,
  Transition,
  Weather,
} from "@/lib/puppet/types";
import { GENRES, type Genre } from "@/lib/storyPlan";

/* --------------------------------- enums --------------------------------- */

export const ACTIONS: readonly Action[] = [
  "idle", "talk", "walk_in", "walk_out", "walk_to", "turn", "sit", "stand", "cry", "laugh", "shock", "angry",
  "hug", "phone_ear", "point", "nod", "shake_head", "lie_down", "pray", "fall", "wave", "run",
];
export const FACES: readonly Face[] = ["neutral", "happy", "sad", "crying", "angry", "shocked", "scared", "worried"];
export const SHOT_SIZES: readonly ShotSize[] = ["wide", "medium", "close", "extreme_close", "two_shot", "over_shoulder", "pov_hand"];
export const CAMERA_MOVES: readonly CameraMove[] = ["hold", "push_in", "pull_out", "pan_left", "pan_right", "shake", "whip"];
export const TRANSITIONS: readonly Transition[] = ["cut", "fade", "flash", "dip_black"];
export const TIMES: readonly TimeOfDay[] = ["morning", "day", "evening", "night"];
export const WEATHERS: readonly Weather[] = ["clear", "rain", "fog", "snow", "dust", "smoke"];
export const VOICES: readonly CastMember["voice"][] = ["narrator", "female", "male", "female_old", "male_old", "child"];
export const SCREEN_TYPES = [
  "none", "notification", "incoming_call", "video_call", "chat", "letter", "tv_news", "calendar", "map", "photo", "text_card",
] as const;
export const SFX = [
  "phone_ring", "notification", "message", "door_knock", "door_creak", "door_slam", "footsteps", "whoosh", "hit",
  "heartbeat", "gasp_swell", "thunder", "glass_break", "clock_tick", "bell", "pop", "laugh_boing", "sad_sting", "scare_sting",
] as const;

/** Speech length limits per shot (words, voice tags not counted). */
export const MAX_DIALOGUE_WORDS = 12;
export const MAX_NARRATION_WORDS = 18;
export const MAX_SHOTS = 120;

export const NEXT_PART_TEXT = "পরের পর্ব দেখুন";
const BN = "০১২৩৪৫৬৭৮৯";
/** Western digits → Bangla digits. */
export const bnNum = (v: number | string) => String(v).replace(/\d/g, (d) => BN[+d]);
export const THE_END_TEXT = "শেষ";

/* --------------------------------- schema -------------------------------- */

const str = { type: "string" } as const;
const num = { type: "number" } as const;
const int = { type: "integer" } as const;
const bool = { type: "boolean" } as const;
const strArr = { type: "array", items: str } as const;
const en = <T extends readonly string[]>(values: T) => ({ type: "string", enum: [...values] }) as const;

function obj(properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties } as const;
}

const ACTOR_SCHEMA = obj({
  id: str,
  x: num,
  action: en(ACTIONS),
  face: en(FACES),
  facing: en(["left", "right"] as const),
  toX: num,
  prop: str,
});

const HALF_SCHEMA = obj({ place: str, actors: { type: "array", items: ACTOR_SCHEMA } });

const SCREEN_SCHEMA = obj({
  type: en(SCREEN_TYPES),
  app: str,
  title: str,
  body: str,
  caller: str,
  subtitle: str,
  who: str,
  people: strArr,
  messages: { type: "array", items: obj({ from: en(["me", "them"] as const), text: str }) },
  text: str,
  signature: str,
  headline: str,
  ticker: str,
  days: int,
  marked: int,
  from: str,
  to: str,
  caption: str,
});

const SHOT_SCHEMA = obj({
  line: str,
  speaker: str,
  place: str,
  layout: en(["single", "split"] as const),
  actors: { type: "array", items: ACTOR_SCHEMA },
  top: HALF_SCHEMA,
  bottom: HALF_SCHEMA,
  screen: SCREEN_SCHEMA,
  camera: obj({ shot: en(SHOT_SIZES), move: en(CAMERA_MOVES), focus: str }),
  transition: en(TRANSITIONS),
  sfx: { type: "array", items: en(SFX) },
  bubble: bool,
  pause: num,
  hook: bool,
  props: { type: "array", items: obj({ id: str, x: num }) },
});

/** Strict JSON schema for the LLM's episode answer (converted by normalizeEpisode). */
/** Written FIRST, before any shot: the model must understand the story before staging it. */
export const UNDERSTANDING_SCHEMA = obj({
  summary: str,
  people: { type: "array", items: obj({ name: str, who: str, facts: str }) },
  places: { type: "array", items: obj({ name: str, what: str, who_is_there: str }) },
  key_moments: { type: "array", items: str },
  never_show: { type: "array", items: str },
});

export const EPISODE_SCHEMA = obj({
  understanding: UNDERSTANDING_SCHEMA,
  series: str,
  episode: int,
  title: str,
  caption: str,
  mood: en(Object.keys(GENRES) as Genre[]),
  format: en(["9:16", "4:5"] as const),
  cast: {
    type: "array",
    items: obj({ id: str, name: str, asset: str, look: str, voice: en(VOICES), new: bool }),
  },
  places: {
    type: "array",
    items: obj({ id: str, asset: str, look: str, time: en(TIMES), weather: en(WEATHERS), label: str, new: bool }),
  },
  props: { type: "array", items: obj({ id: str, asset: str, look: str, new: bool }) },
  shots: { type: "array", items: SHOT_SCHEMA },
  end: obj({ type: en(["next_part", "the_end"] as const), text: str }),
});

/* --------------------------------- prompt -------------------------------- */

export interface EpisodeContext {
  genre: Genre;
  partTitle: string;
  /** 0-based index of this part in the story; episode number = partIndex + 1. */
  partIndex: number;
  partsTotal: number;
  hook: string;
  isLast: boolean;
  characters: string;
  setting: string;
  /** Compact text summary of the asset library (ids + short descriptions). */
  librarySummary: string;
  previousCast?: CastMember[];
  previousPlaces?: PlaceRef[];
  narrator: "female" | "male";
  /** Series name for the title; defaults to the model's choice. */
  series?: string;
}

const MOOD_NOTES: Partial<Record<Genre, string>> = {
  horror:
    "HORROR: places mostly at night, weather fog where it fits; slow push_in on dread; camera move shake + scare_sting on the reveal; leave silences (pause 0.8–2 s) before scares; heartbeat / clock_tick / door_creak under tension.",
  comedy:
    "COMEDY: faster rhythm (shorter lines, more cuts), happy/shocked faces, whip moves on surprises, laugh_boing or pop on punchlines (not every line).",
  emotional:
    "EMOTIONAL: more close and extreme_close on feelings, slower rhythm (pause 0.5–1.2 s after heavy lines), crying/sad faces where earned, sad_sting at most once or twice.",
  drama:
    "DRAMA: confrontations in two_shot / over_shoulder, push_in on accusations, angry/shocked faces, a hit or door_slam on the turn.",
  historical:
    "HISTORICAL: places and clothes match the era in `look`; no phones or modern screens unless the era has them (use letter, map, text_card instead).",
  scifi: "SCI-FI: screens and maps can be futuristic; whoosh on reveals; cool night/evening light.",
  explainer: "EXPLAINER: more text_card, map, calendar and photo screens; a clear narrator voice; one idea per shot.",
};

function castLines(cast: CastMember[] | undefined): string {
  if (!cast?.length) return "";
  return cast.map((c) => `- ${c.id} (${c.name}): asset=${c.asset}, voice=${c.voice}, look: ${c.look}`).join("\n");
}

function placeLines(places: PlaceRef[] | undefined): string {
  if (!places?.length) return "";
  return places.map((p) => `- ${p.id}: asset=${p.asset}, look: ${p.look}`).join("\n");
}

export function buildEpisodePrompt(ctx: EpisodeContext): string {
  const n = ctx.partIndex + 1;
  const prevCast = castLines(ctx.previousCast);
  const prevPlaces = placeLines(ctx.previousPlaces);
  return [
    "You are a top short-form video director. You turn ONE part of a Bangla story into a shot-by-shot plan for a vertical (9:16) puppet-cartoon episode that is drawn by code from a library of characters, places, props and phone/screen templates.",
    `Genre: ${GENRES[ctx.genre].label}. Part ${n} of ${ctx.partsTotal}: ${ctx.partTitle || "(untitled)"}.${ctx.isLast ? " This is the LAST part." : ""}`,
    `Characters: ${ctx.characters || "(see the text)"}`,
    `Setting: ${ctx.setting || "(see the text)"}`,
    `Narrator voice: ${ctx.narrator}.`,
    ctx.series ? `Series name: ${ctx.series}` : "",
    "",
    "ASSET LIBRARY (use these ids when they fit):",
    ctx.librarySummary || "(empty: every asset is new)",
    prevCast ? `\nCAST FROM EARLIER EPISODES (reuse these exact ids, assets and looks):\n${prevCast}` : "",
    prevPlaces ? `\nPLACES FROM EARLIER EPISODES (reuse these exact ids and assets):\n${prevPlaces}` : "",
    "",
    "STEP 1 — UNDERSTAND THE STORY (fill `understanding` before any shot)",
    "- summary: what happens in this part and what it means emotionally.",
    "- people: EVERY person in the story with exact relationships and facts (e.g. \"রহিমা খালা — widow, lives alone; her ONLY son মিজান lives in Dhaka\"). Count family members exactly.",
    "- places: each place, what it looks like and who is there (e.g. \"the locked room — completely empty, only a ceiling fan spinning; nobody inside\").",
    "- key_moments: the 3–6 images the audience must see to feel this part.",
    "- never_show: anything that would contradict the story (people who do not exist, a second child, someone inside the empty room, objects the story never mentions).",
    "STEP 2 — STAGE IT. Every shot must obey your understanding:",
    "- Only people from `people` may appear. Never invent extra family members, children or bystanders the story does not mention.",
    "- If a place is empty in the story, show it EMPTY: no actors, only the objects the story mentions (e.g. the ceiling fan as a prop, camera wide or medium on it).",
    "- Only use props and screens that the story itself mentions or clearly implies. Do not decorate with random objects, calendars or lamps.",
    "- Faces stay natural and calm; use strong faces (shocked, crying, scared) only at the one or two moments the story is truly strong.",
    "",
    "HOOK (first 3 seconds)",
    "- Shot 1 (hook=true) opens on the strongest moment of THIS part: bad news on a screen, a shocking line, or a flash-forward to the climax of this part, then cut back to where it started.",
    "- Never open with a slow introduction like \"এক গ্রামে ... থাকতেন\" or a description of the weather.",
    "",
    "LINES",
    "- Keep the author's own Bangla sentences, in order, with light edits only. Do not invent plot or skip events.",
    `- One line per shot, 1.5–4 seconds of speech: dialogue at most ${MAX_DIALOGUE_WORDS} words, narration at most ${MAX_NARRATION_WORDS} words. Split long sentences into several shots.`,
    "- Dialogue: speaker = the cast id, bubble = true. Narration: speaker = \"narrator\", bubble = false.",
    "- FIRST-PERSON STORIES (\"আমি\"): the storyteller is a real character. Add them to the cast (voice = \"narrator\") and show them on screen in most narration shots: walking, looking, reacting, holding things. Never leave the \"আমি\" character invisible.",
    "- Keep voice tags like [sad] [whispers] [gasp] from the text; add a few where they help. Never two tags side by side.",
    "",
    "SCREENPLAY (think like a storyboard artist)",
    "- Illustrate what each line is ABOUT, not only where the storyteller stands: a memory → cut to that time and place (younger versions of people are separate cast members, e.g. \"rahima_young\"); a mentioned person → show that person; a mentioned object → an insert shot of it (put the prop in shot.props and set camera.focus to the prop id, camera.shot extreme_close).",
    "- When the story moves (another place, a memory, a later time), cut there. When it stays in one place, vary the angle and what we look at (a person, a reaction, an object the story mentions) instead of repeating the same picture.",
    "- Each place gets: an establishing wide shot on arrival, then medium/close shots of people doing the action of the line, then a reaction shot of another character.",
    "- Time passing: the same place at a different time of day; a calendar or text card only when the story mentions dates or days.",
    "",
    "SHOW, THEN TELL",
    "- Every 4–6 shots, show something: a screen (notification, incoming_call, video_call, chat, letter, tv_news, calendar, map, photo, text_card), a prop moment (an actor holds a prop, or a prop placed in the scene), or a change of place. It must fit THIS story.",
    "- screen: set type and only the fields that type uses; leave every other field \"\" / [] / 0. type \"none\" when there is no screen.",
    "  notification: app, title, body | incoming_call: caller, subtitle | video_call: caller, who (cast id in the call) | chat: title, messages[{from: me|them, text}]",
    "  letter: text, signature | tv_news: headline, ticker | calendar: title, days, marked | map: from, to | photo: caption, people (cast ids) | text_card: text",
    "- Screen text is Bangla and short.",
    "",
    "CAMERA",
    "- Never the same camera.shot twice in a row. close or extreme_close on emotional lines; wide when arriving somewhere new; two_shot / over_shoulder for conversations.",
    "- Phone calls between two places: layout \"split\" with top = {place, actors} for one side and bottom for the other; otherwise layout \"single\" and top/bottom = {place: \"\", actors: []}.",
    "- Mostly transition \"cut\". Before a twist use \"dip_black\" or a pause (0.5–2 s). fade only for time jumps; flash for a memory.",
    "- camera.focus: the cast id the camera centres on, or \"\".",
    "",
    "CAST PER SHOT",
    "- actors = only who is visible in that shot, x from 0 (left) to 1 (right), facing each other in conversations.",
    "- A character who enters later in the story is never shown before entering.",
    "- VARIETY: never more than 2 shots in a row with the same place AND the same camera.shot. Narration shots must still show something happening (a character doing the action the line describes, a prop, a screen, a new place) — not the same empty picture again.",
    "- face and action match the line (talk while speaking, phone_ear on calls, cry on crying, shock on a shock...). toX only for walk_to (else same as x); prop = a prop id held in hand or \"\".",
    "",
    "SOUND",
    `- sfx only from: ${SFX.join(", ")}. Use them sparingly, where the picture makes a sound.`,
    "",
    "ASSETS",
    "- cast, places and props: if a library id fits, asset = that id and new = false.",
    "- Otherwise new = true, asset = a new snake_case id, and `look` = a precise English description: for people age, build, skin tone, hair, clothes with colours; for places the layout, era, time and key objects; for props the shape and colour.",
    "- ids are short snake_case English (e.g. \"rina\", \"hospital_ward\"). cast[].name is the display name in Bangla script (e.g. \"রহিমা খালা\"), never English letters.",
    "- places[].label: a small Bangla tag shown on arrival (e.g. \"রাত ২টা • হাসপাতাল\") or \"\".",
    "",
    MOOD_NOTES[ctx.genre] ?? "",
    "",
    "ENDING",
    ctx.isLast
      ? `- This is the last part: end on a closing line that resolves the story; end = {type: "the_end", text: "${THE_END_TEXT}"}.`
      : `- Not the last part: end on the cliffhanger${ctx.hook ? ` (${ctx.hook})` : ""}; the last shot cuts at the peak; end = {type: "next_part", text: "${NEXT_PART_TEXT}"}.`,
    "",
    "META",
    `- title: short emotional Bangla (no emoji), "<hook phrase> | <series name> পর্ব ${bnNum(n)}". caption: 1–2 Bangla lines for Facebook. episode = ${n}. mood = "${ctx.genre}". format = "9:16".`,
    "",
    "Return ONLY the JSON.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/* ------------------------------- normalizer ------------------------------ */

type R = Record<string, unknown>;

function rec(v: unknown): R {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as R) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function s(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function n(v: unknown, fallback: number): number {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : fallback;
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
function pick<T extends string>(v: unknown, values: readonly T[], fallback: T): T {
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : fallback;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** snake_case id from anything ("Dr. Rina" → "dr_rina"). Empty if nothing usable. */
export function slugId(v: unknown): string {
  return s(v, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

const TAG_RE = /\[[^\]]{0,40}\]/g;

/** Keep short English voice tags (lower-cased), drop junk brackets, never two tags side by side. */
export function cleanLine(raw: unknown): string {
  let t = s(raw, 600);
  t = t.replace(TAG_RE, (m) => {
    const inner = m.slice(1, -1).trim().toLowerCase();
    return /^[a-z][a-z ]{0,24}$/.test(inner) ? `[${inner}]` : "";
  });
  t = t.replace(/(\[[^\]]+\])\s*(\[[^\]]+\])/g, "$1");
  return t.replace(/\s{2,}/g, " ").trim();
}

export function wordCount(line: string): number {
  const t = line.replace(TAG_RE, " ").trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Split a line into pieces of at most `max` words: first at sentence ends (। ? ! .),
 * then at commas / dashes, then into even word chunks. Tags stay with the following words.
 */
export function splitLine(line: string, max: number): string[] {
  if (wordCount(line) <= max) return [line];
  const pack = (units: string[], sep: string): string[] => {
    const out: string[] = [];
    let cur = "";
    for (const u of units) {
      const next = cur ? `${cur}${sep}${u}` : u;
      if (cur && wordCount(next) > max) {
        out.push(cur);
        cur = u;
      } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  const bySentence = line.split(/(?<=[।?!.])\s+/).filter(Boolean);
  const pieces: string[] = [];
  for (const part of pack(bySentence, " ")) {
    if (wordCount(part) <= max) {
      pieces.push(part);
      continue;
    }
    const byComma = part.split(/(?<=[,،;—–])\s+/).filter(Boolean);
    for (const p2 of pack(byComma, " ")) {
      if (wordCount(p2) <= max) {
        pieces.push(p2);
        continue;
      }
      const words = p2.split(/\s+/);
      const real = words.filter((w) => !/^\[[^\]]*\]$/.test(w)).length;
      const chunks = Math.ceil(real / max);
      const per = Math.ceil(real / chunks);
      let cur: string[] = [];
      let count = 0;
      for (const w of words) {
        cur.push(w);
        if (!/^\[[^\]]*\]$/.test(w)) count++;
        if (count >= per) {
          pieces.push(cur.join(" "));
          cur = [];
          count = 0;
        }
      }
      if (cur.length) {
        if (cur.every((w) => /^\[[^\]]*\]$/.test(w)) && pieces.length) pieces[pieces.length - 1] += ` ${cur.join(" ")}`;
        else pieces.push(cur.join(" "));
      }
    }
  }
  return pieces.map((p) => p.trim()).filter(Boolean);
}

/** A different shot size that keeps the same feel, for de-duping and split pieces. */
export const ALT_SHOT: Record<ShotSize, ShotSize> = {
  wide: "medium",
  medium: "close",
  close: "medium",
  extreme_close: "close",
  two_shot: "close",
  over_shoulder: "close",
  pov_hand: "medium",
};

function normCast(raw: unknown[], prev: CastMember[], warnings: string[]): CastMember[] {
  const out: CastMember[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const c = rec(x);
    const id = slugId(c.id) || slugId(c.name) || slugId(c.asset);
    if (!id || id === "narrator" || seen.has(id)) continue;
    seen.add(id);
    const old = prev.find((p) => p.id === id);
    if (old) {
      out.push({ ...old, name: s(c.name, 60) || old.name });
      continue;
    }
    const asset = slugId(c.asset);
    const isNew = c.new === true || !asset;
    const m: CastMember = {
      id,
      name: s(c.name, 60) || id,
      asset: asset || id,
      look: s(c.look, 600),
      voice: pick(c.voice, VOICES, "female"),
    };
    if (m.voice === "narrator") m.voice = "female";
    if (isNew) m.new = true;
    if (isNew && !m.look) warnings.push(`Cast "${id}" is new but has no look description.`);
    out.push(m);
  }
  return out;
}

function normPlaces(raw: unknown[], prev: PlaceRef[], genre: Genre): PlaceRef[] {
  const out: PlaceRef[] = [];
  const seen = new Set<string>();
  const defTime: TimeOfDay = genre === "horror" ? "night" : "day";
  for (const x of raw) {
    const p = rec(x);
    const id = slugId(p.id) || slugId(p.asset);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const old = prev.find((q) => q.id === id);
    const asset = slugId(p.asset) || old?.asset || "";
    const isNew = old ? old.new === true : p.new === true || !asset;
    const m: PlaceRef = {
      id,
      asset: asset || id,
      look: s(p.look, 600) || old?.look || "",
      time: pick(p.time, TIMES, old?.time ?? defTime),
    };
    const weather = pick(p.weather, WEATHERS, old?.weather ?? "clear");
    if (weather !== "clear") m.weather = weather;
    const label = s(p.label, 60);
    if (label) m.label = label;
    if (isNew) m.new = true;
    out.push(m);
  }
  return out;
}

function normProps(raw: unknown[]): NonNullable<EpisodePlan["props"]> {
  const out: NonNullable<EpisodePlan["props"]> = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const p = rec(x);
    const id = slugId(p.id) || slugId(p.asset);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const asset = slugId(p.asset);
    const m: NonNullable<EpisodePlan["props"]>[number] = { id, asset: asset || id, look: s(p.look, 400) };
    if (p.new === true || !asset) m.new = true;
    out.push(m);
  }
  return out;
}

interface Refs {
  cast: Map<string, CastMember>;
  castByName: Map<string, string>;
  places: Set<string>;
  props: Set<string>;
}

function resolveCast(v: unknown, refs: Refs): string | null {
  const raw = s(v, 80);
  if (!raw) return null;
  const id = slugId(raw);
  if (id && refs.cast.has(id)) return id;
  return refs.castByName.get(raw) ?? null;
}

function normActors(raw: unknown[], refs: Refs): ActorInShot[] {
  const out: ActorInShot[] = [];
  const seen = new Set<string>();
  const list = raw.map(rec);
  list.forEach((a, i) => {
    const id = resolveCast(a.id, refs);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const defX = list.length === 1 ? 0.5 : 0.25 + (0.5 * i) / Math.max(1, list.length - 1);
    const x = round2(clamp(n(a.x, defX), 0, 1));
    const action = pick(a.action, ACTIONS, "idle");
    const m: ActorInShot = {
      id,
      x,
      action,
      face: pick(a.face, FACES, "neutral"),
      facing: pick(a.facing, ["left", "right"] as const, x <= 0.5 ? "right" : "left"),
    };
    if (action === "walk_to") {
      const toX = round2(clamp(n(a.toX, x), 0, 1));
      if (toX !== x) m.toX = toX;
      else m.action = "idle";
    }
    const prop = slugId(a.prop);
    if (prop && refs.props.has(prop)) m.prop = prop;
    out.push(m);
  });
  return out.slice(0, 5);
}

function normScreen(raw: unknown, refs: Refs): ScreenSpec | undefined {
  const sc = rec(raw);
  const type = pick(sc.type, SCREEN_TYPES, "none");
  const t = (k: string, max = 160) => s(sc[k], max);
  switch (type) {
    case "notification": {
      const title = t("title", 80);
      const body = t("body", 240);
      if (!title && !body) return undefined;
      const r: ScreenSpec = { type, title: title || body, body: title ? body : "" };
      const app = t("app", 40);
      if (app) r.app = app;
      return r;
    }
    case "incoming_call": {
      const caller = t("caller", 60);
      if (!caller) return undefined;
      const subtitle = t("subtitle", 80);
      return subtitle ? { type, caller, subtitle } : { type, caller };
    }
    case "video_call": {
      const who = resolveCast(sc.who, refs);
      const caller = t("caller", 60);
      if (!who) return caller ? { type: "incoming_call", caller } : undefined;
      return { type, caller: caller || refs.cast.get(who)!.name, who };
    }
    case "chat": {
      const messages = arr(sc.messages)
        .map(rec)
        .map((m) => ({ from: pick(m.from, ["me", "them"] as const, "them"), text: s(m.text, 200) }))
        .filter((m) => m.text)
        .slice(0, 8);
      if (!messages.length) return undefined;
      return { type, title: t("title", 60), messages };
    }
    case "letter": {
      const text = t("text", 600);
      if (!text) return undefined;
      const signature = t("signature", 60);
      return signature ? { type, text, signature } : { type, text };
    }
    case "tv_news": {
      const headline = t("headline", 120);
      if (!headline) return undefined;
      const ticker = t("ticker", 200);
      return ticker ? { type, headline, ticker } : { type, headline };
    }
    case "calendar": {
      const days = Math.round(clamp(n(sc.days, 30), 1, 31));
      const marked = Math.round(clamp(n(sc.marked, 1), 1, days));
      return { type, title: t("title", 60), days, marked };
    }
    case "map": {
      const from = t("from", 60);
      const to = t("to", 60);
      if (!from || !to) return undefined;
      return { type, from, to };
    }
    case "photo": {
      const ids = [sc.people, sc.who].flatMap((v) => (Array.isArray(v) ? v : [v]));
      const who = [...new Set(ids.map((v) => resolveCast(v, refs)).filter((v): v is string => !!v))];
      const caption = t("caption", 120);
      if (!who.length && !caption) return undefined;
      return caption ? { type, caption, who } : { type, who };
    }
    case "text_card": {
      const text = t("text", 200) || t("title", 200);
      return text ? { type, text } : undefined;
    }
    default:
      return undefined;
  }
}

function normHalf(raw: unknown, refs: Refs): { place: string; actors: ActorInShot[] } | null {
  const h = rec(raw);
  const place = slugId(h.place);
  if (!place || !refs.places.has(place)) return null;
  return { place, actors: normActors(arr(h.actors), refs) };
}

/**
 * Strict LLM JSON → exact EpisodePlan (version 2). Never throws for messy fields;
 * throws only when no usable shot is left. Problems are appended to `warnings`.
 */
/** Models sometimes wrap the plan ({"episode": {...}}) or rename keys in plain JSON mode. */
export function unwrapEpisode(input: unknown): R {
  let o = rec(input);
  for (let i = 0; i < 2 && !Array.isArray(o.shots); i++) {
    const inner = Object.values(o).find((v) => v && typeof v === "object" && !Array.isArray(v) && ("shots" in (v as R) || "scenes" in (v as R)));
    if (!inner) break;
    o = rec(inner);
  }
  if (!Array.isArray(o.shots)) {
    const alt = ["scenes", "beats", "shot_list", "shotList"].find((k) => Array.isArray(o[k]));
    if (alt) o = { ...o, shots: o[alt] };
  }
  if (Array.isArray(o.shots)) {
    o = {
      ...o,
      shots: (o.shots as unknown[]).map((x) => {
        const r = rec(x);
        if (typeof r.line === "string" && r.line.trim()) return r;
        const line = [r.text, r.narration, r.dialogue, r.voiceover, r.speech].find((v) => typeof v === "string" && v.trim());
        return line ? { ...r, line } : r;
      }),
    };
  }
  return o;
}

export function normalizeEpisode(input: R, ctx: EpisodeContext, warnings: string[] = []): EpisodePlan {
  const o = unwrapEpisode(input);
  const prevCast = (ctx.previousCast ?? []).filter((c) => c && typeof c.id === "string");
  const prevPlaces = (ctx.previousPlaces ?? []).filter((p) => p && typeof p.id === "string");
  const episode = Math.max(1, Math.round(ctx.partIndex) + 1);

  const cast = normCast(arr(o.cast), prevCast, warnings);
  let places = normPlaces(arr(o.places), prevPlaces, ctx.genre);
  const props = normProps(arr(o.props));

  if (!places.length) {
    const prev = prevPlaces[0];
    places = [
      prev ?? {
        id: "place_1",
        asset: "place_1",
        look: ctx.setting || "a simple room",
        time: ctx.genre === "horror" ? "night" : "day",
        new: true,
      },
    ];
    warnings.push("The plan had no places; added a default place.");
  }

  const refs: Refs = {
    cast: new Map(cast.map((c) => [c.id, c])),
    castByName: new Map(cast.map((c) => [c.name, c.id])),
    places: new Set(places.map((p) => p.id)),
    props: new Set(props.map((p) => p.id)),
  };
  // A speaker or actor from an earlier episode that the model forgot to list: bring it back.
  const addPrev = (v: unknown) => {
    const id = slugId(v);
    if (!id || refs.cast.has(id)) return;
    const old = prevCast.find((c) => c.id === id);
    if (old) {
      cast.push(old);
      refs.cast.set(id, old);
      refs.castByName.set(old.name, id);
    }
  };
  for (const raw of arr(o.shots).map(rec)) {
    addPrev(raw.speaker);
    for (const a of arr(raw.actors)) addPrev(rec(a).id);
  }

  const shots: Shot[] = [];
  let lastPlace = places[0].id;
  let unknownSpeakers = 0;
  let splitCount = 0;

  for (const raw of arr(o.shots).map(rec)) {
    const line = cleanLine(raw.line);
    const screen = normScreen(raw.screen, refs);
    if (!line && !screen) continue;

    let speaker = "narrator";
    const sp = s(raw.speaker, 80);
    if (sp && sp.toLowerCase() !== "narrator") {
      const id = resolveCast(sp, refs);
      if (id) speaker = id;
      else unknownSpeakers++;
    }

    const place = slugId(raw.place);
    const placeId = place && refs.places.has(place) ? place : lastPlace;
    lastPlace = placeId;

    const cam = rec(raw.camera);
    const camera: Shot["camera"] = {
      shot: pick(cam.shot, SHOT_SIZES, "medium"),
      move: pick(cam.move, CAMERA_MOVES, "hold"),
    };
    const focus = resolveCast(cam.focus, refs);
    if (focus) camera.focus = focus;

    const shot: Shot = { line, speaker, place: placeId, layout: "single", camera, transition: pick(raw.transition, TRANSITIONS, "cut") };

    const top = raw.layout === "split" ? normHalf(raw.top, refs) : null;
    const bottom = raw.layout === "split" ? normHalf(raw.bottom, refs) : null;
    if (top && bottom) {
      shot.layout = "split";
      shot.top = top;
      shot.bottom = bottom;
      shot.place = top.place;
    } else {
      const actors = normActors(arr(raw.actors), refs);
      if (actors.length) shot.actors = actors;
    }
    if (screen) shot.screen = screen;

    const sfx = [...new Set(arr(raw.sfx).filter((x): x is string => typeof x === "string" && (SFX as readonly string[]).includes(x)))];
    if (sfx.length) shot.sfx = sfx.slice(0, 3);
    shot.bubble = speaker !== "narrator";
    let pause = round2(clamp(n(raw.pause, 0), 0, 3));
    if (!line) pause = Math.max(pause, 1.5);
    if (pause > 0) shot.pause = pause;
    if (raw.hook === true) shot.hook = true;
    const sceneProps = arr(raw.props)
      .map(rec)
      .map((p) => ({ id: slugId(p.id), x: round2(clamp(n(p.x, 0.5), 0, 1)) }))
      .filter((p) => refs.props.has(p.id))
      .slice(0, 4);
    if (sceneProps.length) shot.props = sceneProps;

    // Split overlong lines into extra shots with the same picture and a new camera size.
    const max = speaker === "narrator" ? MAX_NARRATION_WORDS : MAX_DIALOGUE_WORDS;
    const pieces = line ? splitLine(line, max) : [line];
    if (pieces.length > 1) splitCount++;
    pieces.forEach((piece, i) => {
      const copy: Shot = structuredClone(shot);
      copy.line = piece;
      if (i > 0) {
        copy.camera.shot = ALT_SHOT[shots[shots.length - 1]?.camera.shot ?? copy.camera.shot];
        copy.transition = "cut";
        delete copy.sfx;
        delete copy.hook;
      }
      if (i < pieces.length - 1) delete copy.pause;
      shots.push(copy);
    });
  }

  if (!shots.length) throw new Error("The AI returned no usable shots. Try again.");
  if (unknownSpeakers) warnings.push(`${unknownSpeakers} line(s) had an unknown speaker and were given to the narrator.`);
  if (splitCount) warnings.push(`${splitCount} overlong line(s) were split into extra shots.`);
  if (shots.length > MAX_SHOTS) {
    warnings.push(`The plan had ${shots.length} shots; kept the first ${MAX_SHOTS}.`);
    shots.length = MAX_SHOTS;
  }

  // Never the same shot size twice in a row.
  let deduped = 0;
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].camera.shot === shots[i - 1].camera.shot) {
      shots[i].camera.shot = ALT_SHOT[shots[i].camera.shot];
      deduped++;
    }
  }
  if (deduped) warnings.push(`${deduped} repeated camera shot(s) were changed.`);
  if (!shots.some((x) => x.hook)) shots[0].hook = true;

  const series = s(ctx.series, 60) || s(o.series, 60) || "গল্প";
  const hookPhrase = s(ctx.hook, 60) || s(ctx.partTitle, 60);
  const rawTitle = s(o.title, 140).replace(/\p{Extended_Pictographic}\uFE0F?/gu, "").replace(/\s{2,}/g, " ").trim();
  const title = bnNum(rawTitle || `${hookPhrase || series} | ${series} পর্ব ${episode}`);
  const caption = s(o.caption, 300) || title;
  const rawEnd = rec(o.end);
  // Only keep the model's end text when it chose the right end type.
  const endText = rawEnd.type === (ctx.isLast ? "the_end" : "next_part") ? s(rawEnd.text, 40) : "";

  const plan: EpisodePlan = {
    version: 2,
    series,
    episode,
    title,
    caption,
    mood: ctx.genre,
    format: pick(o.format, ["9:16", "4:5"] as const, "9:16"),
    cast,
    places,
    shots,
    end: ctx.isLast
      ? { type: "the_end", text: endText || THE_END_TEXT }
      : { type: "next_part", text: endText || NEXT_PART_TEXT },
  };
  if (props.length) plan.props = props;
  return plan;
}

/** Clean previousCast / previousPlaces sent by the browser (unknown JSON → contract types). */
export function parsePreviousCast(raw: unknown): CastMember[] {
  return normCast(arr(raw).slice(0, 30), [], []);
}
export function parsePreviousPlaces(raw: unknown, genre: Genre = "emotional"): PlaceRef[] {
  return normPlaces(arr(raw).slice(0, 30), [], genre);
}
