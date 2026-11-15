/**
 * Small SVG path helpers: builders used by the starter library (they emit plain
 * path strings, so assets stay JSON) and a tokenizer used by validation and for
 * estimating shape bounds.
 */

export type Pt = [number, number];
export type Xf = (p: Pt) => Pt;

const r1 = (n: number) => Math.round(n * 10) / 10;
const f = (p: Pt) => `${r1(p[0])} ${r1(p[1])}`;
const ID: Xf = (p) => p;

/** Path builders that map every point through an (affine) transform. */
export function pen(T: Xf = ID) {
  const K = 0.5523;
  const ellipse = (cx: number, cy: number, rx: number, ry: number): string => {
    const p = (x: number, y: number) => f(T([cx + x, cy + y]));
    return (
      `M${p(rx, 0)}C${p(rx, ry * K)} ${p(rx * K, ry)} ${p(0, ry)}` +
      `C${p(-rx * K, ry)} ${p(-rx, ry * K)} ${p(-rx, 0)}` +
      `C${p(-rx, -ry * K)} ${p(-rx * K, -ry)} ${p(0, -ry)}` +
      `C${p(rx * K, -ry)} ${p(rx, -ry * K)} ${p(rx, 0)}Z`
    );
  };
  const poly = (pts: Pt[], close = true): string =>
    pts.map((q, i) => `${i ? "L" : "M"}${f(T(q))}`).join("") + (close ? "Z" : "");
  const rect = (x: number, y: number, w: number, h: number) =>
    poly([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ]);
  const rrect = (x: number, y: number, w: number, h: number, rad: number): string => {
    const r = Math.max(0, Math.min(rad, w / 2, h / 2));
    if (!r) return rect(x, y, w, h);
    const k = r * (1 - K);
    const P = (a: number, b: number) => f(T([a, b]));
    return (
      `M${P(x + r, y)}L${P(x + w - r, y)}C${P(x + w - k, y)} ${P(x + w, y + k)} ${P(x + w, y + r)}` +
      `L${P(x + w, y + h - r)}C${P(x + w, y + h - k)} ${P(x + w - k, y + h)} ${P(x + w - r, y + h)}` +
      `L${P(x + r, y + h)}C${P(x + k, y + h)} ${P(x, y + h - k)} ${P(x, y + h - r)}` +
      `L${P(x, y + r)}C${P(x, y + k)} ${P(x + k, y)} ${P(x + r, y)}Z`
    );
  };
  /** Closed smooth-ish shape through points using quadratic midpoints. */
  const blob = (pts: Pt[]): string => {
    const n = pts.length;
    const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let d = `M${f(T(mid(pts[n - 1], pts[0])))}`;
    for (let i = 0; i < n; i++) d += `Q${f(T(pts[i]))} ${f(T(mid(pts[i], pts[(i + 1) % n])))}`;
    return d + "Z";
  };
  /** Open curve (for stroked lines) through points with quadratic smoothing. */
  const curve = (pts: Pt[]): string => {
    if (pts.length < 3) return poly(pts, false);
    const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let d = `M${f(T(pts[0]))}`;
    for (let i = 1; i < pts.length - 1; i++) d += `Q${f(T(pts[i]))} ${f(T(mid(pts[i], pts[i + 1])))}`;
    return d + `L${f(T(pts[pts.length - 1]))}`;
  };
  const line = (a: Pt, b: Pt) => `M${f(T(a))}L${f(T(b))}`;
  return { ellipse, poly, rect, rrect, blob, curve, line };
}

/* ------------------------------- tokenizer -------------------------------- */

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export interface PathCmd {
  c: string; // command letter as written
  a: number[];
}

/** Parse path data. Returns null when it is not plausible SVG path data. */
export function parsePath(d: string): PathCmd[] | null {
  if (typeof d !== "string" || !d.trim()) return null;
  if (!/^[\sMmLlHhVvCcSsQqTtAaZz0-9.,eE+-]+$/.test(d)) return null;
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!toks || !/^[Mm]$/.test(toks[0])) return null;
  const out: PathCmd[] = [];
  let i = 0;
  while (i < toks.length) {
    const c = toks[i++];
    if (!/^[A-Za-z]$/.test(c)) return null;
    const n = ARGS[c.toUpperCase()];
    if (n === 0) {
      out.push({ c, a: [] });
      continue;
    }
    let first = true;
    // repeated argument groups are allowed (implicit repeats)
    while (first || (i < toks.length && !/^[A-Za-z]$/.test(toks[i]))) {
      const a: number[] = [];
      for (let k = 0; k < n; k++) {
        const v = Number(toks[i++]);
        if (!Number.isFinite(v)) return null;
        a.push(v);
      }
      out.push({ c: first ? c : c === "M" ? "L" : c === "m" ? "l" : c, a });
      first = false;
    }
  }
  return out;
}

/** Approximate bounds from all path points (control points included). */
export function pathBounds(d: string): { x0: number; y0: number; x1: number; y1: number } | null {
  const cmds = parsePath(d);
  if (!cmds) return null;
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (px: number, py: number) => {
    x0 = Math.min(x0, px);
    y0 = Math.min(y0, py);
    x1 = Math.max(x1, px);
    y1 = Math.max(y1, py);
  };
  for (const { c, a } of cmds) {
    const rel = c === c.toLowerCase();
    const U = c.toUpperCase();
    const bx = rel ? x : 0,
      by = rel ? y : 0;
    if (U === "Z") {
      x = sx;
      y = sy;
      continue;
    }
    if (U === "H") {
      x = bx + a[0];
      add(x, y);
      continue;
    }
    if (U === "V") {
      y = by + a[0];
      add(x, y);
      continue;
    }
    if (U === "A") {
      x = bx + a[5];
      y = by + a[6];
      add(x, y);
      continue;
    }
    for (let k = 0; k < a.length; k += 2) add(bx + a[k], by + a[k + 1]);
    x = bx + a[a.length - 2];
    y = by + a[a.length - 1];
    if (U === "M") {
      sx = x;
      sy = y;
    }
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, x1, y1 };
}

/* ------------------------------ Path2D cache ------------------------------ */

const cache = new Map<string, Path2D>();
export function path2d(d: string): Path2D {
  let p = cache.get(d);
  if (!p) {
    p = new Path2D(d);
    if (cache.size > 4000) cache.clear();
    cache.set(d, p);
  }
  return p;
}
