/**
 * Story Bible: the story understood ONCE, kept as data, and checked by code.
 *
 * Fact kinds (spec step 2):
 *  - confirmed        said in the story; must quote the source sentence (checked by code)
 *  - inference        the AI worked it out; softer, shown to the user as "maybe"
 *  - creative_choice  the AI picked it for the video (look, mood, pacing)
 *  - prohibited_change must never be altered without the user's permission
 *
 * The Story Accuracy Gate (`runAccuracyGate`) is plain code: a `confirmed` fact whose quoted
 * source does not literally appear in the story is downgraded; a key line / key number that
 * is not in the story is dropped; a character that is never named in the story is removed.
 * Anything the user wrote or edited themselves (`by: "user"`) is trusted and never gated.
 */
import { GENRES, type Genre } from "@/lib/storyPlan";
import type { CastMember, EpisodePlan, Shot } from "@/lib/puppet/types";

export const FACT_KINDS = ["confirmed", "inference", "creative_choice", "prohibited_change"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export interface BibleFact {
  kind: FactKind;
  text: string;
  /** For `confirmed`: the sentence (or phrase) copied exactly from the story. */
  source?: string;
  by?: "ai" | "user";
  /** Set by the gate when something was changed or looks doubtful. */
  flag?: string;
}

export interface BibleCharacter {
  id: string;
  /** Bangla display name. */
  name: string;
  /** Exact words from the story that point to this person (name, "মা", "মিটার রিডার"). */
  mentions: string[];
  /** Exact relations, e.g. "Rahima's only son; lives in Malaysia". */
  relation: string;
  /** Short English look for the asset maker (age, clothes). */
  look: string;
  facts: BibleFact[];
  by?: "ai" | "user";
  flag?: string;
}

export interface BiblePlace {
  id: string;
  name: string;
  description: string;
  /** Who is there; "nobody" for an empty place. */
  who: string;
  by?: "ai" | "user";
}

export interface BibleKeyLine {
  text: string;
  speaker: string;
  by?: "ai" | "user";
}

export interface BibleKeyNumber {
  /** As written in the story, e.g. "১৬" or "তিন বছর". */
  value: string;
  meaning: string;
  by?: "ai" | "user";
}

export interface BibleMoment {
  /** 0-based part index. */
  part: number;
  text: string;
  source?: string;
  by?: "ai" | "user";
}

export interface StoryBible {
  version: 1;
  /** What the story is about and what the viewer should feel. */
  message: string;
  characters: BibleCharacter[];
  places: BiblePlace[];
  /** Events in story order. */
  events: BibleFact[];
  keyLines: BibleKeyLine[];
  keyNumbers: BibleKeyNumber[];
  keyMoments: BibleMoment[];
  /** How the ending should land (e.g. same place changed, fade to black, a question). */
  ending: string;
  pacing: string;
  /** `prohibited_change` facts and things that must never appear on screen. */
  prohibited: BibleFact[];
  /** Free text the user pasted to override the AI's direction. */
  userDirection?: string;
  /** Set when the user pressed Approve. */
  approvedAt?: number;
}

/* --------------------------------- schema --------------------------------- */

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const strArr = { type: "array", items: str } as const;
const en = <T extends readonly string[]>(v: T) => ({ type: "string", enum: [...v] }) as const;
function obj(properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties } as const;
}
const FACT = obj({ kind: en(FACT_KINDS), text: str, source: str });

export const BIBLE_SCHEMA = obj({
  message: str,
  characters: {
    type: "array",
    items: obj({ id: str, name: str, mentions: strArr, relation: str, look: str, facts: { type: "array", items: FACT } }),
  },
  places: { type: "array", items: obj({ id: str, name: str, description: str, who: str }) },
  events: { type: "array", items: FACT },
  key_lines: { type: "array", items: obj({ text: str, speaker: str }) },
  key_numbers: { type: "array", items: obj({ value: str, meaning: str }) },
  key_moments: { type: "array", items: obj({ part: int, text: str, source: str }) },
  ending: str,
  pacing: str,
  prohibited: { type: "array", items: FACT },
});

export function buildBiblePrompt(opts: { genre: Genre; partsTotal: number; userRules?: string }): string {
  return [
    "You are the story editor of a Bangla short-video studio. Read the WHOLE story and write its STORY BIBLE as JSON.",
    "The bible is the single source of truth for everything that follows (cast, pictures, voice, shots). Never improve or change the story.",
    `Genre: ${GENRES[opts.genre].label}. The story will be split into ${opts.partsTotal} part(s).`,
    opts.userRules ? `The author's own rules (obey them): ${opts.userRules}` : "",
    "",
    "FACT KINDS (use exactly):",
    "- confirmed: the story says it. `source` MUST be copied letter for letter from the story (one sentence or phrase, no changes, no translation).",
    "- inference: not said, but you worked it out. `source` = \"\".",
    "- creative_choice: something YOU choose for the video (look, mood). `source` = \"\".",
    "- prohibited_change: something that must never be altered or shown (e.g. a person returning home when the story says he never does; a second child; a person inside an empty room). `source` = the story sentence that makes it forbidden, or \"\".",
    "",
    "FIELDS",
    "- message: what the story means and what the viewer should feel, in 1–2 simple English sentences.",
    "- characters: EVERY person, with exact relations (count family members exactly). `mentions` = the exact Bangla words used in the story for that person (their name, \"মা\", \"মিটার রিডার\"); at least one must appear in the story. For a first-person (\"আমি\") storyteller add that person too. `look` = short English (age, clothes). `id` = short latin slug.",
    "- places: each place, what it looks like and who is there (\"nobody\" when empty).",
    "- events: the events in story order, each a fact.",
    "- key_lines: the few lines the audience must hear exactly (copied letter for letter from the story). speaker = character id or \"narrator\".",
    "- key_numbers: numbers/durations/amounts that matter (e.g. \"১৬\", \"তিন বছর\"), copied exactly as written in the story, with their meaning.",
    "- key_moments: 2–5 images the viewer must see per part. part = 0-based part number. source = the story sentence or \"\".",
    "- ending: how the final shot should land.",
    "- pacing: slow or fast, where to hold silence.",
    "- prohibited: facts of kind prohibited_change (also list anything that would contradict the story).",
    "Be complete but short. Write fields in simple English except copied story text, which stays Bangla.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------ normalization ------------------------------ */

type R = Record<string, unknown>;
const rec = (v: unknown): R => (v && typeof v === "object" && !Array.isArray(v) ? (v as R) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const slug = (v: unknown) =>
  s(v, 40)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

function normFact(raw: unknown, fallback: FactKind = "inference"): BibleFact | null {
  const o = rec(raw);
  const text = s(o.text);
  if (!text) return null;
  const kind = (FACT_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as FactKind) : fallback;
  const source = s(o.source, 800);
  return { kind, text, ...(source ? { source } : {}), by: "ai" };
}

/** Turn the model's raw JSON (or a stored bible) into a clean StoryBible. Never throws. */
export function normalizeBible(input: unknown): StoryBible {
  const o = rec(input);
  const characters: BibleCharacter[] = [];
  const seen = new Set<string>();
  for (const c0 of arr(o.characters)) {
    const c = rec(c0);
    const name = s(c.name, 80);
    if (!name) continue;
    let id = slug(c.id) || `c${characters.length + 1}`;
    while (seen.has(id)) id += "_2";
    seen.add(id);
    const mentions = arr(c.mentions).map((m) => s(m, 80)).filter(Boolean);
    characters.push({
      id,
      name,
      mentions: mentions.length ? mentions : [name],
      relation: s(c.relation, 300),
      look: s(c.look, 200),
      facts: arr(c.facts).map((f) => normFact(f)).filter((f): f is BibleFact => !!f),
      by: c.by === "user" ? "user" : "ai",
    });
  }
  const places: BiblePlace[] = arr(o.places)
    .map((p0, i) => {
      const p = rec(p0);
      return { id: slug(p.id) || `p${i + 1}`, name: s(p.name, 80), description: s(p.description, 300), who: s(p.who, 200), by: p.by === "user" ? ("user" as const) : ("ai" as const) };
    })
    .filter((p) => p.name || p.description);
  const keyLines = arr(o.key_lines ?? o.keyLines)
    .map((l0) => {
      const l = rec(l0);
      return { text: s(l.text, 400), speaker: s(l.speaker, 40) || "narrator", by: l.by === "user" ? ("user" as const) : ("ai" as const) };
    })
    .filter((l) => l.text);
  const keyNumbers = arr(o.key_numbers ?? o.keyNumbers)
    .map((n0) => {
      const n = rec(n0);
      return { value: s(n.value, 60), meaning: s(n.meaning, 200), by: n.by === "user" ? ("user" as const) : ("ai" as const) };
    })
    .filter((n) => n.value);
  const keyMoments = arr(o.key_moments ?? o.keyMoments)
    .map((m0) => {
      const m = rec(m0);
      const source = s(m.source, 800);
      return {
        part: Math.max(0, Math.min(99, Math.floor(Number(m.part) || 0))),
        text: s(m.text, 300),
        ...(source ? { source } : {}),
        by: m.by === "user" ? ("user" as const) : ("ai" as const),
      };
    })
    .filter((m) => m.text);
  const prohibited = arr(o.prohibited)
    .map((f) => normFact(f, "prohibited_change"))
    .filter((f): f is BibleFact => !!f)
    .map((f) => ({ ...f, kind: "prohibited_change" as const }));
  const direction = s(o.userDirection, 4000);
  return {
    version: 1,
    message: s(o.message, 600),
    characters,
    places,
    events: arr(o.events).map((f) => normFact(f)).filter((f): f is BibleFact => !!f),
    keyLines,
    keyNumbers,
    keyMoments,
    ending: s(o.ending, 500),
    pacing: s(o.pacing, 400),
    prohibited,
    ...(direction ? { userDirection: direction } : {}),
    ...(typeof o.approvedAt === "number" ? { approvedAt: o.approvedAt } : {}),
  };
}

/* ------------------------------ accuracy gate ------------------------------ */

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Make two Bangla strings comparable: NFC, no zero-width marks, digits unified, quotes/dashes/space collapsed. */
export function foldText(v: string): string {
  return v
    .normalize("NFC")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .replace(/[“”„‟"«»]/g, '"')
    .replace(/[‘’‚‛']/g, "'")
    .replace(/[–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when `quote` literally appears in `story` (after folding). Empty quotes never match. */
export function inStory(story: string, quote: string): boolean {
  const q = foldText(quote).replace(/^[\s.…,;:!?।"'-]+|[\s.…,;:!?।"'-]+$/g, "");
  if (!q) return false;
  return foldText(story).includes(q);
}

export interface GateReport {
  /** Human-readable, simple English. */
  notes: string[];
  checked: number;
  downgraded: number;
  dropped: number;
}

/**
 * Check a bible against the ORIGINAL story text, in code. Returns a cleaned bible and a report.
 * User-written items (`by: "user"`) are trusted.
 */
export function runAccuracyGate(input: StoryBible, story: string): { bible: StoryBible; report: GateReport } {
  const report: GateReport = { notes: [], checked: 0, downgraded: 0, dropped: 0 };
  const note = (t: string) => report.notes.push(t);

  const gateFact = (f: BibleFact, where: string): BibleFact => {
    if (f.by === "user") return f;
    if (f.kind === "confirmed") {
      report.checked++;
      if (!f.source || !inStory(story, f.source)) {
        report.downgraded++;
        note(`${where}: “${f.text.slice(0, 60)}” is not backed by a sentence in the story, so it is now only a guess.`);
        const { source: _unused, ...rest } = f;
        void _unused;
        return { ...rest, kind: "inference", flag: "source not found in the story" };
      }
    }
    return f;
  };

  const characters: BibleCharacter[] = [];
  for (const c of input.characters) {
    if (c.by === "user") {
      characters.push(c);
      continue;
    }
    report.checked++;
    const found = c.mentions.filter((m) => inStory(story, m));
    if (!found.length) {
      report.dropped++;
      note(`Character “${c.name}” is never mentioned in the story, so it was removed.`);
      continue;
    }
    characters.push({ ...c, mentions: found, facts: c.facts.map((f) => gateFact(f, c.name)) });
  }

  const keyLines = input.keyLines.filter((l) => {
    if (l.by === "user") return true;
    report.checked++;
    if (inStory(story, l.text)) return true;
    report.dropped++;
    note(`Key line “${l.text.slice(0, 50)}” is not in the story, so it was removed.`);
    return false;
  });
  const keyNumbers = input.keyNumbers.filter((n) => {
    if (n.by === "user") return true;
    report.checked++;
    if (inStory(story, n.value)) return true;
    report.dropped++;
    note(`Number “${n.value}” is not in the story, so it was removed.`);
    return false;
  });
  const keyMoments = input.keyMoments.map((m) => {
    if (m.by === "user" || !m.source) return m;
    report.checked++;
    if (inStory(story, m.source)) return m;
    report.downgraded++;
    const { source: _unused, ...rest } = m;
    void _unused;
    return rest;
  });

  const bible: StoryBible = {
    ...input,
    characters,
    events: input.events.map((f) => gateFact(f, "Event")),
    prohibited: input.prohibited.map((f) => (f.by === "user" ? f : { ...f, kind: "prohibited_change" as const })),
    keyLines,
    keyNumbers,
    keyMoments,
  };
  return { bible, report };
}

/* ------------------------------ prompt for shots ------------------------------ */

/** The bible as hard rules for the shot planner. Only gate-checked facts are written as certain. */
export function bibleToPrompt(b: StoryBible, partIndex: number): string {
  const lines: string[] = ["STORY BIBLE (approved by the author; this is the truth, obey it over your own ideas):", `- Meaning: ${b.message}`];
  lines.push("- ONLY these people may appear or speak (plus the narrator). Never add anyone else:");
  for (const c of b.characters) {
    lines.push(`  • ${c.id} = ${c.name}: ${c.relation}${c.look ? `; look: ${c.look}` : ""}`);
    for (const f of c.facts) lines.push(`      ${f.kind === "confirmed" ? "FACT" : "maybe"}: ${f.text}`);
  }
  if (b.places.length) {
    lines.push("- Places:");
    for (const p of b.places) lines.push(`  • ${p.name}: ${p.description}${p.who ? ` Who is there: ${p.who}.` : ""}`);
  }
  const ev = b.events.filter((e) => e.kind === "confirmed");
  if (ev.length) {
    lines.push("- Events in order (do not change the order or skip any):");
    ev.forEach((e, i) => lines.push(`  ${i + 1}. ${e.text}`));
  }
  if (b.keyLines.length) lines.push(`- Key lines to keep exactly: ${b.keyLines.map((l) => `“${l.text}”`).join(" | ")}`);
  if (b.keyNumbers.length) lines.push(`- Key numbers to keep exactly: ${b.keyNumbers.map((n) => `${n.value} (${n.meaning})`).join("; ")}`);
  const moments = b.keyMoments.filter((m) => m.part === partIndex);
  if (moments.length) lines.push(`- Key moments of THIS part (each needs its own shot): ${moments.map((m) => m.text).join(" | ")}`);
  if (b.ending) lines.push(`- Ending: ${b.ending}`);
  if (b.pacing) lines.push(`- Pacing: ${b.pacing}`);
  if (b.prohibited.length) {
    lines.push("- NEVER (prohibited changes):");
    for (const p of b.prohibited) lines.push(`  ✗ ${p.text}`);
  }
  if (b.userDirection) lines.push(`- The author's own direction (highest priority): ${b.userDirection}`);
  return lines.join("\n");
}

/* --------------------------- check a plan against the bible --------------------------- */

const norm = (v: string) => foldText(v).replace(/[^\p{L}\p{N}]+/gu, "");

/** Which bible character is this cast member? Match by name, mention, or id. */
export function matchCharacter(c: Pick<CastMember, "id" | "name">, b: StoryBible): BibleCharacter | null {
  const id = norm(c.id);
  const name = norm(c.name);
  for (const ch of b.characters) {
    if (norm(ch.id) === id && id) return ch;
    const names = [ch.name, ...ch.mentions].map(norm).filter(Boolean);
    if (name && names.includes(name)) return ch;
    if (name && names.some((n) => n.length >= 3 && (name.includes(n) || n.includes(name)))) return ch;
  }
  return null;
}

/**
 * After planning: remove cast the bible does not know (and every shot appearance of them), and warn
 * when a key number or key line of this part never reaches the plan. Returns a new plan.
 */
export function enforceBible(plan: EpisodePlan, b: StoryBible, warnings: string[] = []): EpisodePlan {
  const allowed = new Map<string, CastMember>();
  const removed = new Set<string>();
  for (const c of plan.cast) {
    if (c.voice === "narrator" && /narrator|storyteller|আমি/i.test(`${c.id} ${c.name}`)) {
      allowed.set(c.id, c); // first-person storyteller
      continue;
    }
    if (matchCharacter(c, b)) allowed.set(c.id, c);
    else removed.add(c.id);
  }
  if (!removed.size && !b.keyNumbers.length && !b.keyLines.length) return plan;
  for (const id of removed) warnings.push(`Removed “${id}”: that person is not in the approved Story Bible.`);

  const cleanActors = <T extends { id: string }>(a: T[] | undefined) => a?.filter((x) => !removed.has(x.id));
  const shots: Shot[] = plan.shots.map((sh) => {
    const next: Shot = { ...sh };
    if (removed.has(sh.speaker)) next.speaker = "narrator";
    if (sh.actors) next.actors = cleanActors(sh.actors);
    if (sh.top) next.top = { ...sh.top, actors: cleanActors(sh.top.actors) ?? [] };
    if (sh.bottom) next.bottom = { ...sh.bottom, actors: cleanActors(sh.bottom.actors) ?? [] };
    if (sh.camera.focus && removed.has(sh.camera.focus)) next.camera = { ...sh.camera, focus: undefined };
    return next;
  });
  const out: EpisodePlan = { ...plan, cast: plan.cast.filter((c) => !removed.has(c.id)), shots };

  const spoken = foldText(out.shots.map((x) => x.line).join(" "));
  for (const n of b.keyNumbers) {
    if (!spoken.includes(foldText(n.value))) warnings.push(`The number “${n.value}” (${n.meaning}) is in the bible but not in this part's lines.`);
  }
  return out;
}

/* --------------------------------- cost --------------------------------- */

export interface CostLine {
  label: string;
  detail: string;
  usd: number;
}

/**
 * Rough estimate shown BEFORE any paid step. Rates are the ones measured on 2026-11-15
 * (about $0.02 per new picture, $0.017 per spoken minute, $0.03 for planning).
 */
export function estimateCost(opts: { newCharacters: number; newPlaces: number; voiceMinutes: number }): { lines: CostLine[]; total: number } {
  const IMG = 0.02;
  const VOICE_PER_MIN = 0.017;
  const pictures = (opts.newCharacters + opts.newPlaces) * IMG;
  const voice = opts.voiceMinutes * VOICE_PER_MIN;
  const lines: CostLine[] = [
    { label: "Planning", detail: "story bible + shot list", usd: 0.03 },
    { label: "Pictures", detail: `up to ${opts.newCharacters} characters + ${opts.newPlaces} places`, usd: pictures },
    { label: "Voice", detail: `about ${opts.voiceMinutes.toFixed(1)} minutes`, usd: voice },
    { label: "Animation", detail: "drawn by code, free", usd: 0 },
    { label: "Retries", detail: "about 10% extra", usd: (pictures + voice) * 0.1 },
  ];
  return { lines, total: lines.reduce((a, l) => a + l.usd, 0) };
}

/* ------------------------- editing and per-card regenerate ------------------------- */

export type BibleSection = "story" | "characters" | "scenes" | "ending" | "rules";

/** Take ONE card's content from a freshly generated bible and keep the rest (and the user's edits there). */
export function mergeSection(current: StoryBible, fresh: StoryBible, section: BibleSection): StoryBible {
  const next: StoryBible = { ...current, approvedAt: undefined };
  switch (section) {
    case "story":
      next.message = fresh.message;
      next.events = fresh.events;
      break;
    case "characters":
      next.characters = fresh.characters;
      next.places = fresh.places;
      break;
    case "scenes":
      next.keyMoments = fresh.keyMoments;
      next.keyLines = fresh.keyLines;
      next.keyNumbers = fresh.keyNumbers;
      break;
    case "ending":
      next.ending = fresh.ending;
      next.pacing = fresh.pacing;
      break;
    case "rules":
      next.prohibited = fresh.prohibited;
      break;
  }
  return next;
}
