"use client";

/**
 * Make a video — the 5-screen wizard (v2).
 *  1 Story → 2 Look & voice → 3 Check episode → 4 Make (one button, one wait) → 5 Watch & fix.
 * Decide everything first, wait once, fix after. Work is saved to the browser at every step.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Info from "@/components/Info";
import KeyDialog from "@/components/KeyDialog";
import { getKey } from "@/lib/projects/keyStore";
import { getAsset, getProject, newProjectId, putAsset, putProject } from "@/lib/projects/db";
import type { ProjectRecord } from "@/lib/projects/types";
import { getSettings } from "@/lib/settings";
import { GENRES, type Genre, type StoryPlan } from "@/lib/storyPlan";
import { pickDefaultSpeechModel, STYLE_PRESETS, tagFamilyFor } from "@/lib/voiceDirector";
import type { AssetLibrary, EpisodePlan } from "@/lib/puppet/types";
import { createShotDrawer } from "@/lib/puppet/engine";
import { autoDirect } from "@/lib/puppet/autoDirect";
import { SAMPLE_STORY, SAMPLE_STORY_GENRE } from "@/lib/sampleStory";
import { estimateEpisode, layoutEpisode } from "@/lib/pipeline/layout";
import { castVoices, voiceForShot } from "@/lib/pipeline/voices";
import {
  buildAssets,
  buildSegments,
  decodeVoice,
  finalizePlan,
  mergeLibrary,
  mixEpisode,
  planEpisode,
  planSeries,
  speakLine,
  withEndHold,
  type ShotVoice,
} from "@/lib/pipeline/episode";
import { drawEpisodeFrame, renderEpisode, type EpisodeRenderInput } from "@/lib/render/episodeRenderer";
import { drawCaption } from "@/lib/render/renderer";
import { cleanSubtitle } from "@/lib/render/timeline";

type Step = "story" | "look" | "check" | "make" | "done";
type CaptionChoice = "box" | "clean" | "headline" | "bubbles";

const STEPS: { id: Step; label: string }[] = [
  { id: "story", label: "গল্প · Story" },
  { id: "look", label: "স্টাইল · Look" },
  { id: "check", label: "দেখে নিন · Check" },
  { id: "make", label: "বানানো · Make" },
  { id: "done", label: "ভিডিও · Video" },
];

const PRESET_FOR: Record<Genre, string> = {
  emotional: "emotional",
  drama: "drama",
  horror: "horror",
  comedy: "comedy",
  scifi: "scifi",
  explainer: "explainer",
  historical: "narrator",
};

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bn = (n: number) => String(n).replace(/\d/g, (d) => BN_DIGITS[+d]);
const money = (n: number) => `$${n.toFixed(2)}`;

interface Progress {
  label: string;
  state: "wait" | "run" | "done";
  detail?: string;
}

function ShotThumb({ plan, index, lib }: { plan: EpisodePlan; index: number; lib: AssetLibrary }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    try {
      ctx.save();
      ctx.scale(c.width / 1080, c.height / 1920);
      createShotDrawer(plan, index, lib)(ctx, 1080, 1920, { t: 0.8, dur: 2.5, talk: 0 });
      ctx.restore();
    } catch {
      ctx.fillStyle = "#333";
      ctx.fillRect(0, 0, c.width, c.height);
    }
  }, [plan, index, lib]);
  return <canvas ref={ref} width={135} height={240} className="h-[160px] w-[90px] shrink-0 rounded-lg border border-line bg-black" aria-hidden />;
}

export default function CreateWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>("story");
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [story, setStory] = useState("");
  const [genre, setGenre] = useState<Genre>("emotional");
  const [partMinutes, setPartMinutes] = useState<number | null>(null);
  const [narrator, setNarrator] = useState<"female" | "male">("female");
  const [captionStyle, setCaptionStyle] = useState<CaptionChoice>("bubbles");
  const [music, setMusic] = useState(true);
  const [outline, setOutline] = useState<StoryPlan | null>(null);
  const [partIndex, setPartIndex] = useState(0);
  const [plan, setPlan] = useState<EpisodePlan | null>(null);
  const [library, setLibrary] = useState<Partial<AssetLibrary>>({});
  const [keyOpen, setKeyOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [renderPct, setRenderPct] = useState(0);
  const [video, setVideo] = useState<{ url: string; blob: Blob; ext: string } | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [speechModels, setSpeechModels] = useState<string[]>([]);
  const pendingAction = useRef<null | (() => void)>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const acRef = useRef<AudioContext | null>(null);
  const lib = useMemo(() => mergeLibrary(library), [library]);
  const directed = useMemo(() => (plan ? autoDirect(plan, lib) : null), [plan, lib]);

  /* ------------------------------ load / save ------------------------------ */

  useEffect(() => {
    const s = getSettings();
    const raf = requestAnimationFrame(() => {
      setNarrator(s.defaults.narrator);
      setCaptionStyle(s.defaults.captionStyle);
      setMusic(s.defaults.music);
    });
    fetch("/api/models")
      .then((r) => r.json())
      .then((j) => setSpeechModels(((j.models ?? []) as { id: string }[]).map((m) => m.id)))
      .catch(() => {});
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const id = params.get("project");
    if (!id) return;
    let cancelled = false;
    (async () => {
      const p = await getProject(id);
      if (!p || cancelled) return;
      setProject(p);
      setStory(p.story);
      if (p.genre) setGenre(p.genre);
      setNarrator(p.settings.narrator);
      setCaptionStyle(p.settings.captionStyle);
      setMusic(p.settings.music);
      setOutline(p.outline ?? null);
      setLibrary(p.library ?? {});
      const ep = [...p.episodes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (ep) {
        setPartIndex(ep.index);
        setPlan(ep.plan ?? null);
        const vid = await getAsset(`${p.id}/${ep.index}/video`);
        const cov = await getAsset(`${p.id}/${ep.index}/cover`);
        if (cancelled) return;
        if (cov) setCover(URL.createObjectURL(cov));
        if (vid) {
          setVideo({ url: URL.createObjectURL(vid), blob: vid, ext: vid.type.includes("mp4") ? "mp4" : "webm" });
          setStep("done");
        } else if (ep.plan) setStep("check");
        else setStep("look");
      } else if (p.outline) setStep("look");
    })().catch(() => setError("Could not open that project."));
    return () => {
      cancelled = true;
    };
  }, [params]);

  const save = useCallback(
    async (patch: Partial<ProjectRecord> & { episodePlan?: EpisodePlan | null; status?: "draft" | "planned" | "voiced" | "ready" }) => {
      const now = Date.now();
      const base: ProjectRecord =
        project ??
        ({
          id: newProjectId(),
          title: outline?.title || "নতুন গল্প",
          createdAt: now,
          updatedAt: now,
          style: "puppet",
          story,
          genre,
          episodes: [],
          settings: { narrator, captionStyle, format: "9:16", music },
        } as ProjectRecord);
      const { episodePlan, status, ...rest } = patch;
      const next: ProjectRecord = {
        ...base,
        story,
        genre,
        settings: { ...base.settings, narrator, captionStyle, music },
        ...rest,
      };
      if (episodePlan !== undefined || status) {
        const eps = [...next.episodes];
        const i = eps.findIndex((e) => e.index === partIndex);
        const prev = i >= 0 ? eps[i] : { index: partIndex, title: "", status: "draft" as const, assets: [], updatedAt: now };
        const ep = {
          ...prev,
          title: episodePlan?.title ?? prev.title,
          plan: episodePlan ?? prev.plan,
          status: status ?? prev.status,
          updatedAt: now,
        };
        if (i >= 0) eps[i] = ep;
        else eps.push(ep);
        next.episodes = eps;
      }
      setProject(next);
      await putProject(next);
      if (!params.get("project")) router.replace(`/create?project=${next.id}`, { scroll: false });
      return next;
    },
    [project, outline, story, genre, narrator, captionStyle, music, partIndex, params, router],
  );

  /* -------------------------------- helpers -------------------------------- */

  function withKey(action: () => void) {
    if (getKey()) return action();
    pendingAction.current = action;
    setKeyOpen(true);
  }

  function ac(): AudioContext {
    if (!acRef.current || acRef.current.state === "closed") acRef.current = new AudioContext();
    return acRef.current;
  }

  const preset = STYLE_PRESETS.find((p) => p.id === PRESET_FOR[genre]) ?? STYLE_PRESETS[0];
  const ttsModel = pickDefaultSpeechModel(speechModels);
  const estimate = plan ? estimateEpisode(plan) : null;
  // Rough cost: planning + new assets (~$0.02 each) + voice (~$0.017 per spoken minute measured on Nov 15).
  const cost = estimate ? 0.03 + estimate.newAssets * 0.02 + (estimate.seconds / 60) * 0.017 : 0;

  /* ------------------------------ step actions ----------------------------- */

  async function planIt() {
    setError(null);
    const key = getKey()!;
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      let out = outline;
      if (out && out.genre !== genre && project?.story === story) {
        out = { ...out, genre };
        setOutline(out);
        await save({ outline: out });
      }
      if (!out || project?.story !== story) {
        setBusy("The Story Editor is reading your story… (about 30–90 seconds)");
        out = await planSeries(story, key, partMinutes, ctl.signal);
        out = { ...out, genre };
        setOutline(out);
        await save({ outline: out, title: out.title });
      }
      setStep("look");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function directIt() {
    if (!outline) return;
    setError(null);
    const key = getKey()!;
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      setBusy(`Directing part ${partIndex + 1}: shots, camera, screens… (about 1 minute)`);
      const prevEp = project?.episodes.find((e) => e.index === partIndex - 1)?.plan ?? null;
      const { plan: p0 } = await planEpisode(outline, partIndex, lib, key, { narrator, previous: prevEp, signal: ctl.signal });
      setBusy("Drawing the new characters and places for your story…");
      const { made, failed } = await buildAssets(p0, lib, key, (t) => setBusy(t), ctl.signal);
      const nextLib: Partial<AssetLibrary> = {
        characters: { ...(library.characters ?? {}), ...(made.characters ?? {}) },
        places: { ...(library.places ?? {}), ...(made.places ?? {}) },
        props: { ...(library.props ?? {}), ...(made.props ?? {}) },
      };
      const p = finalizePlan(p0, mergeLibrary(nextLib));
      setLibrary(nextLib);
      setPlan(p);
      await save({ library: nextLib as ProjectRecord["library"], episodePlan: p, status: "planned" });
      if (failed.length) setError(`${failed.length} small item${failed.length > 1 ? "s" : ""} could not be drawn, so ready-made ones are used instead. You can make the video as it is.`);
      setStep("check");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function makeIt() {
    if (!plan) return;
    setError(null);
    setVideo(null);
    const key = getKey()!;
    const ctl = new AbortController();
    abortRef.current = ctl;
    const steps: Progress[] = [
      { label: "Voices", state: "run" },
      { label: "Music and sound", state: "wait" },
      { label: "Video", state: "wait" },
      { label: "Cover picture", state: "wait" },
    ];
    const mark = (i: number, patch: Partial<Progress>) => {
      steps[i] = { ...steps[i], ...patch };
      setProgress([...steps]);
    };
    setProgress([...steps]);
    setStep("make");
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    try {
      if (!ttsModel) throw new Error("Could not load the voice models. Check your internet and try again.");
      const voices = castVoices(plan.cast, preset, tagFamilyFor(ttsModel), narrator);
      const audio = ac();
      const pid = project?.id ?? (await save({})).id;
      const shotVoices: ShotVoice[] = [];
      for (let i = 0; i < plan.shots.length; i++) {
        mark(0, { detail: `${i + 1} / ${plan.shots.length}` });
        const shot = plan.shots[i];
        const text = shot.line.trim();
        if (!cleanSubtitle(text)) {
          shotVoices.push({ blob: null, buffer: null, timing: { seconds: 0, offset: 0 }, env: null });
          continue;
        }
        const k = `${pid}/${partIndex}/voice/${i}/${hash(text + voiceForShot(shot.speaker, voices))}`;
        let blob = await getAsset(k);
        if (!blob) {
          blob = await speakLine(key, { model: ttsModel, text, voice: voiceForShot(shot.speaker, voices), instructions: preset.instructions }, ctl.signal);
          await putAsset(k, blob);
        }
        shotVoices.push(await decodeVoice(audio, blob));
      }
      mark(0, { state: "done", detail: undefined });
      mark(1, { state: "run" });
      const shotPlan = autoDirect(plan, lib); // screenplay pass: nobody missing, no repeated pictures
      const layout = layoutEpisode(shotPlan, shotVoices.map((v) => v.timing));
      const soundtrack = await mixEpisode(shotPlan, layout, shotVoices, { music });
      mark(1, { state: "done" });
      mark(2, { state: "run" });
      const s = getSettings();
      const input: EpisodeRenderInput = {
        soundtrack,
        segments: withEndHold(buildSegments(shotPlan, lib, layout, shotVoices), layout.total),
        total: layout.total,
        badge: `পর্ব ${bn(partIndex + 1)}`,
        watermark: s.brand.name || undefined,
        endCard: { text: plan.end.text, sub: s.brand.name || undefined, seconds: layout.total - layout.endCardStart },
        captionStyle,
      };
      const res = await renderEpisode(audio, input, {
        signal: ctl.signal,
        onProgress: setRenderPct,
        previewCanvas: previewRef.current ?? undefined,
      });
      const ext = res.mimeType.includes("mp4") ? "mp4" : "webm";
      await putAsset(`${pid}/${partIndex}/video`, res.blob);
      setVideo({ url: URL.createObjectURL(res.blob), blob: res.blob, ext });
      mark(2, { state: "done" });
      mark(3, { state: "run" });
      const coverBlob = await makeCover(input, shotPlan);
      if (coverBlob) {
        await putAsset(`${pid}/${partIndex}/cover`, coverBlob);
        setCover(URL.createObjectURL(coverBlob));
      }
      mark(3, { state: "done" });
      await save({ episodePlan: plan, status: "ready" });
      setStep("done");
    } catch (e) {
      if ((e as Error).name === "AbortError") setStep("check");
      else setError((e as Error).message);
    } finally {
      window.removeEventListener("beforeunload", onUnload);
    }
  }

  async function makeCover(input: EpisodeRenderInput, p: EpisodePlan): Promise<Blob | null> {
    const c = document.createElement("canvas");
    c.width = 1080;
    c.height = 1920;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const hookAt = input.segments.find((sg) => sg.start >= 0)?.start ?? 0;
    drawEpisodeFrame(ctx, 1080, 1920, hookAt + 0.8, { ...input, endCard: undefined }, { subtitles: false });
    const title = p.title.split("|")[0].trim() || p.series;
    drawCaption(ctx, { text: title, start: 0, end: 1 }, 0, 1080, 1920, false, "headline");
    return new Promise((r) => c.toBlob((b) => r(b), "image/jpeg", 0.9));
  }

  function editLine(i: number, line: string) {
    if (!plan) return;
    const next = { ...plan, shots: plan.shots.map((s, j) => (j === i ? { ...s, line } : s)) };
    setPlan(next);
    void save({ episodePlan: next });
  }

  async function share() {
    if (!video) return;
    const file = new File([video.blob], `golpo-part-${partIndex + 1}.${video.ext}`, { type: video.blob.type });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) await nav.share({ files: [file], title: plan?.title, text: plan?.caption }).catch(() => {});
    else setError("Sharing files is not supported in this browser. Use Download instead.");
  }

  function nextPart() {
    if (!outline || partIndex + 1 >= outline.parts.length) return;
    setPartIndex(partIndex + 1);
    setPlan(null);
    setVideo(null);
    setCover(null);
    setStep("look");
  }

  /* ---------------------------------- UI ----------------------------------- */

  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const card = "rounded-2xl border border-line bg-surface p-4 sm:p-5";
  const primary =
    "w-full rounded-xl bg-accent px-5 py-3.5 text-base font-bold text-accent-ink shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50";
  const chip = (on: boolean) =>
    `rounded-full border px-3.5 py-2 text-sm font-semibold transition ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink hover:border-accent"}`;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-5">
      <ol className="mb-5 flex gap-1.5 overflow-x-auto" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={s.id === step ? "step" : undefined}
            className={`flex-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-center text-xs font-semibold ${
              i < stepIdx ? "bg-ok/15 text-ok" : s.id === step ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"
            }`}
          >
            {i < stepIdx ? "✓ " : ""}
            {s.label}
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {busy && (
        <div className={`${card} mb-4 flex items-center gap-3`} role="status">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
          <p className="flex-1 text-sm">{busy}</p>
          <button className="text-sm font-semibold text-muted underline" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        </div>
      )}

      {step === "story" && (
        <section className={card}>
          <h1 className="font-display text-2xl font-extrabold">আপনার গল্পটা দিন</h1>
          <p className="mt-1 text-sm text-muted">Paste or type a Bangla story. Any genre, any place, any length.</p>
          <label className="mt-4 block text-sm font-semibold" htmlFor="story">
            Story (Bangla)
            <Info title="Your story">Paste the whole story. The Story Editor splits long stories into parts of 2–5 minutes, each ending on a cliffhanger.</Info>
          </label>
          <textarea
            id="story"
            value={story}
            onChange={(e) => setStory(e.target.value)}
            rows={10}
            placeholder="এখানে আপনার গল্প লিখুন বা পেস্ট করুন…"
            className="mt-2 w-full rounded-xl border border-line bg-bg p-3 font-[Hind_Siliguri] text-base leading-relaxed outline-none focus:border-accent"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>
              {[...story].length} letters · about {Math.max(0, Math.round([...story].length / 12 / 60))} min read aloud
            </span>
            <button
              className="font-semibold text-accent-strong underline"
              onClick={() => {
                setStory(SAMPLE_STORY);
                setGenre(SAMPLE_STORY_GENRE);
              }}
            >
              Use the example story
            </button>
          </div>

          <p className="mt-5 text-sm font-semibold">
            Mood
            <Info title="Mood">Sets the voice, music, colours and camera style. You can change it any time before making the video.</Info>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(GENRES) as Genre[]).map((g) => (
              <button key={g} className={chip(genre === g)} onClick={() => setGenre(g)} aria-pressed={genre === g}>
                {GENRES[g].emoji} {GENRES[g].label}
              </button>
            ))}
          </div>

          <p className="mt-5 text-sm font-semibold">
            Length of each part
            <Info title="Part length">Long stories become a serial: পর্ব ১, ২, ৩… Each part ends on a cliffhanger so people wait for the next one.</Info>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { v: null, l: "Let the editor decide" },
              { v: 2, l: "About 2 min" },
              { v: 3, l: "About 3 min" },
              { v: 5, l: "About 5 min" },
            ].map((o) => (
              <button key={String(o.v)} className={chip(partMinutes === o.v)} onClick={() => setPartMinutes(o.v)} aria-pressed={partMinutes === o.v}>
                {o.l}
              </button>
            ))}
          </div>

          <button className={`${primary} mt-6`} disabled={!story.trim() || !!busy} onClick={() => withKey(planIt)}>
            পরের ধাপ · Next
          </button>
          <p className="mt-2 text-center text-xs text-muted">Reading the story costs about $0.01–0.05.</p>
        </section>
      )}

      {step === "look" && outline && (
        <section className={card}>
          <h1 className="font-display text-2xl font-extrabold">{outline.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {outline.parts.length > 1 ? `${bn(outline.parts.length)} পর্বের সিরিজ · a ${outline.parts.length}-part serial` : "One episode"}
          </p>
          {outline.parts.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {outline.parts.map((p, i) => (
                <button key={i} className={chip(partIndex === i)} onClick={() => setPartIndex(i)} aria-pressed={partIndex === i}>
                  পর্ব {bn(i + 1)}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 rounded-xl bg-surface-2 p-3 text-sm">{outline.parts[partIndex]?.summary}</p>

          <p className="mt-5 text-sm font-semibold">
            Video style
            <Info title="Video style">Cartoon: code-drawn characters that move, the same in every episode, very cheap. Cinematic pictures: AI-painted pictures, opens the Studio.</Info>
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl border-2 border-accent bg-accent/10 p-3 text-sm">
              <b>🎭 Cartoon</b>
              <p className="text-muted">Moving characters, phone screens, serial-ready.</p>
            </div>
            <button className="rounded-xl border border-line p-3 text-left text-sm hover:border-accent" onClick={() => router.push("/studio")}>
              <b>🖼 Cinematic pictures</b>
              <p className="text-muted">AI paintings. Opens the Studio.</p>
            </button>
          </div>

          <p className="mt-5 text-sm font-semibold">
            Narrator
            <Info title="Narrator">The storyteller&apos;s voice. Characters who speak get their own different voices automatically.</Info>
          </p>
          <div className="mt-2 flex gap-2">
            <button className={chip(narrator === "female")} onClick={() => setNarrator("female")} aria-pressed={narrator === "female"}>
              ♀ Female
            </button>
            <button className={chip(narrator === "male")} onClick={() => setNarrator("male")} aria-pressed={narrator === "male"}>
              ♂ Male
            </button>
          </div>

          <p className="mt-5 text-sm font-semibold">
            Subtitles
            <Info title="Subtitles">Speech bubbles: what characters say appears next to them, narration in a box. The spoken word lights up yellow.</Info>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ["bubbles", "💬 Speech bubbles"],
                ["box", "Dark box"],
                ["clean", "Clean"],
                ["headline", "Headline"],
              ] as [CaptionChoice, string][]
            ).map(([v, l]) => (
              <button key={v} className={chip(captionStyle === v)} onClick={() => setCaptionStyle(v)} aria-pressed={captionStyle === v}>
                {l}
              </button>
            ))}
          </div>

          <label className="mt-5 flex items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
            Background music and sound effects
            <Info title="Music">Soft music made for your story&apos;s mood, ducked under the voice, plus sounds like rain, knocks and phone rings.</Info>
          </label>

          <button className={`${primary} mt-6`} disabled={!!busy} onClick={() => withKey(directIt)}>
            পরের ধাপ · Next
          </button>
          <button className="mt-3 w-full text-sm font-semibold text-muted underline" onClick={() => setStep("story")}>
            ← Back to the story
          </button>
        </section>
      )}

      {step === "check" && plan && (
        <section className={card}>
          <h1 className="font-display text-xl font-extrabold">{plan.title}</h1>
          <p className="mt-1 text-sm text-muted">Check the scenes. Change any line if you like, then make the video.</p>

          <div className="mt-4 flex gap-3 overflow-x-auto pb-2" aria-label="Cast">
            {plan.cast.map((c) => (
              <div key={c.id} className="shrink-0 rounded-xl bg-surface-2 px-3 py-2 text-center text-sm">
                <b>{c.name}</b>
                <p className="text-xs text-muted">{c.voice.replace("_", " ")}</p>
              </div>
            ))}
          </div>

          <ol className="mt-3 space-y-3">
            {plan.shots.map((s, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-line p-2.5">
                <ShotThumb plan={directed ?? plan} index={i} lib={lib} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-muted">
                    {i + 1}. {s.speaker === "narrator" ? "Narrator" : (plan.cast.find((c) => c.id === s.speaker)?.name ?? s.speaker)}
                    {s.screen ? " · 📱 screen" : ""}
                    {s.hook ? " · ⚡ hook" : ""}
                  </p>
                  <textarea
                    aria-label={`Line ${i + 1}`}
                    value={s.line}
                    onChange={(e) => editLine(i, e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-line bg-bg p-2 text-sm leading-relaxed outline-none focus:border-accent"
                  />
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
            Narrator voice
            <Info title="Narrator voice">The storyteller&apos;s voice for this video. Characters who speak keep their own voices.</Info>
            <button className={chip(narrator === "female")} onClick={() => setNarrator("female")} aria-pressed={narrator === "female"}>
              ♀ Female
            </button>
            <button className={chip(narrator === "male")} onClick={() => setNarrator("male")} aria-pressed={narrator === "male"}>
              ♂ Male
            </button>
          </div>

          {estimate && (
            <p className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
              পর্ব {bn(partIndex + 1)} · about {Math.round(estimate.seconds)} s · {estimate.shots} shots · about {money(cost)} · takes about{" "}
              {Math.ceil(estimate.seconds / 60) + 2} min to make
            </p>
          )}
          <button className={`${primary} mt-5`} disabled={!!busy} onClick={() => withKey(makeIt)}>
            🎬 ভিডিও বানান · Make the video
          </button>
          <button className="mt-3 w-full text-sm font-semibold text-muted underline" onClick={() => withKey(directIt)}>
            ↻ Direct this part again
          </button>
        </section>
      )}

      {step === "make" && (
        <section className={card}>
          <h1 className="font-display text-xl font-extrabold">ভিডিও তৈরি হচ্ছে…</h1>
          <p className="mt-1 text-sm text-muted">Keep this screen open and the phone awake until it finishes.</p>
          <ul className="mt-4 space-y-2">
            {progress.map((p) => (
              <li key={p.label} className="flex items-center gap-3 text-sm">
                <span aria-hidden className="w-5 text-center">
                  {p.state === "done" ? "✓" : p.state === "run" ? "⏳" : "○"}
                </span>
                <span className={p.state === "wait" ? "text-muted" : ""}>{p.label}</span>
                {p.detail && <span className="text-muted">{p.detail}</span>}
                {p.label === "Video" && p.state === "run" && <span className="text-muted">{Math.round(renderPct * 100)}%</span>}
              </li>
            ))}
          </ul>
          <canvas ref={previewRef} width={270} height={480} className="mx-auto mt-4 block h-[320px] w-[180px] rounded-xl bg-black" aria-label="Live preview" />
          <button className="mt-4 w-full text-sm font-semibold text-muted underline" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        </section>
      )}

      {step === "done" && video && (
        <section className={card}>
          <h1 className="font-display text-xl font-extrabold">{plan?.title ?? "আপনার ভিডিও"}</h1>
          <video src={video.url} controls playsInline className="mx-auto mt-3 aspect-[9/16] w-full max-w-[320px] rounded-xl bg-black" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a href={video.url} download={`golpo-part-${partIndex + 1}.${video.ext}`} className={`${primary} text-center`}>
              ⬇ Download
            </a>
            <button className="rounded-xl border border-line px-4 py-3 font-bold" onClick={share}>
              📤 Share
            </button>
          </div>
          {plan?.caption && (
            <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
              <p className="font-semibold">Facebook caption</p>
              <p className="mt-1">{plan.caption}</p>
              <button className="mt-2 text-xs font-semibold text-accent-strong underline" onClick={() => navigator.clipboard?.writeText(`${plan.title}\n\n${plan.caption}`)}>
                Copy title + caption
              </button>
            </div>
          )}
          {cover && (
            <div className="mt-4 text-sm">
              <p className="font-semibold">
                Cover picture
                <Info title="Cover picture">Use this as the video&apos;s cover (thumbnail) when you post it.</Info>
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
              <img src={cover} alt="Cover" className="mt-2 w-32 rounded-lg" />
              <a href={cover} download={`golpo-part-${partIndex + 1}-cover.jpg`} className="mt-1 inline-block text-xs font-semibold text-accent-strong underline">
                Download cover
              </a>
            </div>
          )}
          <div className="mt-5 grid gap-2">
            <button className="rounded-xl border border-line px-4 py-3 font-semibold" onClick={() => setStep("check")}>
              ✎ Change lines and make again
            </button>
            {outline && partIndex + 1 < outline.parts.length && (
              <button className={primary} onClick={nextPart}>
                পরের পর্ব বানান · Make part {partIndex + 2}
              </button>
            )}
          </div>
        </section>
      )}

      <KeyDialog
        open={keyOpen}
        onClose={() => setKeyOpen(false)}
        onSaved={() => {
          setKeyOpen(false);
          const a = pendingAction.current;
          pendingAction.current = null;
          a?.();
        }}
      />
    </div>
  );
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
