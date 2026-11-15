"use client";

/**
 * Director's Review: the Story Bible as five cards the author can Edit, Regenerate, Compare with
 * the original text, and Approve. Every claim shows what the code check found and the real story
 * passage behind it. Approval is per card and bound to the card's content: change it and the
 * approval goes away. Nothing paid happens before every card is approved.
 */
import { useMemo, useState } from "react";
import Info from "@/components/Info";
import {
  approveSection,
  blockedReasons,
  cardState,
  estimateCost,
  overSpendLimit,
  PLACE_KINDS,
  SECTIONS,
  summarize,
  summaryLine,
  type BibleCharacter,
  type BibleFact,
  type BibleMoment,
  type BibleSection,
  type By,
  type CardState,
  type Finding,
  type GateReport,
  type PlaceKind,
  type StoryBible,
} from "@/lib/storyBible";
import { evidenceView, NO_PASSAGE, storyHash, type Span, type Verification } from "@/lib/storyEvidence";

type Card = { id: BibleSection; title: string; bn: string; info: string };

const CARDS: Card[] = [
  { id: "story", bn: "গল্প ও বার্তা", title: "Story & message", info: "What the story is about, and every event in order. Everything else is built from this." },
  { id: "characters", bn: "চরিত্র, সম্পর্ক ও জায়গা", title: "Characters & relations", info: "Every person, how they are related, and every place. Only these people can appear in the video." },
  { id: "scenes", bn: "মূল দৃশ্য", title: "Key scenes", info: "Every important moment the video must show, with who is on screen, the objects, the feeling and what must not be shown. Also the exact lines and numbers." },
  { id: "ending", bn: "সমাপ্তি", title: "Ending", info: "The story's last moments in order, its exact final line, and how the last shot looks." },
  { id: "rules", bn: "যা বদলানো যাবে না", title: "Cannot-change list", info: "Things the video must never change or show. Some are written by code for every story, some come from your story, and you can add your own. All are obeyed when the shots are planned." },
];

const box = "rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm w-full";
const small = "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent disabled:opacity-50";
const LIMIT_KEY = "golpo.spendLimit.v1";
const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export default function DirectorReview(props: {
  bible: StoryBible;
  /** Only its extra server notes are shown; counts and findings are worked out from the bible, so they are never stale. */
  report?: GateReport | null;
  story: string;
  partsTotal: number;
  voiceMinutes: number;
  fast: boolean;
  busy: boolean;
  onFast: (v: boolean) => void;
  /** `kind` = "approval" when only approvals changed (no new revision). */
  onChange: (b: StoryBible, kind?: "content" | "approval") => void;
  onRegenerate: (section: BibleSection) => void;
  onApprove: () => void;
  onBack: () => void;
}) {
  const { bible, story } = props;
  const report = useMemo(() => summarize(bible), [bible]);
  const [editing, setEditing] = useState<BibleSection | null>(null);
  const [comparing, setComparing] = useState<Set<BibleSection>>(() => new Set());
  const states = Object.fromEntries(SECTIONS.map((s) => [s, cardState(bible, s)])) as Record<BibleSection, CardState>;
  const approvedCount = SECTIONS.filter((s) => states[s] === "approved").length;
  const allApproved = approvedCount === SECTIONS.length;
  const storyChanged = !!bible.storyHash && bible.storyHash !== storyHash(story);
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
      return 1;
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
  const edit = (next: StoryBible) => props.onChange(next, "content");
  const approve = (id: BibleSection, on: boolean) => props.onChange(approveSection(bible, id, on), "approval");
  const toggleCompare = (id: BibleSection) =>
    setComparing((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const need = report.unverified + report.contradicted;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="dr-title">
      <h1 id="dr-title" className="font-display text-2xl font-extrabold">
        পরিচালকের পর্যালোচনা · Director&apos;s review
        <Info title="Director's review">
          The AI read your whole story and wrote down who is who, what happens and what must never change. Code then looked for every claim in your story. Check each card. Nothing is drawn or voiced until you approve all five.
        </Info>
      </h1>
      <p className="mt-1 text-sm text-muted">Green = found in your story. Yellow = please check. Red = disagrees with your story. Fix anything wrong, then approve each card.</p>

      {storyChanged && (
        <p role="alert" className="mt-3 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm font-semibold text-bad">
          Your story was changed after this review was made. The review is out of date: go back and make it again.
        </p>
      )}

      <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3 text-sm" aria-live="polite">
        <p className="font-semibold">
          যাচাই · Accuracy check: {summaryLine(report)}
          <Info title="Accuracy check">
            Plain code, not the AI. It finds each claim&apos;s sentence in your story (Bangla spelling, spaces and digit style do not matter, and numbers written as words like ষোলো count). When the AI wrote a claim in English, a second AI check may only point to sentence numbers; code then shows those real sentences. Nothing is changed without telling you.
          </Info>
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label="Check results">
          <Count n={report.verified} label="Verified" status="verified" />
          <Count n={report.supported} label="Supported interpretation" status="supported" />
          <Count n={report.unverified} label="Unverified" status="unverified" />
          <Count n={report.contradicted} label="Contradicted" status="contradicted" />
          {report.corrected > 0 && <Count n={report.corrected} label="Fixed to exact words" status="corrected" />}
          {report.removed > 0 && <Count n={report.removed} label="Removed (not in story)" status="removed" />}
          {report.user.deviations > 0 && <Count n={report.user.deviations} label="Your creative changes" status="user_deviation" />}
          {report.user.unsupported > 0 && <Count n={report.user.unsupported} label="Your additions not in story" status="user_unsupported" />}
        </ul>
        {report.findings.length > 0 && (
          <details className="mt-2" open={need > 0}>
            <summary className="cursor-pointer font-semibold">
              {need ? `${need} claim${need > 1 ? "s" : ""} need${need > 1 ? "" : "s"} verification` : "What the check changed"} — show details
            </summary>
            <ul className="mt-2 space-y-2">
              {report.findings.map((f, i) => (
                <FindingRow key={`${f.ref}-${i}`} f={f} story={story} />
              ))}
            </ul>
          </details>
        )}
        {(props.report?.notes ?? []).filter((n) => !report.notes.includes(n)).map((n, i) => (
          <p key={i} className="mt-1 text-xs text-muted">
            {n}
          </p>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {CARDS.map((c) => {
          const isEdit = editing === c.id;
          const st = states[c.id];
          const blocked = blockedReasons(bible, c.id);
          return (
            <article
              key={c.id}
              aria-labelledby={`card-${c.id}`}
              className={`rounded-xl border-2 p-3 ${st === "approved" ? "border-ok/60 bg-ok/5" : st === "blocked" ? "border-bad/50 bg-bad/5" : "border-line"}`}
            >
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`card-${c.id}`} className="font-bold">
                  {c.bn} · {c.title}
                  <Info title={c.title}>{c.info}</Info>
                </h2>
                <StateChip state={st} />
              </header>
              {blocked.length > 0 && (
                <ul role="alert" className="mt-2 list-disc pl-5 text-xs font-semibold text-bad">
                  {blocked.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}

              <div className="mt-2 text-sm">
                {isEdit ? (
                  <Editor id={c.id} bible={bible} onChange={edit} partsTotal={props.partsTotal} />
                ) : (
                  <View id={c.id} bible={bible} story={story} compare={comparing.has(c.id)} onChange={edit} />
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button className={small} onClick={() => setEditing(isEdit ? null : c.id)} aria-pressed={isEdit}>
                  {isEdit ? "✓ Done editing" : "✎ Edit"}
                  <Info title="Edit">Change the words yourself. Your edits are kept exactly and marked as yours. The story still checks them: something that differs from the story is shown as your creative change, not as a fact. Editing removes this card&apos;s approval until you approve it again.</Info>
                </button>
                <button className={small} disabled={props.busy} onClick={() => props.onRegenerate(c.id)}>
                  ↻ Regenerate
                  <Info title="Regenerate">The AI reads the story again and redoes only this card (a few cents). Your own items in this card and all other cards, with their approvals, stay as they are.</Info>
                </button>
                <button className={small} onClick={() => toggleCompare(c.id)} aria-pressed={comparing.has(c.id)}>
                  ⇄ Compare with original
                  <Info title="Compare with original">Shows each claim next to the exact sentences of your story behind it, with the matching words highlighted. If no sentence backs it, it says so.</Info>
                </button>
                <button
                  className={`${small} ${st === "approved" ? "border-ok text-ok" : "border-accent text-accent-strong"}`}
                  onClick={() => approve(c.id, st !== "approved")}
                  disabled={st === "blocked"}
                  aria-pressed={st === "approved"}
                >
                  {st === "approved" ? "✓ Approved" : "Approve"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm">
        <label className="block font-semibold" htmlFor="own-direction">
          নিজের নির্দেশনা · Your own direction (optional)
          <Info title="Your own direction">Write in your own words how the video should be made. It is the highest priority and overrides the AI where they disagree. It belongs to the Cannot-change card, so changing it needs that card approved again.</Info>
        </label>
        <textarea
          id="own-direction"
          className={`${box} mt-2 min-h-24`}
          value={bible.userDirection ?? ""}
          placeholder="e.g. Open on the empty room. Keep the fan spinning. End on the question."
          onChange={(e) => edit({ ...bible, userDirection: e.target.value.slice(0, 4000) })}
        />
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm">
        <p className="font-semibold">
          খরচ · Cost before you approve
          <Info title="Cost">A rough guess from prices measured earlier. Real cost depends on the model and on how many new pictures are needed. Animation is drawn by code and is free. The review itself is already paid for.</Info>
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
          <Info title="Fast shot planner">Plans the shots with a cheaper, faster model. If its answer is broken, the strong model is used instead. The review is always made by the strong model.</Info>
        </label>
      </div>

      <button
        className="mt-5 w-full rounded-xl bg-accent px-5 py-3.5 text-base font-bold text-accent-ink shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={props.busy || !allApproved || tooExpensive || storyChanged}
        onClick={props.onApprove}
      >
        {allApproved ? "অনুমোদন করে পরের ধাপ · Approve & plan the shots" : `Approve all ${SECTIONS.length} cards to continue (${approvedCount}/${SECTIONS.length})`}
      </button>
      {!allApproved && SECTIONS.some((s) => states[s] === "unreviewed") && (
        <button
          className="mt-2 w-full text-sm font-semibold text-muted underline"
          onClick={() => props.onChange(SECTIONS.reduce((b, s) => (states[s] === "unreviewed" ? approveSection(b, s) : b), bible), "approval")}
        >
          Looks right: approve every card that is not blocked
        </button>
      )}
      <button className="mt-3 w-full text-sm font-semibold text-muted underline" onClick={props.onBack}>
        ← Back to style
      </button>
    </section>
  );
}

/* --------------------------------- badges --------------------------------- */

const BADGE: Record<string, { t: string; c: string; info: string }> = {
  verified: { t: "✓ Verified", c: "bg-ok/15 text-ok", info: "Found in your story." },
  supported: { t: "≈ Supported interpretation", c: "bg-ok/10 text-ok", info: "The AI points to real sentences of your story; the exact meaning was not checked word by word." },
  unverified: { t: "? Unverified", c: "bg-accent/20 text-accent-strong", info: NO_PASSAGE },
  contradicted: { t: "✗ Contradicted", c: "bg-bad/15 text-bad", info: "Your story says something different." },
  corrected: { t: "✎ Fixed", c: "bg-surface text-ink", info: "Replaced with your story's exact words." },
  removed: { t: "− Removed", c: "bg-surface text-muted", info: "Not in your story, so it was taken out." },
  // The user authorizes these; only the story can support them. The badge says which it is.
  user_supported: { t: "✎ Your addition · story supports it", c: "bg-ok/10 text-ok", info: "Your addition — the story supports it." },
  user_unsupported: { t: "✎ Your addition · not in the story", c: "bg-accent/20 text-accent-strong", info: "Your addition — the story does not say this. It stays because you wrote it." },
  user_deviation: { t: "✎ Your creative change · differs from story", c: "bg-accent/20 text-accent-strong", info: "User-approved creative change — differs from original story." },
};

const userKey = (check?: Verification) => (check?.status === "contradicted" ? "user_deviation" : check?.status === "verified" || check?.status === "supported" ? "user_supported" : "user_unsupported");

function Badge({ check, by }: { check?: Verification; by?: By }) {
  const key = by === "user" ? userKey(check) : (check?.status ?? "");
  const b = BADGE[key];
  if (!b) return null;
  const detail = [check?.quote && check.quote !== "none" ? `Quote: ${check.quote === "fabricated" ? "not in the story" : check.quote === "near" ? "close to the story" : "exact"}` : "", check?.reason || b.info].filter(Boolean).join(". ");
  return (
    <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${b.c}`} title={detail}>
      {b.t}
    </span>
  );
}

function Count({ n, label, status }: { n: number; label: string; status: string }) {
  return <li className={`rounded-full px-2.5 py-1 font-semibold ${BADGE[status].c}`}>{`${n} ${label}`}</li>;
}

function StateChip({ state }: { state: CardState }) {
  const m: Record<CardState, [string, string]> = {
    approved: ["✓ Approved", "bg-ok/15 text-ok"],
    unreviewed: ["Not approved yet", "bg-surface-2 text-muted"],
    blocked: ["⛔ Blocked: fix first", "bg-bad/15 text-bad"],
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${m[state][1]}`}>{m[state][0]}</span>;
}

/* -------------------------------- evidence -------------------------------- */

export function Evidence({ story, spans }: { story: string; spans: Span[] }) {
  const parts = evidenceView(story, spans);
  if (!parts.length) return <p className="text-xs font-semibold text-accent-strong">{NO_PASSAGE}</p>;
  return (
    <div className="space-y-1">
      {parts.map((p, i) => (
        <blockquote key={i} lang="bn" className="rounded-md border-l-4 border-ok/60 bg-surface px-2 py-1 text-xs leading-relaxed">
          <span className="mr-1 font-mono text-[10px] text-muted">{p.sentence}</span>
          {p.before}
          <mark className="rounded bg-ok/25 px-0.5 text-ink">{p.match}</mark>
          {p.after}
        </blockquote>
      ))}
    </div>
  );
}

function FindingRow({ f, story }: { f: Finding; story: string }) {
  const b = f.origin === "user" ? BADGE[userKey({ status: f.status } as Verification)] : BADGE[f.status];
  return (
    <li className="rounded-lg border border-line bg-surface p-2">
      <p className="text-sm">
        <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${b.c}`}>{b.t}</span>
        <span className="text-xs text-muted">{f.label} · </span>
        {f.claim}
      </p>
      <p className="mt-1 text-xs text-muted">Why: {f.reason}</p>
      {f.aiQuote && <p className="mt-1 text-xs text-muted" lang="bn">AI&apos;s quote: “{f.aiQuote}”</p>}
      {(f.status === "unverified" || f.status === "contradicted") && (
        <div className="mt-1">
          <p className="text-xs font-semibold">Your story says:</p>
          <Evidence story={story} spans={f.evidence} />
        </div>
      )}
      {f.suggestion && <p className="mt-1 text-xs font-semibold">Suggestion: {f.suggestion}</p>}
    </li>
  );
}

/** One claim with its badge; with `compare`, the story passages behind it. */
function Claim({ text, check, by, story, compare, onRemove, label }: { text: string; check?: Verification; by?: By; story: string; compare: boolean; onRemove?: () => void; label?: string }) {
  return (
    <div className="py-0.5">
      <div className="flex items-start gap-1">
        <p className="flex-1">
          <Badge check={check} by={by} />
          {label && <span className="text-muted">{label}: </span>}
          {text}
        </p>
        {onRemove && by !== "user" && (check?.status === "contradicted" || check?.status === "unverified") && (
          <button className="shrink-0 px-1 text-xs font-semibold text-bad underline" onClick={onRemove} aria-label={`Remove: ${text}`}>
            Remove
          </button>
        )}
      </div>
      {compare && (
        <div className="ml-2 mt-1 grid gap-1 sm:grid-cols-[auto_1fr]">
          <span className="text-[11px] font-semibold text-muted">Story:</span>
          {by === "user" && !check?.evidence.length ? (
            <p className="text-xs text-muted">{BADGE[userKey(check)].info}</p>
          ) : (
            <div>
              {by === "user" && <p className="mb-0.5 text-xs font-semibold text-accent-strong">{BADGE[userKey(check)].info} The story says:</p>}
              <Evidence story={story} spans={check?.evidence ?? []} />
              {check && check.status !== "verified" && check.reason && <p className="mt-0.5 text-xs text-muted">Why: {check.reason}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- views ---------------------------------- */

const KIND_LABEL: Record<PlaceKind, string> = {
  house: "house",
  room: "room",
  veranda: "veranda",
  courtyard: "courtyard",
  separate_building: "separate building",
  outdoor: "outdoors",
  public_place: "public place",
  other: "place",
};

function View({ id, bible, story, compare, onChange }: { id: BibleSection; bible: StoryBible; story: string; compare: boolean; onChange: (b: StoryBible) => void }) {
  const name = (cid: string) => bible.characters.find((c) => c.id === cid)?.name ?? cid;
  if (id === "story")
    return (
      <>
        <p className="font-medium">{bible.message || "—"}</p>
        <h3 className="mt-2 text-xs font-bold uppercase tracking-wide text-muted">ঘটনা · Events in order</h3>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          {bible.events.map((e) => (
            <li key={e.id}>
              <Claim text={e.text} check={e.check} by={e.by} story={story} compare={compare} onRemove={() => onChange({ ...bible, events: bible.events.filter((x) => x.id !== e.id) })} />
            </li>
          ))}
        </ol>
      </>
    );
  if (id === "characters")
    return (
      <>
        <ul className="grid gap-2 sm:grid-cols-2">
          {bible.characters.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-surface p-2">
              <p className="font-bold" lang="bn">
                {c.name} <span className="font-mono text-[10px] font-normal text-muted">{c.id}</span>
              </p>
              <p className="text-xs text-muted" lang="bn">
                In the story as: {c.mentions.join(", ")}
              </p>
              <p className="mt-1">{c.relation || "No relation given"}</p>
              {c.look && <p className="text-xs text-muted">Look: {c.look}</p>}
              {c.facts.map((f) => (
                <Claim
                  key={f.id}
                  text={f.text}
                  check={f.check}
                  by={f.by}
                  story={story}
                  compare={compare}
                  onRemove={() => onChange({ ...bible, characters: bible.characters.map((x) => (x.id === c.id ? { ...x, facts: x.facts.filter((y) => y.id !== f.id) } : x)) })}
                />
              ))}
            </li>
          ))}
          {!bible.characters.length && <li className="text-muted">No people found.</li>}
        </ul>
        {bible.relations.length > 0 && (
          <>
            <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-muted">সম্পর্ক · Relations</h3>
            <ul className="mt-1 space-y-1">
              {bible.relations.map((r) => (
                <li key={r.id}>
                  <Claim text={`${name(r.from)} → ${r.relation} → ${name(r.to)}`} check={r.check} by={r.by} story={story} compare={compare} onRemove={() => onChange({ ...bible, relations: bible.relations.filter((x) => x.id !== r.id) })} />
                </li>
              ))}
            </ul>
          </>
        )}
        {bible.places.length > 0 && (
          <>
            <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-muted">জায়গা · Places</h3>
            <ul className="mt-1 space-y-1">
              {bible.places.map((p) => (
                <li key={p.id}>
                  <Claim
                    label={`📍 ${p.name} (${KIND_LABEL[p.kind]}${p.partOf ? ` of ${bible.places.find((x) => x.id === p.partOf)?.name ?? p.partOf}` : ""})`}
                    text={`${p.description}${p.who ? ` · who is there: ${p.who}` : ""}`}
                    check={p.check}
                    by={p.by}
                    story={story}
                    compare={compare}
                    onRemove={() => onChange({ ...bible, places: bible.places.filter((x) => x.id !== p.id) })}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  if (id === "scenes")
    return (
      <>
        <ol className="space-y-2">
          {bible.keyMoments.map((m, i) => (
            <li key={m.id} className="rounded-lg border border-line bg-surface p-2">
              <Claim label={`${i + 1}. Part ${m.part + 1}`} text={m.text} check={m.check} by={m.by} story={story} compare={compare} onRemove={() => onChange({ ...bible, keyMoments: bible.keyMoments.filter((x) => x.id !== m.id) })} />
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-muted">
                {m.purpose && (
                  <>
                    <dt className="font-semibold">Why</dt>
                    <dd>{m.purpose}</dd>
                  </>
                )}
                <dt className="font-semibold">On screen</dt>
                <dd>{m.visible.length ? m.visible.map(name).join(", ") : "nobody (empty shot or voice only)"}</dd>
                {m.objects.length > 0 && (
                  <>
                    <dt className="font-semibold">Objects</dt>
                    <dd>{m.objects.join(", ")}</dd>
                  </>
                )}
                {m.tone && (
                  <>
                    <dt className="font-semibold">Feeling</dt>
                    <dd>{m.tone}</dd>
                  </>
                )}
                {m.restrictions.length > 0 && (
                  <>
                    <dt className="font-semibold text-bad">Never</dt>
                    <dd>{m.restrictions.join("; ")}</dd>
                  </>
                )}
              </dl>
            </li>
          ))}
          {!bible.keyMoments.length && <li className="text-muted">No key scenes.</li>}
        </ol>
        {bible.keyLines.length > 0 && (
          <>
            <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-muted">হুবহু সংলাপ · Exact lines</h3>
            {bible.keyLines.map((l) => (
              <Claim key={l.id} label={l.speaker === "narrator" ? "Narrator" : name(l.speaker)} text={`“${l.text}”`} check={l.check} by={l.by} story={story} compare={compare} />
            ))}
          </>
        )}
        {bible.keyNumbers.length > 0 && (
          <>
            <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-muted">সংখ্যা · Exact numbers</h3>
            {bible.keyNumbers.map((n, i) => (
              <Claim key={i} text={`${n.value} — ${n.meaning}`} check={n.check} by={n.by} story={story} compare={compare} />
            ))}
          </>
        )}
      </>
    );
  if (id === "ending")
    return (
      <>
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted">গল্পের শেষ অংশ · How the story ends</h3>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          {bible.endingBeats.map((f) => (
            <li key={f.id}>
              <Claim text={f.text} check={f.check} by={f.by} story={story} compare={compare} onRemove={() => onChange({ ...bible, endingBeats: bible.endingBeats.filter((x) => x.id !== f.id) })} />
            </li>
          ))}
          {!bible.endingBeats.length && <li className="text-muted">No ending beats.</li>}
        </ol>
        <p className="mt-2">
          <span className="text-xs font-semibold text-muted">Final line (copied from your story): </span>
          <b lang="bn">{bible.finalLine || "—"}</b>
        </p>
        <p className="mt-1">
          <span className="text-xs font-semibold text-muted">Last shot: </span>
          {bible.ending || "—"}
        </p>
        <p className="mt-1 text-muted">Pacing: {bible.pacing || "—"}</p>
      </>
    );
  const by: Record<string, string> = { system: "always", user: "yours", ai: "from your story" };
  return (
    <ul className="space-y-1">
      {bible.prohibited.map((p) => (
        <li key={p.id} className="flex items-start gap-1.5">
          <span className="text-bad">✗</span>
          <div className="flex-1">
            <span className="mr-1.5 rounded bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-muted">{by[p.by ?? "ai"]}</span>
            {p.text}
            {compare && p.check && (
              <div className="mt-1">
                <Evidence story={story} spans={p.check.evidence} />
              </div>
            )}
          </div>
        </li>
      ))}
      {!bible.prohibited.length && <li className="text-muted">Nothing listed.</li>}
    </ul>
  );
}

/* ---------------------------------- editors ---------------------------------- */

/** Edit a list of facts one per line; unchanged lines keep their checks. */
function factLines(list: BibleFact[], lines: string[], prefix: string, kind: BibleFact["kind"]): BibleFact[] {
  return lines.map((l, i) => {
    const old = list.find((x) => x.text === l) ?? (list[i]?.text === l ? list[i] : undefined);
    return old ?? { id: uid(prefix), kind, text: l, by: "user" as const };
  });
}

function Editor({ id, bible, onChange, partsTotal }: { id: BibleSection; bible: StoryBible; onChange: (b: StoryBible) => void; partsTotal: number }) {
  if (id === "story")
    return (
      <>
        <label className="block text-xs font-semibold" htmlFor="ed-msg">
          Message
        </label>
        <textarea id="ed-msg" className={`${box} min-h-20`} value={bible.message} onChange={(e) => onChange({ ...bible, message: e.target.value })} />
        <label className="mt-2 block text-xs font-semibold">Events in order (one per line)</label>
        <Lines label="Events" className="min-h-32" initial={bible.events.map((e) => e.text)} onCommit={(ls) => onChange({ ...bible, events: factLines(bible.events, ls, "E", "confirmed") })} />
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
            <button className="justify-self-start text-xs font-semibold text-bad underline" onClick={() => onChange({ ...bible, characters: bible.characters.filter((_, j) => j !== i) })}>
              Remove this person
            </button>
          </div>
        ))}
        <button className={small} onClick={() => onChange({ ...bible, characters: [...bible.characters, { id: uid("c"), name: "", mentions: [], relation: "", look: "", facts: [], by: "user" }] })}>
          + Add a person
        </button>
        <p className="mt-3 text-xs font-semibold">Places</p>
        {bible.places.map((p, i) => (
          <div key={p.id} className="mb-2 grid gap-1.5 rounded-lg border border-line p-2 sm:grid-cols-2">
            <input className={box} value={p.name} aria-label="Place name" onChange={(e) => onChange({ ...bible, places: bible.places.map((x, j) => (j === i ? { ...x, name: e.target.value, by: "user" } : x)) })} />
            <select className={box} aria-label="Kind of place" value={p.kind} onChange={(e) => onChange({ ...bible, places: bible.places.map((x, j) => (j === i ? { ...x, kind: e.target.value as PlaceKind, by: "user" } : x)) })}>
              {PLACE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <input className={`${box} sm:col-span-2`} value={p.description} aria-label="What the story says about it" onChange={(e) => onChange({ ...bible, places: bible.places.map((x, j) => (j === i ? { ...x, description: e.target.value, by: "user" } : x)) })} />
            <input className={box} value={p.who} aria-label="Who is there" placeholder='"nobody" when empty' onChange={(e) => onChange({ ...bible, places: bible.places.map((x, j) => (j === i ? { ...x, who: e.target.value, by: "user" } : x)) })} />
            <button className="justify-self-start text-xs font-semibold text-bad underline" onClick={() => onChange({ ...bible, places: bible.places.filter((_, j) => j !== i) })}>
              Remove this place
            </button>
          </div>
        ))}
      </>
    );
  }
  if (id === "scenes") {
    const set = (i: number, patch: Partial<BibleMoment>) => onChange({ ...bible, keyMoments: bible.keyMoments.map((x, j) => (j === i ? { ...x, ...patch, by: "user" } : x)) });
    const move = (i: number, d: -1 | 1) => {
      const list = [...bible.keyMoments];
      const j = i + d;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      onChange({ ...bible, keyMoments: list });
    };
    const csv = (v: string) =>
      v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    return (
      <>
        {bible.keyMoments.map((m, i) => (
          <fieldset key={m.id} className="mb-2 grid gap-1.5 rounded-lg border border-line p-2">
            <legend className="px-1 text-xs font-semibold">Scene {i + 1}</legend>
            <div className="flex gap-1.5">
              <input type="number" min={1} max={Math.max(1, partsTotal)} aria-label="Part number" className={`${box} !w-16`} value={m.part + 1} onChange={(e) => set(i, { part: Math.max(0, (Number(e.target.value) || 1) - 1) })} />
              <input className={box} aria-label="What happens" value={m.text} onChange={(e) => set(i, { text: e.target.value })} />
            </div>
            <input className={box} aria-label="Why it matters" placeholder="Why it matters" value={m.purpose} onChange={(e) => set(i, { purpose: e.target.value })} />
            <input className={box} aria-label="On screen (ids, comma separated)" placeholder="On screen: ids, comma separated (empty = nobody)" value={m.visible.join(", ")} onChange={(e) => set(i, { visible: csv(e.target.value) })} />
            <input className={box} aria-label="Objects (comma separated)" placeholder="Objects, comma separated" value={m.objects.join(", ")} onChange={(e) => set(i, { objects: csv(e.target.value) })} />
            <input className={box} aria-label="Feeling" placeholder="Feeling" value={m.tone} onChange={(e) => set(i, { tone: e.target.value })} />
            <input className={box} aria-label="Never show (separate with ;)" placeholder="Never show (separate with ;)" value={m.restrictions.join("; ")} onChange={(e) => set(i, { restrictions: e.target.value.split(";").map((x) => x.trim()).filter(Boolean) })} />
            <div className="flex gap-2">
              <button className={small} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move scene ${i + 1} up`}>
                ↑
              </button>
              <button className={small} onClick={() => move(i, 1)} disabled={i === bible.keyMoments.length - 1} aria-label={`Move scene ${i + 1} down`}>
                ↓
              </button>
              <button className="text-xs font-semibold text-bad underline" onClick={() => onChange({ ...bible, keyMoments: bible.keyMoments.filter((_, j) => j !== i) })}>
                Remove scene
              </button>
            </div>
          </fieldset>
        ))}
        <button
          className={small}
          onClick={() => onChange({ ...bible, keyMoments: [...bible.keyMoments, { id: uid("K"), part: 0, text: "", purpose: "", visible: [], objects: [], tone: "", restrictions: [], by: "user" }] })}
        >
          + Add a key scene
        </button>
      </>
    );
  }
  if (id === "ending")
    return (
      <>
        <label className="block text-xs font-semibold">How the story ends, in order (one per line)</label>
        <Lines label="Ending beats" className="min-h-28" initial={bible.endingBeats.map((e) => e.text)} onCommit={(ls) => onChange({ ...bible, endingBeats: factLines(bible.endingBeats, ls, "N", "confirmed") })} />
        <label className="mt-2 block text-xs font-semibold" htmlFor="ed-end">
          Last shot
        </label>
        <textarea id="ed-end" className={`${box} min-h-20`} value={bible.ending} onChange={(e) => onChange({ ...bible, ending: e.target.value })} />
        <label className="mt-2 block text-xs font-semibold" htmlFor="ed-pace">
          Pacing
        </label>
        <textarea id="ed-pace" className={`${box} min-h-16`} value={bible.pacing} onChange={(e) => onChange({ ...bible, pacing: e.target.value })} />
        <p className="mt-2 text-xs text-muted">The final line is always copied from your story by code and cannot be edited here.</p>
      </>
    );
  return (
    <>
      {bible.prohibited.map((p, i) => (
        <div key={p.id} className="mb-1.5 flex gap-1.5">
          <input
            className={box}
            aria-label={`Rule ${i + 1}`}
            value={p.text}
            onChange={(e) => onChange({ ...bible, prohibited: bible.prohibited.map((x, j) => (j === i ? { ...x, text: e.target.value, by: "user" } : x)) })}
          />
          <button aria-label={`Remove rule ${i + 1}`} className="px-2 text-bad" onClick={() => onChange({ ...bible, prohibited: bible.prohibited.filter((_, j) => j !== i) })}>
            ✕
          </button>
        </div>
      ))}
      <button className={small} onClick={() => onChange({ ...bible, prohibited: [...bible.prohibited, { id: uid("X"), kind: "prohibited_change", text: "", by: "user" }] })}>
        + Add a rule
      </button>
      <p className="mt-2 text-xs text-muted">Rules you write are project requirements: the shot planner must obey them.</p>
    </>
  );
}

/** One line per item; keeps its own text so the Enter key works while typing. */
function Lines({ initial, onCommit, className, label }: { initial: string[]; onCommit: (lines: string[]) => void; className?: string; label: string }) {
  const [text, setText] = useState(() => initial.join("\n"));
  return (
    <textarea
      aria-label={label}
      className={`${box} ${className ?? ""}`}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(e.target.value.split("\n").filter((l) => l.trim()));
      }}
    />
  );
}

