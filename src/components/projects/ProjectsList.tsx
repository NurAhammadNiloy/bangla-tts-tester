"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Info from "@/components/Info";
import { exportProject, importBackup } from "@/lib/projects/backup";
import { deleteProject, listProjects } from "@/lib/projects/db";
import type { ProjectRecord } from "@/lib/projects/types";
import { episodesLabel, projectStatus, projectTitle, sortProjects, styleLabel, timeAgo } from "./projectInfo";

const TONE = {
  draft: "border-line bg-surface-2 text-muted",
  working: "border-accent/50 bg-accent/15 text-accent-strong",
  ready: "border-ok/40 bg-ok/10 text-ok",
} as const;

export default function ProjectsList() {
  const [items, setItems] = useState<ProjectRecord[] | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    return listProjects()
      .then((all) => {
        setNow(Date.now());
        setItems(sortProjects(all));
        setError(null);
      })
      .catch(() => {
        setItems([]);
        setError("This browser blocked saved projects (private mode?). Projects can't be listed here.");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function backup(id: string) {
    setBusyId(id);
    try {
      const { blob, fileName } = await exportProject(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make the backup.");
    } finally {
      setBusyId(null);
    }
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    try {
      await importBackup(await file.text());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore that backup.");
    }
  }

  const restoreButton = (
    <div className="mb-3 flex items-center gap-2">
      <label className="btn-secondary cursor-pointer">
        Restore from backup
        <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      <Info title="Backup and restore">
        Your stories are saved only in this browser, and a browser can clear them. Press Backup on a story to download one file with everything in it (voices, pictures, videos). Restore puts a backup file back, here or on another device. Your OpenRouter key is never inside the file.
      </Info>
    </div>
  );

  async function remove(id: string) {
    setBusyId(id);
    try {
      await deleteProject(id);
      setConfirmId(null);
      await load();
    } catch {
      setError("Could not delete that project. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (items === null) {
    return (
      <p role="status" className="py-10 text-center text-muted">
        Loading your projects…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 py-10 text-center">
        <span aria-hidden className="text-4xl">📚</span>
        <h2 className="text-xl font-bold">No projects yet</h2>
        <p className="max-w-sm text-sm text-muted">
          Every story you turn into a video is saved here, in this browser, so you can come back to it later.
        </p>
        {error && <p className="text-sm text-bad">{error}</p>}
        <Link href="/create" className="btn-primary mt-1 px-6 py-3 text-base">
          Make your first video
        </Link>
        <div className="mt-2">{restoreButton}</div>
      </div>
    );
  }

  return (
    <>
      {restoreButton}
      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((p) => {
          const st = projectStatus(p);
          const style = styleLabel(p.style);
          const confirming = confirmId === p.id;
          return (
            <li key={p.id} className="card flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl">
                  {style.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="bangla truncate font-sans text-base font-bold">{projectTitle(p)}</h2>
                  <p className="text-xs text-muted">
                    {style.label} style, {episodesLabel(p.episodes.length)}
                  </p>
                  <p className="text-xs text-muted">Updated {timeAgo(p.updatedAt, now)}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[st.tone]}`}>{st.label}</span>
              </div>

              {confirming ? (
                <div role="alertdialog" aria-label="Delete project?" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">
                  <p className="font-semibold">Delete “{projectTitle(p)}”?</p>
                  <p className="mt-0.5 text-xs text-muted">Its voices, pictures and videos are removed from this browser too. This can&apos;t be undone.</p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      disabled={busyId === p.id}
                      className="inline-flex flex-1 items-center justify-center rounded-xl bg-bad px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {busyId === p.id ? "Deleting…" : "Delete"}
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)} className="btn-secondary flex-1" autoFocus>
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link href={`/create?project=${encodeURIComponent(p.id)}`} className="btn-primary flex-1">
                    Open
                  </Link>
                  <button type="button" onClick={() => backup(p.id)} disabled={busyId === p.id} className="btn-secondary" aria-label={`Back up ${projectTitle(p)}`}>
                    Backup
                  </button>
                  <button type="button" onClick={() => setConfirmId(p.id)} className="btn-secondary" aria-label={`Delete ${projectTitle(p)}`}>
                    Delete
                  </button>
                  <Info title="Open or delete">
                    Open continues this story where you stopped. Delete removes the story and everything made for it from this browser.
                  </Info>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
