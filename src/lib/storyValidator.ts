/**
 * Does a shot plan keep the approved Story Bible? Pure code, no AI, no network.
 *
 * Three kinds of constraint, so nothing is hidden and nothing is overstated:
 *  hard   – breaks something the author fixed (empty room not empty, a secret told, a forbidden
 *           return, a line given to the wrong person, a missing key line / scene / ending line, a
 *           person the bible does not know). A plan with a hard violation does not go to the paid
 *           steps until it is fixed or the author changes the rule (and that change is on the record).
 *  soft   – weaker pictures (same camera over and over, numbers not spoken). Warnings only.
 *  review – only a person can judge (does the acting carry the tone?). Listed, never blocking.
 *
 * validatePlan never changes the plan. repairPlan is a separate, explicit action that reports
 * every change it makes.
 */
import { EMPTY_WHO, emptyPlaceIds, matchCharacter, type BibleCharacter, type BibleMoment, type RuleSpec, type StoryBible } from "@/lib/storyBible";
import { foldText, inStory, numbersIn, type Span } from "@/lib/storyEvidence";
import type { CastMember, EpisodePlan, Shot } from "@/lib/puppet/types";

export type Severity = "hard" | "soft" | "review";
export const SEVERITY_LABEL: Record<Severity, string> = { hard: "Blocking", soft: "Warning", review: "Check by eye" };

export interface Violation {
  /** Constraint id, e.g. "empty_place:locked_room", "key_line_missing:L2". */
  id: string;
  severity: Severity;
  /** 0-based shot indexes (empty when the problem is a missing shot). */
  shots: number[];
  /** Story Bible facts behind the rule (ids such as "P:locked_room", "X2", "K3"). */
  facts: string[];
  /** The author's own words / story passages the rule rests on. */
  evidence: Span[];
  /** Simple English: what is wrong. */
  message: string;
  /** What to do. */
  suggestion: string;
}

export interface ValidationReport {
  /** true when there is no hard violation. */
  ok: boolean;
  hard: Violation[];
  soft: Violation[];
  review: Violation[];
}

export interface ValidateOptions {
  partIndex?: number;
  /** The Bangla text of the part being planned. Needed for key lines and key scenes. */
  partText?: string;
  /** Is this the last part of the story (the ending line must close it)? */
  isLast?: boolean;
}

const slug = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
const narratorLike = (c: Pick<CastMember, "id" | "name" | "voice">) => c.voice === "narrator" && /narrator|storyteller|আমি/i.test(`${c.id} ${c.name}`);
const isNarratorChar = (c: BibleCharacter) => c.mentions.some((m) => /^আমি$/.test(m.trim())) || /narrator|storyteller/i.test(c.id);

interface CastInfo {
  /** cast id → bible character id */
  toBible: Map<string, string>;
  /** cast ids the bible does not know (not narrator, not background extras) */
  unknown: string[];
  narratorBible: Set<string>;
}

function castInfo(plan: EpisodePlan, b: StoryBible): CastInfo {
  const toBible = new Map<string, string>();
  const unknown: string[] = [];
  const narratorBible = new Set<string>(b.characters.filter(isNarratorChar).map((c) => c.id));
  narratorBible.add("narrator");
  for (const c of plan.cast) {
    if (narratorLike(c)) {
      toBible.set(c.id, b.characters.find(isNarratorChar)?.id ?? "narrator");
      continue;
    }
    if (c.id.startsWith("extra_")) continue; // background extras never speak and are not story people
    const m = matchCharacter(c, b);
    if (m) toBible.set(c.id, m.id);
    else unknown.push(c.id);
  }
  return { toBible, unknown, narratorBible };
}

/** People physically drawn in the shot (not voices, not people inside a phone screen). */
function physical(sh: Shot): { id: string; place?: string }[] {
  const out: { id: string; place?: string }[] = [];
  for (const a of sh.actors ?? []) out.push({ id: a.id, place: sh.place });
  for (const a of sh.top?.actors ?? []) out.push({ id: a.id, place: sh.top!.place });
  for (const a of sh.bottom?.actors ?? []) out.push({ id: a.id, place: sh.bottom!.place });
  return out;
}

const shotPlaces = (sh: Shot): string[] => (sh.layout === "split" ? [sh.top?.place, sh.bottom?.place] : [sh.place]).filter((x): x is string => !!x);

const usable = (x: { check?: { status: string }; by?: string }) => x.check?.status !== "contradicted" || x.by === "user";

const spansOf = (...xs: ({ check?: { evidence: Span[] } } | undefined)[]): Span[] => xs.flatMap((x) => x?.check?.evidence ?? []);

export function validatePlan(plan: EpisodePlan, b: StoryBible, opts: ValidateOptions = {}): ValidationReport {
  const hard: Violation[] = [];
  const soft: Violation[] = [];
  const review: Violation[] = [];
  const add = (list: Violation[], sev: Severity, v: Omit<Violation, "severity">) => list.push({ ...v, severity: sev });
  const info = castInfo(plan, b);
  const who = (castId: string) => info.toBible.get(castId) ?? castId;
  const name = (id: string) => b.characters.find((c) => c.id === id)?.name ?? id;
  const moments = b.keyMoments.filter((m) => m.part === (opts.partIndex ?? 0));
  const refsOf = (sh: Shot) => new Set(sh.refs ?? []);
  /** A shot that lists an approved key scene showing this person is allowed to draw them. */
  const authorizedBy = (sh: Shot, id: string): BibleMoment | undefined => moments.find((m) => refsOf(sh).has(m.id) && m.visible.includes(id) && usable(m));

  // --- hard: people the Story Bible does not know -------------------------------------------
  for (const id of info.unknown) {
    const at = plan.shots.flatMap((s, i) => (s.speaker === id || physical(s).some((p) => p.id === id) ? [i] : []));
    add(hard, "hard", {
      id: `unknown_character:${id}`,
      shots: at,
      facts: [],
      evidence: [],
      message: `“${plan.cast.find((c) => c.id === id)?.name ?? id}” is not a person in the approved Story Bible.`,
      suggestion: "Plan the shots again, or add this person to the Characters card (with the story passage that names them) and approve it.",
    });
  }

  // --- hard: empty places stay empty ----------------------------------------------------------
  const empty = emptyPlaceIds(plan, b);
  const emptyBible = b.places.filter((p) => EMPTY_WHO.test(p.who.trim()));
  for (const placeId of empty) {
    const at: number[] = [];
    plan.shots.forEach((sh, i) => {
      if (physical(sh).some((p) => p.place === placeId)) at.push(i);
    });
    if (!at.length) continue;
    const bp = emptyBible.find((p) => [p.id, p.name].map(slug).some((k) => k.length >= 3 && [placeId, plan.places.find((x) => x.id === placeId)?.asset ?? ""].map(slug).some((i) => i === k || i.includes(k) || k.includes(i))));
    add(hard, "hard", {
      id: `empty_place:${placeId}`,
      shots: at,
      facts: bp ? [`P:${bp.id}`] : [],
      evidence: spansOf(bp),
      message: `Nobody is in “${bp?.name ?? placeId}” in the story, but ${at.length} shot${at.length > 1 ? "s draw" : " draws"} someone there.`,
      suggestion: "Show the place empty (the fan, the bed, the calendar), or show the person somewhere else.",
    });
  }

  // --- hard: story-specific, machine-checkable rules ---------------------------------------------
  for (const f of b.prohibited) {
    const r: RuleSpec | undefined = f.rule;
    if (!r) continue;
    const base = { facts: [f.id], evidence: spansOf(f) };
    if (r.type === "never_present") {
      const at = plan.shots.flatMap((sh, i) => (physical(sh).some((p) => who(p.id) === r.who && (!r.place || slug(p.place ?? "") === slug(r.place))) && !authorizedBy(sh, r.who) ? [i] : []));
      if (at.length)
        add(hard, "hard", { ...base, id: `never_present:${f.id}`, shots: at, message: `${name(r.who)} appears on screen, but the approved rule says: “${f.text}”.`, suggestion: "Show only a voice or a phone screen, or change the rule yourself if this is a deliberate creative change." });
    } else if (r.type === "never_together") {
      const at = plan.shots.flatMap((sh, i) => {
        const ids = new Set(physical(sh).map((p) => who(p.id)));
        return ids.has(r.who) && ids.has(r.other) ? [i] : [];
      });
      if (at.length)
        add(hard, "hard", { ...base, id: `never_together:${f.id}`, shots: at, message: `${name(r.who)} and ${name(r.other)} are in the same shot, but the approved rule says: “${f.text}”.`, suggestion: "Separate them (split screen, phone call, or two shots), or change the rule yourself if this is deliberate." });
    } else if (r.type === "never_says") {
      const terms = r.terms.map(foldText).filter(Boolean);
      const at = plan.shots.flatMap((sh, i) => {
        const line = foldText(sh.line);
        if (!terms.some((t) => line.includes(t))) return [];
        const parties = new Set<string>(physical(sh).map((p) => who(p.id)));
        if (sh.speaker !== "narrator") parties.add(who(sh.speaker));
        const scr = sh.screen;
        if (scr && "who" in scr && typeof scr.who === "string") parties.add(who(scr.who));
        if (scr && "who" in scr && Array.isArray(scr.who)) for (const w of scr.who) parties.add(who(w));
        if (scr && "caller" in scr) {
          const m = matchCharacter({ id: slug(scr.caller), name: scr.caller }, b);
          if (m) parties.add(m.id);
        }
        return r.whenPresent.some((p) => parties.has(p)) ? [i] : [];
      });
      if (at.length)
        add(hard, "hard", { ...base, id: `never_says:${f.id}`, shots: at, message: `A line says what must never be said to ${r.whenPresent.map(name).join(" / ")}: “${f.text}”.`, suggestion: "Rewrite that line so it does not say it, or move it to narration over a shot without that person." });
    }
  }

  // --- part-level checks (need the part's text) -----------------------------------------------
  const lastIdx = plan.shots.length - 1;
  if (opts.partText !== undefined) {
    const part = opts.partText;
    const allLines = plan.shots.map((x) => x.line).join(" ");
    const strip = (v: string) => v.replace(/\[[^\]]*\]/g, "").trim();
    for (const l of b.keyLines) {
      if (!inStory(part, l.text)) continue;
      const lf = foldText(l.text).length;
      const idx = plan.shots.findIndex((x) => inStory(x.line, l.text) || (foldText(strip(x.line)).length >= lf * 0.6 && inStory(l.text, strip(x.line))));
      const base = { facts: [l.id], evidence: spansOf(l) };
      if (idx < 0) {
        add(hard, "hard", { ...base, id: `key_line_missing:${l.id}`, shots: [], message: `The key line “${l.text}” (${name(slug(l.speaker))}) is not spoken anywhere in this part.`, suggestion: "Add the line back exactly as the story writes it." });
        continue;
      }
      const sh = plan.shots[idx];
      const spokenBy = sh.speaker === "narrator" ? "narrator" : who(sh.speaker);
      const want = slug(l.speaker);
      const bothNarrator = info.narratorBible.has(want) && (spokenBy === "narrator" || info.narratorBible.has(spokenBy));
      if (spokenBy !== want && !bothNarrator)
        add(hard, "hard", { ...base, id: `key_line_speaker:${l.id}`, shots: [idx], message: `The key line “${l.text}” belongs to ${name(want)}, but shot ${idx + 1} gives it to ${spokenBy === "narrator" ? "the narrator" : name(spokenBy)}.`, suggestion: `Give this line to ${name(want)}.` });
    }
    for (const m of moments.filter(usable)) {
      const shown = plan.shots.some((x) => refsOf(x).has(m.id)) || (!!m.source && inStory(allLines, m.source));
      if (!shown)
        add(hard, "hard", { id: `key_scene_missing:${m.id}`, shots: [], facts: [m.id], evidence: spansOf(m), message: `Key scene ${m.id} is not shown: “${m.text}”.`, suggestion: "Plan the shots again, and make one shot list this scene in `refs`." });
    }
    const spokenNums = new Set(numbersIn(allLines));
    b.keyNumbers.forEach((n, i) => {
      if (!inStory(part, n.value)) return;
      const want = numbersIn(n.value);
      if (!(want.length && want.every((x) => spokenNums.has(x))) && !foldText(allLines).includes(foldText(n.value)))
        add(soft, "soft", { id: `number_missing:${i}`, shots: [], facts: [], evidence: spansOf(n), message: `The number “${n.value}” (${n.meaning}) is in this part but nobody says it.`, suggestion: "Say it in a line or write it in a prop (notebook, bill)." });
    });
    for (const m of moments.filter((x) => x.tone)) {
      const at = plan.shots.flatMap((x, i) => (refsOf(x).has(m.id) ? [i] : []));
      add(review, "review", { id: `review_tone:${m.id}`, shots: at, facts: [m.id], evidence: spansOf(m), message: `Check by eye that the acting and camera carry the tone “${m.tone}” in: ${m.text}.`, suggestion: "Watch the preview of this shot." });
    }
  }
  if (opts.isLast && b.finalLine && lastIdx >= 0) {
    const tail = plan.shots.slice(-2);
    if (!tail.some((x) => inStory(x.line, b.finalLine)))
      add(hard, "hard", { id: "ending_line", shots: [lastIdx], facts: ["finalLine"], evidence: [], message: `The story ends with “${b.finalLine}”, but the last shots do not say it.`, suggestion: "End on the story's own last line." });
  }

  // --- soft ---------------------------------------------------------------------------------
  const sig = (x: Shot) => `${x.camera.shot}|${x.camera.move}|${shotPlaces(x).join("+")}|${x.layout ?? "single"}`;
  let run = 0;
  for (let i = 0; i < plan.shots.length; i++) {
    run = i > 0 && sig(plan.shots[i]) === sig(plan.shots[i - 1]) ? run + 1 : 1;
    if (run === 4) add(soft, "soft", { id: "repeated_camera", shots: [i - 3, i - 2, i - 1, i], facts: [], evidence: [], message: `Shots ${i - 2}–${i + 1} use the same picture and camera.`, suggestion: "Change the camera size or what we look at." });
  }
  if (plan.shots.length >= 8 && new Set(plan.shots.map((x) => x.camera.shot)).size <= 2)
    add(soft, "soft", { id: "low_variety", shots: [], facts: [], evidence: [], message: "Almost every shot has the same camera size.", suggestion: "Mix close-ups, medium and wide shots." });
  const known = new Set([...b.events.map((e) => e.id), ...b.keyMoments.map((m) => m.id)]);
  const bad = plan.shots.flatMap((x, i) => ((x.refs ?? []).some((r) => !known.has(r)) ? [i] : []));
  if (bad.length) add(soft, "soft", { id: "unknown_ref", shots: bad, facts: [], evidence: [], message: "Some shots point to events that are not in the Story Bible.", suggestion: "Ignore, or plan again." });

  // --- review: author rules code cannot check ---------------------------------------------------
  for (const f of b.prohibited.filter((x) => x.by !== "system" && !x.rule))
    add(review, "review", { id: `review_rule:${f.id}`, shots: [], facts: [f.id], evidence: spansOf(f), message: `Code cannot check this rule; please check by eye: “${f.text}”.`, suggestion: "Watch the preview before the paid steps." });

  return { ok: hard.length === 0, hard, soft, review };
}

export interface RepairResult {
  plan: EpisodePlan;
  /** One simple-English line per change. Nothing is changed without a line here. */
  changes: string[];
}

/**
 * Explicit repair, only when the user asks for it: removes people the bible does not know (their
 * lines go to the narrator), empties places the bible says are empty, and drops unknown refs.
 * Never touches key lines, key scenes or the ending.
 */
export function repairPlan(plan: EpisodePlan, b: StoryBible): RepairResult {
  const changes: string[] = [];
  const info = castInfo(plan, b);
  const gone = new Set(info.unknown);
  const empty = emptyPlaceIds(plan, b);
  const known = new Set([...b.events.map((e) => e.id), ...b.keyMoments.map((m) => m.id)]);
  const clean = <T extends { id: string }>(a: T[] | undefined, place: string | undefined, i: number) =>
    a?.filter((x) => {
      if (gone.has(x.id)) {
        changes.push(`Shot ${i + 1}: removed “${x.id}” (not in the Story Bible).`);
        return false;
      }
      if (place && empty.has(place)) {
        changes.push(`Shot ${i + 1}: removed “${x.id}” from an empty place.`);
        return false;
      }
      return true;
    });
  const shots = plan.shots.map((sh, i): Shot => {
    const next: Shot = { ...sh };
    if (gone.has(sh.speaker)) {
      next.speaker = "narrator";
      changes.push(`Shot ${i + 1}: the line of “${sh.speaker}” now goes to the narrator.`);
    }
    if (sh.actors) next.actors = clean(sh.actors, sh.place, i);
    if (sh.top) next.top = { ...sh.top, actors: clean(sh.top.actors, sh.top.place, i) ?? [] };
    if (sh.bottom) next.bottom = { ...sh.bottom, actors: clean(sh.bottom.actors, sh.bottom.place, i) ?? [] };
    if (sh.camera.focus && gone.has(sh.camera.focus)) next.camera = { ...sh.camera, focus: undefined };
    if (sh.refs?.some((r) => !known.has(r))) {
      const kept = sh.refs.filter((r) => known.has(r));
      if (kept.length) next.refs = kept;
      else delete next.refs;
      changes.push(`Shot ${i + 1}: dropped references to events that are not in the Story Bible.`);
    }
    return next;
  });
  return { plan: { ...plan, cast: plan.cast.filter((c) => !gone.has(c.id)), shots }, changes };
}

/** One-line summary for screens and API errors. */
export function reportLine(r: ValidationReport): string {
  if (!r.hard.length && !r.soft.length) return "The plan keeps the approved Story Bible.";
  const parts: string[] = [];
  if (r.hard.length) parts.push(`${r.hard.length} blocking problem${r.hard.length > 1 ? "s" : ""}`);
  if (r.soft.length) parts.push(`${r.soft.length} warning${r.soft.length > 1 ? "s" : ""}`);
  return `${parts.join(" · ")}.`;
}

/** Union of two reports (e.g. after planning and after autoDirect); the same rule is listed once. */
export function mergeReports(a: ValidationReport | null, b: ValidationReport | null): ValidationReport | null {
  if (!a || !b) return a ?? b;
  const m = (x: Violation[], y: Violation[]) => [...x, ...y.filter((v) => !x.some((u) => u.id === v.id))];
  const hard = m(a.hard, b.hard);
  return { ok: hard.length === 0, hard, soft: m(a.soft, b.soft), review: m(a.review, b.review) };
}
