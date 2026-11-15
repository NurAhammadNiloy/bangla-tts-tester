/**
 * Starter props, in character units (a character is 300 × 600). `anchor` is the
 * point that sits in the hand (hand props) or on the floor (furniture, bottom
 * centre). Furniture you can sit or lie on has `seatY` (seat / mattress top).
 */
import type { PropAsset, Shape } from "../types";
import { PALETTE } from "../styleGuide";
import { pen } from "../path";
import { shade } from "./characters";

const P = pen();
const INK = PALETTE.ink;
const C = PALETTE.cloth;
const s = (fill: string, d: string, w = 3): Shape => ({ d, fill, stroke: INK, strokeWidth: w });
const n = (fill: string, d: string, opacity?: number): Shape => ({ d, fill, ...(opacity !== undefined ? { opacity } : {}) });

const prop = (id: string, label: string, tags: string[], size: [number, number], anchor: [number, number], shapes: Shape[], seatY?: number): PropAsset => ({
  kind: "prop",
  id,
  label,
  tags,
  size,
  anchor,
  shapes,
  ...(seatY !== undefined ? { seatY } : {}),
});

export const STARTER_PROPS: PropAsset[] = [
  prop("smartphone", "স্মার্টফোন (smartphone)", ["phone", "smartphone", "mobile", "call", "screen", "hand"], [44, 80], [30, 52], [
    s("#2f3440", P.rrect(2, 2, 40, 76, 8)),
    n("#9fc6e0", P.rrect(7, 9, 30, 58, 3)),
    n("#ffffff", P.rect(10, 12, 10, 4), 0.6),
  ]),
  prop("keypad_phone", "বাটন ফোন (keypad phone)", ["phone", "keypad_phone", "mobile", "old_phone", "call", "village", "hand"], [36, 76], [18, 52], [
    s(C[6], P.rrect(2, 2, 32, 72, 8)),
    n("#bcd8c6", P.rect(7, 8, 22, 20)),
    ...[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => n(C[5], P.rect(8 + c * 7.5, 36 + r * 10, 5, 6)))),
  ]),
  prop("letter", "চিঠি (letter)", ["letter", "paper", "note", "chithi", "envelope", "hand"], [70, 90], [12, 70], [
    s(PALETTE.paper, P.poly([[4, 6], [62, 2], [66, 86], [8, 88]])),
    ...[0, 1, 2, 3, 4].map((i) => ({ d: P.curve([[14, 20 + i * 13], [30, 17 + i * 13], [46, 21 + i * 13], [56, 18 + i * 13]]), fill: "none", stroke: "#5a6a8a", strokeWidth: 2 })),
  ]),
  prop("bag", "ব্যাগ (shoulder / hand bag)", ["bag", "handbag", "purse", "school_bag", "hand"], [90, 110], [45, 6], [
    { d: P.curve([[20, 46], [24, 4], [45, 2], [66, 4], [70, 46]]), fill: "none", stroke: INK, strokeWidth: 6 },
    s(C[9], P.rrect(6, 40, 78, 66, 12)),
    s(shade(C[9], 0.85), P.rrect(6, 40, 78, 24, 10)),
    n(C[1], P.rect(40, 58, 10, 10)),
  ]),
  prop("delivery_bag", "ডেলিভারি ব্যাগ (food delivery box bag)", ["bag", "delivery", "food_delivery", "rider", "box", "parcel", "hand"], [110, 120], [55, 6], [
    { d: P.curve([[30, 30], [34, 2], [76, 2], [80, 30]]), fill: "none", stroke: INK, strokeWidth: 6 },
    s(C[1], P.rrect(4, 26, 102, 92, 10)),
    s(shade(C[1], 0.85), P.rect(4, 50, 102, 14)),
    n(C[8], P.ellipse(55, 90, 16, 16)),
  ]),
  prop("cup", "চায়ের কাপ (tea cup)", ["cup", "tea", "cha", "mug", "drink", "hand"], [46, 42], [8, 22], [
    s(C[8], P.poly([[10, 8], [40, 8], [36, 38], [14, 38]])),
    { d: P.curve([[12, 14], [0, 20], [12, 30]]), fill: "none", stroke: INK, strokeWidth: 4 },
    n("#9a6a43", P.ellipse(25, 10, 14, 3)),
  ]),
  prop("lantern", "হারিকেন (hurricane lantern)", ["lantern", "harikane", "lamp", "light", "village", "night", "hand"], [60, 110], [30, 4], [
    { d: P.curve([[12, 30], [14, 2], [30, 0], [46, 2], [48, 30]]), fill: "none", stroke: INK, strokeWidth: 4 },
    s(C[6], P.rect(14, 26, 32, 10)),
    s("#f6d27a", P.blob([[30, 36], [52, 58], [48, 86], [12, 86], [8, 58]])),
    n("#ffffff", P.ellipse(30, 66, 6, 12), 0.7),
    s(C[0], P.rrect(6, 84, 48, 22, 6)),
  ]),
  prop("umbrella", "ছাতা (open umbrella)", ["umbrella", "chhata", "rain", "hand"], [240, 300], [126, 290], [
    { d: P.line([120, 40], [120, 280]), fill: "none", stroke: INK, strokeWidth: 6 },
    { d: P.curve([[120, 278], [120, 296], [134, 296], [136, 284]]), fill: "none", stroke: INK, strokeWidth: 6 },
    s(C[7], P.poly([[2, 120], [30, 70], [70, 40], [120, 30], [170, 40], [210, 70], [238, 120], [200, 108], [160, 120], [120, 108], [80, 120], [40, 108]])),
    n(shade(C[7], 1.4), P.poly([[80, 118], [100, 50], [120, 30], [118, 108]]), 0.5),
  ]),
  prop("chair", "চেয়ার (wooden chair)", ["chair", "seat", "furniture", "wood", "floor"], [170, 290], [85, 290], [
    s(C[9], P.rect(14, 0, 22, 290)),
    s(C[9], P.rect(14, 150, 150, 22)),
    s(C[9], P.rect(140, 170, 20, 120)),
    s(shade(C[9], 0.85), P.rect(36, 30, 10, 120)),
    s(shade(C[9], 0.85), P.rect(14, 40, 22, 14)),
  ], 150),
  prop("table", "টেবিল (table)", ["table", "desk", "furniture", "wood", "floor"], [320, 260], [160, 260], [
    s(GR(0), P.rect(0, 0, 320, 26)),
    s(C[9], P.rect(20, 26, 22, 234)),
    s(C[9], P.rect(278, 26, 22, 234)),
    s(shade(C[9], 0.85), P.rect(42, 26, 236, 40)),
  ]),
  prop("bed", "খাট (bed)", ["bed", "khat", "sleep", "furniture", "floor", "sick"], [620, 230], [310, 230], [
    s(C[9], P.rect(0, 20, 30, 210)),
    s(C[9], P.rect(590, 90, 30, 140)),
    s(C[8], P.rrect(20, 100, 590, 50, 14)),
    s(C[3], P.rect(200, 100, 410, 52)),
    s(C[5], P.ellipse(90, 92, 64, 24)),
    s(C[9], P.rect(20, 150, 590, 34)),
  ], 100),
  prop("money_notes", "টাকার নোট (money notes)", ["money", "taka", "notes", "cash", "payment", "hand"], [80, 50], [16, 34], [
    s("#a6c79a", P.poly([[10, 18], [74, 6], [78, 34], [14, 46]])),
    s("#c3dcb5", P.poly([[4, 12], [68, 2], [72, 28], [8, 38]])),
    n("#7fa36f", P.ellipse(38, 20, 10, 8)),
  ]),
  prop("suitcase", "সুটকেস (suitcase)", ["suitcase", "luggage", "travel", "bag", "trip", "hand"], [130, 130], [65, 6], [
    s(INK, P.rrect(44, 0, 42, 22, 8)),
    s(C[0], P.rrect(2, 18, 126, 108, 12)),
    n(shade(C[0], 0.8), P.rect(30, 18, 12, 108)),
    n(shade(C[0], 0.8), P.rect(88, 18, 12, 108)),
  ]),
  prop("flashlight", "টর্চ (torch / flashlight)", ["flashlight", "torch", "light", "night", "hand"], [70, 30], [20, 15], [
    s(C[6], P.rrect(2, 8, 46, 16, 6)),
    s(C[5], P.poly([[46, 4], [66, 0], [66, 30], [46, 26]])),
    n("#f6d27a", P.poly([[66, 2], [70, 2], [70, 28], [66, 28]])),
  ]),
  // Added for the director's brief: things a still room can hold.
  prop("ceiling_fan", "সিলিং ফ্যান (ceiling fan, side view)", ["fan", "ceiling_fan", "ceiling", "pakha", "room", "hanging"], [240, 110], [120, 0], [
    n(INK, P.rect(117, 0, 6, 34)),
    s("#c9ced8", P.ellipse(48, 46, 50, 7)),
    s("#c9ced8", P.ellipse(192, 46, 50, 7)),
    s("#8b8f99", P.ellipse(120, 42, 22, 12)),
  ]),
  prop("hand_fan", "হাতপাখা (hand fan)", ["hand_fan", "hatpakha", "pakha", "fan", "village", "hand"], [90, 110], [45, 104], [
    s("#8a5a36", P.rect(41, 58, 8, 48)),
    s("#d9b46a", P.ellipse(45, 34, 38, 32)),
    { d: P.curve([[45, 4], [45, 34], [45, 64]]), fill: "none", stroke: "#9a7a3a", strokeWidth: 2 },
    { d: P.curve([[10, 34], [45, 34], [80, 34]]), fill: "none", stroke: "#9a7a3a", strokeWidth: 2 },
  ]),
  prop("notebook", "খাতা (notebook, top view)", ["notebook", "khata", "diary", "paper", "book", "writing"], [110, 140], [55, 140], [
    s("#f4efe3", P.rrect(2, 2, 106, 136, 6)),
    n("#b9c4d6", P.rect(14, 38, 82, 2)),
    n("#b9c4d6", P.rect(14, 62, 82, 2)),
    n("#b9c4d6", P.rect(14, 86, 82, 2)),
    n("#b9c4d6", P.rect(14, 110, 82, 2)),
    n("#c94f4f", P.rect(10, 2, 2, 136)),
  ]),
];

function GR(i: number) {
  return PALETTE.ground[i];
}
