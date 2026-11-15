export interface SceneDraft {
  narration: string;
  prompt: string;
  kind: "image" | "video";
}

/** Where the story happens (kept for every picture). */
export const DEFAULT_SETTING = "Bangladeshi village setting.";

/** Fixed character descriptions, reused in every picture so people stay recognisable in any art style. */
export const DEFAULT_CHARACTERS =
  "MOTHER — Bangladeshi woman about 55, slim, grey hair in a bun, white cotton saree with a thin red border, small round glasses. " +
  "SON — Bangladeshi man about 30, short black hair, light stubble, blue shirt, carrying a worn travel bag.";

export const DEFAULT_SCENES: SceneDraft[] = [
  {
    narration: "[sad] মা প্রতিদিন সন্ধ্যায় দরজার পাশে বসে থাকতেন, [short pause] ছেলের অপেক্ষায়।",
    prompt: "Evening. The MOTHER sits alone on the doorstep of a small tin-roof village house, looking down the empty dirt path, orange sunset sky.",
    kind: "image",
  },
  {
    narration: "[hope] আজ হয়তো সে ফিরবে, এই ভেবে চা বানিয়ে রাখতেন দুই কাপ।",
    prompt: "Inside a simple village kitchen lit by a kerosene lamp, the MOTHER places two cups of tea on a wooden table, hopeful soft smile.",
    kind: "image",
  },
  {
    narration: "[long pause] বারো বছর পর, এক বৃষ্টির রাতে, [gasp] দরজায় কড়া নাড়ার শব্দ।",
    prompt: "Rainy night outside the same house, heavy rain, lightning in the distance, a silhouette of a man knocking on the wooden door.",
    kind: "image",
  },
  {
    narration: "[whispers] মা কাঁপা গলায় বললেন, খোকা? তুই এসেছিস? [relief] ছেলেটা মায়ের পা জড়িয়ে ধরে কেঁদে ফেলল।",
    prompt: "The door is open. The SON, wet from rain, kneels and hugs the MOTHER's feet while she places a trembling hand on his head, both crying, warm lamp light.",
    kind: "video",
  },
];

/** Motion direction for image-to-video: keep it small so faces stay consistent. */
export const VIDEO_MOTION_HINT =
  "Gentle, slow, natural motion only: the mother's hand moves softly on his head, slight shoulder movement from crying, lamp light flickers, rain outside. Camera static. Keep exactly the same art style, colors and character designs as the first frame.";
