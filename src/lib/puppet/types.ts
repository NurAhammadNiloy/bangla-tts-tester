/**
 * Puppet engine contracts (v2). Every module of the cartoon pipeline builds
 * against these types: the Story Editor writes an EpisodePlan, the asset maker
 * writes Character/Place/Prop assets, the renderer draws them.
 *
 * Coordinates: every asset uses its own box `size: [w, h]`; shapes are SVG path
 * strings ("d") drawn with Path2D, so assets are plain JSON (easy for an LLM to
 * write and for us to validate). Colours are CSS colour strings.
 */
import type { Genre } from "@/lib/storyPlan";

/* --------------------------------- assets --------------------------------- */

export interface Shape {
  d: string; // SVG path data, in the asset's coordinates
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

/** Body parts the engine can move. Face features (eyes, brows, mouth) are drawn by the engine. */
export type PartName =
  | "body"
  | "head"
  | "hair_back"
  | "hair"
  | "arm_l"
  | "arm_r"
  | "leg_l"
  | "leg_r"
  | "accessory";

export interface Part {
  name: PartName;
  /** Rotation point in asset coordinates (shoulder for an arm, hip for a leg, neck for the head). */
  pivot: [number, number];
  /** Draw order, low first. */
  z: number;
  shapes: Shape[];
  /** Optional (added v2-puppet): hand / foot end point in asset coordinates; held props sit here. Estimated from the shapes when missing. */
  tip?: [number, number];
}

/**
 * A character. size = [w, h] with the feet at bottom-centre (w/2, h).
 * Facing right by default; the engine mirrors for facing left.
 * `face` tells the engine where to draw eyes, brows and mouth on the head
 * (in asset coordinates), so expressions, blinking and talking are automatic.
 */
export interface CharacterAsset {
  kind: "character";
  id: string;
  label?: string; // Bangla or English description
  tags: string[]; // e.g. ["old_woman","saree","village"]
  size: [number, number];
  parts: Part[];
  face: {
    eyeL: [number, number];
    eyeR: [number, number];
    mouth: [number, number];
    /** Eye radius in asset units; brows and mouth scale from it. */
    eyeSize: number;
    skin: string; // for eyelids when blinking
    ink?: string; // eye / mouth colour, default dark
  };
}

/**
 * A place: three layers for parallax. size is wider than a 9:16 frame so the
 * camera can pan: use [1620, 1920] (1.5 × 1080 wide). floorY is where feet stand.
 */
export interface PlaceAsset {
  kind: "place";
  id: string;
  label?: string;
  tags: string[];
  size: [number, number];
  floorY: number;
  layers: { back: Shape[]; mid: Shape[]; front: Shape[] };
}

export interface PropAsset {
  kind: "prop";
  id: string;
  label?: string;
  tags: string[];
  size: [number, number];
  /** Point that sits in a hand or on the floor. */
  anchor: [number, number];
  shapes: Shape[];
  /** Optional (added v2-puppet): y of the seat / mattress top for furniture actors can sit or lie on. */
  seatY?: number;
}

export type Asset = CharacterAsset | PlaceAsset | PropAsset;

export interface AssetLibrary {
  characters: Record<string, CharacterAsset>;
  places: Record<string, PlaceAsset>;
  props: Record<string, PropAsset>;
}

/* ---------------------------------- plan ---------------------------------- */

export type Face = "neutral" | "happy" | "sad" | "crying" | "angry" | "shocked" | "scared" | "worried";

export type Action =
  | "idle"
  | "talk"
  | "walk_in"
  | "walk_out"
  | "walk_to"
  | "turn"
  | "sit"
  | "stand"
  | "cry"
  | "laugh"
  | "shock"
  | "angry"
  | "hug"
  | "phone_ear"
  | "point"
  | "nod"
  | "shake_head"
  | "lie_down"
  | "pray"
  | "fall"
  | "wave"
  | "run";

export type ShotSize = "wide" | "medium" | "close" | "extreme_close" | "two_shot" | "over_shoulder" | "pov_hand";
export type CameraMove = "hold" | "push_in" | "pull_out" | "pan_left" | "pan_right" | "shake" | "whip";
export type Transition = "cut" | "fade" | "flash" | "dip_black";
export type TimeOfDay = "morning" | "day" | "evening" | "night";
export type Weather = "clear" | "rain" | "fog" | "snow" | "dust" | "smoke";

export interface CastMember {
  id: string; // stable id used in shots, e.g. "tanvir"
  name: string; // Bangla display name
  /** Library character id to use. If `new`, the asset maker builds it from `look`. */
  asset: string;
  /** Short English description used by the asset maker and for matching. */
  look: string;
  voice: "narrator" | "female" | "male" | "female_old" | "male_old" | "child";
  new?: boolean;
}

export interface PlaceRef {
  id: string;
  asset: string; // library place id
  look: string; // English description for the asset maker
  time: TimeOfDay;
  weather?: Weather;
  /** Small label shown at the top when we arrive, e.g. "রাত ২টা • পুরান ঢাকা". */
  label?: string;
  new?: boolean;
}

export interface ActorInShot {
  id: string; // cast id
  /** Horizontal position 0..1 across the frame. */
  x: number;
  action: Action;
  face: Face;
  facing?: "left" | "right";
  /** Target x for walk_to. */
  toX?: number;
  /** Prop id held in the hand. */
  prop?: string;
}

/** Screens are drawn by code templates; content is data. */
export type ScreenSpec =
  | { type: "notification"; app?: string; title: string; body: string }
  | { type: "incoming_call"; caller: string; subtitle?: string }
  | { type: "video_call"; caller: string; who: string /* cast id shown in the call */ }
  | { type: "chat"; title: string; messages: { from: "me" | "them"; text: string }[] }
  | { type: "letter"; text: string; signature?: string }
  | { type: "tv_news"; headline: string; ticker?: string }
  | { type: "calendar"; title: string; days: number; marked: number }
  | { type: "map"; from: string; to: string }
  | { type: "photo"; caption?: string; who: string[] }
  | { type: "text_card"; text: string };

export interface Shot {
  /** The spoken line (Bangla, may contain voice tags like [sad]). */
  line: string;
  /** "narrator" or a cast id. */
  speaker: string;
  place?: string; // place id from plan.places
  layout?: "single" | "split";
  actors?: ActorInShot[];
  /** For layout "split": two halves, top and bottom. */
  top?: { place: string; actors: ActorInShot[] };
  bottom?: { place: string; actors: ActorInShot[] };
  /** Full-screen or in-phone screen; when set it is the main picture of the shot. */
  screen?: ScreenSpec;
  camera: { shot: ShotSize; move: CameraMove; focus?: string };
  transition?: Transition;
  sfx?: string[];
  /** Show dialogue as a speech bubble instead of a subtitle. */
  bubble?: boolean;
  /** Silence (seconds) after the line, for suspense. */
  pause?: number;
  hook?: boolean;
  /** Props placed in the scene (not held). */
  props?: { id: string; x: number }[];
}

export interface EpisodePlan {
  version: 2;
  series: string;
  episode: number;
  title: string; // Facebook-style title
  caption: string; // 1–2 line Facebook caption
  mood: Genre;
  format: "9:16" | "4:5";
  cast: CastMember[];
  places: PlaceRef[];
  props?: { id: string; asset: string; look: string; new?: boolean }[];
  shots: Shot[];
  end: { type: "next_part" | "the_end"; text: string };
}

/* -------------------------------- renderer -------------------------------- */

/** Everything a shot needs at draw time. t = seconds into the shot, dur = shot length. */
export interface ShotFrame {
  t: number;
  dur: number;
  /** 0..1 loudness of the current speaker's voice at this moment (drives mouth flaps). */
  talk: number;
}

export type ShotDrawer = (ctx: CanvasRenderingContext2D, W: number, H: number, f: ShotFrame) => void;

/**
 * Added v2-puppet: one camera "beat" of a shot. Long lines are split into 2–3
 * beats of the same moment with different camera sizes (see splitLongShots).
 * start/end are seconds relative to the shot start.
 */
export interface RenderBeat {
  shotIndex: number;
  start: number;
  end: number;
  cameraOverride?: Shot["camera"];
}
