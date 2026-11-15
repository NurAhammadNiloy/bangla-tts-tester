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
  },
  {
    id: "flat",
    label: "Flat cartoon",
    emoji: "🟠",
    prompt: "Flat 2D cartoon illustration, simple clean shapes, bold outlines, soft warm colors, gentle shading.",
    goodFor: "Family, comedy",
  },
  {
    id: "anime",
    label: "Soft anime",
    emoji: "🌸",
    prompt:
      "Hand-drawn anime-style illustration, soft painterly backgrounds, expressive eyes, delicate line art, warm cinematic lighting.",
    goodFor: "Emotional, romance",
  },
  {
    id: "3d",
    label: "3D animated",
    emoji: "🧸",
    prompt:
      "3D animated movie style, rounded friendly characters, soft global illumination, subsurface skin, shallow depth of field, rich colors.",
    goodFor: "Family, kids, comedy",
  },
  {
    id: "watercolor",
    label: "Watercolor storybook",
    emoji: "🎨",
    prompt:
      "Watercolor children's storybook illustration, soft washes of color, visible paper texture, gentle hand-drawn ink lines.",
    goodFor: "Emotional, folk tales",
  },
  {
    id: "folk",
    label: "Bengali folk art",
    emoji: "🪔",
    prompt:
      "Traditional Bengali folk painting style inspired by patachitra scroll art, bold black outlines, flat earthy reds, yellows and indigo, decorative borders and patterns.",
    goodFor: "Historical, myths",
  },
  {
    id: "realistic",
    label: "Cinematic realistic",
    emoji: "🎥",
    prompt:
      "Photorealistic cinematic film still, natural skin texture, dramatic lighting, 35mm lens, shallow depth of field, film grain.",
    goodFor: "Drama, true stories",
  },
  {
    id: "horror",
    label: "Dark horror comic",
    emoji: "🌑",
    prompt:
      "Dark horror graphic-novel illustration, heavy ink shadows, desaturated blue-green palette, eerie moonlight, mist, high contrast.",
    goodFor: "Horror, thriller",
  },
  {
    id: "sketch",
    label: "Pencil sketch",
    emoji: "✏️",
    prompt: "Detailed pencil and charcoal sketch, cross-hatching, off-white paper, subtle sepia tint, expressive linework.",
    goodFor: "Memories, flashbacks",
  },
  {
    id: "clay",
    label: "Clay animation",
    emoji: "🧱",
    prompt:
      "Stop-motion claymation style, handmade plasticine characters with fingerprint texture, miniature handcrafted set, soft studio lighting.",
    goodFor: "Comedy, kids",
  },
];

/**
 * Styles that have a built-in preview picture at /previews/<id>.jpg.
 * Filled in after the one-time preview generation.
 */
export const PREVIEW_IDS: string[] = [];

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
