"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Info from "@/components/Info";
import { listProjects } from "@/lib/projects/db";
import type { ProjectRecord } from "@/lib/projects/types";
import { episodesLabel, projectStatus, projectTitle, sortProjects, styleLabel, timeAgo } from "@/components/projects/projectInfo";

/** The 3 latest projects saved in this browser. Renders nothing when there are none. */
export default function ContinueList() {
  const [items, setItems] = useState<ProjectRecord[] | null>(null);

  useEffect(() => {
    let live = true;
    listProjects()
      .then((all) => live && setItems(sortProjects(all).slice(0, 3)))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, []);

  if (!items || items.length === 0) return null;
  const now = Date.now();
  return (
    <section aria-labelledby="continue-h">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="continue-h" className="flex items-center text-lg font-bold">
          Continue where you left off
          <Info title="Continue where you left off">
            Your latest stories, saved in this browser. Tap one to keep working on it. Nothing is uploaded to us.
          </Info>
        </h2>
        <Link href="/projects" className="text-sm font-semibold text-accent-strong hover:underline">
          All projects
        </Link>
      </div>
      <ul className="grid gap-2">
        {items.map((p) => {
          const st = projectStatus(p);
          const style = styleLabel(p.style);
          return (
            <li key={p.id}>
              <Link
                href={`/create?project=${encodeURIComponent(p.id)}`}
                className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 transition hover:border-accent"
              >
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg">
                  {style.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="bangla block truncate font-semibold">{projectTitle(p)}</span>
                  <span className="block truncate text-xs text-muted">
                    {episodesLabel(p.episodes.length)}, {st.label.toLowerCase()}, {timeAgo(p.updatedAt, now)}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-accent-strong">Open</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
