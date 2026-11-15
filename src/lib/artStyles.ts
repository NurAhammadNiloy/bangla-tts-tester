/**
 * Art style presets for scene pictures. Described generically (no studio or
 * artist names) so the look is original. Characters are kept separately, so
 * switching style keeps the same people.
 */
export interface ArtStyle {
  id: string;
  label: string;
  emoji: string;
  prompt: string;
  /** Good fit for these story moods, shown as a hint. */
  goodFor: string;
  /** One plain sentence about the look, for the info button. */
  about: string;
}

export const ART_STYLES: ArtStyle[] = [
  {
    id: "minimal",
    label: "Minimal reel",
    emoji: "🙂",
    prompt:
      "Minimalist flat vector cartoon like a simple explainer animation: characters with large round heads, small dot eyes, " +
      "tiny curved smile, simple short hair shapes, thin tube-like arms and legs, rectangular bodies, thick dark brown outlines, " +
      "flat solid colors with no texture, warm orange, brown and cream palette, plain softly blurred background with shallow depth of field, " +
      "simple props, white thought bubbles with clear icons when a character is thinking.",
    goodFor: "Facebook reels, comedy, life stories",
    about: "Very simple characters with round heads and dot eyes on warm orange-brown backgrounds, like popular Bangla story reels. Easy to read on a small screen.",
  },
  {
    id: "flat",
    label: "Flat cartoon",
    emoji: "🟠",
    prompt: "Flat 2D cartoon illustration, simple clean shapes, bold outlines, soft warm colors, gentle shading.",
    goodFor: "Family, comedy",
    about: "Clean cartoon drawings with bold outlines and soft colours. More detail than Minimal reel, still friendly and bright.",
  },
  {
    id: "anime",
    label: "Soft anime",
    emoji: "🌸",
    prompt:
      "Hand-drawn anime-style illustration, soft painterly backgrounds, expressive eyes, delicate line art, warm cinematic lighting.",
    goodFor: "Emotional, romance",
    about: "Hand-drawn look with painted backgrounds, expressive faces and warm, film-like light. Best for touching and emotional stories.",
  },
  {
    id: "explainer",
    label: "Explainer",
    emoji: "🧠",
    prompt:
      "Minimal dark explainer infographic illustration: deep charcoal background, simple flat shapes and thin outlines, " +
      "a warm amber-gold accent color for the key element, clean diagrams, icons and simple stick-like figures, lots of empty space, " +
      "calm and modern, like a science explainer video.",
    goodFor: "Science, psychology, facts",
    about: "Dark, calm diagrams and icons with one gold highlight, like science and psychology explainer reels. Best when the video explains an idea rather than tells a story.",
  },
];

/**
 * Styles that have a built-in preview picture at /previews/<id>.jpg.
 * Filled in after the one-time preview generation.
 */
export const PREVIEW_IDS: string[] = ["minimal", "flat", "anime"];

export function previewSrc(id: string): string | null {
  return PREVIEW_IDS.includes(id) ? `/previews/${id}.jpg` : null;
}

/** The same scene drawn in every style, so previews are directly comparable. */
export const PREVIEW_SCENE =
  "The MOTHER sits on the doorstep of a small tin-roof village house at sunset, looking hopefully down an empty dirt path, banana trees around.";

export const ALWAYS = "Vertical 9:16 composition, no text, letters or watermarks in the image.";

export function buildImagePrompt(stylePrompt: string, setting: string, characters: string, scene: string): string {
  return [stylePrompt.trim(), setting.trim(), ALWAYS, characters.trim() && `Characters: ${characters.trim()}`, `Scene: ${scene.trim()}`]
    .filter(Boolean)
    .join("\n");
}
