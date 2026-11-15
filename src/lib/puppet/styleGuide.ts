/**
 * The house style for puppet-cartoon assets. Starter assets are drawn to it and
 * the asset maker (LLM) is given STYLE_GUIDE_TEXT so new assets match.
 */

export const PALETTE = {
  ink: "#2b2730", // outlines, eyes, mouth
  paper: "#f4ecdf",
  skin: ["#f2d0b1", "#e2b48f", "#c8946b", "#a8724f", "#7f5238"],
  hair: ["#1f1a1c", "#3b2a22", "#6b4a35", "#d9d4cc"],
  cloth: ["#c94f4f", "#e0a43c", "#4f8a6e", "#3f6fa6", "#7c5ba6", "#d9d4cc", "#5a5a66", "#2f3e4f", "#efe7d6", "#9a6a43"],
  wall: ["#e8dcc6", "#d9c7a7", "#b9c7c4", "#cbb8a0", "#8f9aa8"],
  ground: ["#b98b5a", "#8fa66a", "#7d7f86", "#c9b28a"],
  sky: { morning: "#f6d9b8", day: "#bfdcec", evening: "#e9a77c", night: "#24304a" },
} as const;

export const STYLE_GUIDE_TEXT = `House style: flat 2D cut-out cartoon for vertical story reels.
- Simple geometric shapes, no gradients, no textures, no shading except one flat darker tone for shadow areas.
- Thin dark outline (#2b2730, strokeWidth 3 in a 300-unit character box) on characters and props; places have no outlines on background shapes.
- Muted, warm palette. Skin tones: ${PALETTE.skin.join(", ")}. Cloth colours: ${PALETTE.cloth.join(", ")}. Walls: ${PALETTE.wall.join(", ")}.
- Characters: head about 1/5 of body height, round or oval head, no drawn eyes/mouth (the engine draws the face), simple hands as rounded ends, feet as small ovals. Box 300 wide x 600 tall, feet at bottom centre (150, 600), facing right.
- Parts are separate so they can move: body (torso + neck + clothes), head (with ears), hair_back (behind head), hair (front), arm_l, arm_r (whole arm with hand, pivot at shoulder), leg_l, leg_r (pivot at hip), optional accessory (cap, glasses, scarf).
- Places: box 1620 wide x 1920 tall, three layers: back (sky/far wall), mid (furniture, buildings, trees), front (small foreground items at the edges only, keep the centre clear for characters). Floor line at about y=1500. Leave the middle 60% of the width uncluttered at character height.
- Props: small, readable at a glance, 1–6 shapes.
- Culturally specific clothing and settings come from the story's description; never copy a real person, brand or logo.`;
