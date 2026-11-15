/**
 * Auto-director: a screenplay pass run on every plan before drawing.
 * The rules below are the storyboard habits that make story reels watchable:
 *  1. Every shot shows someone doing something (no empty narration shots),
 *     except one establishing wide shot when we arrive somewhere new.
 *  2. Whoever speaks is on screen, talking, framed on them.
 *  3. The action matches the line (walking, looking, crying, a phone call…).
 *  4. Never the same picture twice in a row: same place + same people means a
 *     new camera size, side or move; long runs on one person get a reaction shot.
 * Pure function, deterministic, unit-tested.
 */
import type { Action, ActorInShot, AssetLibrary, CameraMove, EpisodePlan, Face, Shot, ShotSize } from "./types";

type Cue = { re: RegExp; action?: Action; face?: Face };

/** Bangla (and a little English) cue words → what the body and face should do. */
const CUES: Cue[] = [
  { re: /কাঁদ|কান্না|চোখে জল|অশ্রু|cry/i, action: "cry", face: "crying" },
  { re: /হাস(?!পাতাল)|হেসে|laugh|smil/i, action: "laugh", face: "happy" },
  { re: /চমক|আঁতক|ভয় পে|চিৎকার|শিউরে|scream|shock/i, action: "shock", face: "shocked" },
  { re: /ভয়|আতঙ্ক|কাঁপ|গা ছমছম|scared|afraid/i, face: "scared" },
  { re: /রাগ|রেগে|ধমক|চেঁচি|angry/i, action: "angry", face: "angry" },
  { re: /ফোন|কল |কল দি|ফোনে|call/i, action: "phone_ear" },
  { re: /দৌড়|ছুটে|run/i, action: "run" },
  { re: /হাঁট|এগিয়ে|পৌঁছ|ঢুক|গেলাম|গেল|এলাম|এলো|আসে|আসত|ফিরে|walk|arriv|enter/i, action: "walk_in" },
  { re: /বস(?!ন্ত)|বসে|বসল|sit/i, action: "sit" },
  { re: /শুয়ে|ঘুম|খাটে|lie|sleep/i, action: "lie_down" },
  { re: /জড়িয়ে|আলিঙ্গন|hug/i, action: "hug", face: "sad" },
  { re: /দেখাল|দেখিয়ে|ইশারা|point/i, action: "point" },
  { re: /নামাজ|দোয়া|প্রার্থনা|pray/i, action: "pray" },
  { re: /মাথা নেড়|হ্যাঁ বল|nod/i, action: "nod" },
  { re: /না বল|অস্বীকার|refus/i, action: "shake_head" },
  { re: /হাত নেড়|ডাকল|wave/i, action: "wave" },
  { re: /পড়ে গেল|লুটিয়ে|fell|fall/i, action: "fall", face: "shocked" },
  { re: /দুঃখ|কষ্ট|মন খারাপ|একা|নিঃসঙ্গ|sad|lonely/i, face: "sad" },
  { re: /চিন্তা|দুশ্চিন্তা|অবাক|সন্দেহ|রহস্য|অদ্ভুত|worr|strange/i, face: "worried" },
  { re: /খুশি|আনন্দ|happy/i, face: "happy" },
];

export function cueFor(line: string): { action?: Action; face?: Face } {
  const out: { action?: Action; face?: Face } = {};
  for (const c of CUES) {
    if (!c.re.test(line)) continue;
    if (!out.action && c.action) out.action = c.action;
    if (!out.face && c.face) out.face = c.face;
    if (out.action && out.face) break;
  }
  return out;
}

const NEXT_SIZE: Record<ShotSize, ShotSize> = {
  wide: "medium",
  medium: "close",
  close: "medium",
  extreme_close: "medium",
  two_shot: "close",
  over_shoulder: "close",
  pov_hand: "medium",
};
const MOVES: CameraMove[] = ["push_in", "hold", "pan_right", "pull_out", "hold", "pan_left"];

/** The person whose eyes we see the story through: a cast member voiced as the narrator, else the most seen. */
export function protagonist(plan: EpisodePlan): string | null {
  const narr = plan.cast.find((c) => c.voice === "narrator");
  if (narr) return narr.id;
  const count = new Map<string, number>();
  for (const s of plan.shots) {
    if (s.speaker !== "narrator") count.set(s.speaker, (count.get(s.speaker) ?? 0) + 3);
    for (const a of s.actors ?? []) count.set(a.id, (count.get(a.id) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  for (const [id, n] of count) if (plan.cast.some((c) => c.id === id) && n > max) [best, max] = [id, n];
  return best ?? plan.cast[0]?.id ?? null;
}

function sig(s: Shot): string {
  const who = (s.actors ?? []).map((a) => a.id).sort().join(",");
  return `${s.place ?? ""}|${s.camera.shot}|${who}|${s.screen ? s.screen.type : ""}`;
}

export function autoDirect(plan: EpisodePlan, lib?: AssetLibrary): EpisodePlan {
  void lib;
  const hero = protagonist(plan);
  const castIds = new Set(plan.cast.map((c) => c.id));
  const shots: Shot[] = plan.shots.map((s) => structuredClone(s));
  let lastPlace: string | undefined;
  let lastActors: ActorInShot[] = [];
  let sameRun = 0;

  shots.forEach((s, i) => {
    if (s.layout === "split" || s.screen) {
      lastPlace = s.layout === "split" ? s.top?.place : s.place ?? lastPlace;
      return;
    }
    const cue = cueFor(s.line);
    const arriving = s.place !== lastPlace;
    let actors = (s.actors ?? []).filter((a) => castIds.has(a.id));

    // 2. The speaker is on screen.
    if (s.speaker !== "narrator" && castIds.has(s.speaker) && !actors.some((a) => a.id === s.speaker)) {
      actors.push({ id: s.speaker, x: actors.length ? 0.68 : 0.5, action: "talk", face: cue.face ?? "neutral" });
    }

    // 1. No empty shots, except one establishing wide shot on arrival.
    const establishing = arriving && s.camera.shot === "wide" && actors.length === 0;
    if (!actors.length && !establishing) {
      const carry = lastActors.length && !arriving ? lastActors.map((a) => ({ ...a })) : null;
      if (carry) actors = carry.slice(0, 2);
      else if (hero) actors = [{ id: hero, x: 0.5, action: "idle", face: "neutral" }];
      if (actors.length && s.camera.shot === "wide" && !arriving) s.camera = { ...s.camera, shot: "medium" };
    }

    // 3. Action and face follow the line.
    actors = actors.map((a, k) => {
      const isSpeaker = a.id === s.speaker;
      const main = isSpeaker || (s.speaker === "narrator" && k === 0);
      let action = a.action;
      if (main && cue.action && (action === "idle" || action === "talk")) action = cue.action;
      if (isSpeaker && action === "idle") action = "talk";
      // Walking only makes sense on arrival or when told to; otherwise people would walk in every shot.
      if (action === "walk_in" && !arriving && i > 0 && !cue.action) action = "idle";
      const face = main && cue.face && a.face === "neutral" ? cue.face : a.face;
      return { ...a, action, face };
    });

    // Two people talking: face each other.
    if (actors.length === 2) {
      const [l, r] = actors[0].x <= actors[1].x ? [actors[0], actors[1]] : [actors[1], actors[0]];
      l.facing = "right";
      r.facing = "left";
    }
    if (actors.length) s.actors = actors;
    if (s.speaker !== "narrator" && castIds.has(s.speaker)) s.camera = { ...s.camera, focus: s.speaker };
    else if (actors[0] && !s.camera.focus) s.camera = { ...s.camera, focus: actors[0].id };

    // 4. Never the same picture twice in a row.
    const prev = shots[i - 1];
    if (prev && !prev.screen && prev.layout !== "split" && sig(prev) === sig(s)) {
      sameRun++;
      s.camera = { ...s.camera, shot: actors.length >= 2 && sameRun % 2 ? "two_shot" : NEXT_SIZE[s.camera.shot] };
      if (s.actors?.length === 1) {
        const a = s.actors[0];
        s.actors = [{ ...a, x: sameRun % 2 ? 0.38 : 0.6, facing: sameRun % 2 ? "right" : "left" }];
      }
    } else sameRun = 0;
    if (prev && prev.camera.shot === s.camera.shot && prev.camera.move === s.camera.move) {
      s.camera = { ...s.camera, move: MOVES[i % MOVES.length] === s.camera.move ? MOVES[(i + 1) % MOVES.length] : MOVES[i % MOVES.length] };
    }

    lastPlace = s.place ?? lastPlace;
    if (s.actors?.length) lastActors = s.actors;
  });

  return { ...plan, shots };
}
