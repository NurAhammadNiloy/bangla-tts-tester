import { allowedTags, sanitizeTags, stripTags, tagsFor, type TagFamily } from "@/lib/voiceDirector";

export function buildAutotagPrompt(family: Exclude<TagFamily, "none">, tagHint: string): string {
  const t = tagsFor(family);
  return [
    "You add expressive audio tags to Bengali story text so a text-to-speech model reads it with emotion.",
    "",
    "STRICT RULES:",
    "1. Do NOT change, add, remove, translate or reorder any Bengali word or punctuation. Copy the text exactly.",
    "2. Only INSERT tags in square brackets, written in English, chosen ONLY from this list:",
    `   Emotion: ${t.emotion.join(", ")}`,
    `   Delivery: ${t.delivery.join(", ")}`,
    "3. Put a tag right before the words where the emotion or pace changes.",
    "4. Never put two tags next to each other. Use about one tag every one or two sentences, not more.",
    `5. For this story's genre, prefer: ${tagHint}.`,
    "6. Return ONLY the tagged story text. No explanation, no quotes, no code block.",
  ].join("\n");
}

export type AutotagCheck = { ok: true; text: string; tags: number } | { ok: false; error: string };

/** Clean model output and prove the Bengali text was not altered. */
export function verifyAutotag(original: string, output: string, family: Exclude<TagFamily, "none">): AutotagCheck {
  let out = output.trim();
  // Strip an accidental code fence or surrounding quotes.
  out = out.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").replace(/^["“]([\s\S]*)["”]$/, "$1").trim();
  const cleaned = sanitizeTags(out, allowedTags(family));
  if (stripTags(cleaned) !== stripTags(original)) {
    return { ok: false, error: "The AI changed some words, so its result was rejected. Your text is unchanged. Try again." };
  }
  const tags = (cleaned.match(/\[[^\]]+\]/g) ?? []).length;
  return { ok: true, text: cleaned, tags };
}
