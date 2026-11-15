/**
 * Auto-director: a screenplay pass run on every plan before drawing.
 * It only fixes mechanics and never adds anything the story did not ask for
 * (no extra people, no props, no cards; empty places stay empty):
 *  1. Whoever speaks is on screen, talking, framed on them.
 *  2. Body actions follow clear cue words in the line (walking, sitting, a phone call…);
 *     faces are left as the Story Editor chose them, so acting stays natural.
 *  3. Never the same picture twice in a row: same place + same people means a
 *     new camera size, side or move.
 * Pure function, deterministic, unit-tested.
 */
import type { Action, AssetLibrary, CameraMove, EpisodePlan, Face, Shot, ShotSize } from "./types";

type Cue = { re: RegExp; action?: Action; face?: Face };

/** Bangla (and a little English) cue words → what the body and face should do. */
const CUES: Cue[] = [
  { re: /কাঁদতে|কেঁদে|কান্নায় ভেঙে|cried|crying/i, action: "cry" },
  { re: /ফোন কর|ফোন দি|ফোনে কথা|কল কর|call(ed)? /i, action: "phone_ear" },
  { re: /দৌড়|ছুটে|run/i, action: "run" },
  { re: /হাঁট|এগিয়ে|পৌঁছ|ঢুক|walk|arriv|enter/i, action: "walk_in" },
  { re: /বসে|বসল|বসলেন|বসলাম|sit/i, action: "sit" },
  { re: /শুয়ে|lie down|lying/i, action: "lie_down" },
  { re: /জড়িয়ে ধর|hug/i, action: "hug" },
  { re: /নামাজ|দোয়া কর|pray/i, action: "pray" },
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
  const castIds = new Set(plan.cast.map((c) => c.id));
  const shots: Shot[] = plan.shots.map((s) => structuredClone(s));
  let lastPlace: string | undefined;
  let sameRun = 0;

  shots.forEach((s, i) => {
    if (s.layout === "split" || s.screen) {
      lastPlace = s.layout === "split" ? s.top?.place : s.place ?? lastPlace;
      return;
    }
    const cue = cueFor(s.line);
    const arriving = s.place !== lastPlace;
    let actors = (s.actors ?? []).filter((a) => castIds.has(a.id));

    // 1. The speaker is on screen.
    if (s.speaker !== "narrator" && castIds.has(s.speaker) && !actors.some((a) => a.id === s.speaker)) {
      actors.push({ id: s.speaker, x: actors.length ? 0.68 : 0.5, action: "talk", face: "neutral" });
    }

    // 2. Body action follows the line.
    actors = actors.map((a, k) => {
      const isSpeaker = a.id === s.speaker;
      const main = isSpeaker || (s.speaker === "narrator" && k === 0);
      let action = a.action;
      if (main && cue.action && (action === "idle" || action === "talk")) action = cue.action;
      if (isSpeaker && action === "idle") action = "talk";
      // Walking only makes sense on arrival or when told to; otherwise people would walk in every shot.
      if (action === "walk_in" && !arriving && i > 0 && !cue.action) action = "idle";
      return { ...a, action };
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

    // 3. Never the same picture twice in a row.
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
  });

  return { ...plan, shots };
}
