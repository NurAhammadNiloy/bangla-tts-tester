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

/** Camera framing of one scene's picture. Never the same twice in a row. */
export type SceneShot = "wide" | "medium" | "close-up" | "over-shoulder" | "object close-up";
export const SCENE_SHOTS: SceneShot[] = ["wide", "medium", "close-up", "over-shoulder", "object close-up"];

export interface PlanScene {
  narration: string;
  picture: string;
  speaker: string;
  titleTag: string;
  /** NAMES of the characters who are actually visible in this scene (may be empty). Missing in old saved plans. */
  cast?: string[];
  /** Camera framing. Missing in old saved plans. */
  shot?: SceneShot;
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
        required: ["narration", "picture", "speaker", "titleTag", "cast", "shot"],
        properties: {
          narration: { type: "string" },
          picture: { type: "string" },
          speaker: { type: "string" },
          titleTag: { type: "string" },
          cast: {
            type: "array",
            description: "NAMES (exactly as in the character list) of the characters visible in this picture. Empty if nobody is visible.",
            items: { type: "string" },
          },
          shot: { type: "string", enum: SCENE_SHOTS },
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
    "- cast: the NAMES of ONLY the characters who are actually visible in this scene's picture (from the character list, spelled the same). Leave out anyone who is only mentioned, remembered or off-screen. Use [] when nobody is visible.",
    `- shot: the camera framing, one of: ${SCENE_SHOTS.join(", ")}. Never use the same shot in two scenes in a row. Use "object close-up" for an important thing (a letter, a door, a phone) and "over-shoulder" for conversations.`,
    "- picture: English, concrete: who is in frame (by NAME, only the cast), action, expression, place, time of day, framed as the chosen shot. No text or letters in the picture.",
    ctx.genre === "explainer" ? "- Explainer: pictures are simple diagrams, icons and symbolic scenes that show the idea of each line." : "",
    ctx.isLast ? "- This is the final part: end on a satisfying closing scene." : `- End on the hook so viewers want the next part: ${ctx.hook || "a moment of curiosity"}.`,
    "Return ONLY the JSON.",
  ]
    .filter(Boolean)
    .join("\n");
}

function cleanCast(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const name = str(x, 40);
    if (name && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, 8);
}

/**
 * Make sure no two scenes in a row share a shot. Invalid shots are replaced too.
 * The replacement also avoids the next scene's shot when possible.
 */
export function fixShots(shots: (string | undefined)[]): SceneShot[] {
  const out: SceneShot[] = [];
  for (let i = 0; i < shots.length; i++) {
    const want = shots[i];
    const prev = out[i - 1];
    if (SCENE_SHOTS.includes(want as SceneShot) && want !== prev) {
      out.push(want as SceneShot);
      continue;
    }
    const next = shots[i + 1];
    const pick = SCENE_SHOTS.find((s) => s !== prev && s !== next) ?? SCENE_SHOTS.find((s) => s !== prev)!;
    out.push(pick);
  }
  return out;
}

export function normalizeScenes(obj: Record<string, unknown>): PlanScene[] {
  const tags = allowedTags("gemini");
  const raw = (Array.isArray(obj.scenes) ? obj.scenes : [])
    .map((s: Record<string, unknown>) => ({
      narration: separateAdjacentTags(sanitizeTags(str(s?.narration, 600), tags)),
      picture: str(s?.picture, 800),
      speaker: str(s?.speaker, 40),
      titleTag: str(s?.titleTag, 40),
      cast: cleanCast(s?.cast),
      shot: str(s?.shot, 20).toLowerCase(),
    }))
    .filter((s: { narration: string; picture: string }) => s.narration && s.picture)
    .slice(0, MAX_SCENES_PER_PART);
  if (!raw.length) throw new Error("The AI returned no scenes. Try again.");
  const shots = fixShots(raw.map((s: { shot: string }) => s.shot));
  return raw.map((s: Omit<PlanScene, "shot"> & { shot: string }, i: number): PlanScene => ({ ...s, shot: shots[i] }));
}

/* ------------------------------ picture prompt helpers ------------------------------ */

/**
 * Split the characters box into one entry per person. Entries look like
 * "NAME — description" (dash, en dash, hyphen with spaces, or colon), one per line
 * or one after another in a paragraph.
 */
export function splitCharacters(text: string): { name: string; text: string }[] {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return [];
  // A name starts a line (then a dash or colon follows) or a new sentence (then only a dash follows).
  const re = /(^|\n|[.;]\s+)\s*([^\n—–:.;]{1,40}?)\s*(\s[—–-]\s|[—–]|:)\s*/g;
  const starts: { at: number; name: string }[] = [];
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const lineStart = m[1] === "" || m[1] === "\n";
    if (m[3] === ":" && !lineStart) continue;
    starts.push({ at: m.index + m[1].length, name: m[2].trim() });
  }
  return starts
    .map((s, i) => ({ name: s.name, text: t.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : t.length).trim() }))
    .filter((e) => e.name);
}

const sameName = (a: string, b: string) => {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return !!x && !!y && (x === y || x.split(/\s+/).includes(y) || y.split(/\s+/).includes(x));
};

/**
 * Character descriptions for one scene's picture: only the people in `cast`.
 * cast undefined (hand-written scene, old plan) → every description.
 * cast [] → nobody. If the box cannot be split into named entries, it is used whole.
 */
export function castDescriptions(characters: string, cast: string[] | undefined): string {
  if (!cast) return characters;
  if (!cast.length) return "";
  const entries = splitCharacters(characters);
  if (!entries.length) return characters;
  return entries
    .filter((e) => cast.some((c) => sameName(e.name, c)))
    .map((e) => e.text)
    .join(" ");
}

const SHOT_WORDS: Record<SceneShot, string> = {
  wide: "Wide shot showing the whole place.",
  medium: "Medium shot, people from the waist up.",
  "close-up": "Close-up on the face and its expression.",
  "over-shoulder": "Over-the-shoulder shot from behind one person, looking at the other.",
  "object close-up": "Close-up of the important object, filling the frame.",
};

/** The scene line of a picture prompt: camera framing first, then what is shown. */
export function sceneLine(picture: string, shot: SceneShot | undefined, cast?: string[]): string {
  return [shot ? `Camera: ${SHOT_WORDS[shot]}` : "", picture.trim(), cast && !cast.length ? "No people in this picture." : ""]
    .filter(Boolean)
    .join(" ");
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
