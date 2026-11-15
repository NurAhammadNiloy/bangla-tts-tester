"use client";

import { useRef, useState } from "react";
import Info from "@/components/Info";
import KeyDialog from "@/components/KeyDialog";
import { MAX_BRAND_HINT, MAX_BRAND_NAME, sanitizeSvg, svgToDataUrl } from "@/lib/brand";
import { getKey } from "@/lib/projects/keyStore";
import { saveSettings } from "@/lib/settings";
import { fileToLogoDataUrl } from "./logoFile";
import { useSettings } from "./useSettings";

type Idea = { name: string; logoDataUrl: string };

/** Small end-card preview: what viewers see at the end of each video. */
function EndCard({ name, logo }: { name: string; logo: string | null }) {
  const plain = !name && !logo;
  return (
    <div
      aria-label="End card preview"
      className="flex aspect-[9/16] w-24 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-[#12162e] p-2 text-center text-[#ece9f7]"
    >
      {plain ? (
        <span className="bangla text-[11px] font-semibold leading-tight text-[#a3a6c7]">সমাপ্ত</span>
      ) : (
        <>
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- local data URL
            <img src={logo} alt="" className="h-11 w-11 rounded-lg object-contain" />
          )}
          {name && <span className="bangla line-clamp-2 text-[11px] font-bold leading-tight">{name}</span>}
          <span className="text-[8px] text-[#a3a6c7]">Follow for part 2</span>
        </>
      )}
    </div>
  );
}

export default function BrandBox() {
  const { brand } = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [idea, setIdea] = useState<Idea | null>(null);
  const [askKey, setAskKey] = useState(false);
  // Raw text while typing (saved value is trimmed, which would eat spaces mid-typing).
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const save = (patch: Partial<typeof brand>) => {
    const r = saveSettings({ brand: patch });
    if (!r.ok) setError("This browser didn't let us save. Turn off private mode or free some space.");
    return r.ok;
  };

  async function onFile(f: File | undefined) {
    setError(null);
    setNotice(null);
    if (!f) return;
    try {
      const url = await fileToLogoDataUrl(f);
      if (save({ logoDataUrl: url })) setNotice("Logo saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use that picture.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function makeOne(key = getKey()) {
    setError(null);
    setNotice(null);
    if (!key) {
      setAskKey(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/brand", {
        method: "POST",
        headers: { "content-type": "application/json", "x-openrouter-key": key },
        body: JSON.stringify(hint.trim() ? { hint: hint.trim() } : {}),
      });
      const j = (await res.json().catch(() => ({}))) as { name?: string; logoSvg?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `Could not make a logo (HTTP ${res.status}).`);
      const svg = sanitizeSvg(j.logoSvg);
      if (!svg || !j.name) throw new Error("The logo did not pass the safety check. Try again.");
      setIdea({ name: j.name, logoDataUrl: svgToDataUrl(svg) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make a logo.");
    } finally {
      setBusy(false);
    }
  }

  const empty = !brand.name && !brand.logoDataUrl;

  return (
    <section aria-labelledby="brand-h" className="card">
      <h2 id="brand-h" className="flex items-center text-lg font-bold">
        📣 Your page <span className="ml-1.5 text-sm font-medium text-muted">(optional)</span>
        <Info title="Your page">
          Add your Facebook page name and logo to show a small watermark on your videos and your name on the end card. Leave it empty for no watermark and
          a plain end card.
        </Info>
      </h2>
      <p className="mt-1 text-sm text-muted">
        {empty ? "Empty: videos have no watermark and a plain end card." : "Shown as a small watermark and on the end card of every video."}
      </p>

      <div className="mt-4 flex gap-4">
        <EndCard name={brand.name} logo={brand.logoDataUrl} />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <label htmlFor="brand-name" className="label">
              Page name
              <Info title="Page name">The name of your Facebook page, as viewers know it. Bangla or English. Up to {MAX_BRAND_NAME} letters.</Info>
            </label>
            <input
              id="brand-name"
              className="input bangla"
              value={nameDraft ?? brand.name}
              maxLength={MAX_BRAND_NAME}
              placeholder="e.g. রাতের গল্প"
              onChange={(e) => {
                setNameDraft(e.target.value);
                save({ name: e.target.value });
              }}
              onBlur={() => setNameDraft(null)}
            />
          </div>
          <div>
            <span className="label">
              Logo
              <Info title="Logo">A PNG, JPG or SVG picture. We shrink it to 256 pixels and keep it in this browser. Square pictures look best.</Info>
            </span>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
                {brand.logoDataUrl ? "Change logo" : "Upload logo"}
              </button>
              {brand.logoDataUrl && (
                <button type="button" className="btn-secondary" onClick={() => save({ logoDataUrl: null })}>
                  Remove logo
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="sr-only"
                aria-label="Logo file"
                tabIndex={-1}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-dashed border-line bg-bg/60 p-3.5">
        <label htmlFor="brand-hint" className="label">
          No page yet? Let the AI suggest one
          <Info title="Make one for me">
            The AI suggests a page name and draws a simple logo in Golpo Studio colours. It uses your OpenRouter key and costs a tiny amount. Nothing is
            saved until you tap “Use this”.
          </Info>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="brand-hint"
            className="input"
            value={hint}
            maxLength={MAX_BRAND_HINT}
            placeholder="Optional: horror stories, village life…"
            onChange={(e) => setHint(e.target.value)}
          />
          <button type="button" className="btn-primary shrink-0" disabled={busy} onClick={() => makeOne()}>
            {busy ? "Making…" : "✨ Make one for me"}
          </button>
        </div>
        {idea && (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-accent/50 bg-surface p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- sanitised local data URL */}
            <img src={idea.logoDataUrl} alt="Suggested logo" className="h-14 w-14 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="bangla truncate font-bold">{idea.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary px-3 py-1.5"
                  onClick={() => {
                    if (save({ name: idea.name, logoDataUrl: idea.logoDataUrl })) {
                      setNameDraft(null);
                      setIdea(null);
                      setNotice("Saved your new page name and logo.");
                    }
                  }}
                >
                  Use this
                </button>
                <button type="button" className="btn-secondary px-3 py-1.5" disabled={busy} onClick={() => makeOne()}>
                  Try another
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={empty}
          onClick={() => {
            setNameDraft(null);
            if (save({ name: "", logoDataUrl: null })) setNotice("Cleared. Videos will have no watermark and a plain end card.");
          }}
        >
          Leave empty
        </button>
        <Info title="Leave empty">Removes the page name and logo. Your videos then have no watermark and end with a plain card.</Info>
      </div>

      <div aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm">
        {error ? <p className="text-bad">{error}</p> : notice ? <p className="text-ok">{notice}</p> : null}
      </div>

      <KeyDialog
        open={askKey}
        onClose={() => setAskKey(false)}
        onSaved={(k) => {
          setAskKey(false);
          makeOne(k);
        }}
      />
    </section>
  );
}
