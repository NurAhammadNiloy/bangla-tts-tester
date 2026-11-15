/** Puppet cartoon engine (v2): public API. */
export * from "./types";
export { PALETTE, STYLE_GUIDE_TEXT } from "./styleGuide";
export { validateAsset, normalizePlan, splitLongShots, closestEnum, closestByTags, isColor } from "./validate";
export { STARTER_LIBRARY, summarizeLibrary, recolor, mergeLibrary } from "./library";
export { drawCharacter, drawFace, headPoints, NEUTRAL_POSE, type Pose, type FaceState, type PartXf } from "./rig";
export { poseAt, RECIPES, ACTIONS, travelAt, blinkAt, type Recipe } from "./actions";
export { frameShot, applyMove, layerView, transitionOverlay, wideView, PARALLAX, type View } from "./camera";
export { drawScreen, drawScreenContent } from "./screens";
export { drawTimeTint, drawWeather, drawVignette } from "./atmosphere";
export { createShotDrawer, speakerAnchor, ACTOR_SCALE, type EngineOpts } from "./engine";
export { SAMPLE_EPISODE } from "./sample";
