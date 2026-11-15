/**
 * Story Bible (v2): the story understood ONCE, kept as versioned data, and checked by code.
 *
 * Every claim carries a `check` (see storyEvidence.ts):
 *   verified      – an exact or near Bangla quote, or an AI cross-check that cites real sentences;
 *   supported     – the AI points to real sentences; the English meaning was not checked;
 *   unverified    – no reliable supporting passage found;
 *   contradicted  – the story says something else.
 * Evidence is always a real span of the original story (offsets), never text the AI wrote.
 *
 * Approval is per card and bound to the card's content hash: any change to a card's content
 * (edit or regenerate) makes its approval stale automatically. A change of the story itself
 * makes the whole bible stale (`storyHash`).
 */
import { GENRES, type Genre } from "@/lib/storyPlan";
import type { CastMember, EpisodePlan, Shot } from "@/lib/puppet/types";
import {
  citedSpans,
  foldText,
  hashText,
  inStory,
  lastSentence,
  locate,
  numbersIn,
  splitSentences,
  storyHash,
  verifyClaim,
  confirmClaim,
  type Span,
  type Verification,
  type VerifyStatus,
} from "@/lib/storyEvidence";
import type { Alias } from "@/lib/lexicon";

export { foldText, inStory } from "@/lib/storyEvidence";

export const FACT_KINDS = ["confirmed", "inference", "creative_choice", "prohibited_change"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export type By = "ai" | "user" | "system";

/**
 * A rule code can check on a shot plan (everything else is left to a human).
 *  never_present  – this person is never on screen (a flashback/key scene that lists them is the exception)
 *  never_together – these two are never in the same shot
 *  never_says     – these words are never spoken in a shot where one of `whenPresent` is a party
 */
export type RuleSpec =
  | { type: "never_present"; who: string; place?: string }
  | { type: "never_together"; who: string; other: string }
  | { type: "never_says"; terms: string[]; whenPresent: string[] };

export interface BibleFact {
  id: string;
  kind: FactKind;
  text: string;
  /** Machine-checkable form of a prohibited_change (optional). */
  rule?: RuleSpec;
  /** A Bangla quote the AI says is from the story. */
  source?: string;
  /** Sentence ids the AI cited ("S12"). */
  evidence?: string[];
  check?: Verification;
  by?: By;
}

export interface BibleCharacter {
  id: string;
  /** Bangla display name. */
  name: string;
  /** Exact words from the story that point to this person (name, "মা", "মিটার রিডার"). */
  mentions: string[];
  relation: string;
  look: string;
  facts: BibleFact[];
  by?: By;
}

export interface BibleRelation {
  id: string;
  from: string;
  to: string;
  /** e.g. "mother of", "son of", "not related to". */
  relation: string;
  source?: string;
  evidence?: string[];
  check?: Verification;
  by?: By;
}

export const PLACE_KINDS = ["house", "room", "veranda", "courtyard", "separate_building", "outdoor", "public_place", "other"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export interface BiblePlace {
  id: string;
  name: string;
  kind: PlaceKind;
  /** Id of the larger place this one is part of (a room of a house). */
  partOf?: string;
  description: string;
  /** Who is there; "nobody" for an empty place. */
  who: string;
  source?: string;
  evidence?: string[];
  check?: Verification;
  by?: By;
}

export interface BibleKeyLine {
  id: string;
  text: string;
  speaker: string;
  check?: Verification;
  by?: By;
}

export interface BibleKeyNumber {
  /** As written in the story, e.g. "ষোলো" or "১৮৬". */
  value: string;
  meaning: string;
  check?: Verification;
  by?: By;
}

/** A key scene: a narratively important moment the video must show. */
export interface BibleMoment {
  id: string;
  /** 0-based part index. */
  part: number;
  text: string;
  purpose: string;
  /** Character ids on screen. */
  visible: string[];
  objects: string[];
  tone: string;
  restrictions: string[];
  source?: string;
  evidence?: string[];
  check?: Verification;
  by?: By;
}

export interface Removed {
  section: BibleSection;
  what: string;
  text: string;
  reason: string;
}

export interface Correction {
  section: BibleSection;
  from: string;
  to: string;
  reason: string;
}

export interface Approval {
  hash: string;
  revision: number;
  at: number;
}

export interface StoryBible {
  version: 2;
  /** Goes up by one on every change. */
  revision: number;
  /** Hash of the story this bible was made from. */
  storyHash?: string;
  message: string;
  characters: BibleCharacter[];
  relations: BibleRelation[];
  places: BiblePlace[];
  /** Events in story order. */
  events: BibleFact[];
  keyLines: BibleKeyLine[];
  keyNumbers: BibleKeyNumber[];
  keyMoments: BibleMoment[];
  /** Visual treatment of the last shot. */
  ending: string;
  /** The story's final sequence, in order. */
  endingBeats: BibleFact[];
  /** The story's last line, copied by code from the story. */
  finalLine: string;
  pacing: string;
  prohibited: BibleFact[];
  userDirection?: string;
  removed: Removed[];
  corrections: Correction[];
  approvals: Partial<Record<BibleSection, Approval>>;
  /** Set when every card was approved for this revision. */
  approvedAt?: number;
  /** What the user added, changed or removed (kept as an audit trail; never replaces source evidence). */
  audit?: AuditEntry[];
}

export interface AuditEntry {
  /** Bible revision this change produced. */
  revision: number;
  at: number;
  action: "added" | "changed" | "removed";
  section: BibleSection;
  ref: string;
  text: string;
  was?: string;
  by: By;
  /** What the story says about it at that moment. */
  sourceStatus?: VerifyStatus;
}

export type BibleSection = "story" | "characters" | "scenes" | "ending" | "rules";
export const SECTIONS: BibleSection[] = ["story", "characters", "scenes", "ending", "rules"];

/* --------------------------------- schema --------------------------------- */

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const strArr = { type: "array", items: str } as const;
const en = <T extends readonly string[]>(v: T) => ({ type: "string", enum: [...v] }) as const;
function obj(properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties } as const;
}
const FACT = obj({ kind: en(FACT_KINDS), text: str, source: str, evidence: strArr });
const RULE_TYPES = ["none", "never_present", "never_together", "never_says"] as const;
const RULE_FACT = obj({
  kind: en(FACT_KINDS),
  text: str,
  source: str,
  evidence: strArr,
  rule: obj({ type: en(RULE_TYPES), who: str, other: str, place: str, terms: strArr, when_present: strArr }),
});

export const BIBLE_SCHEMA = obj({
  message: str,
  characters: {
    type: "array",
    items: obj({ id: str, name: str, mentions: strArr, relation: str, look: str, facts: { type: "array", items: FACT } }),
  },
  relations: { type: "array", items: obj({ from: str, to: str, relation: str, source: str, evidence: strArr }) },
  places: {
    type: "array",
    items: obj({ id: str, name: str, kind: en(PLACE_KINDS), part_of: str, description: str, who: str, source: str, evidence: strArr }),
  },
  events: { type: "array", items: FACT },
  key_lines: { type: "array", items: obj({ text: str, speaker: str }) },
  key_numbers: { type: "array", items: obj({ value: str, meaning: str }) },
  key_moments: {
    type: "array",
    items: obj({ part: int, text: str, purpose: str, visible: strArr, objects: strArr, tone: str, restrictions: strArr, source: str, evidence: strArr }),
  },
  ending: str,
  ending_beats: { type: "array", items: FACT },
  final_line: str,
  pacing: str,
  prohibited: { type: "array", items: RULE_FACT },
});

const EVIDENCE_RULE =
  "EVIDENCE: the story is given as numbered sentences [S1], [S2] … . Every fact/relation/place/scene gives `evidence` = the ids of the sentences that say it (e.g. [\"S12\",\"S13\"]), and `source` = a short phrase copied letter for letter from one of them (or \"\"). Never invent ids. Write `text` in simple English.";

export function buildBiblePrompt(opts: { genre: Genre; partsTotal: number; userRules?: string }): string {
  return [
    "You are the story editor of a Bangla short-video studio. Read the WHOLE story and write its STORY BIBLE as JSON.",
    "The bible is the single source of truth for everything that follows (cast, pictures, voice, shots). Never improve or change the story.",
    `Genre: ${GENRES[opts.genre].label}. The story will be split into ${opts.partsTotal} part(s).`,
    opts.userRules ? `The author's own rules (obey them; they are requirements): ${opts.userRules}` : "",
    "",
    EVIDENCE_RULE,
    "",
    "FACT KINDS: confirmed (the story says it) · inference (you worked it out; still give the sentences it rests on) · creative_choice (your choice for the video; evidence []) · prohibited_change (must never be altered or shown).",
    "",
    "FIELDS",
    "- message: what the story means and what the viewer should feel, 1–2 sentences.",
    "- characters: EVERY person with their exact identity. Count family members exactly; never add a child, spouse or relative the story does not name. `mentions` = the exact Bangla words used for that person (name, \"খালা\", \"মা\", \"আম্মা\"). A first-person (\"আমি\") storyteller is a character too; say clearly whose family he belongs to and whose he does not. `look` = short English (age, clothes). `id` = short latin slug.",
    "- relations: every relationship as from → to (character ids), e.g. {from:\"rahima\", to:\"mizan\", relation:\"mother of\"}. Include \"not related to\" when the story makes it clear (a visitor is not family).",
    "- places: each place exactly as the story describes it. kind = house | room | veranda | courtyard | separate_building | outdoor | public_place | other. Rooms of one home are kind \"room\" with part_of = the home's id (\"two tin-roofed rooms\" is ONE home with two rooms, not two houses). Do not add architecture the story does not say. who = who is there, \"nobody\" when the story says it is empty.",
    "- events: every event in story order (not only visual ones).",
    "- key_lines: the lines the audience must hear exactly, copied letter for letter. speaker = character id or \"narrator\".",
    "- key_numbers: every number/amount/duration that matters, copied as written in the story (words like \"ষোলো\" stay words).",
    "- key_moments: EVERY narratively important moment of the whole story in story order: the request, discoveries, secrets, confessions, phone calls, realisations, the final reflection. No fixed number; a turning point that is only heard (a phone call) is still a key moment. part = 0-based part number. purpose = why it matters to the story. visible = ids of the people ON SCREEN (a voice on the phone is not visible). objects = things that must be seen. tone = feeling. restrictions = what must NOT be shown in it.",
    "- ending_beats: the story's final sequence as facts, in order, each with evidence. Keep every beat; never replace the ending with a general message.",
    "- ending: how the last shot should look. Stage only possible things (a person cannot hold a phone to the ear and look at its screen at the same time).",
    "- final_line: the story's last line, copied exactly.",
    "- pacing: slow or fast, where to hold silence.",
    "- prohibited: each item also gets `rule` so code can check it on the shot plan: type never_present (who = character id that must never appear on screen; place optional), never_together (who + other never in the same shot), never_says (terms = Bangla AND English words that must never be spoken while anyone in when_present is a party to the shot, e.g. a secret kept from someone), or none when it cannot be checked (then leave who/other/place empty and lists []). Use character ids from `characters`.",
    "- prohibited: story-specific things that must never be changed or shown, each with evidence: secrets a character keeps from another (who must never tell whom what), people who never meet in person, returns or reunions the story does not tell, people who must never be inside an empty place, scenes that must not be left out.",
    "Be complete. Write in simple English except copied story text, which stays Bangla.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------ normalization ------------------------------ */

type R = Record<string, unknown>;
const rec = (v: unknown): R => (v && typeof v === "object" && !Array.isArray(v) ? (v as R) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max = 200) =>
  arr(v)
    .map((x) => s(x, max))
    .filter(Boolean)
    .slice(0, 30);
const slug = (v: unknown) =>
  s(v, 40)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
const byOf = (v: unknown): By => (v === "user" ? "user" : v === "system" ? "system" : "ai");

function normCheck(v: unknown): Verification | undefined {
  const o = rec(v);
  const status = o.status as VerifyStatus;
  if (!["verified", "supported", "unverified", "contradicted"].includes(status)) return undefined;
  const evidence = arr(o.evidence)
    .map(rec)
    .map((e) => ({ start: Number(e.start), end: Number(e.end), sentence: s(e.sentence, 10) }))
    .filter((e) => Number.isInteger(e.start) && Number.isInteger(e.end) && e.start < e.end);
  return {
    status,
    method: (["exact_quote", "near_quote", "cited", "semantic", "user", "none"].includes(o.method as string) ? o.method : "none") as Verification["method"],
    evidence,
    reason: s(o.reason, 400),
    ...(s(o.suggestion, 300) ? { suggestion: s(o.suggestion, 300) } : {}),
  };
}

function normFact(raw: unknown, id: string, fallback: FactKind = "inference"): BibleFact | null {
  const o = rec(raw);
  const text = s(o.text);
  if (!text) return null;
  const kind = (FACT_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as FactKind) : fallback;
  const source = s(o.source, 800);
  const evidence = strs(o.evidence, 12);
  const check = normCheck(o.check);
  const rule = normRule(o.rule);
  return { id: s(o.id, 40) || id, kind, text, ...(rule ? { rule } : {}), ...(source ? { source } : {}), ...(evidence.length ? { evidence } : {}), ...(check ? { check } : {}), by: byOf(o.by) };
}

function normRule(v: unknown): RuleSpec | undefined {
  const o = rec(v);
  const id = (x: unknown) => slug(x) || "";
  const type = o.type;
  if (type === "never_present" && id(o.who)) return { type, who: id(o.who), ...(id(o.place) ? { place: id(o.place) } : {}) };
  if (type === "never_together" && id(o.who) && id(o.other)) return { type, who: id(o.who), other: id(o.other) };
  const terms = strs(o.terms, 60).slice(0, 12);
  const present = strs(o.whenPresent ?? o.when_present, 40).map((x) => id(x)).filter(Boolean).slice(0, 8);
  if (type === "never_says" && terms.length && present.length) return { type, terms, whenPresent: present };
  return undefined;
}

const facts = (v: unknown, prefix: string, fallback?: FactKind) =>
  arr(v)
    .map((f, i) => normFact(f, `${prefix}${i + 1}`, fallback))
    .filter((f): f is BibleFact => !!f);

/** Turn the model's raw JSON (or a stored v1/v2 bible) into a clean StoryBible. Never throws. */
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
    const mentions = strs(c.mentions, 80);
    characters.push({
      id,
      name,
      mentions: mentions.length ? mentions : [name],
      relation: s(c.relation, 300),
      look: s(c.look, 200),
      facts: facts(c.facts, `${id}.f`),
      by: byOf(c.by),
    });
  }
  const relations: BibleRelation[] = arr(o.relations)
    .map((r0, i) => {
      const r = rec(r0);
      const source = s(r.source, 800);
      const evidence = strs(r.evidence, 12);
      const check = normCheck(r.check);
      return {
        id: s(r.id, 40) || `R${i + 1}`,
        from: slug(r.from),
        to: slug(r.to),
        relation: s(r.relation, 120),
        ...(source ? { source } : {}),
        ...(evidence.length ? { evidence } : {}),
        ...(check ? { check } : {}),
        by: byOf(r.by),
      };
    })
    .filter((r) => r.from && r.to && r.relation);
  const places: BiblePlace[] = arr(o.places)
    .map((p0, i) => {
      const p = rec(p0);
      const source = s(p.source, 800);
      const evidence = strs(p.evidence, 12);
      const check = normCheck(p.check);
      const partOf = slug(p.part_of ?? p.partOf);
      return {
        id: slug(p.id) || `p${i + 1}`,
        name: s(p.name, 80),
        kind: ((PLACE_KINDS as readonly string[]).includes(p.kind as string) ? p.kind : "other") as PlaceKind,
        ...(partOf ? { partOf } : {}),
        description: s(p.description, 300),
        who: s(p.who, 200),
        ...(source ? { source } : {}),
        ...(evidence.length ? { evidence } : {}),
        ...(check ? { check } : {}),
        by: byOf(p.by),
      };
    })
    .filter((p) => p.name || p.description);
  const keyLines = arr(o.key_lines ?? o.keyLines)
    .map((l0, i) => {
      const l = rec(l0);
      const check = normCheck(l.check);
      return { id: s(l.id, 40) || `L${i + 1}`, text: s(l.text, 400), speaker: s(l.speaker, 40) || "narrator", ...(check ? { check } : {}), by: byOf(l.by) };
    })
    .filter((l) => l.text);
  const keyNumbers = arr(o.key_numbers ?? o.keyNumbers)
    .map((n0) => {
      const n = rec(n0);
      const check = normCheck(n.check);
      return { value: s(n.value, 60), meaning: s(n.meaning, 200), ...(check ? { check } : {}), by: byOf(n.by) };
    })
    .filter((n) => n.value);
  const keyMoments: BibleMoment[] = arr(o.key_moments ?? o.keyMoments)
    .map((m0, i) => {
      const m = rec(m0);
      const source = s(m.source, 800);
      const evidence = strs(m.evidence, 12);
      const check = normCheck(m.check);
      return {
        id: s(m.id, 40) || `K${i + 1}`,
        part: Math.max(0, Math.min(99, Math.floor(Number(m.part) || 0))),
        text: s(m.text, 400),
        purpose: s(m.purpose, 300),
        visible: strs(m.visible, 40).map((v) => slug(v) || v),
        objects: strs(m.objects, 60),
        tone: s(m.tone, 80),
        restrictions: strs(m.restrictions, 200),
        ...(source ? { source } : {}),
        ...(evidence.length ? { evidence } : {}),
        ...(check ? { check } : {}),
        by: byOf(m.by),
      };
    })
    .filter((m) => m.text);
  const prohibited = facts(o.prohibited, "X", "prohibited_change").map((f) => ({ ...f, kind: "prohibited_change" as const }));
  const direction = s(o.userDirection, 4000);
  const approvals: StoryBible["approvals"] = {};
  for (const [k, v] of Object.entries(rec(o.approvals))) {
    const a = rec(v);
    if ((SECTIONS as string[]).includes(k) && typeof a.hash === "string") approvals[k as BibleSection] = { hash: a.hash, revision: Number(a.revision) || 0, at: Number(a.at) || 0 };
  }
  const secOf = (v: unknown): BibleSection => ((SECTIONS as string[]).includes(v as string) ? (v as BibleSection) : "story");
  return {
    version: 2,
    revision: Math.max(1, Math.floor(Number(o.revision) || 1)),
    ...(typeof o.storyHash === "string" ? { storyHash: o.storyHash } : {}),
    message: s(o.message, 600),
    characters,
    relations,
    places,
    events: facts(o.events, "E"),
    keyLines,
    keyNumbers,
    keyMoments,
    ending: s(o.ending, 600),
    endingBeats: facts(o.ending_beats ?? o.endingBeats, "N", "confirmed"),
    finalLine: s(o.final_line ?? o.finalLine, 400),
    pacing: s(o.pacing, 400),
    prohibited,
    ...(direction ? { userDirection: direction } : {}),
    removed: arr(o.removed)
      .map(rec)
      .map((r) => ({ section: secOf(r.section), what: s(r.what, 40), text: s(r.text, 400), reason: s(r.reason, 300) }))
      .filter((r) => r.text),
    corrections: arr(o.corrections)
      .map(rec)
      .map((r) => ({ section: secOf(r.section), from: s(r.from, 400), to: s(r.to, 400), reason: s(r.reason, 300) }))
      .filter((r) => r.to),
    approvals,
    ...(typeof o.approvedAt === "number" && Object.keys(approvals).length ? { approvedAt: o.approvedAt } : {}),
  };
}

/* ------------------------------ accuracy gate ------------------------------ */

/** People of the bible as anchors for English claims ("mizan" ↔ মিজান). Never required, only helpful. */
export const aliasesOf = (b: Pick<StoryBible, "characters">): Alias[] =>
  b.characters.map((c) => ({ en: [c.id.replace(/_/g, " ")], bn: [c.name, ...c.mentions], kind: "person" as const }));

/**
 * One claim, one honest source status. User-written claims get the same check as the AI's: the
 * user authorizes content, the story is the only thing that can support it. A user claim that
 * disagrees with the story stays "contradicted" (shown as a creative change, not as a fact).
 */
function checkClaim<T extends { text?: string; source?: string; evidence?: string[]; by?: By }>(story: string, item: T, text: string, aliases: Alias[]): Verification {
  return verifyClaim(story, { text, source: item.source, evidence: item.evidence }, { aliases });
}

export const EMPTY_WHO = /^(nobody|no one|none|empty|nil|কেউ নেই|কেউ না|খালি)/i;

/** Rules every story gets, written by code from the bible's own data (by: "system"). */
export function baselineRules(b: Pick<StoryBible, "characters" | "relations" | "places" | "keyNumbers" | "finalLine">): BibleFact[] {
  const name = (id: string) => b.characters.find((c) => c.id === id)?.name ?? id;
  const rules: string[] = ["Never add a person who is not in the Story Bible (no extra children, relatives or helpers)."];
  const rel = b.relations.filter((r) => r.check?.status !== "contradicted").map((r) => `${name(r.from)} is ${r.relation} ${name(r.to)}`);
  const charRel = b.characters.filter((c) => c.relation).map((c) => `${c.name}: ${c.relation}`);
  if (rel.length || charRel.length) rules.push(`Never change who is who: ${(rel.length ? rel : charRel).join("; ")}.`);
  const nums = b.keyNumbers.filter((n) => n.check?.status !== "contradicted").map((n) => n.value);
  if (nums.length) rules.push(`Never change the story's numbers: ${nums.join(", ")}.`);
  for (const p of b.places.filter((x) => EMPTY_WHO.test(x.who.trim()))) rules.push(`Never put a person inside ${p.name}: the story says nobody is there.`);
  rules.push("Never show a person coming home, travelling back, or meeting someone in person unless the story tells it.");
  if (b.finalLine) rules.push(`Never cut or replace the ending; the last line stays exactly: “${b.finalLine}”`);
  rules.push("Never change the meaning of the final narration or turn it into a general lesson.");
  rules.push("Never change an approved fact without the author.");
  return rules.map((text, i) => ({ id: `SYS${i + 1}`, kind: "prohibited_change" as const, text, by: "system" as const }));
}

/**
 * Check a bible against the ORIGINAL story text, in code. Returns a new bible with a `check`
 * on every claim, removals and corrections listed, baseline rules added, and the story hash set.
 */
export function runAccuracyGate(input: StoryBible, story: string): { bible: StoryBible; report: GateReport } {
  const removed: Removed[] = []; // a fresh gate run starts a fresh list
  const corrections: Correction[] = [];
  const al = aliasesOf(input);

  const characters: BibleCharacter[] = [];
  for (const c of input.characters) {
    const found = c.by === "user" ? c.mentions : c.mentions.filter((m) => inStory(story, m));
    if (!found.length && c.by !== "user") {
      removed.push({ section: "characters", what: "Person", text: c.name, reason: "This name is never used in the story." });
      continue;
    }
    characters.push({ ...c, mentions: found.length ? found : c.mentions, facts: c.facts.map((f) => ({ ...f, check: checkClaim(story, f, f.text, al) })) });
  }
  const ids = new Set(characters.map((c) => c.id));
  const relations = input.relations
    .filter((r) => {
      if (r.by === "user" || (ids.has(r.from) && ids.has(r.to))) return true;
      removed.push({ section: "characters", what: "Relation", text: `${r.from} ${r.relation} ${r.to}`, reason: "It names a person who is not in the story." });
      return false;
    })
    .map((r) => ({ ...r, check: checkClaim(story, r, `${r.from} ${r.relation} ${r.to}`, al) }));
  const places = input.places.map((p) => ({ ...p, check: checkClaim(story, p, `${p.name}: ${p.description}`, al) }));

  const keyLines: BibleKeyLine[] = [];
  for (const l of input.keyLines) {
    if (l.by === "user") {
      // The user's own line stays; the story only says whether those exact words are in it.
      keyLines.push({ ...l, check: verifyClaim(story, { text: "", source: l.text }, { literal: true }) });
      continue;
    }
    const v = verifyClaim(story, { text: "", source: l.text }, { literal: true });
    const at = v.method === "exact_quote" ? locate(story, l.text) : null;
    if (v.status === "verified" && at) {
      // Keep the story's exact characters (punctuation included), and say so when they differ.
      const real = story.slice(at.start, at.end);
      if (real !== l.text) corrections.push({ section: "scenes", from: l.text, to: real, reason: "Copied the story's exact punctuation and spelling for this line." });
      keyLines.push({ ...l, text: real, check: v });
    } else if (v.method === "near_quote" && v.status !== "contradicted") {
      const real = v.evidence.map((e) => story.slice(e.start, e.end)).join(" ");
      corrections.push({ section: "scenes", from: l.text, to: real, reason: "The AI's copy of this line was not word for word; replaced with the story's exact words." });
      keyLines.push({ ...l, text: real, check: verifyClaim(story, { text: "", source: real }, { literal: true }) });
    } else removed.push({ section: "scenes", what: "Line", text: l.text, reason: v.status === "contradicted" ? v.reason : "This line is not in the story." });
  }
  const storyNums = new Set(numbersIn(story));
  const keyNumbers: BibleKeyNumber[] = [];
  for (const n of input.keyNumbers) {
    if (n.by === "user") {
      const nums = numbersIn(n.value);
      keyNumbers.push({ ...n, check: nums.length && nums.every((x) => storyNums.has(x)) ? verifyClaim(story, { text: n.value, source: n.value }, { literal: true }) : { status: "unverified", support: "absent", method: "none", evidence: [], reason: "The story never says this number." } });
      continue;
    }
    const at = locate(story, n.value);
    const nums = numbersIn(n.value);
    if (at) {
      const sent = splitSentences(story).find((x) => at.start >= x.start && at.start < x.end);
      keyNumbers.push({ ...n, check: { status: "verified", quote: "exact", support: "literal", method: "exact_quote", evidence: [{ ...at, sentence: sent?.id ?? "" }], reason: "This number is written in the story." } });
    } else if (nums.length && nums.every((x) => storyNums.has(x))) {
      const sent = splitSentences(story).find((x) => numbersIn(x.text).includes(nums[0]));
      keyNumbers.push({
        ...n,
        check: { status: "verified", quote: "near", support: "literal", method: "near_quote", evidence: sent ? [{ start: sent.start, end: sent.end, sentence: sent.id }] : [], reason: "The story writes this number in words." },
      });
    } else removed.push({ section: "scenes", what: "Number", text: `${n.value} (${n.meaning})`, reason: "The story never says this number." });
  }
  const keyMoments = input.keyMoments.map((m) => ({ ...m, visible: m.visible.filter((v) => ids.has(v) || m.by === "user"), check: checkClaim(story, m, m.text, al) }));
  const events = input.events.map((f) => ({ ...f, check: checkClaim(story, f, f.text, al) }));
  const endingBeats = input.endingBeats.map((f) => ({ ...f, check: checkClaim(story, f, f.text, al) }));

  const last = lastSentence(story)?.text ?? "";
  // The final line is always copied by code from the story itself.
  const finalLine = last || input.finalLine;
  if (last && input.finalLine && foldText(input.finalLine).replace(/[^\p{L}\p{N}]/gu, "") !== foldText(last).replace(/[^\p{L}\p{N}]/gu, ""))
    corrections.push({ section: "ending", from: input.finalLine, to: last, reason: "The final line must be the story's own last line; copied from the story." });

  const aiRules = input.prohibited.filter((f) => f.by !== "system").map((f) => ({ ...f, kind: "prohibited_change" as const, check: f.evidence?.length || f.source ? checkClaim(story, f, f.text, al) : undefined }));
  const draft = { characters, relations, places, keyNumbers, finalLine };
  const prohibited = [...baselineRules(draft), ...aiRules];

  const bible: StoryBible = {
    ...input,
    storyHash: storyHash(story),
    characters,
    relations,
    places,
    events,
    keyLines,
    keyNumbers,
    keyMoments,
    endingBeats,
    finalLine,
    prohibited,
    removed,
    corrections,
  };
  return { bible, report: summarize(bible) };
}

/* -------------------------- claims, findings, summary -------------------------- */

export interface ClaimRef {
  /** Unique within the bible, e.g. "E3", "rahima.f2", "P:kitchen", "K4". */
  ref: string;
  section: BibleSection;
  label: string;
  text: string;
  by?: By;
  check?: Verification;
  source?: string;
}

export type ClaimKind = "source_claim" | "supported_addition" | "unsupported_addition" | "creative_deviation";

export interface ClaimView {
  origin: By;
  /** What the STORY says about this claim. */
  sourceStatus: VerifyStatus | "unchecked";
  /** Whether the card holding it is approved for its current content (separate from sourceStatus). */
  approval: "approved" | "unapproved";
  kind: ClaimKind;
  /** A label that is true: never "verified" for something only the user said. */
  label: string;
}

/** Origin, source status and approval of one claim, kept apart on purpose. */
export function claimView(b: StoryBible, c: ClaimRef): ClaimView {
  const origin: By = c.by ?? "ai";
  const sourceStatus = c.check?.status ?? "unchecked";
  const approval = isApproved(b, c.section) ? "approved" : "unapproved";
  if (origin !== "user") return { origin, sourceStatus, approval, kind: "source_claim", label: "" };
  if (sourceStatus === "contradicted") return { origin, sourceStatus, approval, kind: "creative_deviation", label: "User-approved creative change — differs from original story." };
  if (sourceStatus === "supported" || sourceStatus === "verified") return { origin, sourceStatus, approval, kind: "supported_addition", label: "Your addition — the story supports it." };
  return { origin, sourceStatus, approval, kind: "unsupported_addition", label: "Your addition — the story does not say this." };
}

/** Every checkable claim of the bible, in reading order. */
export function listClaims(b: StoryBible): ClaimRef[] {
  const out: ClaimRef[] = [];
  b.events.forEach((f) => out.push({ ref: f.id, section: "story", label: "Event", text: f.text, by: f.by, check: f.check, source: f.source }));
  b.characters.forEach((c) => c.facts.forEach((f) => out.push({ ref: f.id, section: "characters", label: c.name, text: f.text, by: f.by, check: f.check, source: f.source })));
  const name = (id: string) => b.characters.find((c) => c.id === id)?.name ?? id;
  b.relations.forEach((r) => out.push({ ref: r.id, section: "characters", label: "Relation", text: `${name(r.from)} — ${r.relation} — ${name(r.to)}`, by: r.by, check: r.check, source: r.source }));
  b.places.forEach((p) => out.push({ ref: `P:${p.id}`, section: "characters", label: `Place · ${p.name}`, text: `${p.description}${p.who ? ` (who is there: ${p.who})` : ""}`, by: p.by, check: p.check, source: p.source }));
  b.keyMoments.forEach((m) => out.push({ ref: m.id, section: "scenes", label: `Scene · part ${m.part + 1}`, text: m.text, by: m.by, check: m.check, source: m.source }));
  b.keyLines.forEach((l) => out.push({ ref: l.id, section: "scenes", label: "Exact line", text: l.text, by: l.by, check: l.check }));
  b.keyNumbers.forEach((n, i) => out.push({ ref: `NUM${i + 1}`, section: "scenes", label: "Number", text: `${n.value} — ${n.meaning}`, by: n.by, check: n.check }));
  b.endingBeats.forEach((f) => out.push({ ref: f.id, section: "ending", label: "Ending", text: f.text, by: f.by, check: f.check, source: f.source }));
  b.prohibited.forEach((f) => (f.check || f.by === "user") && out.push({ ref: f.id, section: "rules", label: "Rule", text: f.text, by: f.by, check: f.check, source: f.source }));
  return out;
}

export interface Finding {
  ref: string;
  section: BibleSection;
  label: string;
  claim: string;
  status: VerifyStatus | "removed" | "corrected";
  reason: string;
  evidence: Span[];
  suggestion?: string;
  aiQuote?: string;
  /** Who wrote the claim. User claims are authorized by the user, so they are never "need your check". */
  origin?: By;
}

export interface GateReport {
  verified: number;
  supported: number;
  unverified: number;
  contradicted: number;
  corrected: number;
  removed: number;
  /** Things the user wrote: how the story relates to them. */
  user: { supported: number; unsupported: number; deviations: number };
  /** Only things a person should look at: unverified, contradicted, corrected, removed. */
  findings: Finding[];
  /** Simple English lines (also for older screens). */
  notes: string[];
}

/** The report is always worked out from the bible itself, so it can never be stale. */
export function summarize(b: StoryBible): GateReport {
  const r: GateReport = { verified: 0, supported: 0, unverified: 0, contradicted: 0, corrected: b.corrections.length, removed: b.removed.length, user: { supported: 0, unsupported: 0, deviations: 0 }, findings: [], notes: [] };
  for (const c of listClaims(b)) {
    const st = c.check?.status;
    if (!st || c.section === "rules") continue;
    if (c.by === "user") {
      // The user authorizes it; the story only says whether it backs it.
      if (st === "contradicted") r.user.deviations++;
      else if (st === "unverified") r.user.unsupported++;
      else r.user.supported++;
      if (st === "contradicted" || st === "unverified")
        r.findings.push({ ref: c.ref, section: c.section, label: claimView(b, c).label, claim: c.text, status: st, reason: c.check!.reason, evidence: c.check!.evidence, aiQuote: c.source, origin: "user" });
      continue;
    }
    r[st]++;
    if (st === "unverified" || st === "contradicted")
      r.findings.push({ ref: c.ref, section: c.section, label: c.label, claim: c.text, status: st, reason: c.check!.reason, evidence: c.check!.evidence, suggestion: c.check!.suggestion, aiQuote: c.source });
  }
  for (const x of b.corrections) r.findings.push({ ref: `fix:${x.from}`, section: x.section, label: "Fixed", claim: x.to, status: "corrected", reason: `${x.reason} (was: “${x.from}”)`, evidence: [] });
  for (const x of b.removed) r.findings.push({ ref: `rm:${x.text}`, section: x.section, label: x.what, claim: x.text, status: "removed", reason: x.reason, evidence: [] });
  r.notes = r.findings.map((f) => `${f.label}: “${f.claim}” — ${f.reason}`);
  return r;
}

/** One honest sentence for the top of the review. */
export function summaryLine(r: GateReport): string {
  const need = r.unverified + r.contradicted;
  const parts: string[] = [];
  if (need) parts.push(`${need} claim${need > 1 ? "s" : ""} need${need > 1 ? "" : "s"} your check`);
  if (r.contradicted) parts.push(`${r.contradicted} disagree${r.contradicted > 1 ? "" : "s"} with the story`);
  if (r.corrected) parts.push(`${r.corrected} copied line${r.corrected > 1 ? "s were" : " was"} fixed to the story's exact words`);
  if (r.removed) parts.push(`${r.removed} item${r.removed > 1 ? "s" : ""} not in the story ${r.removed > 1 ? "were" : "was"} removed`);
  if (r.user.deviations) parts.push(`${r.user.deviations} of your changes differ${r.user.deviations > 1 ? "" : "s"} from the story (your choice)`);
  if (r.user.unsupported) parts.push(`${r.user.unsupported} of your additions ${r.user.unsupported > 1 ? "are" : "is"} not in the story (your choice)`);
  if (!need && !r.corrected && !r.removed && !r.user.deviations && !r.user.unsupported) return `All ${r.verified + r.supported} claims point to real sentences in your story.`;
  return `${parts.join(" · ")}.`;
}

/* --------------------------- semantic cross-check --------------------------- */

export const VERIFY_SCHEMA = obj({
  results: {
    type: "array",
    items: obj({ ref: str, verdict: en(["supported", "contradicted", "not_found"] as const), sentences: strArr, reason: str }),
  },
});

export function buildVerifyPrompt(): string {
  return [
    "You check claims about a Bangla story against the story itself. The story is given as numbered sentences [S1] … .",
    "For EACH claim answer: verdict = supported (the story clearly says this; paraphrase and translation are fine) | contradicted (the story says something different) | not_found (the story does not say it).",
    "sentences = the ids of ALL sentences you used (needed for supported and contradicted). Never invent ids. reason = one short simple-English sentence.",
    "Judge only by the story. Details the story does not say (e.g. \"two houses\" when it says two rooms) make the claim contradicted or not_found.",
  ].join("\n");
}

/**
 * Claims for the cross-check: every AI-written claim. A correct Bangla quote proves the passage
 * exists, not that the English claim means the same ("two tin houses" quoting "টিনের দুটো ঘর").
 * Exact lines and numbers are left out: code checks those letter by letter.
 */
export function claimsToVerify(b: StoryBible): ClaimRef[] {
  return listClaims(b).filter((c) => c.by !== "user" && c.by !== "system" && c.section !== "rules" && c.check && c.label !== "Exact line" && c.label !== "Number");
}

/**
 * Apply the model's cross-check. Code keeps control: only real sentence ids count, numbers must
 * still agree, and an exact-quote verification is never weakened.
 */
export function applySemantic(b: StoryBible, story: string, results: unknown): StoryBible {
  const byRef = new Map<string, R>();
  for (const r of arr(rec(results).results)) byRef.set(s(rec(r).ref, 60), rec(r));
  const judge = <T extends { check?: Verification; by?: By }>(ref: string, item: T, text: string): T => {
    const r = byRef.get(ref);
    if (!r || !item.check || item.by === "user" || item.by === "system") return item;
    const spans = citedSpans(story, strs(r.sentences, 12));
    const reason = s(r.reason, 300);
    // A quote that code found in the story keeps its passage: the cross-check may only say the
    // English claim disagrees with it (with real sentence ids), never that the passage is missing.
    const quoted = item.check.method === "exact_quote" || item.check.method === "near_quote";
    if (quoted && !(r.verdict === "contradicted" && spans.length)) return item;
    if (r.verdict === "supported" && spans.length) {
      const src = (item as { source?: string }).source;
      return { ...item, check: confirmClaim(story, { text, source: src, evidence: (item as { evidence?: string[] }).evidence }, spans.map((x) => x.sentence), reason || "An AI cross-check found these sentences say it.", { aliases: aliasesOf(b) }) };
    }
    if (r.verdict === "contradicted" && spans.length)
      return { ...item, check: { status: "contradicted", support: "contradicted", method: "semantic", evidence: spans, reason: reason || "The story says something different.", suggestion: "Read the passage and edit this claim." } };
    if (r.verdict === "not_found") return { ...item, check: { status: "unverified", support: "absent", method: "semantic", evidence: [], reason: reason ? `${reason} ${NO_PASSAGE_HINT}` : NO_PASSAGE_HINT } };
    return item;
  };
  const name = (id: string) => b.characters.find((c) => c.id === id)?.name ?? id;
  return {
    ...b,
    events: b.events.map((f) => judge(f.id, f, f.text)),
    characters: b.characters.map((c) => ({ ...c, facts: c.facts.map((f) => judge(f.id, f, f.text)) })),
    relations: b.relations.map((r) => judge(r.id, r, `${name(r.from)} ${r.relation} ${name(r.to)}`)),
    places: b.places.map((p) => judge(`P:${p.id}`, p, p.description)),
    keyMoments: b.keyMoments.map((m) => judge(m.id, m, m.text)),
    endingBeats: b.endingBeats.map((f) => judge(f.id, f, f.text)),
  };
}
const NO_PASSAGE_HINT = "No reliable supporting passage found.";

/* --------------------------- revisions and approvals --------------------------- */

function sectionContent(b: StoryBible, section: BibleSection): unknown {
  const strip = <T extends object>(x: T) => {
    const { check: _c, ...rest } = x as T & { check?: unknown };
    void _c;
    return rest;
  };
  switch (section) {
    case "story":
      return [b.message, b.events.map(strip)];
    case "characters":
      return [b.characters.map((c) => ({ ...c, facts: c.facts.map(strip) })), b.relations.map(strip), b.places.map(strip)];
    case "scenes":
      return [b.keyMoments.map(strip), b.keyLines.map(strip), b.keyNumbers.map(strip)];
    case "ending":
      return [b.ending, b.endingBeats.map(strip), b.finalLine, b.pacing];
    case "rules":
      return [b.prohibited.map(strip), b.userDirection ?? ""];
  }
}

export const sectionHash = (b: StoryBible, section: BibleSection) => hashText(JSON.stringify(sectionContent(b, section)));

/** Approved = approved for exactly this content. */
export const isApproved = (b: StoryBible, section: BibleSection) => b.approvals[section]?.hash === sectionHash(b, section);

/** A card is blocked while it holds an AI claim that disagrees with the story. */
export function blockedReasons(b: StoryBible, section: BibleSection): string[] {
  return listClaims(b)
    .filter((c) => c.section === section && c.by !== "user" && c.check?.status === "contradicted")
    .map((c) => `“${c.text}” disagrees with the story. Edit or remove it.`);
}

export type CardState = "approved" | "unreviewed" | "blocked";
export function cardState(b: StoryBible, section: BibleSection): CardState {
  if (blockedReasons(b, section).length) return "blocked";
  return isApproved(b, section) ? "approved" : "unreviewed";
}

/** A changed bible: next revision, whole-bible approval cleared unless every card still matches. */
export function revise(prev: StoryBible, next: StoryBible, now = Date.now()): StoryBible {
  const out: StoryBible = { ...next, revision: Math.max(prev.revision, next.revision) + 1 };
  const trail = auditChanges(prev, out, now);
  if (trail.length) out.audit = [...(prev.audit ?? next.audit ?? []), ...trail].slice(-200);
  else if (prev.audit || next.audit) out.audit = prev.audit ?? next.audit;
  if (!SECTIONS.every((sec) => isApproved(out, sec))) delete out.approvedAt;
  return out;
}

/** What the user added, changed or removed between two versions (their own items only). */
function auditChanges(prev: StoryBible, next: StoryBible, now: number): AuditEntry[] {
  const key = (c: ClaimRef) => c.ref;
  const before = new Map(listClaims(prev).filter((c) => c.by === "user").map((c) => [key(c), c]));
  const after = new Map(listClaims(next).filter((c) => c.by === "user").map((c) => [key(c), c]));
  const out: AuditEntry[] = [];
  const entry = (action: AuditEntry["action"], c: ClaimRef, was?: string): AuditEntry => ({ revision: next.revision, at: now, action, section: c.section, ref: c.ref, text: c.text, ...(was !== undefined ? { was } : {}), by: "user", ...(c.check ? { sourceStatus: c.check.status } : {}) });
  for (const [k, c] of after) {
    const old = before.get(k);
    if (!old) out.push(entry("added", c));
    else if (old.text !== c.text) out.push(entry("changed", c, old.text));
  }
  for (const [k, c] of before) if (!after.has(k)) out.push(entry("removed", c));
  // rules the user removed: AI/system rules disappearing is an authorized deviation too
  const rulesBefore = new Map(prev.prohibited.map((f) => [f.id, f]));
  const rulesAfter = new Set(next.prohibited.map((f) => f.id));
  for (const [id, f] of rulesBefore) if (!rulesAfter.has(id) && f.by !== "user") out.push({ revision: next.revision, at: now, action: "removed", section: "rules", ref: id, text: f.text, by: "user", ...(f.check ? { sourceStatus: f.check.status } : {}) });
  return out;
}

export function approveSection(b: StoryBible, section: BibleSection, on = true, now = Date.now()): StoryBible {
  if (on && blockedReasons(b, section).length) return b;
  const approvals = { ...b.approvals };
  if (on) approvals[section] = { hash: sectionHash(b, section), revision: b.revision, at: now };
  else delete approvals[section];
  const out: StoryBible = { ...b, approvals };
  if (!SECTIONS.every((sec) => isApproved(out, sec))) delete out.approvedAt;
  return out;
}

/**
 * Approval check on the bible exactly as the browser sent it (no normalizing first: trimming a
 * half-typed edit would change the hash and wrongly refuse an approved bible). Never throws.
 */
export function rawApprovedSections(raw: unknown): { approved: BibleSection[]; open: BibleSection[] } {
  const approved: BibleSection[] = [];
  const open: BibleSection[] = [];
  for (const sec of SECTIONS) {
    let ok = false;
    try {
      const b = raw as StoryBible;
      ok = !!b?.approvals?.[sec]?.hash && b.approvals[sec]!.hash === sectionHash(b, sec);
    } catch {
      ok = false;
    }
    (ok ? approved : open).push(sec);
  }
  return { approved, open };
}

/**
 * Recompute every claim's check from the story, keeping the CONTENT (and so every approval hash)
 * exactly as it is. This is what the server does with a bible the browser sent: statuses sent by
 * the browser are never trusted. The only thing kept from a stored check is a "contradicted"
 * verdict of the AI cross-check (it can only make a card stricter, never looser).
 */
export function recheck(b: StoryBible, story: string): StoryBible {
  const al = aliasesOf(b);
  const keep = (old: Verification | undefined, fresh: Verification): Verification => {
    if (old?.method === "semantic" && old.status === "contradicted" && fresh.status !== "contradicted" && old.evidence.every((e) => e.end <= story.length)) return { ...old, quote: fresh.quote };
    return fresh;
  };
  const item = <T extends { text: string; source?: string; evidence?: string[]; check?: Verification }>(x: T, text = x.text): T => ({ ...x, check: keep(x.check, verifyClaim(story, { text, source: x.source, evidence: x.evidence }, { aliases: al })) });
  const name = (id: string) => b.characters.find((c) => c.id === id)?.name ?? id;
  const storyNums = new Set(numbersIn(story));
  return {
    ...b,
    events: b.events.map((f) => item(f)),
    characters: b.characters.map((c) => ({ ...c, facts: c.facts.map((f) => item(f)) })),
    relations: b.relations.map((r) => ({ ...r, check: keep(r.check, verifyClaim(story, { text: `${name(r.from)} ${r.relation} ${name(r.to)}`, source: r.source, evidence: r.evidence }, { aliases: al })) })),
    places: b.places.map((p) => ({ ...p, check: keep(p.check, verifyClaim(story, { text: `${p.name}: ${p.description}`, source: p.source, evidence: p.evidence }, { aliases: al })) })),
    keyMoments: b.keyMoments.map((m) => item(m)),
    endingBeats: b.endingBeats.map((f) => item(f)),
    keyLines: b.keyLines.map((l) => ({ ...l, check: verifyClaim(story, { text: "", source: l.text }, { literal: true }) })),
    keyNumbers: b.keyNumbers.map((n) => {
      const nums = numbersIn(n.value);
      const ok = nums.length > 0 && nums.every((x) => storyNums.has(x));
      return { ...n, check: ok ? verifyClaim(story, { text: n.value, source: n.value }, { literal: true }) : ({ status: "unverified", support: "absent", method: "none", evidence: [], reason: "The story never says this number." } as Verification) };
    }),
    prohibited: b.prohibited.map((f) => (f.evidence?.length || f.source ? item(f) : f)),
  };
}

/**
 * Upgrade a stored bible: v1 bibles are re-checked against the story by code (free, no AI).
 * If the story is no longer the one the bible was made from, every check is recomputed against
 * the NEW text (so highlighted passages are never stale offsets) and all approvals are cleared.
 * The bible keeps its old story hash on purpose: that is what marks it as outdated.
 */
export function loadBible(stored: unknown, story: string): StoryBible {
  const b = normalizeBible(stored);
  const v2 = (stored as { version?: number })?.version === 2;
  const out = v2 ? b : runAccuracyGate(b, story).bible;
  // Bibles checked by an older engine ("verified" for any real quote): re-check them with the current rules.
  // Content, and so every approval, stays as it is; only the statuses are recomputed.
  const legacy = v2 && listClaims(b).some((c) => c.check && c.check.support === undefined);
  if (legacy && !(b.storyHash && b.storyHash !== storyHash(story))) return recheck(b, story);
  if (v2 && b.storyHash && b.storyHash !== storyHash(story)) {
    const r = recheck(b, story);
    return { ...r, approvals: {}, approvedAt: undefined, revision: r.revision + 1, storyHash: b.storyHash };
  }
  return out;
}

/** Is a saved shot plan still based on the current approved bible and story? */
export function planFreshness(rec: { bibleHash?: string; storyHash?: string } | null | undefined, b: StoryBible | null | undefined, story: string): { stale: boolean; reason?: string } {
  if (!b) return { stale: false };
  if (!rec?.bibleHash) return { stale: true, reason: "This plan was made before the Director's review was approved. Plan the shots again." };
  if (b.storyHash && b.storyHash !== storyHash(story)) return { stale: true, reason: "The story changed after this plan was made." };
  if (rec.bibleHash !== bibleHash(b)) return { stale: true, reason: "The Director's review changed after this plan was made. Plan the shots again." };
  return { stale: false };
}

/** Can shots be planned from this bible for this story? Reasons are simple English. */
export function bibleReady(b: StoryBible | null | undefined, story: string): { ok: boolean; reasons: string[] } {
  if (!b) return { ok: false, reasons: ["There is no Story Bible yet."] };
  const reasons: string[] = [];
  if (b.storyHash && b.storyHash !== storyHash(story)) reasons.push("The story changed after this review. Make the review again.");
  for (const sec of SECTIONS) {
    if (blockedReasons(b, sec).length) reasons.push(`The “${sec}” card disagrees with the story.`);
    else if (!isApproved(b, sec)) reasons.push(`The “${sec}” card is not approved for its current content.`);
  }
  return { ok: !reasons.length, reasons };
}

/** Hash that changes whenever the approved content changes; stored on episode plans. */
export const bibleHash = (b: StoryBible) => hashText(SECTIONS.map((sec) => sectionHash(b, sec)).join("|") + (b.storyHash ?? ""));

/* ------------------------------ prompt for shots ------------------------------ */

const usable = (c?: Verification) => !c || c.status !== "contradicted";
const certain = (c?: Verification) => !c || c.status === "verified" || c.status === "supported";

/** The bible as hard rules for the shot planner. Contradicted claims are never sent. */
export function bibleToPrompt(b: StoryBible, partIndex: number): string {
  const lines: string[] = ["STORY BIBLE (approved by the author; this is the truth, obey it over your own ideas):", `- Meaning: ${b.message}`];
  lines.push("- ONLY these people may appear or speak (plus the narrator). Never add anyone else:");
  for (const c of b.characters) {
    lines.push(`  • ${c.id} = ${c.name}: ${c.relation}${c.look ? `; look: ${c.look}` : ""}`);
    for (const f of c.facts.filter((x) => usable(x.check))) lines.push(`      ${certain(f.check) ? "FACT" : "unchecked"}: ${f.text}`);
  }
  const name = (id: string) => b.characters.find((c) => c.id === id)?.name ?? id;
  const rel = b.relations.filter((r) => usable(r.check));
  if (rel.length) lines.push(`- Relations: ${rel.map((r) => `${name(r.from)} is ${r.relation} ${name(r.to)}`).join("; ")}`);
  if (b.places.length) {
    lines.push("- Places:");
    for (const p of b.places.filter((x) => usable(x.check)))
      lines.push(`  • ${p.name} (${p.kind}${p.partOf ? ` of ${p.partOf}` : ""}): ${p.description}${p.who ? ` Who is there: ${p.who}.` : ""}`);
  }
  const ev = b.events.filter((e) => usable(e.check));
  if (ev.length) {
    lines.push("- Events in order (do not change the order or skip any):");
    ev.forEach((e) => lines.push(`  ${e.id}. ${e.text}${certain(e.check) ? "" : " (unchecked)"}`));
  }
  if (b.keyLines.length) lines.push(`- Key lines to keep exactly (and give to the right speaker): ${b.keyLines.map((l) => `${l.speaker}: “${l.text}”`).join(" | ")}`);
  if (b.keyNumbers.length) lines.push(`- Key numbers to keep exactly: ${b.keyNumbers.map((n) => `${n.value} (${n.meaning})`).join("; ")}`);
  const moments = b.keyMoments.filter((m) => m.part === partIndex && usable(m.check));
  if (moments.length) {
    lines.push("- Key scenes of THIS part (each needs at least one shot whose `refs` lists its id):");
    for (const m of moments)
      lines.push(
        `  ${m.id}. ${m.text}${m.visible.length ? ` | on screen: ${m.visible.join(", ")}` : " | on screen: nobody"}${m.objects.length ? ` | objects: ${m.objects.join(", ")}` : ""}${m.tone ? ` | tone: ${m.tone}` : ""}${m.restrictions.length ? ` | never: ${m.restrictions.join("; ")}` : ""}`,
      );
  }
  if (b.endingBeats.length) lines.push(`- Story ending, in order (keep every beat): ${b.endingBeats.filter((x) => usable(x.check)).map((x) => x.text).join(" → ")}`);
  if (b.finalLine) lines.push(`- Final line (exactly): “${b.finalLine}”`);
  if (b.ending) lines.push(`- Ending shot: ${b.ending}`);
  if (b.pacing) lines.push(`- Pacing: ${b.pacing}`);
  if (b.prohibited.length) {
    lines.push("- NEVER (prohibited changes):");
    for (const p of b.prohibited) lines.push(`  ✗ ${p.text}`);
  }
  lines.push("- Off-screen voices are fine (a voice on the phone, a narrator over an empty room); a speaker does not have to be on screen.");
  lines.push("- Each shot's `refs` = ids of the events (E…) and key scenes (K…) it shows; [] when none.");
  if (b.userDirection) lines.push(`- The author's own direction (highest priority): ${b.userDirection}`);
  return lines.join("\n");
}

/* --------------------------- check a plan against the bible --------------------------- */

const norm = (v: string) => foldText(v).replace(/[^\p{L}\p{N}]+/gu, "");

/** Which bible character is this cast member? Match by name, mention, or id. */
export function matchCharacter(c: Pick<CastMember, "id" | "name">, b: StoryBible): BibleCharacter | null {
  const id = norm(c.id);
  const name = norm(c.name);
  // "rahima_young" / "rahima_old": another age of a person the bible knows (the planner makes these for memories)
  const variant = b.characters.find((ch) => ch.id.length >= 3 && c.id.toLowerCase().startsWith(`${ch.id.toLowerCase()}_`));
  if (variant) return variant;
  for (const ch of b.characters) {
    if (norm(ch.id) === id && id) return ch;
    const names = [ch.name, ...ch.mentions].map(norm).filter(Boolean);
    if (name && names.includes(name)) return ch;
    if (name && names.some((n) => n.length >= 3 && (name.includes(n) || n.includes(name)))) return ch;
  }
  return null;
}

const slugOf = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");

/** Plan place ids that the bible says are empty (matched by id / asset / name). */
export function emptyPlaceIds(plan: EpisodePlan, b: StoryBible): Set<string> {
  const out = new Set<string>();
  const empties = b.places.filter((p) => EMPTY_WHO.test(p.who.trim()));
  for (const pl of plan.places) {
    const ids = [pl.id, pl.asset].map(slugOf);
    for (const e of empties) {
      const keys = [e.id, e.name].map(slugOf).filter((k) => k.length >= 3);
      if (keys.some((k) => ids.some((i) => i === k || i.includes(k) || k.includes(i)))) out.add(pl.id);
    }
  }
  return out;
}

/** True when the estimate is above the user's spending limit. A limit of 0 or less means "no limit". */
export function overSpendLimit(totalUsd: number, limitUsd: number): boolean {
  return limitUsd > 0 && totalUsd > limitUsd + 1e-9;
}

/**
 * After planning (and again after autoDirect): hard story rules, applied by code.
 *  - cast the bible does not know is removed from every shot (its lines go to the narrator);
 *  - an empty place stays empty;
 *  - unknown `refs` are dropped.
 * With `partText`, it also warns when a key scene of this part has no shot, a key line or number
 * of this part is missing, or a key line is given to the wrong speaker. Returns a new plan.
 */
export function enforceBible(plan: EpisodePlan, b: StoryBible, warnings: string[] = [], opts: { partIndex?: number; partText?: string } = {}): EpisodePlan {
  const allowed = new Map<string, CastMember>();
  const removed = new Set<string>();
  const castToBible = new Map<string, string>();
  for (const c of plan.cast) {
    if (c.voice === "narrator" && /narrator|storyteller|আমি/i.test(`${c.id} ${c.name}`)) {
      allowed.set(c.id, c); // first-person storyteller
      const me = b.characters.find((x) => x.mentions.some((m) => /^আমি$/.test(m.trim())) || /narrator|storyteller/i.test(x.id));
      if (me) castToBible.set(c.id, me.id);
      continue;
    }
    if (c.id.startsWith("extra_")) {
      allowed.set(c.id, c); // background extras from autoDirect never speak
      continue;
    }
    const m = matchCharacter(c, b);
    if (m) {
      allowed.set(c.id, c);
      castToBible.set(c.id, m.id);
    } else removed.add(c.id);
  }
  const empties = emptyPlaceIds(plan, b);
  for (const id of removed) warnings.push(`Removed “${id}”: that person is not in the approved Story Bible.`);
  const refIds = new Set([...b.events.map((e) => e.id), ...b.keyMoments.map((m) => m.id)]);

  const cleanActors = <T extends { id: string }>(a: T[] | undefined) => a?.filter((x) => !removed.has(x.id));
  let emptyFixes = 0;
  const shots: Shot[] = plan.shots.map((sh) => {
    const next: Shot = { ...sh };
    if (removed.has(sh.speaker)) next.speaker = "narrator";
    if (sh.actors) next.actors = cleanActors(sh.actors);
    if (sh.top) next.top = { ...sh.top, actors: (cleanActors(sh.top.actors) ?? []).filter(() => !empties.has(sh.top!.place)) };
    if (sh.bottom) next.bottom = { ...sh.bottom, actors: (cleanActors(sh.bottom.actors) ?? []).filter(() => !empties.has(sh.bottom!.place)) };
    if (sh.camera.focus && removed.has(sh.camera.focus)) next.camera = { ...sh.camera, focus: undefined };
    if (sh.place && empties.has(sh.place) && sh.layout !== "split" && next.actors?.length) {
      emptyFixes++;
      next.actors = [];
      if (next.camera.focus && !(next.props ?? []).some((p) => p.id === next.camera.focus)) next.camera = { ...next.camera, focus: undefined };
    }
    if (sh.refs) {
      const kept = sh.refs.filter((r) => refIds.has(r));
      if (kept.length) next.refs = kept;
      else delete next.refs;
    }
    return next;
  });
  if (emptyFixes) warnings.push(`An empty place stayed empty: removed people from ${emptyFixes} shot${emptyFixes > 1 ? "s" : ""}.`);
  const out: EpisodePlan = { ...plan, cast: plan.cast.filter((c) => !removed.has(c.id)), shots };

  if (opts.partText !== undefined) {
    const part = opts.partText;
    const spoken = foldText(out.shots.map((x) => x.line).join(" "));
    const covered = new Set(out.shots.flatMap((x) => x.refs ?? []));
    for (const m of b.keyMoments.filter((x) => x.part === (opts.partIndex ?? 0) && usable(x.check))) {
      if (!covered.has(m.id)) warnings.push(`Key scene ${m.id} (“${m.text}”) has no shot that says it shows it.`);
    }
    for (const n of b.keyNumbers) {
      if (inStory(part, n.value) && !spoken.includes(foldText(n.value))) warnings.push(`The number “${n.value}” (${n.meaning}) is in this part but not in its lines.`);
    }
    for (const l of b.keyLines) {
      if (!inStory(part, l.text)) continue;
      const shot = out.shots.find((x) => inStory(x.line, l.text) || inStory(l.text, x.line.replace(/\[[^\]]*\]/g, "").trim()));
      if (!shot) warnings.push(`The key line “${l.text}” is missing from this part.`);
      else if (l.speaker !== "narrator" && shot.speaker !== "narrator") {
        const bibleId = castToBible.get(shot.speaker) ?? shot.speaker;
        if (bibleId !== l.speaker) warnings.push(`The key line “${l.text}” belongs to ${l.speaker}, not ${shot.speaker}.`);
      }
    }
  } else {
    const spoken = foldText(out.shots.map((x) => x.line).join(" "));
    for (const n of b.keyNumbers) if (!spoken.includes(foldText(n.value))) warnings.push(`The number “${n.value}” (${n.meaning}) is in the bible but not in this part's lines.`);
  }
  return out;
}

/** The hard rules only, no warnings — safe to run after autoDirect so it can never break them. */
export const applyHardRules = (plan: EpisodePlan, b: StoryBible | null | undefined): EpisodePlan => (b ? enforceBible(plan, b, []) : plan);

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
    { label: "Planning", detail: "shot list", usd: 0.03 },
    { label: "Pictures", detail: `up to ${opts.newCharacters} characters + ${opts.newPlaces} places`, usd: pictures },
    { label: "Voice", detail: `about ${opts.voiceMinutes.toFixed(1)} minutes`, usd: voice },
    { label: "Animation", detail: "drawn by code, free", usd: 0 },
    { label: "Retries", detail: "about 10% extra", usd: (pictures + voice) * 0.1 },
  ];
  return { lines, total: lines.reduce((a, l) => a + l.usd, 0) };
}

/* ------------------------- per-card regenerate ------------------------- */

/**
 * Take ONE card's content from a freshly generated (and gated) bible. Other cards, their
 * approvals, and the user's own items in this card are kept. Fixes and removals of the other
 * cards are kept too; the regenerated card's come from the fresh run.
 */
export function mergeSection(current: StoryBible, fresh: StoryBible, section: BibleSection): StoryBible {
  const next: StoryBible = {
    ...current,
    removed: [...current.removed.filter((r) => r.section !== section), ...fresh.removed.filter((r) => r.section === section)],
    corrections: [...current.corrections.filter((r) => r.section !== section), ...fresh.corrections.filter((r) => r.section === section)],
  };
  const mine = <T extends { by?: By }>(xs: T[]) => xs.filter((x) => x.by === "user");
  switch (section) {
    case "story":
      next.message = fresh.message;
      next.events = [...fresh.events, ...mine(current.events)];
      break;
    case "characters": {
      const userChars = mine(current.characters);
      next.characters = [...fresh.characters.filter((c) => !userChars.some((u) => u.id === c.id)), ...userChars];
      next.relations = [...fresh.relations, ...mine(current.relations)];
      next.places = [...fresh.places.filter((p) => !mine(current.places).some((u) => u.id === p.id)), ...mine(current.places)];
      break;
    }
    case "scenes":
      next.keyMoments = [...fresh.keyMoments.filter((m) => !mine(current.keyMoments).some((u) => u.id === m.id)), ...mine(current.keyMoments)].sort((a, b) => a.part - b.part);
      next.keyLines = [...fresh.keyLines, ...mine(current.keyLines)];
      next.keyNumbers = [...fresh.keyNumbers, ...mine(current.keyNumbers)];
      break;
    case "ending":
      next.ending = fresh.ending;
      next.endingBeats = [...fresh.endingBeats, ...mine(current.endingBeats)];
      next.finalLine = fresh.finalLine || current.finalLine;
      next.pacing = fresh.pacing;
      break;
    case "rules":
      next.prohibited = [...fresh.prohibited, ...mine(current.prohibited)];
      break;
  }
  return revise(current, next);
}
