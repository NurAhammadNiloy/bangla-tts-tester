/**
 * Final accuracy / security patch: claim support vs quote authenticity (1), user edits vs source
 * evidence (2), hard / soft / human-review plan constraints (3), server-side approval checks (4),
 * stale evidence after edits (5), review labels (6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DirectorReview from "@/components/create/DirectorReview";
import { _resetPlannerCache } from "@/lib/openrouter/askJson";
import { _resetRateLimit } from "@/lib/rateLimit";
import {
  approveSection,
  blockedReasons,
  claimView,
  listClaims,
  loadBible,
  normalizeBible,
  planFreshness,
  bibleHash,
  recheck,
  revise,
  runAccuracyGate,
  SECTIONS,
  type StoryBible,
} from "@/lib/storyBible";
import { confirmClaim, storyHash, verifyClaim } from "@/lib/storyEvidence";
import { validatePlan, repairPlan, SEVERITY_LABEL } from "@/lib/storyValidator";
import type { EpisodePlan, Shot } from "@/lib/puppet/types";
import { AI, STORY } from "./fixtures/khaliBible";

const SYN = "মিজান মালয়েশিয়ায় থাকে। রহিমা বাড়িতে একা থাকেন। ফ্যান চালানো ঘরে কেউ নেই। মিজান নয় বছর ধরে ফেরেনি।";
const gated = () => runAccuracyGate(normalizeBible(AI()), STORY).bible;
const approveAll = (b: StoryBible) => SECTIONS.reduce((x, sec) => approveSection(x, sec), b);

/* ============================ ISSUE 1: quote ≠ meaning ============================ */

describe("Issue 1 — a real quotation does not prove the claim", () => {
  const src = "মিজান মালয়েশিয়ায় থাকে।";
  it("real quote + correct claim → supported, quote exact, never auto-'verified'", () => {
    const v = verifyClaim(SYN, { text: "Mizan lives in Malaysia.", source: src });
    expect(v.status).toBe("supported");
    expect(v.quote).toBe("exact");
    expect(v.support).toBe("likely");
  });
  it("real quote + contradictory claim → contradicted", () => {
    const v = verifyClaim(SYN, { text: "Mizan lives in Dhaka.", source: src });
    expect(v.status).toBe("contradicted");
    expect(v.quote).toBe("exact");
    expect(v.reason).toMatch(/dhaka/i);
  });
  it("real quote + unrelated claim → unverified", () => {
    const v = verifyClaim(SYN, { text: "The fan was running in the room.", source: src });
    expect(v.status).toBe("unverified");
    expect(v.support).toBe("unrelated");
    expect(v.quote).toBe("exact");
  });
  it("real quote + a detail the story never mentions → unverified", () => {
    const v = verifyClaim(SYN, { text: "Mizan lives in Malaysia and keeps a goat.", source: src });
    expect(v.status).toBe("unverified");
    expect(v.support).toBe("absent");
  });
  it("fabricated quote → unverified, flagged fabricated, no evidence invented", () => {
    const v = verifyClaim(SYN, { text: "Mizan lives in Dhaka.", source: "মিজান ঢাকায় থাকে।" });
    expect(v.status).toBe("unverified");
    expect(v.quote).toBe("fabricated");
    expect(v.evidence).toEqual([]);
  });
  it("English paraphrase + supporting Bengali passage: supported by code, verified only after the cross-check confirms it", () => {
    const claim = { text: "Mizan has not come back in nine years", evidence: ["S4"] };
    expect(verifyClaim(SYN, claim).status).toBe("supported");
    const c = confirmClaim(SYN, claim, ["S4"], "It says he has not come back for nine years.");
    expect(c.status).toBe("verified");
    expect(c.support).toBe("confirmed");
    expect(c.method).toBe("semantic");
  });
  it("a model's 'supported' never upgrades a fabricated quote to Verified", () => {
    const c = confirmClaim(SYN, { text: "Mizan lives in Malaysia", source: "মিজান মালয়েশিয়ায় বাস করে।", evidence: ["S1"] }, ["S1"], "same meaning");
    expect(c.quote).toBe("fabricated");
    expect(c.status).toBe("supported");
  });
  it("the cross-check cannot override something code can check (a wrong number stays contradicted)", () => {
    const c = confirmClaim(SYN, { text: "Mizan has been away for 12 years", evidence: ["S4"] }, ["S4"], "model says yes");
    expect(c.status).not.toBe("verified");
  });
  it("Bengali digits and number words are normalized", () => {
    expect(verifyClaim(SYN, { text: "He has not returned for 9 years", evidence: ["S4"] }).status).toBe("supported");
    expect(verifyClaim("সে ৯ বছর ধরে ফেরেনি।", { text: "He has not come back for nine years", evidence: ["S1"] }).status).toBe("supported");
    expect(verifyClaim(SYN, { text: "He has not returned for 7 years", evidence: ["S4"] }).status).toBe("contradicted");
  });
  it("negated and non-negated claims are told apart", () => {
    expect(verifyClaim(SYN, { text: "Mizan did not come back", evidence: ["S4"] }).status).toBe("supported");
    const v = verifyClaim(SYN, { text: "Mizan came back", evidence: ["S4"] });
    expect(v.status).toBe("unverified");
    expect(v.support).toBe("doubtful");
  });
  it("a quote that differs only by negation is contradicted, not 'near'", () => {
    expect(verifyClaim(SYN, { text: "Mizan returned", source: "মিজান নয় বছর ধরে ফিরেছে।" }).status).not.toBe("supported");
  });
});

/* ===================== ISSUE 2: user edits vs source evidence ===================== */

describe("Issue 2 — user authorization is separate from source verification", () => {
  const withUser = (items: Record<string, unknown>[]) => {
    const b = normalizeBible(AI());
    return runAccuracyGate({ ...b, events: [...b.events, ...(items as never[])] }, STORY).bible;
  };
  const find = (b: StoryBible, id: string) => listClaims(b).find((c) => c.ref === id)!;

  it("a user fact the story supports keeps origin=user and gets an honest source status", () => {
    const b = withUser([{ id: "U1", kind: "confirmed", text: "Rahima's house is behind the mosque", by: "user", source: "খালার বাড়ি মসজিদের পেছনে।" }]);
    const c = find(b, "U1");
    expect(c.check?.method).not.toBe("user");
    expect(["supported", "verified"]).toContain(c.check?.status);
    expect(claimView(b, c)).toMatchObject({ origin: "user", sourceStatus: c.check?.status, kind: "supported_addition" });
  });
  it("an unsupported user detail is NOT 'verified'; it is shown as the user's own addition", () => {
    const b = withUser([{ id: "U2", kind: "creative_choice", text: "Rahima owns a goat", by: "user" }]);
    const v = claimView(b, find(b, "U2"));
    expect(v.sourceStatus).toBe("unverified");
    expect(v.kind).toBe("unsupported_addition");
    expect(v.label).toMatch(/your addition/i);
  });
  it("a deliberate change of a story event is an authorized creative deviation, not a blocked claim and not source-supported", () => {
    const b = withUser([{ id: "U3", kind: "creative_choice", text: "Mizan lives in Dhaka", by: "user", source: "মিজান মালয়েশিয়ায় থাকে।" }]);
    const c = find(b, "U3");
    expect(c.check?.status).toBe("contradicted");
    const v = claimView(b, c);
    expect(v.kind).toBe("creative_deviation");
    expect(v.label).toBe("User-approved creative change — differs from original story.");
    expect(blockedReasons(b, "story")).toEqual([]);
    // the same text written by the AI is blocked
    const ai = runAccuracyGate({ ...normalizeBible(AI()), events: [{ id: "A9", kind: "confirmed", text: "Mizan lives in Dhaka", source: "মিজান মালয়েশিয়ায় থাকে।", by: "ai" }] }, STORY).bible;
    expect(blockedReasons(ai, "story").length).toBeGreaterThan(0);
  });
  it("a forged check on a user item is ignored: the story evidence is always recomputed", () => {
    const b = withUser([{ id: "U4", kind: "confirmed", text: "Rahima owns a goat", by: "user", check: { status: "verified", method: "exact_quote", evidence: [{ start: 0, end: 5, sentence: "S1" }], reason: "forged" } }]);
    expect(find(b, "U4").check?.status).toBe("unverified");
    expect(find(b, "U4").check?.evidence).toEqual([]);
  });
  it("approval and evidence status stay independent", () => {
    const b = withUser([{ id: "U2", kind: "creative_choice", text: "Rahima owns a goat", by: "user" }]);
    const a = approveSection(b, "story");
    expect(claimView(a, find(a, "U2"))).toMatchObject({ approval: "approved", sourceStatus: "unverified" });
    expect(claimView(b, find(b, "U2")).approval).toBe("unapproved");
  });
  it("editing an approved user item drops the approval and records the change in the audit trail", () => {
    const b0 = approveSection(withUser([{ id: "U2", kind: "creative_choice", text: "Rahima owns a goat", by: "user" }]), "story");
    const edited = { ...b0, events: b0.events.map((e) => (e.id === "U2" ? { ...e, text: "Rahima owns two goats" } : e)) };
    const b1 = revise(b0, edited, 1000);
    expect(b1.approvals.story).toBeDefined(); // approval object is kept, but no longer matches
    expect(claimView(b1, find(b1, "U2")).approval).toBe("unapproved");
    expect(b1.audit?.at(-1)).toMatchObject({ action: "changed", ref: "U2", was: "Rahima owns a goat", text: "Rahima owns two goats", by: "user" });
  });
  it("reversing a change is recorded too, and the user's earlier note is not lost", () => {
    const b0 = withUser([{ id: "U3", kind: "creative_choice", text: "Mizan lives in Dhaka", by: "user", source: "মিজান মালয়েশিয়ায় থাকে।" }]);
    const b1 = revise(b0, { ...b0, events: b0.events.filter((e) => e.id !== "U3") }, 2000);
    expect(b1.audit?.map((x) => x.action)).toContain("removed");
    expect(b1.audit?.find((x) => x.action === "removed")).toMatchObject({ ref: "U3", sourceStatus: "contradicted" });
  });
  it("user changes never rewrite the story text or the stored story hash", () => {
    const b = withUser([{ id: "U3", kind: "creative_choice", text: "Mizan lives in Dhaka", by: "user" }]);
    expect(b.storyHash).toBe(storyHash(STORY));
  });
});

/* ============== ISSUE 3: hard / soft / human-review constraints ============== */

const shot = (line: string, speaker: string, place: string, actors: string[] = [], extra: Partial<Shot> = {}): Shot => ({
  line,
  speaker,
  place,
  layout: "single",
  actors: actors.map((id, i) => ({ id, x: 0.3 + i * 0.4, action: "idle", face: "neutral" }) as never),
  camera: { shot: "medium", move: "hold" },
  ...extra,
});
const mkPlan = (shots: Shot[], extraCast: EpisodePlan["cast"] = []): EpisodePlan =>
  ({
    version: 2,
    series: "t",
    episode: 1,
    title: "t",
    caption: "",
    mood: "emotional",
    format: "9:16",
    cast: [
      { id: "narrator", name: "মিটার রিডার", asset: "man", look: "man", voice: "narrator" },
      { id: "rahima", name: "রহিমা খালা", asset: "old_woman", look: "old woman", voice: "female_old" },
      { id: "mizan", name: "মিজান", asset: "man", look: "man", voice: "male" },
      ...extraCast,
    ],
    places: [
      { id: "rahima_home", asset: "tin_house", look: "house", time: "day" },
      { id: "locked_room", asset: "room", look: "locked room", time: "night" },
    ],
    shots,
    end: { type: "the_end", text: "" },
  }) as unknown as EpisodePlan;

const bible = () => approveAll(gated());
const ids = (r: ReturnType<typeof validatePlan>, sev: "hard" | "soft" | "review") => r[sev].map((v) => v.id);
const FINAL = "এমনি।";
const goodShots = (withRefs = true): Shot[] => [
  shot("খালার বাড়ি মসজিদের পেছনে।", "narrator", "rahima_home", ["narrator"], { refs: withRefs ? gated().keyMoments.map((m) => m.id) : [] }),
  shot("তালা দেওয়া ঘরে ফ্যান ঘুরছে।", "narrator", "locked_room", [], { props: [{ id: "fan", x: 0.5, state: "on" }] }),
  shot("ঐটা আমার ঘর ভাই", "mizan", "rahima_home", ["narrator"], { screen: { type: "video_call", caller: "মিজান", who: "mizan" } }),
  shot("টাকা আমার যায় না।", "rahima", "rahima_home", ["rahima"]),
  shot(`এমনি ফোন দিলাম। ${FINAL}`, "narrator", "rahima_home", ["narrator"]),
];

describe("Issue 3 — constraint severity and validation report", () => {
  const opts = { partIndex: 0, partText: STORY, isLast: true };

  it("returns structured violations with id, severity, shot ids, facts, evidence, explanation and suggestion", () => {
    const r = validatePlan(mkPlan([...goodShots().slice(0, 1), shot("x", "narrator", "locked_room", ["rahima"]), ...goodShots().slice(2)]), bible(), opts);
    const v = r.hard.find((x) => x.id.startsWith("empty_place"))!;
    expect(v).toBeDefined();
    expect(v.severity).toBe("hard");
    expect(v.shots).toEqual([1]);
    expect(v.facts.length).toBeGreaterThan(0);
    expect(v.message).toMatch(/locked|empty|nobody/i);
    expect(v.suggestion.length).toBeGreaterThan(5);
    expect(Array.isArray(v.evidence)).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("blocks: a person stands inside the locked room while the fan runs", () => {
    const r = validatePlan(mkPlan([shot("ফ্যান ঘুরছে।", "narrator", "locked_room", ["rahima"], { props: [{ id: "fan", x: 0.5, state: "on" }] }), ...goodShots().slice(2)]), bible(), opts);
    expect(ids(r, "hard").some((i) => i.startsWith("empty_place"))).toBe(true);
  });
  it("blocks: Mizan physically returns home / meets Rahima (unauthorized reunion)", () => {
    const r = validatePlan(mkPlan([shot("মা!", "mizan", "rahima_home", ["mizan", "rahima"]), ...goodShots().slice(2)]), bible(), opts);
    expect(ids(r, "hard").some((i) => i.startsWith("never_present"))).toBe(true);
    expect(ids(r, "hard").some((i) => i.startsWith("never_together"))).toBe(true);
  });
  it("blocks: the narrator tells Mizan about the cataracts", () => {
    const told = shot("মিজান, তোমার মায়ের চোখে ছানি পড়েছে।", "narrator", "rahima_home", ["narrator"], { screen: { type: "video_call", caller: "মিজান", who: "mizan" } });
    const r = validatePlan(mkPlan([told, ...goodShots().slice(2)]), bible(), opts);
    expect(ids(r, "hard").some((i) => i.startsWith("never_says"))).toBe(true);
  });
  it("does NOT block narration about the cataracts over a shot that has no Mizan in it", () => {
    const ok = shot("শুধু ছানির কথাটা বললাম না।", "narrator", "rahima_home", ["narrator"], { refs: gated().keyMoments.map((m) => m.id) });
    expect(ids(validatePlan(mkPlan([ok, ...goodShots().slice(2)]), bible(), opts), "hard")).toEqual([]);
  });
  it("blocks: an essential line is given to the wrong speaker", () => {
    const wrong = [...goodShots()];
    wrong[2] = { ...wrong[2], speaker: "rahima" };
    const r = validatePlan(mkPlan(wrong), bible(), opts);
    expect(ids(r, "hard").some((i) => i.startsWith("key_line_speaker"))).toBe(true);
  });
  it("blocks: a verbatim key line is missing from the part", () => {
    const r = validatePlan(mkPlan(goodShots().filter((_, i) => i !== 2)), bible(), opts);
    expect(ids(r, "hard").some((i) => i.startsWith("key_line_missing"))).toBe(true);
  });
  it("blocks: the approved ending is replaced by a generic motivational line", () => {
    const bad = [...goodShots().slice(0, 4), shot("জীবনে ভালোবাসাই সবচেয়ে বড়।", "narrator", "rahima_home", ["narrator"])];
    const r = validatePlan(mkPlan(bad), bible(), opts);
    expect(ids(r, "hard")).toContain("ending_line");
  });
  it("blocks: a person the Story Bible does not know (nothing is deleted silently)", () => {
    const plan = mkPlan([...goodShots().slice(0, 1), shot("এই যে!", "doctor", "rahima_home", ["doctor"]), ...goodShots().slice(1)], [{ id: "doctor", name: "ডাক্তার", asset: "man", look: "doctor", voice: "male" }]);
    const r = validatePlan(plan, bible(), opts);
    expect(ids(r, "hard").some((i) => i.startsWith("unknown_character"))).toBe(true);
    expect(plan.shots.some((s) => s.speaker === "doctor")).toBe(true); // validatePlan never mutates
  });
  it("blocks: a required key scene is not shown (no ref, no matching words)", () => {
    const b = bible();
    const r = validatePlan(mkPlan(goodShots(false)), b, opts);
    expect(ids(r, "hard").some((i) => i.startsWith("key_scene_missing"))).toBe(true);
  });
  it("a key scene counts as shown when a shot references it", () => {
    const b = bible();
    const refs = b.keyMoments.map((m) => m.id);
    const shots = goodShots(false).map((s, i) => ({ ...s, refs: i === 0 ? refs : [] }));
    expect(ids(validatePlan(mkPlan(shots), b, opts), "hard").some((i) => i.startsWith("key_scene_missing"))).toBe(false);
  });

  it("does NOT reject valid off-screen voices, phone calls, memories or a deliberately empty shot", () => {
    const b = bible();
    const refs = b.keyMoments.map((m) => m.id);
    const shots = [
      shot("খালার বাড়ি মসজিদের পেছনে।", "narrator", "rahima_home", ["narrator"], { refs }),
      shot("তালা দেওয়া ঘর।", "narrator", "locked_room", []), // deliberately empty
      shot("ঐটা আমার ঘর ভাই", "mizan", "rahima_home", ["narrator"], { screen: { type: "video_call", caller: "মিজান", who: "mizan" } }), // phone
      shot("তিনি তখন তালপাতার পাখা হাতে।", "narrator", "rahima_home", ["rahima_young"]), // memory, younger cast
      shot("টাকা আমার যায় না।", "rahima", "rahima_home", ["rahima"]),
      shot(`এমনি ফোন দিলাম। ${FINAL}`, "narrator", "rahima_home", ["narrator"]),
    ];
    const plan = mkPlan(shots, [{ id: "rahima_young", name: "তরুণী রহিমা", asset: "woman", look: "young Rahima", voice: "female" }]);
    expect(ids(validatePlan(plan, b, opts), "hard")).toEqual([]);
    // Mizan speaking while not on screen: fine
    expect(validatePlan(plan, b, opts).ok).toBe(true);
  });

  it("soft: repeated camera composition and low variety only warn", () => {
    const b = bible();
    const refs = b.keyMoments.map((m) => m.id);
    const same = (line: string, i = 0) => shot(line, "narrator", "rahima_home", ["narrator"], { refs: i === 0 ? refs : [] });
    const shots = [same("এক।", 0), same("দুই।"), same("তিন।"), same("চার।"), ...goodShots().slice(2)];
    const r = validatePlan(mkPlan(shots), b, opts);
    expect(ids(r, "hard")).toEqual([]);
    expect(ids(r, "soft")).toContain("repeated_camera");
    expect(r.ok).toBe(true); // soft never blocks
  });
  it("human review: tone of key scenes and rules that code cannot check are listed, never blocking", () => {
    const r = validatePlan(mkPlan(goodShots()), bible(), opts);
    expect(r.review.length).toBeGreaterThan(0);
    expect(r.review.every((v) => v.severity === "review")).toBe(true);
    expect(r.review.some((v) => /tone|acting|emotion/i.test(v.message))).toBe(true);
  });
  it("runs again after autoDirect: a person autoDirect puts in an empty place is caught", () => {
    const plan = mkPlan([...goodShots().slice(0, 1), shot("ঘর।", "narrator", "locked_room", ["extra_1"]), ...goodShots().slice(2)], [{ id: "extra_1", name: "পথচারী", asset: "man", look: "extra", voice: "male" }]);
    expect(ids(validatePlan(plan, bible(), opts), "hard").some((i) => i.startsWith("empty_place"))).toBe(true);
  });
  it("repairPlan is explicit, reports every change, and only touches people the bible does not allow", () => {
    const plan = mkPlan([goodShots()[0], shot("ঘর।", "narrator", "locked_room", ["extra_1"]), ...goodShots().slice(2)], [{ id: "extra_1", name: "পথচারী", asset: "man", look: "extra", voice: "male" }]);
    const { plan: fixed, changes } = repairPlan(plan, bible());
    expect(changes.length).toBeGreaterThan(0);
    expect(fixed.shots[1].actors).toEqual([]);
    expect(ids(validatePlan(fixed, bible(), opts), "hard").some((i) => i.startsWith("empty_place"))).toBe(false);
  });
  it("user can authorize a deviation by removing the rule (the audit trail records it)", () => {
    const b0 = bible();
    const rule = b0.prohibited.find((p) => p.rule?.type === "never_present")!;
    const b1 = revise(b0, { ...b0, prohibited: b0.prohibited.filter((p) => p.id !== rule.id) });
    const r = validatePlan(mkPlan([shot("মা!", "mizan", "rahima_home", ["mizan"]), ...goodShots().slice(2)]), approveAll(b1), opts);
    expect(ids(r, "hard").some((i) => i.startsWith("never_present"))).toBe(false);
    expect(b1.audit?.some((a) => a.action === "removed" && a.ref === rule.id)).toBe(true);
  });
});

/* ================= ISSUE 4: server-side approval enforcement ================= */

describe("Issue 4 — /api/episode refuses unbound or inconsistent approvals", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    _resetRateLimit();
    _resetPlannerCache();
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.unstubAllEnvs();
  });
  const req = (body: unknown) =>
    new Request("http://localhost/api/episode", { method: "POST", headers: { "content-type": "application/json", "x-openrouter-key": "sk-or-test-1234567890" }, body: JSON.stringify(body) });
  const base = { text: STORY, story: STORY, genre: "emotional", partIndex: 0, partsTotal: 1, isLast: true, narrator: "male" };
  const post = async (body: unknown) => (await import("@/app/api/episode/route")).POST(req(body));

  it("no Story Bible → 409 bible_required (structured error)", async () => {
    const res = await post(base);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "bible_required", error: expect.any(String) });
  });
  it("bible without the full story → 400 story_required", async () => {
    const res = await post({ ...base, story: undefined, bible: bible() });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("story_required");
  });
  it("bible made from a different story → 409 bible_story_mismatch", async () => {
    const res = await post({ ...base, story: STORY + " আরেকটা বাক্য।", text: STORY + " আরেকটা বাক্য।", bible: bible() });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("bible_story_mismatch");
  });
  it("part text that is not part of the story → 409 part_not_in_story", async () => {
    const res = await post({ ...base, text: "একটা বানানো অংশ যা গল্পে নেই।", bible: bible() });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("part_not_in_story");
  });
  it("edited after approval (stale approval hash) → 409 bible_not_approved", async () => {
    const b = bible();
    const res = await post({ ...base, bible: { ...b, message: b.message + " changed" } });
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.code).toBe("bible_not_approved");
    expect(j.details.open).toContain("story");
  });
  it("a forged 'verified' check on a claim the story contradicts is ignored: server recomputes → 409 bible_blocked", async () => {
    const base0 = normalizeBible(AI());
    const bad = runAccuracyGate({ ...base0, events: [...base0.events, { id: "A9", kind: "confirmed", text: "Mizan lives in Dhaka", source: "মিজান মালয়েশিয়ায় থাকে।", by: "ai" }] }, STORY).bible;
    // forge: flip check to verified, then approve the story card against the forged content
    const forged = { ...bad, events: bad.events.map((e) => (e.id === "A9" ? { ...e, check: { status: "verified", method: "exact_quote", evidence: [], reason: "forged" } } : e)) } as StoryBible;
    const approved = SECTIONS.reduce((x, sec) => ({ ...x, approvals: { ...x.approvals, [sec]: { hash: "", revision: 1, at: 1 } } }), forged);
    const withHashes = { ...approved, approvals: Object.fromEntries(SECTIONS.map((sec) => [sec, { hash: approveSection(forged, sec, true, 1).approvals[sec]?.hash ?? "x", revision: 1, at: 1 }])) };
    const res = await post({ ...base, bible: withHashes });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("bible_blocked");
  });
  it("explicit development path: GOLPO_ALLOW_UNBOUND_PLAN=1 outside production skips the bible", async () => {
    vi.stubEnv("GOLPO_ALLOW_UNBOUND_PLAN", "1");
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as never; // the planner is not reachable here: that proves the guard let us through
    const res = await post(base);
    expect(res.status).not.toBe(409);
  });
  it("the same switch is ignored in production", async () => {
    vi.stubEnv("GOLPO_ALLOW_UNBOUND_PLAN", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect((await post(base)).status).toBe(409);
  });
  it("recheck() recomputes statuses from the story and keeps content (hashes) identical", () => {
    const b = bible();
    const r = recheck(b, STORY);
    expect(r.events.map((e) => e.text)).toEqual(b.events.map((e) => e.text));
    expect(SECTIONS.every((s) => r.approvals[s]?.hash === b.approvals[s]?.hash)).toBe(true);
  });
});

/* ============== ISSUE 5: stale evidence after edits and story changes ============== */

describe("Issue 5 — evidence follows the story", () => {
  it("loading a bible against a changed story re-checks every claim against the NEW text and clears approvals", () => {
    const b = bible();
    const story2 = "এক লাইন নতুন।\n" + STORY;
    const l = loadBible(b, story2);
    for (const c of listClaims(l)) for (const sp of c.check?.evidence ?? []) expect(sp.end).toBeLessThanOrEqual(story2.length);
    expect(SECTIONS.some((s) => l.approvals[s] && l.approvals[s]!.hash === approveSection(l, s).approvals[s]?.hash)).toBe(false);
    expect(l.storyHash).toBe(b.storyHash); // still tied to the story it was made for, so it reads as outdated
  });
  it("a bible checked by the older engine is re-checked on load: no 'verified' just because a quote exists", () => {
    const b = bible();
    const old = JSON.parse(JSON.stringify(b)) as StoryBible;
    for (const e of old.events) if (e.check) e.check = { status: "verified", method: "exact_quote", evidence: e.check.evidence, reason: "old engine" };
    const l = loadBible(old, STORY);
    expect(l.events.filter((e) => e.check?.status === "verified").length).toBe(0);
    expect(l.events.every((e) => e.check?.support !== undefined)).toBe(true);
    expect(SECTIONS.every((s) => l.approvals[s]?.hash === b.approvals[s]?.hash)).toBe(true); // content untouched
  });
  it("planFreshness: plans from an older bible, an older story, or before approvals existed are stale", () => {
    const b = bible();
    const rec = { bibleHash: "x" };
    expect(planFreshness(rec, b, STORY).stale).toBe(true);
    expect(planFreshness({}, b, STORY).stale).toBe(true);
    expect(planFreshness({ bibleHash: bibleHash(b) }, b, STORY).stale).toBe(false);
    expect(planFreshness({ bibleHash: bibleHash(b) }, b, STORY + "x").stale).toBe(true);
  });
  it("regenerating one card keeps the approvals of the others", async () => {
    const { mergeSection } = await import("@/lib/storyBible");
    const b = bible();
    const fresh = { ...b, message: "new message" };
    const m = mergeSection(b, fresh, "story");
    expect(m.approvals.characters?.hash).toBe(b.approvals.characters?.hash);
    expect(m.approvals.story?.hash).not.toBe(approveSection(m, "story").approvals.story?.hash);
  });
});

/* ===================== ISSUE 6: what the review screen says ===================== */

describe("Issue 6 — the review tells the truth", () => {
  const html = (b: StoryBible) =>
    renderToStaticMarkup(
      createElement(DirectorReview, { bible: b, story: STORY, partsTotal: 1, voiceMinutes: 1.5, fast: true, busy: false, onFast: () => {}, onChange: () => {}, onRegenerate: () => {}, onApprove: () => {}, onBack: () => {} }),
    );
  it("labels user-approved creative changes and does not call unsupported user text verified", () => {
    const b0 = normalizeBible(AI());
    const b = runAccuracyGate({ ...b0, events: [...b0.events, { id: "U3", kind: "creative_choice", text: "Mizan lives in Dhaka", by: "user", source: "" } as never, { id: "U2", kind: "creative_choice", text: "Rahima owns a goat", by: "user" } as never] }, STORY).bible;
    const h = html(b);
    expect(h).toMatch(/Your addition/);
    expect(h).not.toMatch(/Written by you; trusted/);
  });
  it("uses plain words for the three severities", () => {
    expect(SEVERITY_LABEL).toEqual({ hard: "Blocking", soft: "Warning", review: "Check by eye" });
  });
});

