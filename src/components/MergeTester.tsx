"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ART_STYLES, buildImagePrompt, previewSrc } from "@/lib/artStyles";
import StylePreviewMaker from "@/components/StylePreviewMaker";
import { DEFAULT_CHARACTERS, DEFAULT_SCENES, DEFAULT_SETTING, VIDEO_MOTION_HINT, type SceneDraft } from "@/lib/mergeSample";
import type { SpeechModel } from "@/lib/openrouter/types";
import type { ImageModel, VideoModel } from "@/lib/openrouter/media";
import { estimateVideoCost, pickClipDuration } from "@/lib/openrouter/media";
import { renderVideo, type RenderScene, type SyncReport } from "@/lib/render/renderer";
import { buildTimeline, totalDuration } from "@/lib/render/timeline";
import { formatUsd } from "@/lib/report";
import { pickDefaultSpeechModel, presetVoice, STYLE_PRESETS, tagFamilyFor } from "@/lib/voiceDirector";
import { groupVoices, type Gender } from "@/lib/voices";

interface SceneState extends SceneDraft {
  audio?: { url: string; buffer: AudioBuffer; seconds: number };
  imageUrl?: string;
  imageCost?: number | null;
  video?: { jobId?: string; status: string; url?: string; seconds?: number; cost?: number | null; error?: string };
}

type Busy = null | "voice" | "images" | "video" | "render";

const PREFERRED_IMAGE = [/^google\/gemini-nano-banana/, /^bytedance-seed\/seedream-5-0-flash/, /^black-forest-labs\/flux-3-image-klein/];
const PREFERRED_VIDEO = [/^x-ai\/grok-imagine-video-[\d.]+-lite$/, /^minimax\/hailuo/, /^alibaba\/wan/];

function preferred<T extends { id: string }>(list: T[], prefs: RegExp[]): string {
  for (const re of prefs) {
    const hit = list.filter((m) => re.test(m.id)).map((m) => m.id).sort().reverse()[0];
    if (hit) return hit;
  }
  return list[0]?.id ?? "";
}

async function postJson<T>(url: string, key: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-openrouter-key": key },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load."));
    img.src = src;
  });
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.oncanplaythrough = () => resolve(v);
    v.onerror = () => reject(new Error("Video failed to load."));
    v.src = src;
    v.load();
  });
}

export default function MergeTester() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const [speech, setSpeech] = useState<SpeechModel[]>([]);
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [ttsModel, setTtsModel] = useState("");
  const [presetId, setPresetId] = useState(STYLE_PRESETS[0].id);
  const [gender, setGender] = useState<Gender>("female");
  const [imageModel, setImageModel] = useState("");
  const [videoModel, setVideoModel] = useState("");
  const [videoRes, setVideoRes] = useState("");
  const [artId, setArtId] = useState("minimal");
  const [customArt, setCustomArt] = useState("");
  const [setting, setSetting] = useState(DEFAULT_SETTING);
  const [characters, setCharacters] = useState(DEFAULT_CHARACTERS);
  const [imagesStyle, setImagesStyle] = useState<string | null>(null);
  const [scenes, setScenes] = useState<SceneState[]>(DEFAULT_SCENES.map((s) => ({ ...s })));

  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ kind: "info" | "error" | "ok"; text: string } | null>(null);
  const [confirmVideo, setConfirmVideo] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<{ url: string; blob: Blob; ext: string; mime: string; seconds: number; report: SyncReport[] } | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/models").then((r) => r.json()),
      fetch("/api/media/models").then((r) => r.json()),
    ])
      .then(([sp, media]) => {
        if (sp.error || media.error) throw new Error(sp.error ?? media.error);
        const speechList = sp.models as SpeechModel[];
        setSpeech(speechList);
        setTtsModel(pickDefaultSpeechModel(speechList.map((m) => m.id)));
        setImageModels(media.image);
        setImageModel(preferred(media.image, PREFERRED_IMAGE));
        setVideoModels(media.video);
        const v = preferred<VideoModel>(media.video, PREFERRED_VIDEO);
        setVideoModel(v);
        const vm = (media.video as VideoModel[]).find((m) => m.id === v);
        setVideoRes(vm?.resolutions.includes("480p") ? "480p" : (vm?.resolutions[0] ?? ""));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load models."));
  }, []);

  const art = ART_STYLES.find((a) => a.id === artId);
  const stylePrompt = artId === "custom" ? customArt : (art?.prompt ?? "");
  const promptFor = (scene: string) => buildImagePrompt(stylePrompt, setting, characters, scene);
  const styleChanged = imagesStyle !== null && imagesStyle !== `${artId}|${customArt}`;

  const tts = speech.find((m) => m.id === ttsModel);
  const preset = STYLE_PRESETS.find((p) => p.id === presetId)!;
  const voice = useMemo(() => {
    if (!tts) return "";
    const v = presetVoice(preset, tagFamilyFor(tts.id), gender);
    if (v && tts.voices.includes(v)) return v;
    return groupVoices(tts.id, tts.voices)[gender][0] ?? tts.voices[0] ?? "";
  }, [tts, preset, gender]);
  const vModel = videoModels.find((m) => m.id === videoModel);
  const iModel = imageModels.find((m) => m.id === imageModel);

  const audioReady = scenes.every((s) => s.audio);
  const visualsReady = scenes.every((s) => (s.kind === "image" ? s.imageUrl : s.video?.url));
  const slots = audioReady ? buildTimeline(scenes.map((s) => s.audio!.seconds)) : [];
  const videoScenes = scenes.map((s, i) => ({ s, i })).filter((x) => x.s.kind === "video");
  const videoPlan = videoScenes.map(({ s, i }) => {
    const slotSec = slots[i] ? slots[i].end - slots[i].start : (s.audio?.seconds ?? 0);
    const dur = vModel ? pickClipDuration(slotSec, vModel.durations) : null;
    const cost = vModel && dur ? estimateVideoCost(vModel, videoRes, dur) : null;
    return { i, dur, cost };
  });

  const update = (i: number, patch: Partial<SceneState>) =>
    setScenes((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  function needKey(): boolean {
    if (apiKey.trim()) return false;
    setMessage({ kind: "error", text: "Enter your OpenRouter API key first." });
    return true;
  }

  function audioContext(): AudioContext {
    if (!acRef.current || acRef.current.state === "closed") acRef.current = new AudioContext();
    return acRef.current;
  }

  /* ---------- Step 1: voices (always first) ---------- */
  async function makeVoices() {
    if (needKey() || !tts) return;
    setBusy("voice");
    setOutput(null);
    const ac = audioContext();
    try {
      for (let i = 0; i < scenes.length; i++) {
        setMessage({ kind: "info", text: `Generating narration ${i + 1} of ${scenes.length}…` });
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-openrouter-key": apiKey.trim() },
          body: JSON.stringify({
            model: tts.id,
            text: scenes[i].narration,
            voice,
            format: "auto",
            instructions: preset.instructions,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(`Scene ${i + 1}: ${j.error ?? `HTTP ${res.status}`}`);
        }
        const blob = await res.blob();
        const buffer = await ac.decodeAudioData(await blob.arrayBuffer());
        update(i, { audio: { url: URL.createObjectURL(blob), buffer, seconds: buffer.duration } });
      }
      setMessage({ kind: "ok", text: "All narration ready. Scene lengths are now fixed by the audio. Next: visuals." });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Voice generation failed." });
    } finally {
      setBusy(null);
    }
  }

  /* ---------- Step 2a: images ---------- */
  async function makeImages() {
    if (needKey() || !iModel) return;
    setBusy("images");
    try {
      let reference: string | undefined;
      for (let i = 0; i < scenes.length; i++) {
        setMessage({ kind: "info", text: `Drawing image ${i + 1} of ${scenes.length}…` });
        const r = await postJson<{ dataUrl: string; costUsd: number | null }>("/api/image", apiKey.trim(), {
          model: iModel.id,
          prompt: promptFor(scenes[i].prompt),
          references: reference && iModel.acceptsReferences ? [reference] : undefined,
        });
        update(i, { imageUrl: r.dataUrl, imageCost: r.costUsd });
        // Scene 1 becomes the character reference for later scenes.
        if (i === 0) reference = r.dataUrl;
      }
      setImagesStyle(`${artId}|${customArt}`);
      const hasVideo = scenes.some((s) => s.kind === "video");
      setMessage({
        kind: "ok",
        text: hasVideo ? "Images ready. Next: animate the video scene (you'll see the cost first)." : "Images ready. Next: render.",
      });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Image generation failed." });
    } finally {
      setBusy(null);
    }
  }

  /* ---------- Step 2b: video clip(s), fitted to audio ---------- */
  async function makeVideos() {
    setConfirmVideo(false);
    if (needKey() || !vModel) return;
    setBusy("video");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      for (const plan of videoPlan) {
        const s = scenes[plan.i];
        if (!plan.dur) throw new Error("This video model has no usable duration.");
        update(plan.i, { video: { status: "submitting" } });
        const { id } = await postJson<{ id: string }>(
          "/api/video",
          apiKey.trim(),
          {
            model: vModel.id,
            prompt: `${promptFor(s.prompt)}\n${VIDEO_MOTION_HINT}`,
            duration: plan.dur,
            resolution: videoRes || undefined,
            firstFrame: s.imageUrl,
          },
          ac.signal,
        );
        update(plan.i, { video: { jobId: id, status: "pending" } });
        const started = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 8000));
          if (ac.signal.aborted) throw new DOMException("cancelled", "AbortError");
          const st = await fetch(`/api/video/${id}`, { headers: { "x-openrouter-key": apiKey.trim() } }).then((r) => r.json());
          if (st.error && !st.status) throw new Error(st.error);
          const mins = Math.floor((Date.now() - started) / 60000);
          setMessage({ kind: "info", text: `Video scene ${plan.i + 1}: ${st.status.replace("_", " ")}… (${mins} min). Usually 1–5 minutes.` });
          update(plan.i, { video: { jobId: id, status: st.status, cost: st.costUsd } });
          if (st.status === "completed") {
            const res = await fetch(`/api/video/${id}/content`, { headers: { "x-openrouter-key": apiKey.trim() } });
            if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
            const url = URL.createObjectURL(await res.blob());
            const v = await loadVideo(url);
            update(plan.i, { video: { jobId: id, status: "completed", url, seconds: v.duration, cost: st.costUsd } });
            break;
          }
          if (["failed", "cancelled", "expired"].includes(st.status)) throw new Error(`Video ${st.status}: ${st.error ?? "no details"}`);
          if (Date.now() - started > 15 * 60_000) throw new Error("Video took longer than 15 minutes. Try again or pick another model.");
        }
      }
      setMessage({ kind: "ok", text: "Video clip ready. Next: render the final video." });
    } catch (e) {
      if ((e as Error).name === "AbortError") setMessage({ kind: "info", text: "Stopped waiting. The job may still finish and be billed by OpenRouter." });
      else setMessage({ kind: "error", text: e instanceof Error ? e.message : "Video generation failed." });
    } finally {
      setBusy(null);
    }
  }

  /* ---------- Step 3: render (audio is the clock) ---------- */
  async function render() {
    if (!audioReady || !visualsReady) return;
    setBusy("render");
    setProgress(0);
    setOutput(null);
    setMessage({ kind: "info", text: "Rendering in real time… keep this screen on and the tab open." });
    const ac = audioContext();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const prepared: RenderScene[] = await Promise.all(
        scenes.map(async (s) => ({
          audio: s.audio!.buffer,
          narration: s.narration,
          visual:
            s.kind === "video" && s.video?.url
              ? { kind: "video" as const, video: await loadVideo(s.video.url), clipSeconds: s.video.seconds ?? 0 }
              : { kind: "image" as const, image: await loadImage(s.imageUrl!) },
        })),
      );
      const r = await renderVideo(ac, prepared, slots, { onProgress: setProgress, signal: ctrl.signal });
      const ext = r.mimeType.includes("mp4") ? "mp4" : "webm";
      setOutput({ url: URL.createObjectURL(r.blob), blob: r.blob, ext, mime: r.mimeType, seconds: r.durationSeconds, report: r.report });
      setMessage({ kind: "ok", text: `Done: ${r.durationSeconds.toFixed(1)} s ${ext.toUpperCase()} video.` });
    } catch (e) {
      if ((e as Error).name === "AbortError") setMessage({ kind: "info", text: "Render cancelled." });
      else setMessage({ kind: "error", text: e instanceof Error ? e.message : "Render failed." });
    } finally {
      setBusy(null);
    }
  }

  async function shareOutput() {
    if (!output) return;
    const file = new File([output.blob], `golpo-test.${output.ext}`, { type: output.blob.type });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "Bangla story test" });
    } catch {
      /* user cancelled */
    }
  }

  const imgCost = scenes.reduce((a, s) => a + (s.imageCost ?? 0), 0);
  const vidCost = scenes.reduce((a, s) => a + (s.video?.cost ?? 0), 0);
  const picturesDone = scenes.every((s) => s.imageUrl);
  const storyReady = scenes.every((s) => s.narration.trim() && s.prompt.trim());
  const progressSteps = [
    { id: "story", icon: "✍️", label: "Story", done: storyReady },
    { id: "voice", icon: "🔊", label: "Voice", done: audioReady },
    { id: "pictures", icon: "🖼", label: "Pictures", done: visualsReady },
    { id: "video", icon: "🎞", label: "Video", done: !!output },
  ];
  const allStyles = [...ART_STYLES, { id: "custom", label: "Custom", emoji: "✍️", prompt: "", goodFor: "Describe your own look" }];
  const SCENE_COLORS = ["bg-orange-400", "bg-sky-500", "bg-indigo-500", "bg-amber-500", "bg-rose-400", "bg-emerald-500"];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-5">
        <h1 className="text-3xl font-bold tracking-tight">🎬 Video Maker</h1>
        <p className="mt-1.5 text-stone-600 dark:text-stone-400">
          Turn a short Bangla story into a vertical video with narration, pictures, motion and subtitles. Follow the 4 steps
          from top to bottom.
        </p>
      </header>

      {/* Progress strip */}
      <ol className="mb-5 grid grid-cols-4 gap-1.5">
        {progressSteps.map((p, i) => (
          <li key={p.id}>
            <a
              href={`#${p.id}`}
              className={`flex flex-col items-center rounded-xl border px-1 py-2 text-center text-xs font-medium transition ${
                p.done
                  ? "border-teal-600 bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200"
                  : "border-stone-200 bg-white text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400"
              }`}
            >
              <span className="text-lg">{p.done ? "✅" : p.icon}</span>
              <span>
                {i + 1}. {p.label}
              </span>
            </a>
          </li>
        ))}
      </ol>

      {loadError && <Note kind="error">{loadError}</Note>}

      <section className="mb-5 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <label className="label" htmlFor="key">
          🔑 Your OpenRouter key
        </label>
        <div className="flex gap-2">
          <input
            id="key"
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-v1-…"
            autoComplete="off"
            spellCheck={false}
            aria-label="OpenRouter API key"
            className="input font-mono"
          />
          <button type="button" onClick={() => setShowKey((v) => !v)} className="btn-secondary w-20">
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-stone-500">
          Needed for every AI step. It stays only on this page and is forgotten when you reload. You pay OpenRouter directly.
        </p>
      </section>

      {/* STEP 1 */}
      <Step
        id="story"
        n={1}
        title="Write your story"
        what="Pick a look, then write each scene: one line the narrator says (Bangla) and what the picture shows (English)."
        meta="Free"
        done={storyReady}
      >
        <h3 className="mb-2 text-sm font-semibold">Art style: how the pictures will look</h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {allStyles.map((a) => {
            const src = previewSrc(a.id);
            const on = artId === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setArtId(a.id)}
                aria-pressed={on}
                className={`group overflow-hidden rounded-xl border-2 text-left transition ${
                  on ? "border-teal-600 ring-2 ring-teal-600/30" : "border-transparent hover:border-stone-300 dark:hover:border-stone-700"
                }`}
              >
                <div className="relative aspect-[4/5] bg-gradient-to-br from-stone-100 to-stone-200 dark:from-stone-800 dark:to-stone-900">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- small static preview
                    <img src={src} alt={`${a.label} preview`} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-3xl">{a.emoji}</span>
                  )}
                  {on && <span className="absolute right-1 top-1 rounded-full bg-teal-600 px-1.5 text-xs text-white">✓</span>}
                </div>
                <div className="bg-white px-1.5 py-1 dark:bg-stone-900">
                  <span className="block truncate text-xs font-semibold">{a.label}</span>
                  <span className="block truncate text-[10px] text-stone-500">{a.goodFor}</span>
                </div>
              </button>
            );
          })}
        </div>
        {artId === "custom" && (
          <textarea
            value={customArt}
            onChange={(e) => setCustomArt(e.target.value)}
            rows={3}
            placeholder="Describe the look in English, e.g. 'oil painting, warm golden light, thick brush strokes'"
            className="input mt-3 text-sm"
          />
        )}
        {styleChanged && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">You changed the style. Redraw the pictures in step 3 to apply it.</p>}

        <details className="mt-4 rounded-xl bg-stone-50 p-3 dark:bg-stone-800/50">
          <summary className="cursor-pointer text-sm font-semibold">👥 Characters &amp; place (kept the same in every picture)</summary>
          <p className="mt-1 text-xs text-stone-500">Describe each person once, with age, hair and clothes. This keeps them looking the same in every scene.</p>
          <textarea value={characters} onChange={(e) => setCharacters(e.target.value)} rows={4} className="input mt-2 text-sm" aria-label="Characters" />
          <input value={setting} onChange={(e) => setSetting(e.target.value)} className="input mt-2 text-sm" aria-label="Place" />
        </details>

        <h3 className="mb-2 mt-5 text-sm font-semibold">Scenes</h3>
        <div className="space-y-3">
          {scenes.map((s, i) => (
            <div key={i} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`h-3 w-3 rounded-full ${SCENE_COLORS[i % SCENE_COLORS.length]}`} /> Scene {i + 1}
                </span>
                <div className="flex overflow-hidden rounded-lg border border-stone-300 text-xs dark:border-stone-700" role="radiogroup" aria-label={`Scene ${i + 1} type`}>
                  {(["image", "video"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={s.kind === k}
                      onClick={() => update(i, { kind: k })}
                      className={`px-2.5 py-1.5 ${s.kind === k ? "bg-teal-700 text-white" : "bg-white dark:bg-stone-900"}`}
                    >
                      {k === "image" ? "🖼 Picture + motion · cheap" : "🎬 AI video · costs more"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-400">🗣 Narrator says (Bangla, tags like [sad] allowed)</label>
              <textarea
                value={s.narration}
                onChange={(e) => update(i, { narration: e.target.value, audio: undefined })}
                rows={2}
                lang="bn"
                className="input bangla text-base"
                aria-label={`Scene ${i + 1} narration`}
              />
              <label className="mb-1 mt-2 block text-xs font-medium text-stone-600 dark:text-stone-400">🖼 Picture shows (English)</label>
              <textarea
                value={s.prompt}
                onChange={(e) => update(i, { prompt: e.target.value, imageUrl: undefined, video: undefined })}
                rows={2}
                className="input text-sm"
                aria-label={`Scene ${i + 1} picture description`}
              />
              {(s.audio || s.imageUrl || s.video) && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {s.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- generated data: URL
                    <img src={s.imageUrl} alt={`Scene ${i + 1}`} className="h-28 rounded-lg object-cover" />
                  )}
                  {s.video?.url && <video src={s.video.url} className="h-28 rounded-lg" muted loop autoPlay playsInline />}
                  <div className="space-y-1 text-xs">
                    {s.audio && (
                      <>
                        <span className="font-semibold text-teal-700 dark:text-teal-400">🔊 {s.audio.seconds.toFixed(1)} s</span>
                        <audio controls src={s.audio.url} className="h-8 max-w-[220px]" />
                      </>
                    )}
                    {s.video?.status && !s.video.url && <span className="block text-stone-500">🎬 {s.video.status.replace("_", " ")}…</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Step>

      {/* STEP 2 */}
      <Step
        id="voice"
        n={2}
        title="Make the voice"
        what="Creates the Bangla narration for every scene. Its length decides how long each picture stays on screen, so the voice always comes first."
        meta="⏱ about 20 s · 💲 about $0.01"
        done={audioReady}
        locked={!storyReady ? "Fill in every scene in step 1 first." : undefined}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Story mood</span>
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="input">
              {STYLE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="label">Narrator voice</span>
            <div className="flex gap-1.5">
              {(["female", "male"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={`flex-1 rounded-lg border px-2 py-2.5 text-sm ${gender === g ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 dark:border-stone-700"}`}
                >
                  {g === "female" ? "♀ Female" : "♂ Male"}
                  {gender === g && voice ? ` · ${voice}` : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-stone-500">Voice model (advanced)</summary>
          <select value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} className="input mt-2">
            {speech.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </details>
        <button onClick={makeVoices} disabled={!!busy || !tts || !storyReady} className="btn-primary mt-4 w-full sm:w-auto">
          {busy === "voice" ? "Making the voice…" : audioReady ? "↻ Make the voice again" : "🔊 Make the voice"}
        </button>
        {audioReady && (
          <div className="mt-4">
            <p className="mb-1 text-xs text-stone-500">
              Video timeline, set by the voice: <b>{totalDuration(slots).toFixed(1)} s</b>
            </p>
            <div className="flex h-7 overflow-hidden rounded-lg text-[11px] font-semibold text-white">
              {slots.map((sl, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-center ${SCENE_COLORS[i % SCENE_COLORS.length]}`}
                  style={{ width: `${((sl.end - sl.start) / totalDuration(slots)) * 100}%` }}
                  title={`Scene ${i + 1}`}
                >
                  {(sl.end - sl.start).toFixed(1)}s
                </div>
              ))}
            </div>
          </div>
        )}
      </Step>

      {/* STEP 3 */}
      <Step
        id="pictures"
        n={3}
        title="Make the pictures"
        what="Draws one picture per scene in your art style. Scenes set to 🎬 then get a short AI video clip made from their picture, cut to fit the voice."
        meta="⏱ about 1 min · 💲 a few cents per picture · 🎬 clip ≈ $0.10–0.20 (shown before you approve)"
        done={visualsReady}
        locked={!audioReady ? "Make the voice in step 2 first. It sets each scene's length." : undefined}
      >
        <div className="flex flex-wrap gap-2">
          <button onClick={makeImages} disabled={!!busy || !audioReady || !iModel} className="btn-primary">
            {busy === "images" ? "Drawing…" : picturesDone ? "↻ Redraw pictures" : "🖼 Draw pictures"}
          </button>
          {videoScenes.length > 0 && (
            <button
              onClick={() => setConfirmVideo(true)}
              disabled={!!busy || !audioReady || !videoScenes.every(({ s }) => s.imageUrl) || !vModel}
              className="btn-primary"
            >
              🎬 Make video clip{videoScenes.length > 1 ? "s" : ""}
            </button>
          )}
          {busy === "video" && (
            <button onClick={() => abortRef.current?.abort()} className="btn-secondary">
              Stop waiting
            </button>
          )}
        </div>
        {videoScenes.length > 0 && !picturesDone && audioReady && (
          <p className="mt-2 text-xs text-stone-500">Draw the pictures first; the video clip starts from its scene&apos;s picture.</p>
        )}

        {confirmVideo && (
          <div className="mt-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
            <p className="font-semibold">💲 Approve the video cost</p>
            {videoPlan.map((p) => (
              <p key={p.i} className="mt-1">
                Scene {p.i + 1}: voice slot {(slots[p.i].end - slots[p.i].start).toFixed(1)} s → <b>{p.dur} s clip</b> ({vModel?.name}, {videoRes || "default"}).
                Estimated <b>{p.cost !== null ? formatUsd(p.cost) : "unknown"}</b>
              </p>
            ))}
            <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">Charged by OpenRouter to your key. Takes about 1–5 minutes.</p>
            <div className="mt-3 flex gap-2">
              <button onClick={makeVideos} className="btn-primary">
                Approve &amp; make
              </button>
              <button onClick={() => setConfirmVideo(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-stone-500">Picture &amp; video models (advanced)</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Picture model</span>
              <select value={imageModel} onChange={(e) => setImageModel(e.target.value)} className="input">
                {imageModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.acceptsReferences ? " ✓ keeps characters" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Video model</span>
              <select
                value={videoModel}
                onChange={(e) => {
                  setVideoModel(e.target.value);
                  const vm = videoModels.find((m) => m.id === e.target.value);
                  setVideoRes(vm?.resolutions.includes("480p") ? "480p" : (vm?.resolutions[0] ?? ""));
                }}
                className="input"
              >
                {videoModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {vModel && vModel.resolutions.length > 0 && (
              <label className="block">
                <span className="label">Video quality</span>
                <select value={videoRes} onChange={(e) => setVideoRes(e.target.value)} className="input">
                  {vModel.resolutions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="mt-2 text-xs text-stone-500">“✓ keeps characters” models reuse scene 1&apos;s picture as a reference, so people look the same.</p>
        </details>
      </Step>

      {/* STEP 4 */}
      <Step
        id="video"
        n={4}
        title="Make the final video"
        what="Joins the voice, pictures, motion and subtitles (the spoken word turns yellow) into one video file. It records in real time, so keep the screen on."
        meta="⏱ as long as the video · 💲 free"
        done={!!output}
        locked={!audioReady ? "Make the voice first (step 2)." : !visualsReady ? "Make all pictures and video clips first (step 3)." : undefined}
      >
        <button onClick={render} disabled={!!busy || !audioReady || !visualsReady} className="btn-primary w-full sm:w-auto">
          {busy === "render" ? `Recording… ${Math.round(progress * 100)}%` : output ? "↻ Make the video again" : "🎞 Make the final video"}
        </button>
        {busy === "render" && (
          <>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
              <div className="h-full bg-teal-700 transition-[width]" style={{ width: `${progress * 100}%` }} />
            </div>
            <button onClick={() => abortRef.current?.abort()} className="btn-secondary mt-2">
              Cancel
            </button>
          </>
        )}
        {output && (
          <div className="mt-4">
            <video src={output.url} controls playsInline className="mx-auto max-h-[70vh] rounded-xl bg-black" />
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <a href={output.url} download={`golpo-video.${output.ext}`} className="btn-primary">
                ⬇ Download video
              </a>
              <button onClick={shareOutput} className="btn-secondary">
                📤 Share / Save to phone
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-stone-500">
              {output.mime.includes("avc1") ? "MP4 (H.264), plays everywhere." : `Format: ${output.mime}. For an iPhone-friendly MP4, make it in Safari or desktop Chrome.`}
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-stone-500">Sync report (for checking timing)</summary>
              <table className="mt-1 w-full text-left text-xs">
                <thead className="text-stone-500">
                  <tr>
                    <th className="py-1">Scene</th>
                    <th>Voice</th>
                    <th>On screen</th>
                    <th>Visual</th>
                  </tr>
                </thead>
                <tbody>
                  {output.report.map((r) => (
                    <tr key={r.scene} className="border-t border-stone-200 dark:border-stone-800">
                      <td className="py-1">{r.scene}</td>
                      <td>{r.audioSeconds.toFixed(2)} s</td>
                      <td>
                        {r.slotStart.toFixed(2)}–{r.slotEnd.toFixed(2)} s
                      </td>
                      <td>{r.visual === "video" ? `clip ×${r.playbackRate ?? 1} speed` : "picture + motion"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        )}
        <p className="mt-3 text-xs text-stone-500">
          Spent this session: pictures {formatUsd(imgCost || null)} · video {formatUsd(vidCost || null)} · voice ≈ $0.01
        </p>
      </Step>

      <details className="mb-5 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <summary className="cursor-pointer text-sm font-semibold">🧪 One-time setup: make the art style preview pictures</summary>
        <div className="mt-3">
          <StylePreviewMaker apiKey={apiKey} imageModel={imageModel} />
        </div>
      </details>

      {message && <Note kind={message.kind}>{message.text}</Note>}
    </div>
  );
}

function Step({
  id,
  n,
  title,
  what,
  meta,
  done,
  locked,
  children,
}: {
  id: string;
  n: number;
  title: string;
  what: string;
  meta: string;
  done?: boolean;
  locked?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`mb-5 scroll-mt-16 rounded-2xl border bg-white p-4 shadow-sm sm:p-5 dark:bg-stone-900 ${
        done ? "border-teal-300 dark:border-teal-900" : "border-stone-200 dark:border-stone-800"
      }`}
    >
      <div className="mb-3 flex gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
            done ? "bg-teal-600" : locked ? "bg-stone-400" : "bg-teal-700"
          }`}
        >
          {done ? "✓" : locked ? "🔒" : n}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">
            Step {n} · {title}
          </h2>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{what}</p>
          <p className="mt-1 text-xs font-medium text-stone-500">{meta}</p>
        </div>
      </div>
      {locked && <p className="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400">🔒 {locked}</p>}
      {children}
    </section>
  );
}

function Note({ kind, children }: { kind: "info" | "error" | "ok"; children: React.ReactNode }) {
  const cls =
    kind === "error"
      ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
      : kind === "ok"
        ? "border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200"
        : "border-stone-300 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300";
  return (
    <div role="status" className={`sticky bottom-3 z-10 mb-5 rounded-lg border p-3 text-sm shadow-sm ${cls}`}>
      {children}
    </div>
  );
}
