/**
 * Story planner, in two stages so stories of any length work:
 *  1. Outline: the AI reads the whole (numbered) story and decides where each
 *     part starts and ends — every part ≤ 6 minutes, ending on a hook.
 *  2. Scenes: when a part is opened, the AI turns just that part's sentences
 *     into scenes (narration + picture + speaker + title tag).
 * The author's sentences are kept; the AI only chooses cuts and adds directions.
 */
import { allowedTags, sanitizeTags, separateAdjacentTags } from "@/lib/voiceDirector";

export type Genre = "emotional" | "drama" | "horror" | "comedy" | "scifi" | "explainer" | "historical";
export type CaptionStyle = "box" | "clean" | "headline";

export const GENRES: Record<Genre, { label: string; emoji: string; art: string; caption: CaptionStyle; mood: string }> = {
  emotional: { label: "Emotional", emoji: "🥲", art: "anime", caption: "box", mood: "emotional" },
  drama: { label: "Family drama", emoji: "🎭", art: "flat", caption: "box", mood: "drama" },
  horror: { label: "Horror", emoji: "👻", art: "minimal", caption: "clean", mood: "horror" },
  comedy: { label: "Comedy", emoji: "😄", art: "minimal", caption: "box", mood: "comedy" },
  scifi: { label: "Sci-fi", emoji: "🚀", art: "flat", caption: "clean", mood: "scifi" },
  explainer: { label: "Explainer", emoji: "🧠", art: "explainer", caption: "headline", mood: "explainer" },
  historical: { label: "Historical", emoji: "🏛", art: "flat", caption: "box", mood: "narrator" },
};

export const CAPTION_STYLES: { id: CaptionStyle; label: string; about: string }[] = [
  { id: "box", label: "Dark box", about: "White Bangla text in a dark rounded box near the bottom, the spoken word in yellow. Easy to read on any picture." },
  { id: "clean", label: "Clean", about: "White text with a soft dark outline and no box. Lets the picture breathe; good for night scenes and horror." },
  { id: "headline", label: "Headline", about: "Big bold text near the top, key word in yellow, like explainer reels. Best for facts and short punchy lines." },
];

/** Bangla speech rate used for estimates (letters per second, tags removed). */
export const LETTERS_PER_SECOND = 12;
export const MAX_PART_SECONDS = 6 * 60;
export const MAX_STORY_CHARS = 60_000;
export const MAX_PARTS = 15;
export const MAX_SCENES_PER_PART = 60;

export interface PlanScene {
  narration: string;
  picture: string;
  speaker: string;
  titleTag: string;
}

export interface PlanPart {
  title: string;
  summary: string;
  /** Why the audience will want the next part (the cliffhanger). */
  hook: string;
  /** Inclusive 1-based sentence numbers into StoryPlan.sentences. */
  from: number;
  to: number;
  /** Filled in stage 2, when the part is opened. */
  scenes?: PlanScene[];
}

export interface StoryPlan {
  title: string;
  genre: Genre;
  characters: string;
  setting: string;
  sentences: string[];
  parts: PlanPart[];
}

/* ------------------------------ text helpers ------------------------------ */

function letters(s: string): number {
  return [...s.replace(/\[[^\]\n]{1,40}\]/g, "").replace(/\s+/g, " ").trim()].length;
}

export function estimateSeconds(text: string): number {
  return letters(text) / LETTERS_PER_SECOND + 0.5;
}

/** Split a Bangla story into sentences, keeping punctuation. Paragraph breaks also split. */
export function splitSentences(story: string): string[] {
  return story
    .replace(/\r/g, "")
    .split(/\n+/)
    .flatMap((para) => para.match(/[^।?!]+[।?!]*["”’']*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => letters(s) > 0);
}

export function partText(plan: StoryPlan, part: PlanPart): string {
  return plan.sentences.slice(part.from - 1, part.to).join(" ");
}

export function partSeconds(plan: StoryPlan, part: PlanPart): number {
  if (part.scenes?.length) return part.scenes.reduce((a, s) => a + estimateSeconds(s.narration), 0);
  return estimateSeconds(partText(plan, part));
}

/* ------------------------------ stage 1: outline ------------------------------ */

export const OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "genre", "characters", "setting", "parts"],
  properties: {
    title: { type: "string", description: "Short Bangla title of the story" },
    genre: { type: "string", enum: Object.keys(GENRES) },
    characters: {
      type: "string",
      description: "English visual description of every main character: NAME — age, build, hair, clothes, one distinctive item.",
    },
    setting: { type: "string", description: "English: where and when the story happens, one sentence" },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "hook", "firstSentence", "lastSentence"],
        properties: {
          title: { type: "string", description: "Bangla part title" },
          summary: { type: "string", description: "One Bangla sentence about this part" },
          hook: { type: "string", description: "Bangla: the open question this part ends on" },
          firstSentence: { type: "integer" },
          lastSentence: { type: "integer" },
        },
      },
    },
  },
} as const;

export function buildOutlinePrompt(totalSeconds: number, partMinutes: number | null): string {
  const mins = (totalSeconds / 60).toFixed(1);
  const size = partMinutes
    ? `Aim for about ${partMinutes} minute(s) per part.`
    : "Choose the number of parts yourself. A story under ~3 minutes is ONE part. Longer stories: usually 2–3 minutes per part, as many parts as the story needs.";
  return [
    "You are the Story Editor: an experienced editor of Bangla serial stories for Facebook and YouTube reels, the kind of person",
    "who decides where each episode ends so the audience comes back for the next one. The user's story is given as numbered sentences.",
    `It is about ${mins} minutes long when read aloud (about ${LETTERS_PER_SECOND} letters per second).`,
    "",
    "FIRST, read the whole story and understand it: the main characters, the central question, the turning points, the twists and the ending.",
    "THEN decide the parts:",
    "- Each part needs a small arc of its own: a strong first line that pulls the viewer in, rising interest, and a gripping last line.",
    "- Cut at the strongest cliffhangers: right before a reveal, at a shock, at a decision, when danger appears, or on an unanswered question.",
    "- Never cut in the middle of a dialogue exchange or a calm, resolved moment.",
    "- Do not make parts tiny just to create more episodes; every part must feel worth watching on its own.",
    "",
    "RULES",
    `- ${size}`,
    "- A part must NEVER be longer than 6 minutes (about 4,300 letters).",
    "- Parts are continuous and cover every sentence in order: part 1 starts at sentence 1, each next part starts right after the previous one ends, the last part ends at the last sentence.",
    "- End every part (except the last) at a moment of curiosity: a question, a reveal about to happen, danger, or a surprise — never in the middle of a calm moment.",
    "- hook: in Bangla, the open question the viewer is left with (e.g. \"দরজার ওপাশে কে ছিল?\"). For the last part, a short closing line.",
    "- characters: describe each main person once in English so they look identical in every picture.",
    "- genre: emotional, drama, horror, comedy, scifi, explainer (teaches facts/science/psychology), or historical.",
    "Return ONLY the JSON.",
  ].join("\n");
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function parseJsonLoose(raw: string): Record<string, unknown> {
  let text = raw.trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "");
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("The AI's plan was not valid JSON. Try again.");
  text = text.slice(first, last + 1);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The AI's plan was not valid JSON. Try again.");
  }
}

/**
 * Turn the AI's outline into continuous, gap-free parts; split any part that is
 * still longer than 6 minutes at the sentence nearest its middle.
 */
export function normalizeOutline(obj: Record<string, unknown>, sentences: string[]): StoryPlan {
  const N = sentences.length;
  if (!N) throw new Error("The story has no sentences.");
  const genre = (Object.keys(GENRES).includes(obj.genre as string) ? obj.genre : "emotional") as Genre;
  type Raw = { title: string; summary: string; hook: string; from: number };
  const raw: Raw[] = (Array.isArray(obj.parts) ? obj.parts : [])
    .map((p: Record<string, unknown>) => ({
      title: str(p?.title, 80),
      summary: str(p?.summary, 300),
      hook: str(p?.hook, 200),
      from: Math.round(Number(p?.firstSentence)),
    }))
    .filter((p: Raw) => Number.isFinite(p.from) && p.from >= 1 && p.from <= N)
    .sort((a: Raw, b: Raw) => a.from - b.from)
    .filter((p: Raw, i: number, arr: Raw[]) => i === 0 || p.from !== arr[i - 1].from);
  if (!raw.length || raw[0].from !== 1) raw.unshift({ title: raw[0]?.title ?? "", summary: "", hook: "", from: 1 });
  if (raw.length > 1 && raw[1].from === 1) raw.splice(1, 1);

  let parts: PlanPart[] = raw.map((p, i) => ({
    title: p.title,
    summary: p.summary,
    hook: p.hook,
    from: p.from,
    to: i + 1 < raw.length ? raw[i + 1].from - 1 : N,
  }));

  // Enforce the 6-minute ceiling by halving overlong parts.
  const plan0 = { sentences } as StoryPlan;
  for (let guard = 0; guard < 50; guard++) {
    const idx = parts.findIndex((p) => partSeconds(plan0, p) > MAX_PART_SECONDS && p.to > p.from);
    if (idx === -1) break;
    const p = parts[idx];
    const half = partSeconds(plan0, p) / 2;
    let acc = 0;
    let cut = p.from;
    for (let s = p.from; s < p.to; s++) {
      acc += estimateSeconds(sentences[s - 1]);
      cut = s;
      if (acc >= half) break;
    }
    parts.splice(idx, 1, { ...p, to: cut, hook: "" }, { title: p.title ? `${p.title} (২)` : "", summary: "", hook: p.hook, from: cut + 1, to: p.to });
  }
  parts = parts.slice(0, MAX_PARTS).map((p, i) => ({ ...p, title: p.title || `পর্ব ${i + 1}` }));
  parts[parts.length - 1].to = N;

  return {
    title: str(obj.title, 120) || "আমার গল্প",
    genre,
    characters: str(obj.characters, 2000),
    setting: str(obj.setting, 400),
    sentences,
    parts,
  };
}

/* ------------------------------ stage 2: scenes ------------------------------ */

export const SCENES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenes"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["narration", "picture", "speaker", "titleTag"],
        properties: {
          narration: { type: "string" },
          picture: { type: "string" },
          speaker: { type: "string" },
          titleTag: { type: "string" },
        },
      },
    },
  },
} as const;

export function buildScenesPrompt(ctx: { genre: Genre; characters: string; setting: string; partTitle: string; isLast: boolean; hook: string }): string {
  return [
    "You are a director turning one part of a Bangla story into scenes for a vertical (9:16) animated reel.",
    `Genre: ${GENRES[ctx.genre].label}. Part: ${ctx.partTitle}.`,
    `Characters (use these NAMES in pictures): ${ctx.characters}`,
    `Setting: ${ctx.setting}`,
    "",
    "RULES",
    "- Use the author's own Bangla sentences for narration, in order. Do not invent plot, do not skip events. You may trim filler words or split a long sentence.",
    "- One scene = one picture + 1–3 short sentences (about 6–12 seconds, 60–150 Bangla letters, never over 400).",
    "- Add English emotion tags in [brackets] inside narration where the feeling changes, ONLY from:",
    `  ${[...allowedTags("gemini")].join(", ")}. Never two tags side by side. About one tag every 1–2 scenes.`,
    "- speaker: the character's name when the narration is that character speaking aloud; otherwise \"\".",
    "- titleTag: short Bangla tag only when time or place jumps (e.g. \"৩ মাস পর • বৃষ্টির দুপুর\"); otherwise \"\".",
    "- picture: English, concrete: who is in frame (by NAME), action, expression, place, time of day, camera (wide / medium / close-up). Vary camera angles. No text or letters in the picture.",
    ctx.genre === "explainer" ? "- Explainer: pictures are simple diagrams, icons and symbolic scenes that show the idea of each line." : "",
    ctx.isLast ? "- This is the final part: end on a satisfying closing scene." : `- End on the hook so viewers want the next part: ${ctx.hook || "a moment of curiosity"}.`,
    "Return ONLY the JSON.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function normalizeScenes(obj: Record<string, unknown>): PlanScene[] {
  const tags = allowedTags("gemini");
  const scenes = (Array.isArray(obj.scenes) ? obj.scenes : [])
    .map((s: Record<string, unknown>) => ({
      narration: separateAdjacentTags(sanitizeTags(str(s?.narration, 600), tags)),
      picture: str(s?.picture, 800),
      speaker: str(s?.speaker, 40),
      titleTag: str(s?.titleTag, 40),
    }))
    .filter((s: PlanScene) => s.narration && s.picture)
    .slice(0, MAX_SCENES_PER_PART);
  if (!scenes.length) throw new Error("The AI returned no scenes. Try again.");
  return scenes;
}

/* ------------------------------ model choice ------------------------------ */

export const PLANNER_PREFERENCES: RegExp[] = [
  /^google\/gemini-[\d.]+-pro(-preview)?$/,
  /^anthropic\/claude-[\w.-]*sonnet[\w.-]*$/,
  /^google\/gemini-[\d.]+-flash(-preview)?$/,
  /^openai\/gpt-[\d.]+$/,
];

export function pickPlannerModel(
  models: { id: string; supported_parameters?: string[]; architecture?: { output_modalities?: string[] } }[],
): string | null {
  const ok = models.filter((m) => {
    const out = m.architecture?.output_modalities ?? ["text"];
    const textOnly = out.length === 1 && out[0] === "text";
    const structured =
      !m.supported_parameters || m.supported_parameters.includes("structured_outputs") || m.supported_parameters.includes("response_format");
    return textOnly && structured && !/tts|image|audio|embed|lite/i.test(m.id);
  });
  for (const re of PLANNER_PREFERENCES) {
    const hits = ok.filter((m) => re.test(m.id)).map((m) => m.id).sort().reverse();
    if (hits.length) return hits[0];
  }
  return null;
}

/**
 * Best subtitle style for a story type + art style.
 * Horror and sci-fi want a clean, boxless look (darker pictures, mood);
 * explainers want big headline text; warm/emotional/comedy stories read best in the dark box.
 */
export function suggestCaption(genre: Genre | null | undefined, artId: string): CaptionStyle {
  if (artId === "explainer" || genre === "explainer") return "headline";
  if (genre === "horror" || genre === "scifi") return "clean";
  if (!genre && artId === "minimal") return "clean";
  return "box";
}
