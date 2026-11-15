"use client";

import { useState, useSyncExternalStore } from "react";
import Info from "@/components/Info";
import KeyDialog from "@/components/KeyDialog";
import { clearKey, getKey } from "@/lib/projects/keyStore";
import { maskKey } from "./maskKey";

// keyStore has no change events; bump listeners ourselves after edits here,
// and listen to storage events for other tabs.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}
const readKey = () => {
  try {
    return getKey();
  } catch {
    return "";
  }
};

export default function KeyBox() {
  const key = useSyncExternalStore(subscribe, readKey, () => "");
  const [open, setOpen] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);

  return (
    <section aria-labelledby="key-h" className="card">
      <h2 id="key-h" className="flex items-center text-lg font-bold">
        🔑 OpenRouter key
        <Info title="OpenRouter key">
          Golpo Studio uses your own OpenRouter account to make voices, pictures and plans. You pay OpenRouter directly for what you use. The key is
          kept only in this browser and sent only with your own requests.
        </Info>
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className={`min-w-0 flex-1 truncate rounded-xl border border-line bg-bg px-3.5 py-2.5 font-mono text-sm ${key ? "" : "text-muted"}`}>
          {key ? maskKey(key) : "No key yet"}
        </p>
        <button type="button" onClick={() => setOpen(true)} className={key ? "btn-secondary" : "btn-primary"}>
          {key ? "Change" : "Add key"}
        </button>
        {key && !confirmForget && (
          <button type="button" onClick={() => setConfirmForget(true)} className="btn-secondary">
            Forget
          </button>
        )}
        <Info title="Change or forget">
          Change saves a new key after checking that OpenRouter accepts it. Forget removes the key from this browser; your projects stay.
        </Info>
      </div>
      {confirmForget && (
        <div role="alertdialog" aria-label="Forget key?" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">
          <span className="flex-1">Remove the key from this browser? You can add it again any time.</span>
          <button
            type="button"
            className="rounded-xl bg-bad px-3 py-2 text-sm font-bold text-white"
            onClick={() => {
              clearKey();
              setConfirmForget(false);
              notify();
            }}
          >
            Forget key
          </button>
          <button type="button" className="btn-secondary" onClick={() => setConfirmForget(false)} autoFocus>
            Cancel
          </button>
        </div>
      )}
      <KeyDialog
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          notify();
        }}
      />
    </section>
  );
}
