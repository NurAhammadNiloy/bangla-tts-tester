"use client";

/**
 * Director's Review: the Story Bible as five cards the author can Edit, Regenerate,
 * Compare with the original text, and Approve. Nothing paid happens before approval.
 */
import { useMemo, useState } from "react";
import Info from "@/components/Info";
import {
  estimateCost,
  inStory,
  overSpendLimit,
  type BibleCharacter,
  type BibleSection,
  type GateReport,
  type StoryBible,
} from "@/lib/storyBible";

type Card = { id: BibleSection; title: string; bn: string; info: string };

const CARDS: Card[] = [
  { id: "story", bn: "গল্প ও বার্তা", title: "Story & message", info: "What the story is about, and the events in order. Everything else is built from this." },
  { id: "characters", bn: "চরিত্র ও সম্পর্ক", title: "Characters & relations", info: "Every person and place. Only these people can appear in the video. Fix a wrong relation here before anything is drawn." },
  { id: "scenes", bn: "মূল দৃশ্য", title: "Key scenes", info: "The pictures, lines and numbers the viewer must see and hear exactly." },
  { id: "ending", bn: "সমাপ্তি", title: "Ending", info: "How the last shot lands and how slow or fast the video feels." },
  { id: "rules", bn: "যা বদলানো যাবে না", title: "Cannot-change list", info: "Things the video must never change or show. The planner is told to obey this list." },
];

const box = "rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm w-full";
const small = "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent disabled:opacity-50";

const LIMIT_KEY = "golpo.spendLimit.v1";

export default function DirectorReview(props: {
  bible: StoryBible;
  report: GateReport | null;
  story: string;
  partsTotal: number;
  voiceMinutes: number;
  fast: boolean;
  busy: boolean;
  onFast: (v: boolean) => void;
  onChange: (b: StoryBible) => void;
  onRegenerate: (section: BibleSection) => void;
  onApprove: () => void;
  onBack: () => void;
}) {
  const { bible, story } = props;
  const [approved, setApproved] = useState<Set<BibleSection>>(() => new Set());
  const [editing, setEditing] = useState<BibleSection | null>(null);
  const [comparing, setComparing] = useState<Set<BibleSection>>(() => new Set());
  const allApproved = CARDS.every((c) => approved.has(c.id));
  const cost = useMemo(
    () => estimateCost({ newCharacters: bible.characters.length, newPlaces: bible.places.length, voiceMinutes: props.voiceMinutes }),
    [bible.characters.length, bible.places.length, props.voiceMinutes],
  );

  const [limit, setLimit] = useState(() => {
    try {
      const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(LIMIT_KEY);
      const v = raw === null ? NaN : Number(raw);
      return Number.isFinite(v) && v >= 0 ? v : 1;
    } catch {
      return 1; // storage blocked: default limit
    }
  });
  const changeLimit = (v: number) => {
    const n = Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : 0;
    setLimit(n);
    try {
      localStorage.setItem(LIMIT_KEY, String(n));
    } catch {
      /* ignore */
    }
  };
  const tooExpensive = overSpendLimit(cost.total, limit);

  const touch = (id: BibleSection, next: StoryBible) => {
    setApproved((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    props.onChange({ ...next, approvedAt: undefined });
  };
  const toggle = (set: Set<BibleSection>, id: BibleSection, fn: (s: Set<BibleSection>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    fn(n);
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h1 className="font-display text-2xl font-extrabold">
        পরিচালকের পর্যালোচনা · Director&apos;s review
        <Info title="Director's review">
          The AI read your whole story and wrote down what is true: who is who, what happens, what must never change. Check each card. Nothing is drawn or voiced until you approve.
        </Info>
      </h1>
      <p className="mt-1 text-sm text-muted">Check each card, fix anything wrong, then approve. Every fact below was checked by code against your story.</p>

      {props.report && props.report.notes.length > 0 && (
        <details className="mt-3 rounded-xl border border-line bg-surface-2 p-3 text-sm">
          <summary className="cursor-pointer font-semibold">
            ⚠ The accuracy check fixed {props.report.notes.length} thing{props.report.notes.length > 1 ? "s" : ""}
            <Info title="Accuracy check">A plain computer check, not the AI. Facts whose quoted sentence is not really in your story were turned into guesses; lines, numbers and people that are not in your story were removed.</Info>
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {props.report.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 space-y-3">
        {CARDS.map((c) => {
          const isEdit = editing === c.id;
          const isApproved = approved.has(c.id);
          return (
            <article key={c.id} className={`rounded-xl border-2 p-3 ${isApproved ? "border-ok/60 bg-ok/5" : "border-line"}`}>
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold">
                  {isApproved ? "✓ " : ""}
                  {c.bn} · {c.title}
                  <Info title={c.title}>{c.info}</Info>
                </h2>
              </header>

              <div className="mt-2 text-sm">
                {isEdit ? <Editor id={c.id} bible={bible} onChange={(b) => touch(c.id, b)} partsTotal={props.partsTotal} /> : <View id={c.id} bible={bible} />}
              </div>

              {comparing.has(c.id) && <Compare id={c.id} bible={bible} story={story} />}

              <div className="mt-3 flex flex-wrap gap-2">
                <button className={small} onClick={() => setEditing(isEdit ? null : c.id)}>
                  {isEdit ? "Done editing" : "✎ Edit"}
                  <Info title="Edit">Change the words yourself. Your edits are trusted and kept exactly.</Info>
                </button>
                <button className={small} disabled={props.busy} onClick={() => props.onRegenerate(c.id)}>
                  ↻ Regenerate
                  <Info title="Regenerate">Ask the AI to read the story again and redo only this card. Costs a few cents. Your other cards stay as they are.</Info>
                </button>
                <button className={small} onClick={() => toggle(comparing, c.id, setComparing)} aria-pressed={comparing.has(c.id)}>
                  ⇄ Compare with original
                  <Info title="Compare with original">Shows the sentences copied from your story next to what the AI wrote, with a tick where the sentence is really in your story.</Info>
                </button>
                <button
                  className={`${small} ${isApproved ? "border-ok text-ok" : "border-accent text-accent-strong"}`}
                  onClick={() => toggle(approved, c.id, setApproved)}
                  aria-pressed={isApproved}
                >
                  {isApproved ? "✓ Approved" : "Approve"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm">
        <label className="block font-semibold" htmlFor="own-direction">
          Paste your own direction (optional)
          <Info title="Your own direction">Write in your own words how the video should be made. It is the highest priority and overrides the AI where they disagree.</Info>
        </label>
        <textarea
          id="own-direction"
          className={`${box} mt-2 min-h-24`}
          value={bible.userDirection ?? ""}
          placeholder="e.g. Open on the empty room. Keep the fan spinning. End on the question."
          onChange={(e) => props.onChange({ ...bible, userDirection: e.target.value.slice(0, 4000), approvedAt: undefined })}
        />
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm">
        <p className="font-semibold">
          Cost before you approve
          <Info title="Cost">A rough guess from prices measured earlier. Real cost depends on the model and on how many new pictures are needed. Animation is drawn by code and is free.</Info>
        </p>
        <ul className="mt-2 space-y-1">
          {cost.lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-3">
              <span>
                {l.label} <span className="text-muted">· {l.detail}</span>
              </span>
              <span className="tabular-nums">${l.usd.toFixed(2)}</span>
            </li>
          ))}
          <li className="flex justify-between border-t border-line pt-1 font-bold">
            <span>About</span>
            <span className="tabular-nums">${cost.total.toFixed(2)}</span>
          </li>
        </ul>
        <label className="mt-3 flex items-center gap-3 font-semibold">
          Spending limit $
          <input
            type="number"
            min={0}
            step={0.25}
            value={limit}
            onChange={(e) => changeLimit(Number(e.target.value))}
            className="w-24 rounded-lg border border-line bg-surface-2 px-2 py-1"
            aria-label="Spending limit in US dollars"
          />
          <Info title="Spending limit">The most you want to spend on this part. If the estimate is higher, the Approve button stays locked until you raise the limit. 0 means no limit.</Info>
        </label>
        {tooExpensive && (
          <p role="alert" className="mt-2 text-sm font-semibold text-bad">
            The estimate (${cost.total.toFixed(2)}) is above your limit (${limit.toFixed(2)}). Raise the limit to continue.
          </p>
        )}
        <label className="mt-3 flex items-center gap-3 font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={props.fast} onChange={(e) => props.onFast(e.target.checked)} />
          Fast shot planner (cheaper)
          <Info title="Fast shot planner">Plans the shots with a cheaper, faster model. If its answer is broken, the strong model is used instead. The bible is always made by the strong model.</Info>
        </label>
      </div>

      <button
        className="mt-5 w-full rounded-xl bg-accent px-5 py-3.5 text-base font-bold text-accent-ink shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={props.busy || !allApproved || tooExpensive}
        onClick={props.onApprove}
      >
        {allApproved ? "অনুমোদন করে পরের ধাপ · Approve & plan the shots" : `Approve all ${CARDS.length} cards to continue (${approved.size}/${CARDS.length})`}
      </button>
      {!allApproved && (
        <button className="mt-2 w-full text-sm font-semibold text-muted underline" onClick={() => setApproved(new Set(CARDS.map((c) => c.id)))}>
          Looks right: approve all cards
        </button>
      )}
      <button className="mt-3 w-full text-sm font-semibold text-muted underline" onClick={props.onBack}>
        ← Back to style
      </button>
    </section>
  );
}

/* ---------------------------------- views ---------------------------------- */

function factBadge(kind: string) {
  const m: Record<string, string> = { confirmed: "✓ in story", inference: "maybe", creative_choice: "our choice", prohibited_change: "never" };
  return <span className="mr-1.5 rounded bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-muted">{m[kind] ?? kind}</span>;
}

function View({ id, bible }: { id: BibleSection; bible: StoryBible }) {
  if (id === "story")
    return (
      <>
        <p>{bible.message || "—"}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {bible.events.map((e, i) => (
            <li key={i}>
              {factBadge(e.kind)}
              {e.text}
            </li>
          ))}
        </ol>
      </>
    );
  if (id === "characters")
    return (
      <>
        <ul className="space-y-2">
          {bible.characters.map((c) => (
            <li key={c.id}>
              <b>{c.name}</b> <span className="text-muted">— {c.relation || "no relation given"}</span>
              {c.facts.map((f, i) => (
                <div key={i} className="ml-3 text-muted">
                  {factBadge(f.kind)}
                  {f.text}
                </div>
              ))}
            </li>
          ))}
          {!bible.characters.length && <li className="text-muted">No people found.</li>}
        </ul>
        {bible.places.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-line pt-2">
            {bible.places.map((p) => (
              <li key={p.id}>
                📍 <b>{p.name}</b> <span className="text-muted">— {p.description}{p.who ? ` (${p.who})` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  if (id === "scenes")
    return (
      <>
        <ul className="space-y-1">
          {bible.keyMoments.map((m, i) => (
            <li key={i}>
              <span className="text-muted">Part {m.part + 1}:</span> {m.text}
            </li>
          ))}
          {!bible.keyMoments.length && <li className="text-muted">No key scenes.</li>}
        </ul>
        {bible.keyLines.length > 0 && <p className="mt-2 text-muted">Exact lines: {bible.keyLines.map((l) => `“${l.text}”`).join(" · ")}</p>}
        {bible.keyNumbers.length > 0 && <p className="mt-1 text-muted">Exact numbers: {bible.keyNumbers.map((n) => `${n.value} (${n.meaning})`).join(" · ")}</p>}
      </>
    );
  if (id === "ending")
    return (
      <>
        <p>{bible.ending || "—"}</p>
        <p className="mt-1 text-muted">Pacing: {bible.pacing || "—"}</p>
      </>
    );
  return (
    <ul className="space-y-1">
      {bible.prohibited.map((p, i) => (
        <li key={i}>✗ {p.text}</li>
      ))}
      {!bible.prohibited.length && <li className="text-muted">Nothing listed.</li>}
    </ul>
  );
}

function Compare({ id, bible, story }: { id: BibleSection; bible: StoryBible; story: string }) {
  const rows: { says: string; source?: string; ok: boolean | null }[] = [];
  const add = (says: string, source?: string) => rows.push({ says, source, ok: source ? inStory(story, source) : null });
  if (id === "story") bible.events.forEach((e) => add(e.text, e.source));
  if (id === "characters") bible.characters.forEach((c) => c.facts.forEach((f) => add(`${c.name}: ${f.text}`, f.source)));
  if (id === "scenes") {
    bible.keyMoments.forEach((m) => add(m.text, m.source));
    bible.keyLines.forEach((l) => add(`Line: ${l.text}`, l.text));
    bible.keyNumbers.forEach((n) => add(`Number: ${n.meaning}`, n.value));
  }
  if (id === "rules") bible.prohibited.forEach((p) => add(p.text, p.source));
  const chars = [...story];
  const head = chars.slice(0, 300).join("");
  const tail = chars.length > 300 ? chars.slice(-300).join("") : "";
  return (
    <div className="mt-2 rounded-lg bg-surface p-2 text-xs">
      <p className="mb-1 font-semibold">Original story vs. what the AI wrote</p>
      {id === "ending" && (
        <>
          <p className="text-muted">Story ends: …{tail || head}</p>
          <p className="mt-1">AI ending: {bible.ending}</p>
        </>
      )}
      {id !== "ending" && !rows.length && <p className="text-muted">Nothing to compare here.</p>}
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i}>
            <div>AI: {r.says}</div>
            <div className={r.ok === false ? "text-danger" : "text-muted"}>
              {r.ok === null ? "No sentence quoted (a guess or a choice)." : r.ok ? `✓ Story: “${r.source}”` : `✗ Not found in the story: “${r.source}”`}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------- editors ---------------------------------- */

function Editor({ id, bible, onChange, partsTotal }: { id: BibleSection; bible: StoryBible; onChange: (b: StoryBible) => void; partsTotal: number }) {
  if (id === "story")
    return (
      <>
        <label className="block text-xs font-semibold">Message</label>
        <textarea className={`${box} min-h-20`} value={bible.message} onChange={(e) => onChange({ ...bible, message: e.target.value })} />
        <label className="mt-2 block text-xs font-semibold">Events in order (one per line)</label>
        <Lines
          className="min-h-32"
          initial={bible.events.map((e) => e.text)}
          onCommit={(ls) =>
            onChange({
              ...bible,
              events: ls.map((l, i) => {
                const old = bible.events[i];
                return old && old.text === l ? old : { kind: "confirmed" as const, text: l, by: "user" as const };
              }),
            })
          }
        />
      </>
    );
  if (id === "characters") {
    const setChar = (i: number, patch: Partial<BibleCharacter>) =>
      onChange({ ...bible, characters: bible.characters.map((c, j) => (j === i ? { ...c, ...patch, by: "user" } : c)) });
    return (
      <>
        {bible.characters.map((c, i) => (
          <div key={c.id} className="mb-2 grid gap-1.5 rounded-lg border border-line p-2">
            <input className={box} value={c.name} aria-label="Name" onChange={(e) => setChar(i, { name: e.target.value, mentions: Array.from(new Set([e.target.value, ...c.mentions])).filter(Boolean) })} />
            <input className={box} value={c.relation} aria-label="Relation" placeholder="Exact relation, e.g. Rahima's only son" onChange={(e) => setChar(i, { relation: e.target.value })} />
            <input className={box} value={c.look} aria-label="Look" placeholder="Look in English: age, clothes" onChange={(e) => setChar(i, { look: e.target.value })} />
            <button className="justify-self-start text-xs font-semibold text-danger underline" onClick={() => onChange({ ...bible, characters: bible.characters.filter((_, j) => j !== i) })}>
              Remove this person
            </button>
          </div>
        ))}
        <button
          className={small}
          onClick={() =>
            onChange({ ...bible, characters: [...bible.characters, { id: `c${Date.now().toString(36)}`, name: "", mentions: [], relation: "", look: "", facts: [], by: "user" }] })
          }
        >
          + Add a person
        </button>
      </>
    );
  }
  if (id === "scenes")
    return (
      <>
        {bible.keyMoments.map((m, i) => (
          <div key={i} className="mb-1.5 flex gap-1.5">
            <input
              type="number"
              min={1}
              max={Math.max(1, partsTotal)}
              aria-label="Part number"
              className={`${box} !w-16`}
              value={m.part + 1}
              onChange={(e) => onChange({ ...bible, keyMoments: bible.keyMoments.map((x, j) => (j === i ? { ...x, part: Math.max(0, (Number(e.target.value) || 1) - 1), by: "user" } : x)) })}
            />
            <input
              className={box}
              aria-label="Key scene"
              value={m.text}
              onChange={(e) => onChange({ ...bible, keyMoments: bible.keyMoments.map((x, j) => (j === i ? { ...x, text: e.target.value, by: "user" } : x)) })}
            />
            <button aria-label="Remove" className="px-2 text-danger" onClick={() => onChange({ ...bible, keyMoments: bible.keyMoments.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <button className={small} onClick={() => onChange({ ...bible, keyMoments: [...bible.keyMoments, { part: 0, text: "", by: "user" }] })}>
          + Add a key scene
        </button>
      </>
    );
  if (id === "ending")
    return (
      <>
        <label className="block text-xs font-semibold">Ending</label>
        <textarea className={`${box} min-h-20`} value={bible.ending} onChange={(e) => onChange({ ...bible, ending: e.target.value })} />
        <label className="mt-2 block text-xs font-semibold">Pacing</label>
        <textarea className={`${box} min-h-16`} value={bible.pacing} onChange={(e) => onChange({ ...bible, pacing: e.target.value })} />
      </>
    );
  return (
    <>
      <label className="block text-xs font-semibold">Things that must never change or appear (one per line)</label>
      <Lines
        className="min-h-28"
        initial={bible.prohibited.map((p) => p.text)}
        onCommit={(ls) =>
          onChange({
            ...bible,
            prohibited: ls.map((l, i) => {
              const old = bible.prohibited[i];
              return old && old.text === l ? old : { kind: "prohibited_change" as const, text: l, by: "user" as const };
            }),
          })
        }
      />
    </>
  );
}

/** One line per item; keeps its own text so the Enter key works while typing. */
function Lines({ initial, onCommit, className }: { initial: string[]; onCommit: (lines: string[]) => void; className?: string }) {
  const [text, setText] = useState(() => initial.join("\n"));
  return (
    <textarea
      className={`${box} ${className ?? ""}`}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(e.target.value.split("\n").filter((l) => l.trim()));
      }}
    />
  );
}
