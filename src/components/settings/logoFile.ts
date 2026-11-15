"use client";

import { MAX_LOGO_DATA_URL } from "@/lib/settings";

export const LOGO_MAX_PX = 256;
const TYPES = ["image/png", "image/jpeg", "image/svg+xml"];

/** Size that fits inside max×max, keeping the aspect ratio and never upscaling. */
export function fitSize(w: number, h: number, max = LOGO_MAX_PX): { w: number; h: number } {
  if (!w || !h) return { w: max, h: max };
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/**
 * Read a PNG/JPG/SVG file and redraw it on a canvas at most 256px wide/high.
 * SVGs are rasterised too, so no uploaded markup is ever kept.
 */
export async function fileToLogoDataUrl(file: File): Promise<string> {
  if (!TYPES.includes(file.type)) throw new Error("Use a PNG, JPG or SVG picture.");
  if (file.size > 10 * 1024 * 1024) throw new Error("That picture is too big (max 10 MB).");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("Could not open that picture. Try another file.");
    });
    const { w, h } = fitSize(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't resize pictures.");
    ctx.drawImage(img, 0, 0, w, h);
    const out = file.type === "image/jpeg" ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
    if (out.length > MAX_LOGO_DATA_URL) throw new Error("That logo is still too large after resizing. Try a simpler picture.");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
