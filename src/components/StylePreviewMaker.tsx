"use client";

import { useState } from "react";
import { zipSync } from "fflate";
import { ART_STYLES, buildImagePrompt, PREVIEW_SCENE } from "@/lib/artStyles";
import { DEFAULT_CHARACTERS, DEFAULT_SETTING } from "@/lib/mergeSample";
import { formatUsd } from "@/lib/report";

/** Shrink a generated picture to a small 9:16 JPEG (360×640) for the app's preview cards. */
async function toPreviewJpeg(dataUrl: string): Promise<Uint8Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Could not read image"));
    i.src = dataUrl;
  });
  const W = 360;
  const H = 640;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.82));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * One-time tool: draws the same sample scene in every art style with the user's
 * key, then downloads a zip of small previews to build into the app.
 */
export default function StylePreviewMaker({ apiKey, imageModel }: { apiKey: string; imageModel: string }) {
  const [items, setItems] = useState<Record<string, { url?: string; jpg?: Uint8Array; error?: string }>>({});
  const [running, setRunning] = useState(false);
  const [cost, setCost] = useState(0);

  async function run() {
    if (!apiKey.trim() || !imageModel) return;
    setRunning(true);
    setCost(0);
    for (const a of ART_STYLES) {
      if (items[a.id]?.jpg) continue; // keep ones already made
      try {
        const res = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-openrouter-key": apiKey.trim() },
          body: JSON.stringify({ model: imageModel, prompt: buildImagePrompt(a.prompt, DEFAULT_SETTING, DEFAULT_CHARACTERS, PREVIEW_SCENE) }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        const jpg = await toPreviewJpeg(j.dataUrl);
        const url = URL.createObjectURL(new Blob([jpg as BlobPart], { type: "image/jpeg" }));
        setItems((m) => ({ ...m, [a.id]: { url, jpg } }));
        setCost((c) => c + (j.costUsd ?? 0));
      } catch (e) {
        setItems((m) => ({ ...m, [a.id]: { error: e instanceof Error ? e.message : "failed" } }));
      }
    }
    setRunning(false);
  }

  function downloadZip() {
    const files: Record<string, Uint8Array> = {};
    for (const [id, v] of Object.entries(items)) if (v.jpg) files[`${id}.jpg`] = v.jpg;
    const zip = zipSync({ "style-previews": files }, { level: 0 });
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "style-previews.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const done = Object.values(items).filter((v) => v.jpg).length;

  return (
    <div className="rounded-xl border border-dashed border-stone-300 p-4 dark:border-stone-700">
      <p className="text-sm">
        Draws the <b>same sample scene</b> (mother at her door at sunset) in all {ART_STYLES.length} styles, so the
        picture cards show real examples. Run it once: about {ART_STYLES.length} pictures, roughly $0.30–0.50 on your key.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={run} disabled={running || !apiKey.trim() || !imageModel} className="btn-primary">
          {running ? `Drawing ${done + 1} of ${ART_STYLES.length}…` : done ? "Make missing previews" : "Make style previews"}
        </button>
        {done > 0 && !running && (
          <button onClick={downloadZip} className="btn-secondary">
            ⬇ Download {done} previews (.zip)
          </button>
        )}
      </div>
      {!apiKey.trim() && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Enter your API key at the top first.</p>}
      {done > 0 && <p className="mt-2 text-xs text-stone-500">Spent: {formatUsd(cost || null)}. After downloading, tell Claude and the previews get built into the app.</p>}
      <div className="mt-3 grid grid-cols-5 gap-2">
        {ART_STYLES.map((a) => {
          const v = items[a.id];
          return (
            <div key={a.id} className="text-center text-[10px] leading-tight text-stone-500">
              <div className="aspect-[9/16] overflow-hidden rounded-md bg-stone-100 dark:bg-stone-800">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                {v?.url ? <img src={v.url} alt={a.label} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-lg">{v?.error ? "⚠️" : a.emoji}</span>}
              </div>
              <span title={v?.error}>{a.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
