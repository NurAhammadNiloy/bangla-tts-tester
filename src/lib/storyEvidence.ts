/**
 * Story evidence: find where a claim is backed in the ORIGINAL story, by plain code.
 *
 * Three layers (in this order):
 *  1. exact quote   – the quoted Bangla text is in the story (ignoring spaces, punctuation,
 *                     Unicode form and digit style). Several "…"-joined pieces are allowed.
 *  2. evidence      – a near quote (most words match one to three story sentences) or sentence
 *                     ids ("S12") the AI cited. Always resolved to REAL story text by code.
 *  3. contradiction – numbers in the claim that the story never says, or a quote whose
 *                     negation is the opposite of the story sentence.
 *
 * Every span is an offset into the exact story string the caller passed, so the UI can
 * highlight it. Nothing here ever writes story text that is not in the story.
 */

export type VerifyStatus = "verified" | "supported" | "unverified" | "contradicted";
export type VerifyMethod = "exact_quote" | "near_quote" | "cited" | "semantic" | "user" | "none";

export interface Span {
  start: number;
  end: number;
  /** Sentence id the span is in, e.g. "S12". */
  sentence: string;
}

export interface Verification {
  status: VerifyStatus;
  method: VerifyMethod;
  evidence: Span[];
  /** Simple English: why this status. */
  reason: string;
  /** What to change, when the checker has a safe suggestion. */
  suggestion?: string;
}

export interface Sentence {
  id: string;
  start: number;
  end: number;
  text: string;
}

export const NO_PASSAGE = "No reliable supporting passage found.";

/* --------------------------------- folding --------------------------------- */

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const ZERO_WIDTH = /[​-‍⁠﻿]/;

/**
 * Fold a string for comparing, keeping a map from each folded char back to its index in the
 * original string. Per-character NFD (so য় / য + ় match), zero-width marks dropped, Bangla
 * digits → ASCII, quotes and dashes unified, whitespace collapsed, lowercase. With `loose`,
 * all punctuation is dropped too (only letters, marks, numbers and single spaces stay).
 */
export function foldMap(v: string, loose = false): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let space = false;
  const push = (ch: string, i: number) => {
    if (ch === " ") {
      if (space || !text.length) return;
      space = true;
    } else space = false;
    text += ch;
    map.push(i);
  };
  for (let i = 0; i < v.length; i++) {
    let ch = v[i];
    // keep surrogate pairs together
    if (ch >= "\uD800" && ch <= "\uDBFF" && i + 1 < v.length) {
      ch = v.slice(i, i + 2);
      const start = i;
      i++;
      for (const c of ch.normalize("NFD").toLowerCase()) push(loose && !/[\p{L}\p{M}\p{N}]/u.test(c) ? " " : c, start);
      continue;
    }
    if (ZERO_WIDTH.test(ch)) continue;
    for (let c of ch.normalize("NFD")) {
      const d = BN_DIGITS.indexOf(c);
      if (d >= 0) c = String(d);
      else if (/\s/.test(c)) c = " ";
      else if (/[“”„‟"«»]/.test(c)) c = '"';
      else if (/[‘’‚‛']/.test(c)) c = "'";
      else if (/[–—―‐]/.test(c)) c = "-";
      else c = c.toLowerCase();
      if (loose && !/[\p{L}\p{M}\p{N} ]/u.test(c)) c = " ";
      push(c, i);
    }
  }
  while (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

export const foldText = (v: string) => foldMap(v).text;
const looseText = (v: string) => foldMap(v, true).text;

/* -------------------------------- sentences -------------------------------- */

const cache = new Map<string, Sentence[]>();

/** Split the story into sentences (on । ? ! and line breaks) with offsets and ids S1, S2, … */
export function splitSentences(story: string): Sentence[] {
  const hit = cache.get(story);
  if (hit) return hit;
  const out: Sentence[] = [];
  const re = /[^।?!\n]+[।?!]*["”’']*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(story))) {
    let start = m.index;
    let end = m.index + m[0].length;
    while (start < end && /\s/.test(story[start])) start++;
    while (end > start && /\s/.test(story[end - 1])) end--;
    const text = story.slice(start, end);
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    out.push({ id: `S${out.length + 1}`, start, end, text });
  }
  if (cache.size > 20) cache.clear();
  cache.set(story, out);
  return out;
}

/** The story as numbered sentences, for prompts: "[S1] …". */
export function numberedStory(story: string): string {
  return splitSentences(story)
    .map((s) => `[${s.id}] ${s.text}`)
    .join("\n");
}

function sentenceAt(story: string, offset: number): Sentence | undefined {
  return splitSentences(story).find((s) => offset >= s.start && offset < s.end);
}

/** Spans for a range of the story, cut at sentence borders. */
function spansFor(story: string, start: number, end: number): Span[] {
  const out: Span[] = [];
  for (const s of splitSentences(story)) {
    const a = Math.max(start, s.start);
    const b = Math.min(end, s.end);
    if (a < b) out.push({ start: a, end: b, sentence: s.id });
  }
  return out;
}

/* ------------------------------ layer 1: quote ------------------------------ */

/** Find `quote` in `story` (loose fold). Returns story offsets, or null. */
export function locate(story: string, quote: string): { start: number; end: number } | null {
  const q = looseText(quote).trim();
  if (!q) return null;
  const f = foldMap(story, true);
  // Whole words only: "ফিরে আসে" must not match inside "ফিরে আসেনি" (that drops a negation).
  let at = -1;
  for (let from = 0; ; ) {
    const i = f.text.indexOf(q, from);
    if (i < 0) break;
    const before = i === 0 || f.text[i - 1] === " ";
    const after = i + q.length === f.text.length || f.text[i + q.length] === " ";
    if (before && after) {
      at = i;
      break;
    }
    from = i + 1;
  }
  if (at < 0) return null;
  const start = f.map[at];
  const end = f.map[at + q.length - 1] + 1;
  return { start, end };
}

/** True when `quote` appears in `story` (spaces, punctuation, digit style ignored). Empty never matches. */
export function inStory(story: string, quote: string): boolean {
  return !!locate(story, quote);
}

/** Exact quote, also when the AI joined several pieces with "…" / "...". */
function exactSpans(story: string, quote: string): Span[] | null {
  const pieces = quote
    .split(/…|\.{3,}/)
    .map((p) => p.trim())
    .filter((p) => looseText(p).length >= 2);
  if (!pieces.length) return null;
  const spans: Span[] = [];
  for (const p of pieces) {
    const r = locate(story, p);
    if (!r) return null;
    spans.push(...spansFor(story, r.start, r.end));
  }
  return spans;
}

/* --------------------------- layer 2: near quote --------------------------- */

const tokens = (v: string) => looseText(v).split(" ").filter((t) => t.length >= 2);
const NEG_WORDS = new Set(["না", "নাই", "নেই", "নয়", "নি", "নাহ"].map((w) => looseText(w)));
const NEG_SUFFIX = looseText("নি");
const isNeg = (t: string) => NEG_WORDS.has(t);

/** Best window of 1–3 sentences that contains most of the quote's words. */
function nearSpans(story: string, quote: string): { spans: Span[]; coverage: number; negationFlip: boolean } | null {
  const q = tokens(quote);
  if (q.length < 3) return null;
  const sents = splitSentences(story);
  let best: { from: number; to: number; coverage: number } | null = null;
  for (let i = 0; i < sents.length; i++) {
    for (let w = 1; w <= 3 && i + w <= sents.length; w++) {
      const set = new Set(tokens(sents.slice(i, i + w).map((s) => s.text).join(" ")));
      // A word that differs only by the -নি negation still lines the quote up with the
      // sentence (so the flip can be caught below), in both directions.
      const hit = q.filter((t) => set.has(t) || set.has(t + NEG_SUFFIX) || (t.endsWith(NEG_SUFFIX) && set.has(t.slice(0, -NEG_SUFFIX.length)))).length;
      const coverage = hit / q.length;
      const better = !best || coverage > best.coverage + 1e-9 || (Math.abs(coverage - best.coverage) < 1e-9 && w < best.to - best.from);
      if (better) best = { from: i, to: i + w, coverage };
    }
  }
  if (!best || best.coverage < 0.8) return null;
  const win = sents.slice(best.from, best.to);
  const wt = tokens(win.map((s) => s.text).join(" "));
  const wset = new Set(wt);
  // Negation flip: the quote says "came" where the story says "did not come", or the other way.
  const qNeg = q.filter((t) => isNeg(t) || (t.endsWith(NEG_SUFFIX) && wset.has(t.slice(0, -NEG_SUFFIX.length)))).length;
  const qset = new Set(q);
  const wNeg = wt.filter((t) => (isNeg(t) && !qset.has(t)) || (t.endsWith(NEG_SUFFIX) && !qset.has(t) && qset.has(t.slice(0, -NEG_SUFFIX.length)))).length;
  const qNegMissing = q.filter((t) => (isNeg(t) && !wset.has(t)) || (t.endsWith(NEG_SUFFIX) && !wset.has(t) && wset.has(t.slice(0, -NEG_SUFFIX.length)))).length;
  const negationFlip = qNegMissing > 0 || (wNeg > 0 && qNeg === 0);
  return { spans: win.map((s) => ({ start: s.start, end: s.end, sentence: s.id })), coverage: best.coverage, negationFlip };
}

/* ------------------------------- numbers ------------------------------- */

const BN_NUM_WORDS: [string, number][] = [
  ["এক", 1], ["দুই", 2], ["দু", 2], ["তিন", 3], ["চার", 4], ["পাঁচ", 5], ["ছয়", 6], ["ছ", 6], ["সাত", 7], ["আট", 8], ["নয়", 9], ["দশ", 10], ["এগারো", 11], ["এগার", 11], ["বারো", 12], ["বার", 12], ["তেরো", 13], ["চৌদ্দ", 14], ["পনেরো", 15], ["পনের", 15], ["ষোলো", 16], ["ষোল", 16], ["সতেরো", 17], ["আঠারো", 18], ["উনিশ", 19], ["বিশ", 20], ["কুড়ি", 20], ["একুশ", 21], ["বাইশ", 22], ["তেইশ", 23], ["চব্বিশ", 24], ["পঁচিশ", 25], ["ছাব্বিশ", 26], ["সাতাশ", 27], ["আটাশ", 28], ["উনত্রিশ", 29], ["তিরিশ", 30], ["ত্রিশ", 30], ["একত্রিশ", 31], ["বত্রিশ", 32], ["তেত্রিশ", 33], ["চৌত্রিশ", 34], ["পঁয়ত্রিশ", 35], ["ছত্রিশ", 36], ["সাঁইত্রিশ", 37], ["আটত্রিশ", 38], ["উনচল্লিশ", 39], ["চল্লিশ", 40], ["একচল্লিশ", 41], ["বিয়াল্লিশ", 42], ["বেয়াল্লিশ", 42], ["তেতাল্লিশ", 43], ["চুয়াল্লিশ", 44], ["পঁয়তাল্লিশ", 45], ["ছেচল্লিশ", 46], ["সাতচল্লিশ", 47], ["আটচল্লিশ", 48], ["উনপঞ্চাশ", 49], ["পঞ্চাশ", 50], ["ষাট", 60], ["সত্তর", 70], ["আশি", 80], ["নব্বই", 90], ["একশো", 100], ["একশ", 100], ["শো", 100],
];
/** Words that are numbers only before a unit (নয় also means "is not"; বার also means "times"). */
const BN_AMBIGUOUS = new Set(["নয়", "নয়", "বার", "এক", "দু", "ছ", "শো"].map(looseText));
const BN_UNITS = new Set(
  ["ইউনিট", "মাস", "মাসে", "বছর", "বছরে", "দিন", "দিনে", "টাকা", "ঘণ্টা", "রাত", "জন", "টা", "টি", "গুণ", "মিনিট", "সপ্তাহ"].map(looseText),
);
const EN_NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const BN_MAP = new Map(BN_NUM_WORDS.map(([k, v]) => [looseText(k), v]));
const COUNT_SUFFIX = ["টা", "টি", "টো", "টার", "টির"].map(looseText);
/** "বিশটা" → 20: a number word with a counting suffix. */
function bnWord(t: string): number | undefined {
  const v = BN_MAP.get(t);
  if (v !== undefined) return v;
  for (const suf of COUNT_SUFFIX) if (t.endsWith(suf) && t.length > suf.length) return BN_MAP.get(t.slice(0, -suf.length));
  return undefined;
}

/** Numbers said in a text: digits (Bangla or ASCII), Bangla number words (before a unit if ambiguous), English number words. */
export function numbersIn(v: string): number[] {
  const out: number[] = [];
  const ts = looseText(v.replace(/(\d),(\d)/g, "$1$2")).split(" ").filter(Boolean);
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const digits = t.match(/\d+/g);
    if (digits) {
      for (const d of digits) out.push(Number(d));
      continue;
    }
    const en = EN_NUM_WORDS[t];
    if (en !== undefined) {
      const next = EN_NUM_WORDS[ts[i + 1] ?? ""];
      if (en >= 20 && next !== undefined && next < 10) {
        out.push(en + next);
        i++;
      } else out.push(en);
      continue;
    }
    const bn = bnWord(t);
    if (bn === undefined) continue;
    const next = ts[i + 1] ?? "";
    if (BN_AMBIGUOUS.has(t) && !BN_UNITS.has(next) && bnWord(next) === undefined) continue;
    // "একশো বিশ" = 120
    const nv = bnWord(next);
    if (bn === 100 && nv !== undefined && nv < 100) {
      out.push(100 + nv);
      i++;
    } else out.push(bn);
  }
  return out;
}

/* ------------------------------ verification ------------------------------ */

export interface ClaimInput {
  text: string;
  /** A Bangla quote the AI says is from the story. */
  source?: string;
  /** Sentence ids the AI cited ("S12"). */
  evidence?: string[];
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end && s.sentence === last.sentence) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Spans for cited sentence ids that really exist. Unknown ids are ignored (never invented). */
export function citedSpans(story: string, ids: string[] | undefined): Span[] {
  if (!ids?.length) return [];
  const byId = new Map(splitSentences(story).map((s) => [s.id.toLowerCase(), s]));
  const out: Span[] = [];
  for (const raw of ids) {
    const id = String(raw).trim().replace(/^\[|\]$/g, "").toLowerCase();
    const s = byId.get(id);
    if (s) out.push({ start: s.start, end: s.end, sentence: s.id });
  }
  return mergeSpans(out);
}

const spanText = (story: string, spans: Span[]) => spans.map((s) => story.slice(s.start, s.end)).join(" ");
const sentenceText = (story: string, spans: Span[]) =>
  [...new Set(spans.map((s) => s.sentence))]
    .map((id) => splitSentences(story).find((x) => x.id === id)?.text ?? "")
    .join(" ");

/**
 * Check one claim against the story. Never throws, never returns text that is not in the story.
 * `verified`  = exact or near quote found (and its numbers agree);
 * `supported` = the AI cited real sentences, but code cannot prove an English paraphrase means them;
 * `unverified`= no real passage found;
 * `contradicted` = the story says something else (a number it never says, or the opposite negation).
 */
export function verifyClaim(story: string, claim: ClaimInput): Verification {
  let spans: Span[] = [];
  let method: VerifyMethod = "none";
  let quoteNote = "";
  if (claim.source?.trim()) {
    const exact = exactSpans(story, claim.source);
    if (exact) {
      spans = exact;
      method = "exact_quote";
    } else {
      const near = nearSpans(story, claim.source);
      if (near?.negationFlip) {
        return {
          status: "contradicted",
          method: "near_quote",
          evidence: near.spans,
          reason: "The quoted words are close to the story, but the story says the opposite (না / নি / নেই differs).",
          suggestion: "Read the story passage and fix the claim.",
        };
      }
      if (near) {
        spans = near.spans;
        method = "near_quote";
        quoteNote = "The AI's quote was slightly different; the real story sentence is shown.";
      } else quoteNote = "The AI's quote is not in the story.";
    }
  }
  const cited = citedSpans(story, claim.evidence);
  if (!spans.length && cited.length) {
    spans = cited;
    method = "cited";
  } else if (spans.length && cited.length) spans = mergeSpans([...spans, ...cited]);
  spans = mergeSpans(spans);

  // Numbers: every number in the claim must be in the evidence (or at least in the story).
  const claimNums = [...new Set(numbersIn(`${claim.text} ${claim.source ?? ""}`))];
  const storyNums = new Set(numbersIn(story));
  const evNums = new Set(numbersIn(sentenceText(story, spans)));
  const notInStory = claimNums.filter((n) => !storyNums.has(n));
  const notInEvidence = claimNums.filter((n) => storyNums.has(n) && !evNums.has(n));
  if (notInStory.length) {
    const has = spans.length && evNums.size;
    return {
      status: has ? "contradicted" : "unverified",
      method,
      evidence: spans,
      reason: has
        ? `The story never says ${notInStory.join(", ")}; this passage says ${[...evNums].join(", ")}.`
        : `The story never says ${notInStory.join(", ")}.`,
      suggestion: has ? `Use the number from the story (${[...evNums].join(", ")}).` : "Remove or fix this number.",
    };
  }
  if (notInEvidence.length) {
    // Add the sentences that do say the missing numbers, so the evidence is complete.
    for (const n of notInEvidence) {
      const s = splitSentences(story).find((x) => numbersIn(x.text).includes(n));
      if (s) spans.push({ start: s.start, end: s.end, sentence: s.id });
    }
    spans = mergeSpans(spans);
  }

  if (!spans.length) return { status: "unverified", method: "none", evidence: [], reason: quoteNote || NO_PASSAGE };
  if (method === "exact_quote" || method === "near_quote") {
    return { status: "verified", method, evidence: spans, reason: quoteNote || "The quoted words are in the story." };
  }
  return {
    status: "supported",
    method,
    evidence: spans,
    reason: `${quoteNote ? `${quoteNote} ` : ""}The AI points to these story sentences; the meaning was not checked word by word.`,
  };
}

/** The story's last sentence, exactly as written (e.g. "এমনি।"). */
export function lastSentence(story: string): Sentence | undefined {
  const s = splitSentences(story);
  return s[s.length - 1];
}

/** Text of each span plus its full sentence, for the Compare panel. */
export function evidenceView(story: string, spans: Span[]): { sentence: string; before: string; match: string; after: string }[] {
  const out: { sentence: string; before: string; match: string; after: string }[] = [];
  for (const sp of mergeSpans(spans)) {
    const s = sentenceAt(story, sp.start) ?? splitSentences(story).find((x) => x.id === sp.sentence);
    if (!s) continue;
    const a = Math.max(s.start, sp.start);
    const b = Math.min(s.end, sp.end);
    out.push({ sentence: s.id, before: story.slice(s.start, a), match: story.slice(a, b), after: story.slice(b, s.end) });
  }
  return out;
}

/** Checks that a span really points into this story (used when loading stored bibles). */
export function spanValid(story: string, sp: Span): boolean {
  return Number.isInteger(sp.start) && Number.isInteger(sp.end) && sp.start >= 0 && sp.end <= story.length && sp.start < sp.end;
}

/** FNV-1a hash (hex) — for "has this changed?" checks, not security. */
export function hashText(v: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Hash of the story's meaning-bearing text (spacing and Unicode form do not count). */
export const storyHash = (story: string) => hashText(foldText(story));

export { spanText };
