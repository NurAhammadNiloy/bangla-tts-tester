"use client";

import { useEffect, useId, useRef, useState } from "react";
import Info from "@/components/Info";
import { getKey, setKey } from "@/lib/projects/keyStore";

export interface KeyCheck {
  ok: boolean;
  label?: string;
  limitRemaining?: number;
  usage?: number;
  error?: string;
}

/** Ask this app's /api/key route whether OpenRouter accepts the key. */
export async function checkKey(key: string): Promise<KeyCheck> {
  try {
    const res = await fetch("/api/key", { headers: { "x-openrouter-key": key.trim() }, cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as KeyCheck;
    if (!res.ok || !j.ok) return { ok: false, error: j.error ?? `Key check failed (HTTP ${res.status}).` };
    return j;
  } catch {
    return { ok: false, error: "Could not check the key. Are you online?" };
  }
}

/**
 * Friendly "connect your OpenRouter key" modal. Tests the key, saves it in this
 * browser (keyStore) and calls onSaved(key). Reusable on any page.
 */
export default function KeyDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (key: string) => void;
}) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [state, setState] = useState<{ kind: "idle" | "checking" | "ok" | "error"; text?: string }>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const inputId = useId();

  // Keep the latest onClose without re-running the open effect (parents often pass a new arrow each render).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      setValue(getKey());
      setState({ kind: "idle" });
      inputRef.current?.focus();
    });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  async function testAndSave() {
    const key = value.trim();
    if (!key) {
      setState({ kind: "error", text: "Paste your key first." });
      return;
    }
    setState({ kind: "checking" });
    const r = await checkKey(key);
    if (!r.ok) {
      setState({ kind: "error", text: r.error });
      return;
    }
    const saved = setKey(key);
    const credit = typeof r.limitRemaining === "number" ? ` · $${r.limitRemaining.toFixed(2)} credit left on this key` : "";
    setState({
      kind: "ok",
      text: `✓ Connected${r.label ? ` (${r.label})` : ""}${credit}${saved ? "" : ". This browser would not save it, so you may need to paste it again next time."}`,
    });
    onSaved(key);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 sm:items-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="card max-h-[92vh] w-full max-w-md overflow-y-auto !p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="text-xl font-bold leading-tight">
            🔑 Connect your OpenRouter key
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:text-ink">
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">To make videos you need an OpenRouter key. Takes 2 minutes.</p>
        <ol className="mt-4 space-y-2 text-sm">
          <li className="flex gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">1</span>
            <span>
              Sign up at{" "}
              <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className="font-semibold underline">
                openrouter.ai
              </a>{" "}
              (free).
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">2</span>
            <span>Add a little credit (about $5 makes many videos).</span>
          </li>
          <li className="flex gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink">3</span>
            <span>
              Open{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="font-semibold underline">
                openrouter.ai/keys
              </a>
              , create a key and copy it.
            </span>
          </li>
        </ol>

        <label className="label mt-5" htmlFor={inputId}>
          Paste your key here
          <Info title="Your OpenRouter key">
            Your personal password for the AI services (voice, pictures, video). It is saved only in this browser, and sent only to this
            app to make each request. Every AI step is charged to your OpenRouter balance, not to this app. You can remove it any time.
          </Info>
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            ref={inputRef}
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (state.kind !== "checking") setState({ kind: "idle" });
            }}
            onKeyDown={(e) => e.key === "Enter" && testAndSave()}
            placeholder="sk-or-v1-…"
            autoComplete="off"
            spellCheck={false}
            className="input font-mono"
          />
          <button type="button" onClick={() => setShow((v) => !v)} className="btn-secondary w-20" aria-label={show ? "Hide key" : "Show key"}>
            {show ? "Hide" : "Show"}
          </button>
        </div>

        {state.text && (
          <p role="status" className={`mt-2 text-sm font-semibold ${state.kind === "ok" ? "text-ok" : "text-bad"}`}>
            {state.text}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          {state.kind === "ok" ? (
            <button type="button" onClick={onClose} className="btn-primary flex-1">
              Done
            </button>
          ) : (
            <button type="button" onClick={testAndSave} disabled={state.kind === "checking"} className="btn-primary flex-1">
              {state.kind === "checking" ? "Checking…" : "Test & save"}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary">
            {state.kind === "ok" ? "Close" : "Later"}
          </button>
        </div>
      </div>
    </div>
  );
}
