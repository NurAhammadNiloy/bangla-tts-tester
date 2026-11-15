/**
 * Starter places, 1620 × 1920, floor line at y = 1500. Background shapes have
 * no outlines. The colour token "$sky" is replaced by the time-of-day sky
 * colour at draw time (windows and open sky follow morning / night).
 * The middle of the frame (x ≈ 400–1220) is kept clear at character height.
 */
import type { PlaceAsset, Shape } from "../types";
import { PALETTE } from "../styleGuide";
import { pen } from "../path";
import { shade } from "./characters";

const P = pen();
const W = 1620;
const FLOOR = 1500;
const f = (fill: string, d: string, opacity?: number): Shape => (opacity !== undefined ? { d, fill, opacity } : { d, fill });
const st = (stroke: string, d: string, w = 4, opacity?: number): Shape => ({ d, fill: "none", stroke, strokeWidth: w, ...(opacity !== undefined ? { opacity } : {}) });
const SKY = "$sky";
const INK = PALETTE.ink;
const [WALL0, WALL1, WALL2, WALL3, WALL4] = PALETTE.wall;
const [GR_WOOD, GR_GRASS, GR_ASPHALT, GR_SAND] = PALETTE.ground;
const C = PALETTE.cloth;

function window(x: number, y: number, w: number, h: number, frame: string = C[9], bars = true): Shape[] {
  const out = [f(frame, P.rect(x - 16, y - 16, w + 32, h + 32)), f(SKY, P.rect(x, y, w, h))];
  if (bars) {
    out.push(f(frame, P.rect(x + w / 2 - 6, y, 12, h)));
    out.push(f(frame, P.rect(x, y + h / 2 - 6, w, 12)));
  }
  out.push(f(shade(frame, 0.8), P.rect(x - 28, y + h + 16, w + 56, 18)));
  return out;
}

function floorboards(color: string, y0: number, y1: number): Shape[] {
  const out = [f(color, P.rect(0, y0, W, y1 - y0))];
  for (let y = y0 + 70, i = 0; y < y1; y += 60 + i * 18, i++) out.push(f(shade(color, 0.9), P.rect(0, y, W, 5)));
  return out;
}

function curtain(x: number, y: number, w: number, h: number, color: string, left: boolean): Shape[] {
  const tip = left ? x + w * 0.35 : x + w * 0.65;
  return [
    f(color, P.blob([[x, y], [x + w, y], [left ? x + w * 0.7 : x + w, y + h * 0.6], [tip, y + h], [left ? x : x + w * 0.3, y + h * 0.6]])),
    f(shade(color, 0.82), P.rect(left ? x + w * 0.3 : x + w * 0.55, y + 10, 10, h * 0.7), 0.5),
  ];
}

/* --------------------------------- home --------------------------------- */
const home_room: PlaceAsset = {
  kind: "place",
  id: "home_room",
  label: "ঘর (simple home room / mess room)",
  tags: ["home", "room", "bedroom", "house", "interior", "mess", "flat", "living_room", "indoor"],
  size: [W, 1920],
  floorY: FLOOR,
  layers: {
    back: [
      f(WALL0, P.rect(0, 0, W, FLOOR)),
      f(WALL1, P.rect(0, 1180, W, FLOOR - 1180)),
      f(shade(WALL1, 0.9), P.rect(0, 1180, W, 10)),
      f(C[9], P.rect(0, 1478, W, 22)),
      ...floorboards(GR_WOOD, FLOOR, 1920),
      f(shade(C[0], 0.9), P.ellipse(810, 1660, 520, 110), 0.85),
      f(C[1], P.ellipse(810, 1660, 440, 80), 0.6),
      // window with curtains
      ...window(400, 520, 330, 380),
      f(C[9], P.rect(330, 470, 470, 14)),
      ...curtain(338, 480, 130, 480, C[0], true),
      ...curtain(662, 480, 130, 480, C[0], false),
      // framed picture
      f(C[9], P.rect(1000, 560, 190, 150)),
      f(WALL2, P.rect(1014, 574, 162, 122)),
      f(C[2], P.poly([[1014, 696], [1070, 620], [1110, 670], [1140, 640], [1176, 696]])),
      f(C[1], P.ellipse(1140, 606, 14, 14)),
      // wall clock
      f(C[8], P.ellipse(1250, 420, 48, 48)),
      st(INK, P.ellipse(1250, 420, 48, 48), 6),
      st(INK, P.line([1250, 420], [1250, 390]), 6),
      st(INK, P.line([1250, 420], [1272, 430]), 5),
      // ceiling fan
      f(C[6], P.rect(806, 0, 8, 110)),
      f(C[6], P.ellipse(810, 118, 30, 16)),
      f(C[5], P.ellipse(690, 124, 110, 14)),
      f(C[5], P.ellipse(930, 124, 110, 14)),
    ],
    mid: [
      // wardrobe (left edge)
      f(C[9], P.rect(30, 760, 300, 740)),
      f(shade(C[9], 0.85), P.rect(46, 780, 128, 700)),
      f(shade(C[9], 0.85), P.rect(186, 780, 128, 700)),
      f(C[1], P.rect(160, 1080, 8, 50)),
      f(C[1], P.rect(192, 1080, 8, 50)),
      // bed (right edge)
      f(C[9], P.rect(1300, 1020, 34, 480)),
      f(C[9], P.rect(1300, 1020, 320, 60)),
      f(C[8], P.rect(1320, 1250, 300, 140)),
      f(C[3], P.rect(1400, 1260, 220, 130)),
      f(shade(C[3], 0.85), P.rect(1400, 1260, 220, 26)),
      f(C[5], P.ellipse(1380, 1236, 64, 32)),
      f(C[9], P.rect(1320, 1390, 300, 40)),
      f(shade(C[9], 0.8), P.rect(1330, 1430, 26, 70)),
    ],
    front: [
      // potted plant, bottom-left corner
      f(C[0], P.poly([[70, 1760], [230, 1760], [210, 1920], [90, 1920]])),
      f(shade(C[0], 0.8), P.rect(62, 1748, 176, 24)),
      f(C[2], P.blob([[150, 1750], [60, 1650], [40, 1540], [120, 1620], [150, 1500], [180, 1620], [260, 1540], [240, 1650]])),
      f(shade(C[2], 0.8), P.blob([[150, 1750], [110, 1640], [150, 1560], [190, 1640]])),
    ],
  },
};

/* -------------------------------- kitchen -------------------------------- */
function tiles(x0: number, y0: number, x1: number, y1: number, size: number, color: string): Shape[] {
  const out = [f(color, P.rect(x0, y0, x1 - x0, y1 - y0))];
  for (let x = x0 + size; x < x1; x += size) out.push(f(shade(color, 0.92), P.rect(x, y0, 3, y1 - y0)));
  for (let y = y0 + size; y < y1; y += size) out.push(f(shade(color, 0.92), P.rect(x0, y, x1 - x0, 3)));
  return out;
}
const kitchen: PlaceAsset = {
  kind: "place",
  id: "kitchen",
  label: "রান্নাঘর (kitchen)",
  tags: ["kitchen", "cooking", "home", "house", "interior", "indoor", "stove", "food"],
  size: [W, 1920],
  floorY: FLOOR,
  layers: {
    back: [
      f(WALL0, P.rect(0, 0, W, FLOOR)),
      ...tiles(0, 900, W, 1190, 70, WALL2),
      ...window(420, 470, 320, 300),
      // shelf with jars
      f(C[9], P.rect(900, 700, 460, 20)),
      f(C[1], P.rrect(930, 620, 70, 80, 12)),
      f(C[0], P.rrect(1020, 600, 70, 100, 12)),
      f(C[2], P.rrect(1110, 630, 60, 70, 12)),
      f(C[8], P.rrect(1190, 610, 90, 90, 14)),
      // hanging pans
      f(C[6], P.rect(1440, 520, 8, 120)),
      f(C[6], P.ellipse(1444, 700, 60, 60)),
      f(shade(C[6], 0.8), P.ellipse(1444, 700, 44, 44)),
      // counter
      f(WALL4, P.rect(0, 1180, W, 34)),
      f(C[9], P.rect(0, 1214, W, 286)),
      ...[0, 1, 2, 3, 4, 5].map((i) => f(shade(C[9], 0.85), P.rect(30 + i * 270, 1240, 240, 230))),
      ...[0, 1, 2, 3, 4, 5].map((i) => f(C[1], P.rect(140 + i * 270, 1330, 26, 8))),
      // stove + pot
      f(C[6], P.rect(1060, 1150, 260, 34)),
      f(C[7], P.poly([[1100, 1060], [1260, 1060], [1240, 1150], [1120, 1150]])),
      f(C[6], P.rect(1086, 1050, 188, 18)),
      // sink area
      f(WALL4, P.rect(430, 1170, 300, 18)),
      f(C[5], P.rect(560, 1080, 12, 90)),
      f(C[5], P.rect(560, 1080, 60, 12)),
      ...tiles(0, FLOOR, W, 1920, 140, GR_SAND),
    ],
    mid: [
      // fridge at right edge
      f(C[8], P.rrect(1380, 820, 240, 680, 24)),
      f(shade(C[8], 0.88), P.rect(1380, 1060, 240, 8)),
      f(C[6], P.rect(1400, 900, 12, 110)),
      f(C[6], P.rect(1400, 1100, 12, 140)),
    ],
    front: [
      // onion basket hanging top-left
      st(C[9], P.line([120, 0], [120, 180]), 6),
      f(C[9], P.poly([[40, 180], [200, 180], [170, 290], [70, 290]])),
      f(C[0], P.ellipse(90, 176, 30, 26)),
      f(C[4], P.ellipse(140, 170, 30, 28)),
    ],
  },
};

/* --------------------------------- office -------------------------------- */
const office: PlaceAsset = {
  kind: "place",
  id: "office",
  label: "অফিস (office)",
  tags: ["office", "work", "desk", "company", "city", "interior", "indoor", "computer", "boss"],
  size: [W, 1920],
  floorY: FLOOR,
  layers: {
    back: [
      f(WALL2, P.rect(0, 0, W, FLOOR)),
      f(shade(WALL2, 0.92), P.rect(0, 1250, W, 250)),
      // big window with skyline
      f(C[6], P.rect(290, 360, 1040, 660)),
      f(SKY, P.rect(306, 376, 1008, 628)),
      f(WALL4, P.poly([[306, 1004], [306, 760], [380, 760], [380, 680], [470, 680], [470, 820], [560, 820], [560, 600], [660, 600], [660, 760], [760, 760], [760, 700], [860, 700], [860, 860], [960, 860], [960, 640], [1060, 640], [1060, 780], [1160, 780], [1160, 720], [1240, 720], [1240, 840], [1314, 840], [1314, 1004]]), 0.55),
      f(C[6], P.rect(632, 376, 12, 628)),
      f(C[6], P.rect(976, 376, 12, 628)),
      f(C[6], P.rect(270, 1020, 1080, 22)),
      // wall clock
      f(C[8], P.ellipse(1470, 520, 54, 54)),
      st(INK, P.ellipse(1470, 520, 54, 54), 6),
      st(INK, P.line([1470, 520], [1470, 486]), 6),
      st(INK, P.line([1470, 520], [1494, 534]), 5),
      // ceiling lights
      f(C[8], P.rect(500, 0, 220, 26), 0.9),
      f(C[8], P.rect(900, 0, 220, 26), 0.9),
      f(GR_ASPHALT, P.rect(0, FLOOR, W, 420)),
      f(shade(GR_ASPHALT, 0.9), P.rect(0, FLOOR, W, 14)),
    ],
    mid: [
      // desk with monitor at left
      f(C[6], P.rect(10, 1000, 220, 140)),
      f(SKY, P.rect(24, 1014, 192, 110), 0.7),
      f(C[6], P.rect(110, 1140, 20, 60)),
      f(C[9], P.rect(0, 1190, 400, 36)),
      f(shade(C[9], 0.85), P.rect(20, 1226, 360, 274)),
      f(C[8], P.rect(260, 1150, 90, 40)),
      // filing cabinet right
      f(WALL4, P.rect(1340, 1040, 220, 460)),
      ...[0, 1, 2].map((i) => f(shade(WALL4, 0.88), P.rect(1356, 1060 + i * 148, 188, 130))),
      ...[0, 1, 2].map((i) => f(C[5], P.rect(1420, 1110 + i * 148, 60, 12))),
      f(C[1], P.rect(1380, 990, 120, 50)),
    ],
    front: [
      f(C[0], P.poly([[1440, 1780], [1600, 1780], [1580, 1920], [1460, 1920]])),
      f(C[2], P.blob([[1520, 1780], [1420, 1600], [1440, 1420], [1500, 1560], [1530, 1380], [1570, 1560], [1620, 1450], [1610, 1640]])),
    ],
  },
};

/* ------------------------------ city street ------------------------------ */
function buildingWindows(x: number, y: number, cols: number, rows: number, cw: number, ch: number, gap: number): Shape[] {
  const out: Shape[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const lit = (r * 7 + c * 3) % 4 === 0;
      out.push(f(lit ? C[1] : SKY, P.rect(x + c * (cw + gap), y + r * (ch + gap), cw, ch), lit ? 0.85 : 0.75));
    }
  return out;
}
const city_street: PlaceAsset = {
  kind: "place",
  id: "city_street",
  label: "শহরের রাস্তা (city street with shops)",
  tags: ["street", "road", "city", "town", "outdoor", "shops", "dhaka", "market", "footpath", "traffic"],
  size: [W, 1920],
  floorY: FLOOR,
  layers: {
    back: [
      f(SKY, P.rect(0, 0, W, 1200)),
      // far skyline
      f(WALL4, P.poly([[0, 1200], [0, 520], [160, 520], [160, 430], [300, 430], [300, 600], [430, 600], [430, 380], [560, 380], [560, 560], [700, 560], [700, 470], [860, 470], [860, 610], [980, 610], [980, 400], [1120, 400], [1120, 540], [1260, 540], [1260, 450], [1400, 450], [1400, 590], [1620, 590], [1620, 1200]]), 0.6),
      // wires
      st(INK, P.curve([[0, 300], [810, 420], [1620, 280]]), 4, 0.6),
      st(INK, P.curve([[0, 360], [810, 470], [1620, 350]]), 3, 0.5),
      // left building with shop
      f(WALL1, P.rect(0, 560, 560, 940)),
      ...buildingWindows(40, 620, 4, 3, 90, 110, 34),
      f(C[0], P.rect(0, 1090, 560, 60)),
      f(C[6], P.rect(20, 1150, 520, 350)),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => f(shade(C[6], 0.85), P.rect(20, 1170 + i * 42, 520, 6))),
      // right building
      f(WALL3, P.rect(1060, 480, 560, 1020)),
      ...buildingWindows(1100, 540, 4, 4, 90, 110, 34),
      f(C[3], P.rect(1060, 1100, 560, 60)),
      f(C[1], P.rect(1100, 1160, 480, 340), 0.85),
      f(C[9], P.rect(1100, 1160, 480, 20)),
      f(C[8], P.rect(1150, 1210, 140, 220)),
      f(C[8], P.rect(1340, 1210, 200, 120)),
      // street far end (between buildings)
      f(shade(WALL4, 0.9), P.rect(560, 980, 500, 520), 0.7),
      // footpath + road
      f(GR_SAND, P.rect(0, 1430, W, 120)),
      f(shade(GR_SAND, 0.85), P.rect(0, 1540, W, 20)),
      f(GR_ASPHALT, P.rect(0, 1560, W, 360)),
      ...[0, 1, 2, 3, 4].map((i) => f(WALL0, P.rect(60 + i * 340, 1740, 180, 16), 0.8)),
    ],
    mid: [
      // street lamp
      f(C[6], P.rect(1236, 760, 18, 740)),
      f(C[6], P.rect(1150, 760, 104, 14)),
      f(C[6], P.poly([[1120, 770], [1190, 770], [1180, 800], [1130, 800]])),
      f(C[1], P.ellipse(1155, 804, 22, 10)),
      // signboard pole on left
      f(C[6], P.rect(300, 1000, 12, 500)),
    ],
    front: [
      f(C[6], P.rect(30, 1560, 44, 360)),
      f(C[0], P.rect(30, 1620, 44, 30)),
      f(C[2], P.rrect(1460, 1700, 140, 220, 16)),
      f(shade(C[2], 0.8), P.rect(1450, 1690, 160, 24)),
    ],
  },
};

/* ------------------------------- night alley ----------------------------- */
function bricks(x0: number, y0: number, x1: number, y1: number, color: string): Shape[] {
  const out = [f(color, P.rect(x0, y0, x1 - x0, y1 - y0))];
  const bw = 120,
    bh = 50;
  for (let y = y0, r = 0; y < y1; y += bh, r++)
    for (let x = x0 + (r % 2 ? -bw / 2 : 0); x < x1; x += bw)
      if ((r * 5 + Math.round(x / bw) * 3) % 7 === 0) out.push(f(shade(color, 0.86), P.rect(Math.max(x0, x + 4), y + 4, bw - 8, bh - 8)));
  for (let y = y0 + bh; y < y1; y += bh) out.push(f(shade(color, 0.78), P.rect(x0, y, x1 - x0, 4)));
  return out;
}
const night_alley: PlaceAsset = {
  kind: "place",
  id: "night_alley",
  label: "সরু গলি (narrow old alley, old door, hanging bulb)",
  tags: ["alley", "lane", "gali", "old_town", "street", "outdoor", "night", "horror", "door", "old_house", "abandoned"],
  size: [W, 1920],
  floorY: FLOOR,
  layers: {
    back: [
      f(SKY, P.rect(0, 0, W, 420)),
      st(INK, P.curve([[0, 160], [700, 300], [1620, 180]]), 4, 0.7),
      st(INK, P.curve([[0, 230], [900, 330], [1620, 260]]), 3, 0.6),
      ...bricks(0, 380, W, FLOOR, "#9c8574"),
      // old door with frame
      f("#4a3f3a", P.rect(980, 860, 340, 640)),
      f("#5f4a3c", P.rect(1004, 884, 292, 616)),
      f(shade("#5f4a3c", 0.8), P.rect(1020, 910, 120, 260)),
      f(shade("#5f4a3c", 0.8), P.rect(1160, 910, 120, 260)),
      f(shade("#5f4a3c", 0.8), P.rect(1020, 1200, 120, 280)),
      f(shade("#5f4a3c", 0.8), P.rect(1160, 1200, 120, 280)),
      f(C[1], P.ellipse(1150, 1190, 10, 10)),
      f("#3a3634", P.rect(960, 840, 380, 28)),
      // small barred window
      f("#3a3634", P.rect(300, 700, 240, 200)),
      f(SKY, P.rect(316, 716, 208, 168), 0.4),
      ...[0, 1, 2, 3].map((i) => f("#3a3634", P.rect(340 + i * 52, 716, 10, 168))),
      // pipe
      f(WALL4, P.rect(760, 380, 26, 1120)),
      f(shade(WALL4, 0.8), P.rect(752, 900, 42, 20)),
      // hanging bulb
      st(INK, P.line([900, 380], [900, 640]), 4),
      f(C[6], P.rect(888, 630, 24, 24)),
      f("#f6d27a", P.ellipse(900, 676, 24, 28)),
      f("#f6d27a", P.ellipse(900, 676, 130, 120), 0.12),
      // wet ground
      f(GR_ASPHALT, P.rect(0, FLOOR, W, 420)),
      f(shade(GR_ASPHALT, 0.85), P.rect(0, FLOOR, W, 18)),
      f(WALL4, P.ellipse(560, 1700, 220, 30), 0.45),
      f(WALL4, P.ellipse(1200, 1820, 160, 22), 0.4),
      f("#f6d27a", P.ellipse(900, 1650, 60, 10), 0.25),
    ],
    mid: [
      // side walls framing the alley
      f("#6f5e54", P.poly([[0, 300], [150, 360], [150, FLOOR + 40], [0, FLOOR + 80]])),
      f("#6f5e54", P.poly([[1620, 300], [1470, 360], [1470, FLOOR + 40], [1620, FLOOR + 80]])),
      f(shade("#6f5e54", 0.85), P.rect(0, 800, 150, 14)),
      f(shade("#6f5e54", 0.85), P.rect(1470, 800, 150, 14)),
    ],
    front: [
      // bins and bags at the left edge
      f(C[6], P.rrect(20, 1580, 170, 260, 12)),
      f(shade(C[6], 0.8), P.rect(10, 1570, 190, 26)),
      f(INK, P.blob([[200, 1840], [190, 1740], [250, 1700], [320, 1740], [310, 1850]])),
      // cat silhouette at right edge
      f(INK, P.blob([[1500, 1840], [1500, 1760], [1540, 1730], [1580, 1760], [1580, 1840]])),
      f(INK, P.poly([[1510, 1745], [1516, 1712], [1532, 1735]])),
      f(INK, P.poly([[1550, 1735], [1566, 1712], [1572, 1745]])),
      f(C[1], P.ellipse(1528, 1752, 5, 4)),
      f(C[1], P.ellipse(1556, 1752, 5, 4)),
    ],
  },
};

/* ------------------------------ countryside ------------------------------ */
const countryside: PlaceAsset = {
  kind: "place",
  id: "countryside",
  label: "গ্রাম (village: fields, hut, trees)",
  tags: ["village", "countryside", "rural", "gram", "outdoor", "field", "hut", "nature", "trees", "farm"],
  size: [W, 1920],
  floorY: FLOOR,
  layers: {
    back: [
      f(SKY, P.rect(0, 0, W, 1160)),
      f(C[8], P.ellipse(360, 260, 120, 40), 0.7),
      f(C[8], P.ellipse(1200, 340, 160, 46), 0.6),
      f(shade(GR_GRASS, 1.12), P.blob([[-100, 1160], [200, 860], [520, 980], [840, 820], [1200, 960], [1500, 860], [1800, 1160]])),
      // tree line
      ...[80, 260, 430, 620, 980, 1160, 1380, 1540].map((x, i) => f(shade(GR_GRASS, 0.78 + (i % 3) * 0.05), P.ellipse(x, 1080, 110, 80 + (i % 2) * 30))),
      f(GR_GRASS, P.rect(0, 1120, W, 800)),
      ...[0, 1, 2, 3].map((i) => f(shade(GR_GRASS, 0.92), P.rect(0, 1180 + i * 70, W, 8))),
      // yard / path where people stand
      f(GR_SAND, P.blob([[-60, 1460], [500, 1420], [1100, 1430], [1700, 1460], [1700, 1960], [-60, 1960]])),
      f(shade(GR_SAND, 0.9), P.ellipse(800, 1720, 400, 40), 0.6),
    ],
    mid: [
      // hut on the right
      f(WALL3, P.rect(1180, 1040, 420, 460)),
      f(shade(WALL3, 0.85), P.rect(1180, 1440, 420, 60)),
      f("#5f4a3c", P.rect(1330, 1200, 130, 300)),
      f(C[9], P.poly([[1130, 1060], [1390, 830], [1660, 1060]])),
      f(GR_WOOD, P.poly([[1150, 1060], [1390, 860], [1640, 1060], [1620, 1080], [1170, 1080]])),
      ...[0, 1, 2, 3].map((i) => f(shade(GR_WOOD, 0.85), P.rect(1190 + i * 110, 900 + Math.abs(1.5 - i) * 40, 10, 170 - Math.abs(1.5 - i) * 40))),
      // palm / banana tree on the left
      f(C[9], P.poly([[160, 1500], [196, 1500], [210, 900], [180, 900]])),
      f(shade(GR_GRASS, 0.8), P.blob([[196, 900], [40, 860], [-20, 960], [100, 880]])),
      f(shade(GR_GRASS, 0.72), P.blob([[196, 900], [340, 820], [420, 920], [300, 870]])),
      f(shade(GR_GRASS, 0.86), P.blob([[196, 900], [120, 740], [200, 700], [220, 800]])),
      f(shade(GR_GRASS, 0.76), P.blob([[196, 900], [300, 720], [360, 760], [250, 840]])),
    ],
    front: [
      ...[60, 140, 1480, 1560].map((x) => f(shade(GR_GRASS, 0.75), P.poly([[x - 50, 1920], [x - 20, 1780], [x, 1860], [x + 20, 1760], [x + 50, 1920]]))),
      f(C[9], P.rect(10, 1640, 20, 280)),
      f(C[9], P.rect(110, 1660, 20, 260)),
      f(C[9], P.rect(0, 1700, 160, 14)),
    ],
  },
};

/* ------------------------------ hospital room ---------------------------- */
const hospital_room: PlaceAsset = {
  kind: "place",
  id: "hospital_room",
  label: "হাসপাতালের কেবিন (hospital room)",
  tags: ["hospital", "clinic", "ward", "cabin", "doctor", "patient", "medical", "interior", "indoor", "sick"],
  size: [W, 1920],
  floorY: FLOOR,
  layers: {
    back: [
      f(WALL2, P.rect(0, 0, W, FLOOR)),
      f(shade(WALL2, 0.94), P.rect(0, 1200, W, 300)),
      ...window(340, 500, 340, 380, C[5], false),
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => f(C[5], P.rect(340, 520 + i * 52, 340, 14), 0.9)),
      // monitor on wall
      f(C[6], P.rrect(1180, 640, 220, 160, 14)),
      f("#1f2a2e", P.rect(1196, 656, 188, 128)),
      st("#7fd99a", P.poly([[1200, 730], [1250, 730], [1266, 690], [1284, 770], [1300, 730], [1380, 730]], false), 5),
      // curtain rail and curtain at left
      f(C[6], P.rect(0, 380, 330, 10)),
      f("#9cc3b6", P.poly([[0, 390], [260, 390], [230, 1450], [0, 1450]])),
      ...[0, 1, 2].map((i) => f(shade("#9cc3b6", 0.88), P.rect(40 + i * 70, 400, 14, 1040))),
      f(C[5], P.rect(0, FLOOR, W, 420)),
      ...tiles(0, FLOOR, W, 1920, 160, C[5]),
    ],
    mid: [
      // IV stand
      f(C[6], P.rect(1090, 760, 10, 740)),
      f(C[6], P.rect(1050, 1490, 90, 10)),
      f(C[6], P.rect(1060, 760, 70, 8)),
      f("#cfe6ef", P.rrect(1062, 770, 34, 70, 10), 0.9),
      st(C[6], P.curve([[1080, 840], [1060, 1000], [1120, 1200]]), 3),
      // bed
      f(C[5], P.rect(1180, 1040, 30, 460)),
      f(C[5], P.rect(1180, 1240, 440, 30)),
      f(C[8], P.rrect(1200, 1180, 420, 80, 20)),
      f("#8fb3cf", P.rect(1300, 1190, 320, 80)),
      f(C[8], P.ellipse(1250, 1170, 50, 26)),
      f(C[6], P.rect(1210, 1270, 20, 230)),
      f(C[6], P.rect(1580, 1270, 20, 230)),
    ],
    front: [],
  },
};

/* ------------------------------ shop interior ---------------------------- */
const shop_interior: PlaceAsset = {
  kind: "place",
  id: "shop_interior",
  label: "দোকান (small grocery / tea shop interior)",
  tags: ["shop", "store", "grocery", "market", "dokan", "tea_stall", "interior", "indoor", "counter"],
  size: [W, 1920],
  floorY: FLOOR,
  layers: {
    back: [
      f(WALL0, P.rect(0, 0, W, FLOOR)),
      // shelves full of goods
      ...[0, 1, 2, 3].flatMap((r) => [
        f(C[9], P.rect(100, 520 + r * 200, 1420, 18)),
        ...Array.from({ length: 11 }, (_, i) => {
          const col = C[(i * 3 + r * 2) % 8];
          const h = 90 + ((i * 7 + r * 3) % 4) * 18;
          return f(col, P.rrect(120 + i * 128, 520 + r * 200 - h, 100, h, 8));
        }),
      ]),
      f(C[9], P.rect(90, 340, 18, 1160)),
      f(C[9], P.rect(1512, 340, 18, 1160)),
      // hanging bulbs
      ...[520, 1100].flatMap((x) => [st(INK, P.line([x, 0], [x, 200]), 4), f("#f6d27a", P.ellipse(x, 226, 24, 28)), f("#f6d27a", P.ellipse(x, 226, 90, 80), 0.14)]),
      f(GR_SAND, P.rect(0, FLOOR, W, 420)),
      ...tiles(0, FLOOR, W, 1920, 180, GR_SAND),
    ],
    mid: [
      // counter on the left with a scale and jars
      f(GR_WOOD, P.rect(0, 1140, 500, 40)),
      f(C[9], P.rect(0, 1180, 470, 320)),
      f(shade(C[9], 0.85), P.rect(20, 1210, 430, 270)),
      f(C[6], P.rect(300, 1100, 140, 40)),
      f(C[5], P.ellipse(370, 1090, 70, 12)),
      f("#cfe6ef", P.rrect(60, 1040, 80, 100, 18), 0.85),
      f(C[1], P.rrect(68, 1080, 64, 54, 12)),
      f("#cfe6ef", P.rrect(160, 1050, 80, 90, 18), 0.85),
      f(C[0], P.rrect(168, 1090, 64, 44, 12)),
    ],
    front: [
      // rice sacks at the right edge
      f(C[8], P.blob([[1400, 1920], [1390, 1720], [1440, 1680], [1520, 1700], [1560, 1920]])),
      f(C[8], P.blob([[1520, 1920], [1520, 1760], [1570, 1720], [1630, 1740], [1640, 1920]])),
      f(shade(C[8], 0.85), P.rect(1410, 1720, 130, 12)),
    ],
  },
};

export const STARTER_PLACES: PlaceAsset[] = [home_room, kitchen, office, city_street, night_alley, countryside, hospital_room, shop_interior];
export { WALL0 as DEFAULT_WALL };
