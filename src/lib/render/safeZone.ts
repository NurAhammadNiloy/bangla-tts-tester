/**
 * Facebook Reels covers parts of the frame with its own buttons and text.
 * Keep important things (subtitles, labels, faces) out of these zones.
 * Values are fractions of a 1080×1920 frame: top ~250 px, bottom ~380 px,
 * right edge ~120 px.
 */
export const SAFE = {
  top: 250 / 1920,
  bottom: 380 / 1920,
  right: 120 / 1080,
} as const;

/** Lowest y (fraction of H) that content should reach. */
export const SAFE_BOTTOM_Y = 1 - SAFE.bottom;
/** Widest centred text block (fraction of W) that keeps the right edge clear. */
export const SAFE_TEXT_WIDTH = 1 - 2 * SAFE.right;
