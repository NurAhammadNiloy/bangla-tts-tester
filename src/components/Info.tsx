"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Small ⓘ button that explains a setting in plain words.
 * Popover on wide screens, bottom sheet on phones. Closes on outside tap or Escape.
 */
export default function Info({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative ml-1.5 inline-flex align-middle">
      <button
        type="button"
        aria-label={`What is “${title}”?`}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold leading-none transition ${
          open ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:border-accent hover:text-accent-strong"
        }`}
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-line bg-surface-2 p-4 text-left text-sm font-normal leading-relaxed text-ink shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-7 sm:w-72 sm:-translate-x-1/2 sm:p-3.5"
        >
          <span className="mb-1 block font-bold">{title}</span>
          {children}
          <button type="button" onClick={() => setOpen(false)} className="mt-3 block w-full rounded-lg bg-surface py-2 text-xs font-semibold sm:hidden">
            Got it
          </button>
        </span>
      )}
    </span>
  );
}
