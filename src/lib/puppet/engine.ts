/**
 * The puppet engine: turns one shot of an EpisodePlan into a ShotDrawer that
 * can paint any moment of that shot. Order: place back → mid → placed props →
 * actors → place front → weather → time tint → vignette → screen → label pill
 * → transition overlay. Subtitles and speech bubbles are drawn by the renderer.
 *
 * Time: ShotFrame.t / dur are SHOT-relative. A render beat (from
 * splitLongShots) only changes the camera: opts.beat.start/end say when that
 * beat's camera move runs, so actions continue smoothly across beats.
 */
import type {
  PlacedPropRef,
  ActorInShot,
  AssetLibrary,
  CharacterAsset,
  EpisodePlan,
  PlaceAsset,
  PlaceRef,
  PropAsset,
  Shot,
  ShotDrawer,
  ShotFrame,
} from "./types";
import { PALETTE } from "./styleGuide";
import { BN_FONT, clamp, drawShapes, easeInOut, getMat, mul, rotate, roundRectPath, setMat, strSeed, translate, type ColorMap, type Mat } from "./draw";
import { drawCharacter, headPoints, type Pose } from "./rig";
import { poseAt, travelAt } from "./actions";
import {
  applyMove,
  clampView,
  frameShot,
  frameXToPlace,
  layerView,
  PARALLAX,
  toScreen,
  transitionOverlay,
  viewMatrix,
  wideView,
  type ActorBox,
  type View,
} from "./camera";
import { drawTimeTint, drawVignette, drawWeather, skyColor } from "./atmosphere";
import { drawScreen, screenInPhone } from "./screens";
import { shade } from "./library/characters";

/** Place units per character-asset unit (a 600-unit character is 780 units tall in a 1920 place). */
export const ACTOR_SCALE = 1.3;

/** Props that belong on the ceiling (fans, hanging bulbs) and props that spin (fans). */
const CEILING_RE = /fan|ceiling|chandelier|hanging|bulb|পাখা|ফ্যান/i;
const SPIN_RE = /fan|পাখা|ফ্যান/i;
/** A hand fan swings back and forth (a loop) instead of spinning. */
const HAND_FAN_RE = /hand[ _-]?fan|hatpakha|হাতপাখা|হাত পাখা/i;
/** Handwriting reveal: starts at WRITE_START seconds and takes WRITE_SECONDS. */
const WRITE_START = 0.4;
const WRITE_SECONDS = 1.6;
function propText(id: string | undefined, a: PropAsset): string {
  return `${id ?? ""} ${a.id} ${a.label ?? ""} ${a.tags.join(" ")}`;
}

export interface BeatOpts {
  /** Shot-relative seconds when this beat starts / ends (camera move timing). */
  start?: number;
  end?: number;
  cameraOverride?: Shot["camera"];
}

export interface EngineOpts {
  beat?: BeatOpts;
  /** Draw the vignette (default true). */
  vignette?: boolean;
}

const BLANK_PLACE: PlaceAsset = {
  kind: "place",
  id: "_blank",
  tags: [],
  size: [1620, 1920],
  floorY: 1500,
  layers: {
    back: [
      { d: "M0 0H1620V1500H0Z", fill: PALETTE.wall[0] },
      { d: "M0 1500H1620V1920H0Z", fill: PALETTE.ground[0] },
    ],
    mid: [],
    front: [],
  },
};

/* -------------------------------- resolving ------------------------------- */

export function shotPlaceId(plan: EpisodePlan, i: number): string | undefined {
  for (let k = i; k >= 0; k--) {
    const s = plan.shots[k];
    if (!s) continue;
    if (s.place) return s.place;
    if (s.layout === "split" && s.top?.place) return s.top.place;
  }
  return plan.places?.[0]?.id;
}

export function resolvePlace(plan: EpisodePlan, placeId: string | undefined, lib: AssetLibrary): { ref?: PlaceRef; asset: PlaceAsset } {
  const ref = plan.places?.find((p) => p.id === placeId) ?? plan.places?.[0];
  const asset = (ref && (lib.places[ref.asset] ?? lib.places[ref.id])) ?? (placeId ? lib.places[placeId] : undefined) ?? Object.values(lib.places)[0] ?? BLANK_PLACE;
  return { ref, asset };
}

export function resolveCharacter(plan: EpisodePlan, castId: string, lib: AssetLibrary): CharacterAsset | null {
  const m = plan.cast?.find((c) => c.id === castId);
  return (m && lib.characters[m.asset]) ?? lib.characters[castId] ?? Object.values(lib.characters)[0] ?? null;
}

export function resolveProp(plan: EpisodePlan, propId: string | undefined, lib: AssetLibrary): PropAsset | null {
  if (!propId) return null;
  const ref = plan.props?.find((p) => p.id === propId);
  return (ref && lib.props[ref.asset]) ?? lib.props[propId] ?? null;
}

/* ---------------------------------- scene --------------------------------- */

export interface ActorState {
  actor: ActorInShot;
  asset: CharacterAsset;
  x: number; // place coords (feet)
  y: number;
  facing: "left" | "right";
  pose: Pose;
  prop: PropAsset | null;
  /** Framing box (stable through the shot). */
  box: ActorBox;
}

export interface PlacedProp {
  id?: string;
  asset: PropAsset;
  x: number;
  y: number;
  /** "off" keeps a fan still. */
  state?: "on" | "off";
  /** Handwriting written stroke by stroke on this prop (a notebook page, a note). */
  text?: string;
}

/** 0..1 progress of the write-on at shot-relative time t. */
export function writeProgress(t: number): number {
  return clamp((t - WRITE_START) / WRITE_SECONDS, 0, 1);
}

export interface SceneState {
  place: PlaceAsset;
  ref?: PlaceRef;
  view: View;
  wide: View;
  actors: ActorState[];
  props: PlacedProp[];
}

interface SceneDef {
  placeId?: string;
  actors: ActorInShot[];
  props?: PlacedPropRef[];
}

function hipHeight(a: CharacterAsset): number {
  const leg = a.parts.find((p) => p.name === "leg_r" || p.name === "leg_l");
  return leg ? a.size[1] - leg.pivot[1] : a.size[1] * 0.36;
}

/** Frame-x (0..1) of an actor at time t, plus facing. */
function actorTrack(a: ActorInShot, all: ActorInShot[], t: number, dur: number): { x: number; facing: "left" | "right"; endX: number } {
  const others = all.filter((o) => o.id !== a.id);
  const near = others.length ? others.reduce((b, o) => (Math.abs(o.x - a.x) < Math.abs(b.x - a.x) ? o : b)) : null;
  let facing: "left" | "right" = a.facing ?? (near ? (near.x >= a.x ? "right" : "left") : a.x <= 0.55 ? "right" : "left");
  let from = a.x,
    to = a.x;
  switch (a.action) {
    case "walk_in":
      if (!a.facing) facing = a.x <= 0.5 ? "right" : "left";
      from = facing === "right" ? -0.3 : 1.3;
      break;
    case "walk_out":
      to = facing === "right" ? 1.35 : -0.35;
      break;
    case "walk_to":
      to = clamp(a.toX ?? a.x + (facing === "right" ? 0.3 : -0.3), -0.4, 1.4);
      if (!a.facing && to !== a.x) facing = to > a.x ? "right" : "left";
      break;
    case "run":
      to = a.toX ?? (facing === "right" ? 1.4 : -0.4);
      if (!a.facing && to !== a.x) facing = to > a.x ? "right" : "left";
      break;
    case "hug":
      if (near) {
        const mutual = near.action === "hug";
        const gap = 0.2;
        const meet = mutual ? (a.x + near.x) / 2 : near.x;
        to = meet + (near.x >= a.x ? -1 : 1) * (mutual ? gap / 2 : gap);
        facing = near.x >= a.x ? "right" : "left";
      }
      break;
    case "turn":
      if (t >= Math.min(0.3, dur * 0.4)) facing = facing === "right" ? "left" : "right";
      break;
  }
  let x = a.x;
  if (from !== to || a.action === "walk_in") {
    let p: number;
    if (a.action === "hug") p = easeInOut(clamp(t / 0.7, 0, 1));
    else p = travelAt(a.action, t, dur).p;
    x = from + (to - from) * p;
  }
  return { x, facing, endX: a.action === "walk_out" || a.action === "run" ? a.x : to };
}

export function buildScene(
  plan: EpisodePlan,
  lib: AssetLibrary,
  def: SceneDef,
  shot: Shot,
  speaker: string,
  f: ShotFrame,
  W: number,
  H: number,
  camera: Shot["camera"],
  beat?: BeatOpts,
): SceneState {
  const { ref, asset: place } = resolvePlace(plan, def.placeId, lib);
  const pw = place.size[0];
  const floor = place.floorY;
  const t = Math.max(0, f.t),
    dur = Math.max(0.1, f.dur);

  const props: PlacedProp[] = [];
  for (const p of def.props ?? []) {
    const a = resolveProp(plan, p.id, lib);
    if (!a) continue;
    // Ceiling props hang with their top just under the ceiling (well above a standing head).
    const ceilingY = floor - 600 * ACTOR_SCALE * 1.7;
    const y = CEILING_RE.test(propText(p.id, a)) ? ceilingY + a.anchor[1] * ACTOR_SCALE : floor;
    props.push({ id: p.id, asset: a, x: frameXToPlace(p.x, pw), y, ...(p.state ? { state: p.state } : {}), ...(p.text ? { text: p.text } : {}) });
  }

  const actors: ActorState[] = [];
  for (const a of def.actors ?? []) {
    const asset = resolveCharacter(plan, a.id, lib);
    if (!asset) continue;
    const seed = strSeed(a.id) + 1;
    const tr = actorTrack(a, def.actors, t, dur);
    let x = frameXToPlace(tr.x, pw);
    let boxX = frameXToPlace(tr.endX, pw);
    let seat: number | undefined;
    if (a.action === "sit" || a.action === "stand" || a.action === "lie_down") {
      const want = a.action === "lie_down" ? "bed" : "chair";
      const cands = props.filter((p) => p.asset.seatY !== undefined);
      const best = cands
        .map((p) => ({ p, d: Math.abs(p.x - x) + (p.asset.tags.includes(want) ? 0 : 200) }))
        .sort((m, n) => m.d - n.d)[0];
      if (best && best.d < 420) {
        const pr = best.p;
        seat = (pr.asset.size[1] - (pr.asset.seatY as number)) * 1; // character units (props share the character scale)
        const dir = tr.facing === "right" ? 1 : -1;
        if (a.action === "lie_down") x = pr.x + pr.asset.size[0] * 0.42 * ACTOR_SCALE * dir;
        else x = pr.x + (pr.asset.anchor[0] - pr.asset.size[0] / 2 + 6) * ACTOR_SCALE * dir;
        boxX = x;
      }
    }
    let prop = resolveProp(plan, a.prop, lib);
    if (!prop && a.action === "phone_ear") prop = lib.props["smartphone"] ?? null;
    const talk = speaker === a.id ? clamp(f.talk, 0, 1) : 0;
    const pose = poseAt(a.action, t, dur, talk, seed, { face: a.face, hipHeight: hipHeight(asset), seat, holding: !!prop });
    // stable framing box from the end pose without breathing/talking
    const still = poseAt(a.action, dur, dur, 0, seed, { face: a.face, hipHeight: hipHeight(asset), seat });
    const hp = headPoints(asset, still, { x: boxX, y: floor, scale: ACTOR_SCALE, facing: tr.facing });
    const box: ActorBox = { x: (hp.face[0] + boxX) / 2, headTop: Math.min(hp.top[1], hp.face[1] - 40), faceY: hp.face[1], feetY: floor };
    actors.push({ actor: a, asset, x, y: floor, facing: tr.facing, pose, prop, box });
  }
  // lying actors behind standing ones
  actors.sort((m, n) => Number(n.actor.action === "lie_down") - Number(m.actor.action === "lie_down"));

  // camera
  const focusId = camera.focus ?? speaker;
  const fi = actors.findIndex((s) => s.actor.id === focusId);
  const ordered = fi > 0 ? [actors[fi], ...actors.filter((_, i) => i !== fi)] : actors;
  const wide = wideView(place.size, floor, W, H);
  // Insert shot: camera.focus names a placed prop → frame that object large (a key object close-up).
  const focusProp = fi < 0 ? props.find((pr) => pr.id === focusId) : undefined;
  let view = focusProp
    ? (() => {
        const pw2 = focusProp.asset.size[0] * ACTOR_SCALE;
        const ph2 = focusProp.asset.size[1] * ACTOR_SCALE;
        const s = Math.min(W / (pw2 * 1.9), H / (ph2 * 2.6));
        return clampView({ s, cx: focusProp.x - (focusProp.asset.anchor[0] * ACTOR_SCALE - pw2 / 2), cy: focusProp.y - (focusProp.asset.anchor[1] * ACTOR_SCALE - ph2 / 2) }, place.size, W, H);
      })()
    : frameShot(camera.shot, ordered.map((s) => s.box), place.size, floor, W, H);
  const b0 = beat?.start ?? 0;
  const b1 = beat?.end ?? dur;
  const p = (t - b0) / Math.max(0.1, b1 - b0);
  view = applyMove(view, camera.move, p, t - b0, strSeed(shot.line ?? "") + 3, W);
  return { place, ref, view, wide, actors, props };
}

/** Draw `text` in asset units inside a w×h box, revealed left to right by `progress`. */
export function drawWriteOn(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, progress: number) {
  if (progress <= 0 || !text) return;
  ctx.save();
  const size = Math.min(h * 0.3, (w * 0.8) / Math.max(1, [...text].length * 0.6));
  ctx.font = `700 ${size}px ${BN_FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const tw = ctx.measureText(text).width || size * text.length * 0.6;
  const x0 = w / 2 - tw / 2;
  ctx.beginPath();
  ctx.rect(x0 - size * 0.2, 0, (tw + size * 0.4) * progress, h);
  ctx.clip();
  ctx.fillStyle = "#23336b";
  ctx.translate(0, 0);
  ctx.fillText(text, w / 2, h * 0.52);
  ctx.restore();
}

function colorMapFor(ref?: PlaceRef): ColorMap {
  const sky = skyColor(ref?.time);
  return (c) => (c === "$sky" ? sky : c === "$skyDark" ? shade(sky, 0.8) : c);
}

/** Draw a scene into the viewport (ox, oy, W, H). */
export function drawScene(ctx: CanvasRenderingContext2D, base: Mat, sc: SceneState, ox: number, oy: number, W: number, H: number, t: number, opts: EngineOpts = {}) {
  const cmap = colorMapFor(sc.ref);
  const layer = (k: number, shapes: PlaceAsset["layers"]["back"]) => {
    const v = layerView(sc.view, sc.wide, k);
    setMat(ctx, base, viewMatrix(v, W, H, ox, oy));
    drawShapes(ctx, shapes ?? [], cmap);
  };
  ctx.save();
  setMat(ctx, base, [1, 0, 0, 1, 0, 0]);
  ctx.beginPath();
  ctx.rect(ox, oy, W, H);
  ctx.clip();
  ctx.fillStyle = cmap("$sky");
  ctx.fillRect(ox, oy, W, H);
  layer(PARALLAX.back, sc.place.layers.back);
  layer(PARALLAX.mid, sc.place.layers.mid);
  const vm = viewMatrix(sc.view, W, H, ox, oy);
  for (const p of sc.props) {
    const s = ACTOR_SCALE;
    const label = propText(p.id, p.asset);
    const [ax, ay] = p.asset.anchor;
    const m0: Mat = [vm[0] * s, 0, 0, vm[3] * s, vm[4] + vm[0] * (p.x - ax * s), vm[5] + vm[3] * (p.y - ay * s)];
    if (SPIN_RE.test(label) && HAND_FAN_RE.test(label)) {
      // Hand fan: a steady back-and-forth swing around the handle (loops forever).
      setMat(ctx, base, mul(m0, mul(translate(ax, ay), mul(rotate(Math.sin(t * 7) * 0.45), translate(-ax, -ay)))));
    } else if (SPIN_RE.test(label) && p.state !== "off") {
      // A spinning fan seen from the side: the blades sweep, so squeeze the width around the centre.
      const sx = s * (0.35 + 0.65 * Math.abs(Math.cos(t * 9)));
      const cx = p.x - ax * s + (p.asset.size[0] * s) / 2;
      setMat(ctx, base, [vm[0] * sx, 0, 0, vm[3] * s, vm[4] + vm[0] * (cx - (p.asset.size[0] * sx) / 2), vm[5] + vm[3] * (p.y - ay * s)]);
    } else {
      setMat(ctx, base, m0); // a fan that is off hangs still
    }
    drawShapes(ctx, p.asset.shapes);
    if (p.text) {
      // Handwriting appears from left to right, like a pen moving.
      setMat(ctx, base, m0);
      drawWriteOn(ctx, p.text, p.asset.size[0], p.asset.size[1], writeProgress(t));
    }
  }
  setMat(ctx, base, vm);
  for (const a of sc.actors) {
    // soft contact shadow
    if (a.actor.action !== "lie_down") {
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, 95 * ACTOR_SCALE * (a.asset.size[0] / 300), 14 * ACTOR_SCALE, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawCharacter(ctx, a.asset, a.pose, { x: a.x, y: a.y, scale: ACTOR_SCALE, facing: a.facing, prop: a.prop });
  }
  layer(PARALLAX.front, sc.place.layers.front);
  setMat(ctx, base, [1, 0, 0, 1, 0, 0]);
  const r = { x: ox, y: oy, w: W, h: H };
  drawTimeTint(ctx, sc.ref?.time, r);
  drawWeather(ctx, sc.ref?.weather, t, r, strSeed(sc.place.id) + 1);
  if (opts.vignette !== false) drawVignette(ctx, r, sc.ref?.time === "night" ? 0.45 : 0.28);
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, W: number, H: number, t: number) {
  const a = t < 0.25 ? t / 0.25 : t > 1.6 ? 1 - (t - 1.6) / 0.4 : 1;
  if (a <= 0 || !text) return;
  const size = Math.round(W * 0.036);
  ctx.save();
  ctx.globalAlpha *= clamp(a, 0, 1);
  ctx.font = `600 ${size}px ${BN_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let s = text;
  const maxW = W * 0.8;
  while (s.length > 2 && ctx.measureText(s).width > maxW) s = s.slice(0, -2) + "…";
  const tw = ctx.measureText(s).width;
  const padX = size * 0.8,
    h = size * 1.9;
  const x = (W - tw) / 2 - padX,
    y = H * 0.06;
  ctx.fillStyle = "rgba(20,18,28,0.62)";
  roundRectPath(ctx, x, y, tw + padX * 2, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(s, x + padX, y + h / 2);
  ctx.restore();
}

function sceneDefs(shot: Shot): { top: SceneDef; bottom: SceneDef } | null {
  if (shot.layout !== "split") return null;
  return {
    top: { placeId: shot.top?.place ?? shot.place, actors: shot.top?.actors ?? [] },
    bottom: { placeId: shot.bottom?.place ?? shot.place, actors: shot.bottom?.actors ?? [] },
  };
}

/** Create the drawer for one shot (or one render beat of it). */
export function createShotDrawer(plan: EpisodePlan, shotIndex: number, lib: AssetLibrary, opts: EngineOpts = {}): ShotDrawer {
  const shot: Shot = plan.shots[shotIndex] ?? plan.shots[0];
  const camera = opts.beat?.cameraOverride ?? shot.camera ?? { shot: "wide", move: "hold" };
  const placeId = shotPlaceId(plan, shotIndex);
  const prevPlace = shotIndex > 0 ? shotPlaceId(plan, shotIndex - 1) : undefined;
  const { ref } = resolvePlace(plan, placeId, lib);
  const label = ref?.label && (shotIndex === 0 || prevPlace !== placeId) && shot.layout !== "split" ? ref.label : "";
  const beatStart = opts.beat?.start ?? 0;
  const next = plan.shots[shotIndex + 1];
  const split = sceneDefs(shot);
  const speaker = shot.speaker;
  const clock = ref?.time === "night" ? "২:০৭" : ref?.time === "morning" ? "৭:১৫" : ref?.time === "evening" ? "৬:৪০" : "১২:৩০";

  return (ctx: CanvasRenderingContext2D, W: number, H: number, f: ShotFrame) => {
    const base = getMat(ctx);
    const t = Math.max(0, f.t);
    const dur = Math.max(0.1, f.dur);
    const mainDef: SceneDef = { placeId, actors: shot.actors ?? [], props: shot.props };
    ctx.save();
    if (shot.screen) {
      const inPhone = screenInPhone(shot.screen, camera.shot);
      const firstActor = (shot.actors ?? [])[0];
      const holder = firstActor ? resolveCharacter(plan, firstActor.id, lib) : resolveCharacter(plan, plan.cast?.[0]?.id ?? "", lib);
      drawScreen(ctx, shot.screen, W, H, {
        t: t - beatStart,
        dur,
        shot: camera.shot,
        plan,
        lib,
        talk: shot.screen.type === "video_call" && speaker === shot.screen.who ? f.talk : 0,
        handSkin: holder?.face.skin,
        clock,
        background: inPhone
          ? (c) => drawScene(c, base, buildScene(plan, lib, mainDef, shot, "", f, W, H, { shot: "medium", move: "hold" }), 0, 0, W, H, t, opts)
          : undefined,
      });
    } else if (split) {
      const h2 = H / 2;
      const top = buildScene(plan, lib, split.top, shot, speaker, f, W, h2, camera, opts.beat);
      const bot = buildScene(plan, lib, split.bottom, shot, speaker, f, W, h2, camera, opts.beat);
      drawScene(ctx, base, top, 0, 0, W, h2, t, opts);
      drawScene(ctx, base, bot, 0, h2, W, h2, t, opts);
      setMat(ctx, base, [1, 0, 0, 1, 0, 0]);
      ctx.fillStyle = PALETTE.ink;
      ctx.fillRect(0, h2 - W * 0.006, W, W * 0.012);
      ctx.fillStyle = "#f4ecdf";
      ctx.fillRect(0, h2 - W * 0.003, W, W * 0.006);
    } else {
      const sc = buildScene(plan, lib, mainDef, shot, speaker, f, W, H, camera, opts.beat);
      drawScene(ctx, base, sc, 0, 0, W, H, t, opts);
    }
    setMat(ctx, base, [1, 0, 0, 1, 0, 0]);
    if (label && beatStart === 0) drawLabel(ctx, label, W, H, t);
    const ov = transitionOverlay(beatStart === 0 ? shot.transition : undefined, opts.beat?.end !== undefined && opts.beat.end < dur - 0.01 ? undefined : next?.transition, t, dur);
    if (ov) {
      ctx.globalAlpha = ov.alpha;
      ctx.fillStyle = ov.color;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.setTransform(base[0], base[1], base[2], base[3], base[4], base[5]);
  };
}

/**
 * Screen position (output pixels) of the current speaker's head top, for a
 * speech-bubble tail. null when the speaker is not on screen.
 */
export function speakerAnchor(plan: EpisodePlan, shotIndex: number, lib: AssetLibrary, W: number, H: number, f: ShotFrame, opts: EngineOpts = {}): { x: number; y: number } | null {
  const shot = plan.shots[shotIndex];
  if (!shot || shot.screen || !shot.speaker || shot.speaker === "narrator") return null;
  const camera = opts.beat?.cameraOverride ?? shot.camera ?? { shot: "wide", move: "hold" };
  const find = (def: SceneDef, h: number, oy: number) => {
    if (!def.actors?.some((a) => a.id === shot.speaker)) return null;
    const sc = buildScene(plan, lib, def, shot, shot.speaker, f, W, h, camera, opts.beat);
    const a = sc.actors.find((s) => s.actor.id === shot.speaker);
    if (!a) return null;
    const hp = headPoints(a.asset, a.pose, { x: a.x, y: a.y, scale: ACTOR_SCALE, facing: a.facing });
    const [x, y] = toScreen(sc.view, W, h, hp.top, 0, oy);
    return { x: clamp(x, 0, W), y: clamp(y, oy, oy + h) };
  };
  const split = sceneDefs(shot);
  if (split) return find(split.top, H / 2, 0) ?? find(split.bottom, H / 2, H / 2);
  return find({ placeId: shotPlaceId(plan, shotIndex), actors: shot.actors ?? [], props: shot.props }, H, 0);
}
