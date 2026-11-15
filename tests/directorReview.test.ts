import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DirectorReview from "@/components/create/DirectorReview";
import { normalizeBible, runAccuracyGate } from "@/lib/storyBible";

const STORY = "রহিমা খালা একা থাকেন। তার একমাত্র ছেলে মিজান মালয়েশিয়ায় থাকে।";
const { bible, report } = runAccuracyGate(
  normalizeBible({
    message: "A mother waits.",
    characters: [{ id: "rahima", name: "রহিমা", mentions: ["রহিমা খালা"], relation: "mother of Mizan", look: "old", facts: [{ kind: "confirmed", text: "lives alone", source: "রহিমা খালা একা থাকেন।" }] }],
    places: [{ id: "room", name: "ঘর", description: "empty", who: "nobody" }],
    events: [{ kind: "confirmed", text: "She lives alone", source: "রহিমা খালা একা থাকেন।" }],
    key_moments: [{ part: 0, text: "the empty room", source: "" }],
    ending: "fade to black",
    pacing: "slow",
    prohibited: [{ kind: "prohibited_change", text: "Mizan returns", source: "" }],
  }),
  STORY,
);

describe("DirectorReview screen", () => {
  const html = renderToStaticMarkup(
    createElement(DirectorReview, {
      bible, report, story: STORY, partsTotal: 1, voiceMinutes: 1.5, fast: true, busy: false,
      onFast: () => {}, onChange: () => {}, onRegenerate: () => {}, onApprove: () => {}, onBack: () => {},
    }),
  );

  it("shows the five cards, each with Edit, Regenerate, Compare and Approve", () => {
    for (const t of ["Story &amp; message", "Characters &amp; relations", "Key scenes", "Ending", "Cannot-change list"]) expect(html).toContain(t);
    expect(html.match(/✎ Edit/g)).toHaveLength(5);
    expect(html.match(/↻ Regenerate/g)).toHaveLength(5);
    expect(html.match(/⇄ Compare with original/g)).toHaveLength(5);
    expect(html.match(/>Approve</g)).toHaveLength(5);
  });
  it("shows the bible content, the override box and the cost breakdown", () => {
    expect(html).toContain("mother of Mizan");
    expect(html).toContain("Mizan returns");
    expect(html).toContain("Your own direction");
    for (const l of ["Planning", "Pictures", "Voice", "Animation", "Retries"]) expect(html).toContain(l);
  });
  it("blocks the paid step until every card is approved", () => {
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Approve all 5 cards to continue \(0\/5\)/);
  });
  it("has an Info button on the controls", () => {
    expect((html.match(/aria-label="What is /g) ?? []).length).toBeGreaterThanOrEqual(15);
  });
});
