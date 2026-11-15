export const DEFAULT_BENGALI_TEXT =
  "আসসালামু আলাইকুম। আমার নাম জারভিস। আমি একজন বাংলা এআই সহকারী। আজ আমরা বাংলা ভয়েস জেনারেশন পরীক্ষা করছি।";

/**
 * Model families whose *provider* documentation explicitly lists Bengali.
 * This only labels models; the model list itself always comes live from
 * OpenRouter, so nothing here can make a non-existent model appear.
 *
 *  - ElevenLabs Eleven v3 (and v3 Conversational, built on v3): "BEN Bengali"
 *    in ElevenLabs' language list.
 *  - Google Gemini TTS: "Bangla (Bangladesh) bn-BD" in Google Cloud's
 *    Gemini-TTS language table.
 *
 * Eleven v4 is described as 90+ languages but its list was not checked, so it
 * is NOT flagged. Everything else is "untested" until you try it.
 */
const BENGALI_DOCUMENTED_PATTERNS: RegExp[] = [/^elevenlabs\/eleven-v3/, /^google\/gemini-.*tts/];

export function isBengaliDocumented(modelId: string): boolean {
  return BENGALI_DOCUMENTED_PATTERNS.some((re) => re.test(modelId));
}

/** Rough share of characters in the Bengali Unicode block (U+0980–U+09FF). */
export function bengaliRatio(text: string): number {
  const letters = [...text].filter((c) => !/[\s\p{P}\d]/u.test(c));
  if (letters.length === 0) return 0;
  const bn = letters.filter((c) => {
    const cp = c.codePointAt(0)!;
    return cp >= 0x0980 && cp <= 0x09ff;
  });
  return bn.length / letters.length;
}

/** OpenRouter bills ElevenLabs by Unicode code points, so count those, not UTF-16 units. */
export function codePointLength(text: string): number {
  return [...text].length;
}
