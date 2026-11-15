/**
 * Regression tests for the Director's Review problems found on "খালি ঘরের ফ্যান" (Nov 15).
 * The story fixture is the author's original text. The AI answers below imitate what the model
 * really sends: English claims, sentence ids, and Bangla quotes that are trimmed, joined or
 * slightly re-spelt.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as biblePost } from "@/app/api/bible/route";
import DirectorReview from "@/components/create/DirectorReview";
import { _resetPlannerCache } from "@/lib/openrouter/askJson";
import { _resetRateLimit } from "@/lib/rateLimit";
import {
  applyHardRules,
  applySemantic,
  approveSection,
  bibleHash,
  bibleReady,
  bibleToPrompt,
  cardState,
  claimsToVerify,
  enforceBible,
  isApproved,
  listClaims,
  mergeSection,
  normalizeBible,
  revise,
  runAccuracyGate,
  SECTIONS,
  summarize,
  summaryLine,
  VERIFY_SCHEMA,
  type StoryBible,
} from "@/lib/storyBible";
import {
  evidenceView,
  lastSentence,
  locate,
  NO_PASSAGE,
  numbersIn,
  splitSentences,
  storyHash,
  verifyClaim,
} from "@/lib/storyEvidence";
import type { EpisodePlan } from "@/lib/puppet/types";
import { FAKE_KEY, mockFetch } from "./helpers";
import { strictProblems } from "./strictSchema";

import { AI, S, STORY } from "./fixtures/khaliBible";

const gated = () => runAccuracyGate(normalizeBible(AI()), STORY).bible;
const approveAll = (b: StoryBible) => SECTIONS.reduce((x, sec) => approveSection(x, sec), b);

/* ------------------------------ evidence layer ------------------------------ */

describe("Bengali source verification", () => {
  it("finds quotes despite spacing, punctuation, য় spelling and digit style, with exact offsets", () => {
    const r = locate(STORY, "চলতি   মাসের বিল 186 টাকা")!;
    expect(STORY.slice(r.start, r.end)).toBe("চলতি মাসের বিল ১৮৬ টাকা");
    // composed য় (U+09DF) in the quote, decomposed য + ় in the story
    expect(locate(STORY, "মালয়েশিয়ায় থাকে")).not.toBeNull();
    expect(locate(STORY, "")).toBeNull();
  });
  it("every evidence span slices back to real story text", () => {
    for (const c of listClaims(gated())) {
      for (const sp of c.check?.evidence ?? []) {
        const sent = splitSentences(STORY).find((x) => x.id === sp.sentence)!;
        expect(sp.start).toBeGreaterThanOrEqual(sent.start);
        expect(sp.end).toBeLessThanOrEqual(sent.end);
        expect(STORY.slice(sp.start, sp.end).length).toBeGreaterThan(0);
      }
    }
  });
  it("highlights the matching words inside their full sentence", () => {
    const v = verifyClaim(STORY, { text: "16 units", source: "ষোলো ইউনিট" });
    const [p] = evidenceView(STORY, v.evidence);
    expect(p.match).toBe("ষোলো ইউনিট");
    expect(`${p.before}${p.match}${p.after}`).toBe(splitSentences(STORY).find((x) => x.id === p.sentence)!.text);
  });
  it("the last sentence is the story's own final word", () => {
    expect(lastSentence(STORY)?.text).toBe("এমনি।");
  });
});

describe("numbers", () => {
  it("reads Bangla digits, Bangla number words and English number words", () => {
    expect(numbersIn("মাসে উঠেছে নয় ইউনিট")).toEqual([9]);
    expect(numbersIn("উঠল একচল্লিশ ইউনিট")).toEqual([41]);
    expect(numbersIn("ষোলো ইউনিট")).toEqual([16]);
    expect(numbersIn("বিল ১৮৬ টাকা")).toEqual([186]);
    expect(numbersIn("দিনে একশো বিশটা মিটার")).toEqual([120]);
    expect(numbersIn("after four months, 41 units")).toEqual([4, 41]);
    expect(numbersIn("thirty six")).toEqual([36]);
  });
  it("does not read নয় ('is not') as nine", () => {
    expect(numbersIn("এটা ঠিক নয়")).toEqual([]);
  });
  it("a number the story never says contradicts the cited passage", () => {
    const v = verifyClaim(STORY, { text: "The next month it is 14 units", evidence: [S("ষোলো ইউনিট")] });
    expect(v.status).toBe("contradicted");
    expect(v.reason).toMatch(/never says 14/);
    expect(v.suggestion).toMatch(/16/);
  });
});

describe("paraphrase, negation and missing evidence", () => {
  it("an English paraphrase with real sentence ids is supported, not 'maybe'", () => {
    const v = verifyClaim(STORY, { text: "Mizan recognizes the locked room as his former bedroom", evidence: [S("ঐটা আমার ঘর, ভাই")] });
    expect(v.status).toBe("supported");
    expect(STORY.slice(v.evidence[0].start, v.evidence[0].end)).toMatch(/ঐটা আমার ঘর/);
  });
  it("a quote that drops the negation is contradicted", () => {
    const v = verifyClaim(STORY, { text: "Mizan calls her", source: "তিন বছর দেয়" });
    expect(["contradicted", "verified"]).toContain(v.status); // a 3-word fragment is a real substring…
    const flip = verifyClaim(STORY, { text: "x", source: "ও আপনারে ফোন দেয়? তিন বছর দেয় খালা" });
    expect(flip.status).toBe("contradicted"); // …but the sentence-level quote without না/নাই is not
  });
  it("no source and no real ids: unverified with the honest message; invented ids are ignored", () => {
    expect(verifyClaim(STORY, { text: "Rahima has a daughter" })).toMatchObject({ status: "unverified", reason: NO_PASSAGE, evidence: [] });
    expect(verifyClaim(STORY, { text: "Rahima has a daughter", evidence: ["S9999", "banana"] }).status).toBe("unverified");
  });
});

/* -------------------------------- the gate -------------------------------- */

describe("খালি ঘরের ফ্যান — the eight reported claims", () => {
  const b = gated();
  it("none of the true events is unverified or contradicted", () => {
    for (const e of b.events) expect(["verified", "supported"], e.text).toContain(e.check?.status);
  });
  it("quoted ones are verified with the story's real words", () => {
    const by = (t: string) => b.events.find((e) => e.text.includes(t))!.check!;
    expect(by("9 units")).toMatchObject({ status: "verified" });
    expect(by("41 units")).toMatchObject({ status: "verified" }); // AI wrote উঠলো, story has উঠল
    expect(by("16 units").status).toBe("verified");
    expect(by("186 taka").status).toBe("verified");
    expect(by("four months").status).toBe("verified"); // two pieces joined by "..."
  });
  it("the report says how many need checking, never 'fixed'", () => {
    const r = summarize(b);
    expect(r.contradicted).toBe(0);
    expect(summaryLine(r)).not.toMatch(/fixed \d+ things/);
    expect(r.findings.every((f) => !f.claim.endsWith("…"))).toBe(true);
  });
});

describe("Story Bible content", () => {
  const b = gated();
  it("keeps exact identities and relations", () => {
    expect(b.characters.map((c) => c.id)).toEqual(["rahima", "mizan", "narrator", "hamida"]);
    expect(b.relations.map((r) => [r.from, r.relation, r.to])).toContainEqual(["rahima", "mother of", "mizan"]);
    expect(b.relations.map((r) => [r.from, r.relation, r.to])).toContainEqual(["hamida", "mother of", "narrator"]);
    expect(b.relations.every((r) => r.check?.status === "verified" || r.check?.status === "supported")).toBe(true);
  });
  it("places keep their kind: the locked room is a room of Rahima's home", () => {
    const room = b.places.find((p) => p.id === "locked_room")!;
    expect(room).toMatchObject({ kind: "room", partOf: "rahima_home", who: "nobody" });
  });
  it("key scenes are not capped and keep their fields", () => {
    expect(b.keyMoments.length).toBe(10);
    expect(b.keyMoments[1]).toMatchObject({ visible: [], restrictions: ["nobody inside the room"] });
    expect(b.keyMoments.every((m) => m.check?.status !== "unverified")).toBe(true);
  });
  it("key lines are fixed to the story's exact words and that is reported as a correction", () => {
    const l = b.keyLines.find((x) => x.speaker === "mizan")!;
    expect(l.text).toMatch(/ঐটা আমার ঘর, ভাই/);
    expect(b.corrections.some((c) => c.section === "scenes")).toBe(true);
  });
  it("numbers written in words are kept and located", () => {
    expect(b.keyNumbers.map((n) => n.value)).toEqual(["নয় ইউনিট", "একচল্লিশ", "ষোলো", "১৮৬", "ছয় ইউনিট"]);
    expect(b.keyNumbers.every((n) => n.check?.status === "verified")).toBe(true);
  });
  it("the final line is always the story's own, 'এমনি।'", () => {
    expect(b.finalLine).toBe("এমনি।");
  });
  it("adds the baseline cannot-change rules from the bible's own data", () => {
    const rules = b.prohibited.map((p) => p.text).join("\n");
    expect(rules).toMatch(/Never add a person/);
    expect(rules).toMatch(/রহিমা খালা is mother of মিজান/);
    expect(rules).toMatch(/হামিদা খাতুন is mother of মিটার রিডার/);
    expect(rules).toMatch(/নয় ইউনিট, একচল্লিশ, ষোলো, ১৮৬, ছয় ইউনিট/);
    expect(rules).toMatch(/inside The locked east room/);
    expect(rules).toMatch(/coming home/);
    expect(rules).toMatch(/“এমনি।”/);
    expect(rules).toMatch(/cataracts/); // story-specific rule from the model is kept
    expect(b.prohibited.filter((p) => p.by === "system").length).toBeGreaterThanOrEqual(7);
  });
  it("the shot planner gets ids, scenes, ending beats and the final line", () => {
    const p = bibleToPrompt(b, 0);
    expect(p).toMatch(/K2\. The fan spins in the locked, empty room \| on screen: nobody/);
    expect(p).toMatch(/Final line \(exactly\): “এমনি।”/);
    expect(p).toMatch(/Off-screen voices are fine/);
  });
});

/* --------------------------- semantic cross-check --------------------------- */

describe("semantic cross-check", () => {
  it("the schema is strict-mode safe and only unproven claims are sent", () => {
    expect(strictProblems(VERIFY_SCHEMA)).toEqual([]);
    const todo = claimsToVerify(gated());
    expect(todo.length).toBeGreaterThan(0);
    expect(todo.some((c) => c.check?.method === "exact_quote")).toBe(true); // quotes are cross-checked too
    expect(todo.every((c) => c.label !== "Exact line" && c.label !== "Number")).toBe(true);
  });
  it("supported + real ids → verified; fake ids change nothing; wrong numbers stay contradicted; 'two houses' is contradicted", () => {
    const b0 = normalizeBible({ ...AI(), places: [{ ...AI().places[0], description: "Two separate tin houses", source: "", evidence: [S("টিনের দুটো ঘর")] }] });
    const b = runAccuracyGate(b0, STORY).bible;
    const fan = b.events.find((e) => e.text.includes("ceiling fan"))!;
    const call = b.events.find((e) => e.text.includes("simply to talk"))!;
    const out = applySemantic(b, STORY, {
      results: [
        { ref: fan.id, verdict: "supported", sentences: [S("তালা দিয়াই চালাই")], reason: "She says she runs it through the locked door." },
        { ref: call.id, verdict: "supported", sentences: ["S9999"], reason: "made up" },
        { ref: "P:rahima_home", verdict: "contradicted", sentences: [S("টিনের দুটো ঘর")], reason: "The story says two rooms, not two houses." },
      ],
    });
    expect(out.events.find((e) => e.id === fan.id)!.check).toMatchObject({ status: "verified", method: "semantic" });
    expect(out.events.find((e) => e.id === call.id)!.check!.method).toBe("cited"); // unchanged
    expect(out.places[0].check?.status).toBe("contradicted");
    expect(cardState(out, "characters")).toBe("blocked");
    expect(approveSection(out, "characters")).toBe(out); // cannot approve a blocked card
  });
});

/* ------------------------- persistence and approvals ------------------------- */

describe("persistence, revisions and approvals", () => {
  it("a stored bible keeps checks, approvals, revision and story hash", () => {
    const b = approveAll(gated());
    const back = normalizeBible(JSON.parse(JSON.stringify(b)));
    expect(back.storyHash).toBe(storyHash(STORY));
    expect(back.events[0].check?.status).toBe("verified");
    expect(SECTIONS.every((s) => isApproved(back, s))).toBe(true);
    expect(bibleHash(back)).toBe(bibleHash(b));
  });
  it("an old v1 bible still loads", () => {
    const v1 = { version: 1, message: "m", characters: [{ id: "a", name: "রহিমা", mentions: ["রহিমা"], relation: "", look: "", facts: [{ kind: "confirmed", text: "x", flag: "old" }] }], places: [{ id: "r", name: "ঘর", description: "", who: "nobody" }], events: [], keyLines: [], keyNumbers: [], keyMoments: [{ part: 0, text: "t" }], ending: "", pacing: "", prohibited: [], approvedAt: 5 };
    const b = normalizeBible(v1);
    expect(b.version).toBe(2);
    expect(b.keyMoments[0].id).toBe("K1");
    expect(b.approvedAt).toBeUndefined(); // no card approvals: not approved
  });
  it("editing one card removes only that card's approval and bumps the revision", () => {
    const a = approveAll(gated());
    expect(bibleReady(a, STORY).ok).toBe(true);
    const edited = revise(a, { ...a, events: [...a.events, { id: "U1", kind: "confirmed", text: "my event", by: "user" }] });
    expect(edited.revision).toBe(a.revision + 1);
    expect(isApproved(edited, "story")).toBe(false);
    expect(SECTIONS.filter((s) => s !== "story").every((s) => isApproved(edited, s))).toBe(true);
    expect(bibleReady(edited, STORY).ok).toBe(false);
    expect(bibleHash(edited)).not.toBe(bibleHash(a)); // a plan made from `a` is now stale
  });
  it("changing the story makes the whole review outdated", () => {
    const a = approveAll(gated());
    const r = bibleReady(a, STORY.replace("ষোলো ইউনিট", "সতেরো ইউনিট"));
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/story changed/);
    expect(bibleReady(a, `  ${STORY}\n`).ok).toBe(true); // spacing alone is not a change
  });
  it("regenerating one card keeps the other cards, their approvals and the user's own items", () => {
    const a = approveAll(gated());
    const withMine = approveSection(revise(a, { ...a, keyMoments: [...a.keyMoments, { id: "Umine", part: 0, text: "my scene", purpose: "", visible: [], objects: [], tone: "", restrictions: [], by: "user" }] }), "scenes");
    const fresh = runAccuracyGate(normalizeBible({ ...AI(), key_moments: AI().key_moments.slice(0, 2), message: "different" }), STORY).bible;
    const m = mergeSection(withMine, fresh, "scenes");
    expect(m.keyMoments.map((x) => x.text)).toContain("my scene");
    expect(m.keyMoments).toHaveLength(3);
    expect(m.message).toBe(a.message);
    expect(isApproved(m, "scenes")).toBe(false);
    expect(["story", "characters", "ending", "rules"].every((s) => isApproved(m, s as never))).toBe(true);
  });
});

/* --------------------------- downstream shot plan --------------------------- */

const plan = (): EpisodePlan => ({
  version: 2, series: "s", episode: 1, title: "t", caption: "c", mood: "emotional", format: "9:16",
  cast: [
    { id: "me", name: "আমি", asset: "young_man", look: "", voice: "narrator" },
    { id: "rahima", name: "রহিমা খালা", asset: "old_woman", look: "", voice: "female_old" },
    { id: "mizan", name: "মিজান", asset: "young_man", look: "", voice: "male" },
    { id: "daughter", name: "মেয়ে", asset: "girl", look: "", voice: "female" },
  ],
  places: [{ id: "locked_room", asset: "home_room", look: "", time: "night" }, { id: "office", asset: "office", look: "", time: "day" }],
  shots: [
    { line: "টাকা আমার যায় না।", speaker: "mizan", place: "office", camera: { shot: "medium", move: "hold" }, refs: ["K1", "nonsense"] },
    { line: "আর মাথার উপর সিলিং ফ্যানটা পুরো গতিতে ঘুরছে।", speaker: "narrator", place: "locked_room", camera: { shot: "wide", move: "hold" }, actors: [{ id: "rahima", x: 0.5, action: "idle", face: "neutral" }], refs: ["K2"] },
    { line: "ঐটা আমার ঘর, ভাই।", speaker: "mizan", place: "office", camera: { shot: "close", move: "hold" }, actors: [{ id: "me", x: 0.5, action: "idle", face: "neutral" }] },
    { line: "মেয়ে বলল কিছু।", speaker: "daughter", place: "office", camera: { shot: "close", move: "hold" }, actors: [{ id: "daughter", x: 0.5, action: "idle", face: "neutral" }] },
  ],
  end: { type: "the_end", text: "শেষ কবে মাকে এমনি ফোন দিয়েছিলেন?" },
});

describe("downstream shot-plan validation", () => {
  const b = approveAll(gated());
  const w: string[] = [];
  const out = enforceBible(plan(), b, w, { partIndex: 0, partText: STORY });
  it("removes invented people and gives their lines to the narrator", () => {
    expect(out.cast.map((c) => c.id)).not.toContain("daughter");
    expect(out.shots[3].speaker).toBe("narrator");
  });
  it("keeps the empty room empty", () => {
    expect(out.shots[1].actors).toEqual([]);
  });
  it("allows an off-screen phone voice (Mizan speaks, only the narrator is on screen)", () => {
    expect(out.shots[2].speaker).toBe("mizan");
    expect(out.shots[2].actors?.map((a) => a.id)).toEqual(["me"]);
  });
  it("drops unknown refs and warns about key scenes with no shot", () => {
    expect(out.shots[0].refs).toEqual(["K1"]);
    expect(w.join("\n")).toMatch(/Key scene K3 /);
    expect(w.join("\n")).not.toMatch(/Key scene K1 /);
  });
  it("warns when a key line is given to the wrong speaker or left out", () => {
    expect(w.join("\n")).toMatch(/“টাকা আমার যায় না” belongs to rahima, not mizan/);
    expect(w.join("\n")).toMatch(/“এমনি ফোন দিলাম” is missing/);
  });
  it("the hard rules still hold after autoDirect-style staging puts someone back", () => {
    const staged = structuredClone(out);
    staged.shots[1].actors = [{ id: "rahima", x: 0.4, action: "idle", face: "neutral" }];
    expect(applyHardRules(staged, b).shots[1].actors).toEqual([]);
  });
});

/* -------------------------- synthetic edge stories -------------------------- */

describe("synthetic stories", () => {
  it("ambiguous relation: an uncited claim is unverified, not guessed", () => {
    const st = "করিম চাচা প্রতিদিন আসেন। তিনি আমাদের কেউ না, তবু সবাই তাকে চাচা বলে।";
    const b = runAccuracyGate(normalizeBible({ characters: [{ id: "karim", name: "করিম", mentions: ["করিম চাচা"], relation: "uncle", facts: [{ kind: "inference", text: "He is the father's brother", source: "", evidence: [] }] }] }), st).bible;
    expect(b.characters[0].facts[0].check?.status).toBe("unverified");
  });
  it("flashback: a quote from the past part is still found with its offsets", () => {
    const st = "আজ সে একা। দশ বছর আগে, এই উঠোনে বাবা তাকে সাইকেল চালানো শিখিয়েছিলেন। এখন উঠোনে ঘাস।";
    const v = verifyClaim(st, { text: "Ten years ago his father taught him to ride", source: "দশ বছর আগে, এই উঠোনে বাবা তাকে সাইকেল চালানো শিখিয়েছিলেন" });
    expect(v.status).toBe("verified");
    expect(numbersIn(st)).toContain(10);
  });
  it("negation: 'he came back' against 'he never came back' is contradicted", () => {
    const st = "ছেলেটা আর কোনোদিন গ্রামে ফিরে আসেনি। মা রোজ রাস্তার দিকে তাকিয়ে থাকতেন।";
    expect(verifyClaim(st, { text: "He returned", source: "ছেলেটা আর কোনোদিন গ্রামে ফিরে আসে" }).status).not.toBe("verified");
    expect(verifyClaim(st, { text: "He returned", source: "ছেলেটা আর একদিন গ্রামে ফিরে আসে।" }).status).toBe("contradicted");
  });
  it("unsupported visual detail is unverified without a passage", () => {
    const st = "ঘরে একটা পুরোনো আলমারি।";
    expect(verifyClaim(st, { text: "A red sofa stands by the window" }).status).toBe("unverified");
  });
});

/* --------------------------------- UI --------------------------------- */

describe("Director's Review UI", () => {
  const render = (b: StoryBible, story = STORY) =>
    renderToStaticMarkup(
      createElement(DirectorReview, {
        bible: b, report: null, story, partsTotal: 1, voiceMinutes: 3, fast: true, busy: false,
        onFast: () => {}, onChange: () => {}, onRegenerate: () => {}, onApprove: () => {}, onBack: () => {},
      }),
    );
  it("shows honest counts, every status label, and full claims", () => {
    const html = render(gated());
    expect(html).toMatch(/Verified/);
    expect(html).toMatch(/Supported interpretation/);
    expect(html).toMatch(/Unverified/);
    expect(html).toMatch(/Contradicted/);
    expect(html).not.toMatch(/fixed \d+ thing/);
    expect(html).toContain("The narrator reads 9 units at Rahima Khala&#x27;s house, and she asks him to write more");
  });
  it("five cards, each with Edit, Regenerate, Compare and Approve, and state chips", () => {
    const html = render(gated());
    expect(html.match(/✎ Edit/g)).toHaveLength(5);
    expect(html.match(/↻ Regenerate/g)).toHaveLength(5);
    expect(html.match(/⇄ Compare with original/g)).toHaveLength(5);
    expect(html.match(/Not approved yet/g)).toHaveLength(5);
  });
  it("approved cards show as approved and the paid step unlocks only when all five are", () => {
    const all = render(approveAll(gated()));
    expect(all.match(/✓ Approved/g)!.length).toBeGreaterThanOrEqual(5);
    expect(all).toMatch(/Approve &amp; plan the shots/);
    const four = render(approveSection(approveAll(gated()), "rules", false));
    expect(four).toMatch(/Approve all 5 cards to continue \(4\/5\)/);
  });
  it("a contradicted claim blocks its card and shows the story passage", () => {
    const b = applySemantic(gated(), STORY, { results: [{ ref: "P:rahima_home", verdict: "contradicted", sentences: [S("টিনের দুটো ঘর")], reason: "two rooms, not two houses" }] });
    const html = render(b);
    expect(html).toMatch(/⛔ Blocked: fix first/);
    expect(html).toMatch(/<mark[^>]*>টিনের দুটো ঘর।<\/mark>/);
  });
  it("warns when the story changed after the review", () => {
    expect(render(gated(), `${STORY}\nনতুন লাইন।`)).toMatch(/story was changed after this review/);
  });
});

/* ------------------------------- route ------------------------------- */

describe("/api/bible end to end (mock OpenRouter)", () => {
  beforeEach(() => {
    _resetRateLimit();
    _resetPlannerCache();
  });
  afterEach(() => _resetPlannerCache());
  const models = { data: [{ id: "google/gemini-3-pro", supported_parameters: ["structured_outputs"] }, { id: "google/gemini-3-flash", supported_parameters: ["structured_outputs"] }] };
  const chat = (obj: unknown) => new Response(JSON.stringify({ id: "g", choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });

  it("sends numbered sentences, runs the cross-check with the cheap model, and returns evidence-based statuses", async () => {
    let n = 0;
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith("/models")) return Response.json(models);
      n++;
      if (n === 1) return chat(AI());
      const sent = String(init.body ?? "");
      const refs = [...sent.matchAll(/\\n([A-Za-z0-9_.:]+): \[/g)].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(10);
      return chat({ results: refs.map((ref) => ({ ref, verdict: "not_found", sentences: [], reason: "" })) });
    });
    const res = await biblePost(new Request("http://x/api/bible", { method: "POST", headers: { "content-type": "application/json", "x-openrouter-key": FAKE_KEY }, body: JSON.stringify({ text: STORY, genre: "emotional", partsTotal: 1 }) }));
    expect(res.status).toBe(200);
    const j = await res.json();
    const chats = calls.filter((c) => c.url.includes("chat/completions"));
    expect(chats).toHaveLength(2);
    expect(JSON.stringify(chats[0].body)).toMatch(/\[S1\] \*খালি ঘরের ফ্যান\*/);
    expect(chats[1].body?.model).toBe("google/gemini-3-flash");
    expect(j.verifyModel).toBe("google/gemini-3-flash");
    // Exact-quote facts can never be weakened by the cross-check.
    const b = normalizeBible(j.bible);
    expect(b.events.find((e) => e.text.includes("41 units"))!.check!.status).toBe("verified");
    expect(j.report.unverified).toBeGreaterThan(0); // "not_found" answers are reported honestly
  });
});

describe("approval check survives the trip to the server", () => {
  it("an approved bible with a half-typed edit (trailing space, blank rule) is still approved as sent", async () => {
    const { rawApprovedSections, loadBible } = await import("@/lib/storyBible");
    const a = gated();
    const typing = { ...a, message: `${a.message} `, prohibited: [...a.prohibited, { id: "Xnew", kind: "prohibited_change" as const, text: "", by: "user" as const }] };
    const approved = SECTIONS.reduce((x, sec) => approveSection(x, sec), typing);
    const sent = JSON.parse(JSON.stringify(approved));
    expect(rawApprovedSections(sent).open).toEqual([]);
    expect(rawApprovedSections({ ...sent, message: "changed" }).open).toEqual(["story"]);
    expect(rawApprovedSections(null).open).toEqual(SECTIONS);
    // old v1 bibles are upgraded and re-checked on load
    const v1 = { version: 1, message: "m", characters: [{ id: "r", name: "রহিমা", mentions: ["রহিমা বেগম"], relation: "", look: "", facts: [] }], places: [], events: [{ kind: "confirmed", text: "41 units", source: "একচল্লিশ ইউনিট" }], keyLines: [], keyNumbers: [], keyMoments: [], ending: "", pacing: "", prohibited: [] };
    const up = loadBible(v1, STORY);
    expect(up.version).toBe(2);
    expect(up.events[0].check?.status).toBe("verified");
    expect(up.finalLine).toBe("এমনি।");
  });
});
