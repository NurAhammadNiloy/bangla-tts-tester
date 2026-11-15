/**
 * "Your page" branding helpers: a strict SVG sanitiser for AI-made logos and the
 * prompt/schema for POST /api/brand.
 *
 * The sanitiser never passes input through. It tokenises the markup, keeps only
 * a small whitelist of shape elements and presentation attributes whose values
 * match tight patterns, and rebuilds a fresh SVG string from those pieces.
 */

export const MAX_SVG_BYTES = 8 * 1024;
export const MAX_BRAND_NAME = 40;
export const MAX_BRAND_HINT = 200;

/** House palette, shared with the prompt so AI logos match the app and videos. */
export const BRAND_PALETTE = {
  night: "#1a1d3b",
  indigo: "#252c55",
  marigold: "#f4b13e",
  cream: "#ece9f7",
  teal: "#1f9e83",
  rose: "#c43d55",
} as const;

const ELEMENTS = new Set(["svg", "g", "path", "circle", "rect", "ellipse", "polygon"]);
const SHAPES = new Set(["path", "circle", "rect", "ellipse", "polygon"]);

const NUM = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?(%|px)?$/i;
const PLAIN_NUM = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const COLOR = /^(#[0-9a-f]{3,8}|none|currentColor|transparent|[a-z]{3,20}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))$/i;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;
const POINTS = /^[0-9eE.,\s+-]*$/;
const TRANSFORM = /^(\s*(matrix|translate|scale|rotate|skewX|skewY)\(\s*[0-9eE.,\s+-]*\)\s*,?)+$/;

const VIEWBOX = (v: string) => {
  const parts = v.trim().split(/[\s,]+/);
  return parts.length === 4 && parts.every((p) => PLAIN_NUM.test(p)) && Number(parts[2]) > 0 && Number(parts[3]) > 0;
};

/** Attribute name → validator. Anything not listed is dropped. */
const ATTRS: Record<string, (v: string) => boolean> = {
  d: (v) => PATH_DATA.test(v) && v.length < 6000,
  points: (v) => POINTS.test(v),
  cx: (v) => NUM.test(v),
  cy: (v) => NUM.test(v),
  r: (v) => NUM.test(v),
  rx: (v) => NUM.test(v),
  ry: (v) => NUM.test(v),
  x: (v) => NUM.test(v),
  y: (v) => NUM.test(v),
  width: (v) => NUM.test(v),
  height: (v) => NUM.test(v),
  fill: (v) => COLOR.test(v),
  stroke: (v) => COLOR.test(v),
  "stroke-width": (v) => NUM.test(v),
  "stroke-linecap": (v) => /^(butt|round|square)$/.test(v),
  "stroke-linejoin": (v) => /^(miter|round|bevel)$/.test(v),
  "fill-rule": (v) => /^(nonzero|evenodd)$/.test(v),
  "clip-rule": (v) => /^(nonzero|evenodd)$/.test(v),
  opacity: (v) => PLAIN_NUM.test(v),
  "fill-opacity": (v) => PLAIN_NUM.test(v),
  "stroke-opacity": (v) => PLAIN_NUM.test(v),
  transform: (v) => TRANSFORM.test(v),
};

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/\s*([a-zA-Z][\w:.-]*)\s*>|<([a-zA-Z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)|(<)/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Returns a clean, self-contained SVG string, or null when the input is not a
 * safe, simple logo (no viewBox, no shapes, DOCTYPE/CDATA, broken nesting, too big).
 * Disallowed elements are dropped with everything inside them.
 */
export function sanitizeSvg(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const src = input.trim();
  if (!src || src.length > 64 * 1024) return null;
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(src)) return null;

  const out: string[] = [];
  const stack: { name: string; kept: boolean }[] = [];
  let dropDepth = 0; // > 0 while inside a dropped subtree
  let sawRoot = false;
  let rootClosed = false;
  let shapes = 0;

  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(src))) {
    const [whole, closeName, openName, rawAttrs = "", selfClose, text, stray] = m;
    if (stray) return null;
    if (text !== undefined || whole.startsWith("<!--") || whole.startsWith("<?")) continue; // text, comments, XML decl: dropped

    if (closeName) {
      const name = closeName.toLowerCase();
      const top = stack.pop();
      if (!top || top.name !== name) return null;
      if (!top.kept) dropDepth--;
      else out.push(`</${name}>`);
      if (stack.length === 0) rootClosed = true;
      continue;
    }

    const name = openName.toLowerCase();
    if (rootClosed) return null; // content after </svg>
    if (!sawRoot) {
      if (name !== "svg") return null;
      sawRoot = true;
    } else if (name === "svg") return null; // nested svg

    const kept = dropDepth === 0 && ELEMENTS.has(name);
    if (kept) {
      const attrs: string[] = [];
      let viewBox: string | null = null;
      ATTR.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = ATTR.exec(rawAttrs))) {
        const key = a[1].toLowerCase();
        const value = (a[2] ?? a[3] ?? "").trim();
        if (/url\s*\(|javascript:|&|[<>"'`\\]/i.test(value)) continue;
        if (name === "svg") {
          if (key === "viewbox" && VIEWBOX(value)) viewBox = value.split(/[\s,]+/).join(" ");
          if (key === "fill" && COLOR.test(value)) attrs.push(`fill="${value}"`);
          continue; // width/height/xmlns etc. are set by us
        }
        const ok = ATTRS[key];
        if (ok && ok(value)) attrs.push(`${key}="${value}"`);
      }
      if (name === "svg") {
        if (!viewBox) return null;
        attrs.unshift(`xmlns="http://www.w3.org/2000/svg"`, `viewBox="${viewBox}"`);
      }
      if (SHAPES.has(name)) shapes++;
      out.push(`<${name}${attrs.length ? " " + attrs.join(" ") : ""}${selfClose ? "/" : ""}>`);
    }
    if (!selfClose) {
      stack.push({ name, kept });
      if (!kept) dropDepth++;
    } else if (name === "svg") {
      rootClosed = true;
    }
  }

  if (!sawRoot || stack.length || shapes === 0) return null;
  const svg = out.join("");
  if (new TextEncoder().encode(svg).length >= MAX_SVG_BYTES) return null;
  return svg;
}

/** data: URL for a sanitised SVG (UTF-8, percent-encoded). */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Reverse of svgToDataUrl; null for anything else. */
export function svgFromDataUrl(url: string): string | null {
  const prefix = "data:image/svg+xml;charset=utf-8,";
  if (!url.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(url.slice(prefix.length));
  } catch {
    return null;
  }
}

/** Clean a page name: one line, no markup characters, max 40 letters. */
export function cleanBrandName(v: unknown): string {
  if (typeof v !== "string") return "";
  return [...v.replace(/[\u0000-\u001f<>{}\\]/g, " ").replace(/\s+/g, " ").trim()].slice(0, MAX_BRAND_NAME).join("").trim();
}

export const BRAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "Short page name, 1-3 words, Bangla or English." },
    logoSvg: { type: "string", description: "A complete <svg> document with a viewBox." },
  },
  required: ["name", "logoSvg"],
} as const;

export function buildBrandPrompt(): string {
  const p = BRAND_PALETTE;
  return [
    "You design a tiny brand for a Facebook page that posts Bangla story videos (emotional, horror, drama, comedy stories told at night).",
    "Return JSON with two fields:",
    '- "name": a short, warm, easy-to-say page name idea (1-3 words, Bangla script or simple English, max 30 letters). No hashtags, no emoji.',
    '- "logoSvg": a simple flat logo as one SVG document.',
    "SVG rules (strict, anything else is thrown away):",
    '- Root <svg> with viewBox="0 0 100 100". No width/height.',
    "- Only these elements: g, path, circle, rect, ellipse, polygon. No text, no fonts, no letters drawn as text, no images, no gradients, no filters, no defs, no style, no CSS, no script, no links.",
    "- Only attributes: d, points, cx, cy, r, rx, ry, x, y, width, height, fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, fill-rule, opacity, transform.",
    `- Colors only from this palette: night ${p.night}, indigo ${p.indigo}, marigold ${p.marigold}, cream ${p.cream}, teal ${p.teal}, rose ${p.rose}.`,
    "- One bold, readable symbol (for example an oil lamp, a crescent moon, an open book, a speech bubble) on a rounded square or circle. Max 8 shapes, under 3000 characters.",
    "If the user gives a hint, follow its mood and topic.",
  ].join("\n");
}
