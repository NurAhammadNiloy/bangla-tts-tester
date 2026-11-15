"use client";

import { Evidence } from "@/components/create/DirectorReview";
import { SEVERITY_LABEL, type Severity, type ValidationReport, type Violation } from "@/lib/storyValidator";

const TONE: Record<Severity, string> = {
  hard: "border-bad/50 bg-bad/10 text-bad",
  soft: "border-accent/40 bg-accent/10 text-accent-strong",
  review: "border-line bg-surface-2 text-ink",
};
const ICON: Record<Severity, string> = { hard: "⛔", soft: "⚠", review: "👁" };

function Row({ v, story }: { v: Violation; story: string }) {
  return (
    <li className={`rounded-lg border p-2 ${TONE[v.severity]}`}>
      <p className="text-sm font-semibold">
        <span className="mr-1">{ICON[v.severity]}</span>
        <span className="mr-1.5 rounded bg-surface px-1.5 py-0.5 text-[11px]">{SEVERITY_LABEL[v.severity]}</span>
        {v.message}
      </p>
      {v.shots.length > 0 && <p className="mt-0.5 text-xs">Shot{v.shots.length > 1 ? "s" : ""} {v.shots.map((i) => i + 1).join(", ")}</p>}
      {v.evidence.length > 0 && (
        <div className="mt-1 text-ink">
          <p className="text-xs font-semibold">Your story says:</p>
          <Evidence story={story} spans={v.evidence} />
        </div>
      )}
      <p className="mt-1 text-xs">What to do: {v.suggestion}</p>
      <p className="mt-0.5 font-mono text-[10px] opacity-70">{v.id}{v.facts.length ? ` · ${v.facts.join(", ")}` : ""}</p>
    </li>
  );
}

/** Blocking problems first (they stop the paid steps), then warnings, then things to check by eye. */
export default function PlanReport({ report, story }: { report: ValidationReport; story: string }) {
  const groups: [Severity, Violation[]][] = [
    ["hard", report.hard],
    ["soft", report.soft],
    ["review", report.review],
  ];
  return (
    <div className="space-y-3" aria-label="Story check of this plan">
      {groups.map(([sev, list]) =>
        list.length ? (
          <details key={sev} open={sev === "hard"}>
            <summary className="cursor-pointer text-sm font-semibold">
              {SEVERITY_LABEL[sev]}: {list.length}
              {sev === "hard" ? " — the video cannot be made until these are fixed" : sev === "soft" ? " — the video can still be made" : " — only a person can judge these"}
            </summary>
            <ul className="mt-2 space-y-2">
              {list.map((v, i) => (
                <Row key={`${v.id}-${i}`} v={v} story={story} />
              ))}
            </ul>
          </details>
        ) : null,
      )}
    </div>
  );
}
