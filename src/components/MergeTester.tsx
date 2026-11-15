"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ART_STYLES, buildImagePrompt, previewSrc } from "@/lib/artStyles";
import Info from "@/components/Info";
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
  const [showPreviewMaker, setShowPreviewMaker] = useState(false);
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

  // The one-time preview maker is hidden; open it with …/merge#previews.
  useEffect(() => {
    const check = () => setShowPreviewMaker(window.location.hash === "#previews");
    const raf = requestAnimationFrame(check);
    window.addEventListener("hashchange", check);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", check);
    };
  }, []);

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
  const stylePrompt = art?.prompt ?? "";
  const promptFor = (scene: string) => buildImagePrompt(stylePrompt, setting, characters, scene);
  const styleChanged = imagesStyle !== null && imagesStyle !== artId;

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
      setImagesStyle(artId);
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
    try {
      await document.fonts.load('700 48px "Hind Siliguri"', "বাংলা");
    } catch {
      /* fall back to system Bangla font */
    }
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
  const SCENE_COLORS = ["#F4B13E", "#5AB0F0", "#9B8CFF", "#F07A8A", "#3CC4A6", "#E88BD0"];
  const total = audioReady ? totalDuration(slots) : 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:pt-10">
      {/* Hero: the output's own signature — a subtitle with the spoken word lit */}
      <header className="mb-6 text-center">
        <h1 className="text-[2.1rem] font-extrabold leading-tight sm:text-5xl">Turn a Bangla story into a video</h1>
        <p className="mx-auto mt-2 max-w-xl text-muted">
          Write a few lines, pick a look, and get a vertical video with narration, pictures, motion and subtitles, ready for
          Facebook Reels.
        </p>
        <div className="bangla mx-auto mt-5 inline-block rounded-2xl bg-[#2a1d12]/85 px-5 py-2.5 text-xl font-bold text-white shadow-lg sm:text-2xl" aria-hidden>
          গল্প বলুন, <span className="text-accent">ভিডিও</span> হবে
        </div>
      </header>

      {/* Sticky progress */}
      <nav aria-label="Progress" className="sticky top-[52px] z-10 -mx-4 mb-5 bg-bg/85 px-4 py-2 backdrop-blur">
        <ol className="grid grid-cols-4 gap-1.5">
          {progressSteps.map((p, i) => (
            <li key={p.id}>
              <a
                href={`#${p.id}`}
                className={`flex items-center justify-center gap-1.5 rounded-full border px-2 py-1.5 text-xs font-semibold transition sm:text-sm ${
                  p.done ? "border-ok/60 bg-ok/15 text-ok" : "border-line bg-surface text-muted hover:border-accent"
                }`}
              >
                <span aria-hidden>{p.done ? "✓" : p.icon}</span>
                <span>
                  <span className="hidden sm:inline">{i + 1}. </span>
                  {p.label}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {loadError && <Note kind="error">{loadError}</Note>}

      <section className="card mb-5">
        <label className="label" htmlFor="key">
          🔑 Your OpenRouter key
          <Info title="OpenRouter key">
            Your personal password for the AI services (voice, pictures, video). Get one at openrouter.ai → Keys. It stays only in
            this browser tab: it is never saved, and reloading the page forgets it. Every AI step is charged to your OpenRouter
            balance, not to this app.
          </Info>
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
        {!apiKey && <p className="hint mt-1.5">Paste it once; all four steps use it.</p>}
      </section>

      {/* STEP 1 */}
      <Step id="story" n={1} title="Write your story" what="Choose how the pictures look, then write each scene." meta="Free" done={storyReady}>
        <div className="label">
          Art style
          <Info title="Art style">
            How every picture in your video will be drawn. The same characters and scenes are redrawn in the style you pick. You
            can change it later and just redraw the pictures; the voice stays the same.
          </Info>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {ART_STYLES.map((a) => {
            const src = previewSrc(a.id);
            const on = artId === a.id;
            return (
              <div key={a.id} className="relative">
                <button
                  type="button"
                  onClick={() => setArtId(a.id)}
                  aria-pressed={on}
                  className={`block w-full overflow-hidden rounded-2xl border-2 text-left transition ${
                    on ? "border-accent shadow-[0_8px_28px_-10px_var(--accent)]" : "border-line hover:border-accent/60"
                  }`}
                >
                  <div className="relative aspect-[9/14] bg-surface-2">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element -- small static preview
                      <img src={src} alt={`Example picture in ${a.label} style`} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-3xl">{a.emoji}</span>
                    )}
                    {on && (
                      <span className="absolute bottom-2 left-2 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-ink">✓ Selected</span>
                    )}
                  </div>
                  <div className={`px-2.5 py-2 ${on ? "bg-accent/15" : "bg-surface"}`}>
                    <span className="block text-sm font-bold leading-tight">{a.label}</span>
                    <span className="block truncate text-[11px] text-muted">{a.goodFor}</span>
                  </div>
                </button>
                <span className="absolute right-1.5 top-1.5 rounded-full bg-surface/90 p-0.5">
                  <Info title={a.label}>{a.about}</Info>
                </span>
              </div>
            );
          })}
        </div>
        {styleChanged && <p className="mt-2 text-xs font-semibold text-accent-strong">Style changed: redraw the pictures in step 3 to see it.</p>}

        <details className="mt-4 rounded-2xl border border-line bg-surface-2/60 p-3.5">
          <summary className="flex cursor-pointer list-none items-center text-sm font-semibold">
            👥 Characters &amp; place
            <Info title="Characters & place">
              A short description of each person (age, hair, clothes) and where the story happens. It is added to every picture so
              the same mother looks like the same mother in every scene. Write it in English.
            </Info>
            <span className="ml-auto text-xs text-muted">Edit ▾</span>
          </summary>
          <textarea value={characters} onChange={(e) => setCharacters(e.target.value)} rows={4} className="input mt-3 text-sm" aria-label="Characters" />
          <input value={setting} onChange={(e) => setSetting(e.target.value)} className="input mt-2 text-sm" aria-label="Place" />
        </details>

        <div className="label mt-5">
          Scenes
          <Info title="Scenes">
            Each scene is one line of narration plus one picture. 4 scenes make about 20–30 seconds of video. Edit the sample to tell
            your own story.
          </Info>
        </div>
        <div className="space-y-3">
          {scenes.map((s, i) => (
            <div key={i} className="rounded-2xl border border-line bg-bg/40 p-3.5" style={{ borderLeft: `4px solid ${SCENE_COLORS[i % SCENE_COLORS.length]}` }}>
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold">Scene {i + 1}</span>
                <div className="flex items-center">
                  <div className="flex rounded-full border border-line bg-surface p-0.5 text-xs font-semibold" role="radiogroup" aria-label={`Scene ${i + 1} type`}>
                    {(["image", "video"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={s.kind === k}
                        onClick={() => update(i, { kind: k })}
                        className={`rounded-full px-3 py-1.5 transition ${s.kind === k ? "bg-accent text-accent-ink" : "text-muted"}`}
                      >
                        {k === "image" ? "🖼 Picture" : "🎬 AI video"}
                      </button>
                    ))}
                  </div>
                  <Info title="Picture or AI video?">
                    <b>🖼 Picture</b>: one still picture with a slow zoom and pan. Costs a few cents and always matches the voice exactly.
                    <br />
                    <b>🎬 AI video</b>: the picture is turned into a short moving clip (people move, rain falls). Looks livelier but costs
                    about $0.10–0.20 per scene and takes 1–5 minutes.
                  </Info>
                </div>
              </div>
              <label className="label !text-xs !font-semibold text-muted" htmlFor={`n${i}`}>
                🗣 Narrator says
                <Info title="Narrator says">
                  The exact Bangla words the voice will read. You can add English emotion tags like [sad], [whispers] or [long pause]
                  where the feeling changes; they are not spoken or shown in subtitles.
                </Info>
              </label>
              <textarea
                id={`n${i}`}
                value={s.narration}
                onChange={(e) => update(i, { narration: e.target.value, audio: undefined })}
                rows={2}
                lang="bn"
                className="input bangla text-base"
              />
              <label className="label !text-xs !font-semibold text-muted mt-2.5" htmlFor={`p${i}`}>
                🖼 Picture shows
                <Info title="Picture shows">
                  What should be in the picture, in English: who is there, what they do, where, and the time of day. Example: “Rainy
                  night, the son knocks on the wooden door.”
                </Info>
              </label>
              <textarea
                id={`p${i}`}
                value={s.prompt}
                onChange={(e) => update(i, { prompt: e.target.value, imageUrl: undefined, video: undefined })}
                rows={2}
                className="input text-sm"
              />
              {(s.audio || s.imageUrl || s.video) && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {s.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- generated data: URL
                    <img src={s.imageUrl} alt={`Scene ${i + 1} picture`} className="h-28 rounded-xl object-cover" />
                  )}
                  {s.video?.url && <video src={s.video.url} className="h-28 rounded-xl" muted loop autoPlay playsInline />}
                  <div className="space-y-1 text-xs">
                    {s.audio && (
                      <>
                        <span className="font-bold text-ok">🔊 {s.audio.seconds.toFixed(1)} s voice</span>
                        <audio controls src={s.audio.url} className="h-8 max-w-[220px]" />
                      </>
                    )}
                    {s.video?.status && !s.video.url && <span className="block text-muted">🎬 {s.video.status.replace("_", " ")}…</span>}
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
        what="Reads every scene aloud in Bangla. The length of each line decides how long its picture stays on screen."
        meta="About 20 seconds · about $0.01"
        done={audioReady}
        locked={!storyReady ? "Fill in every scene in step 1 first." : undefined}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">
              Story mood
              <Info title="Story mood">
                Tells the narrator how to perform: accent (Bangladeshi, Dhaka), feeling and pace. Emotional is soft and warm; Horror is
                tense with whispers; Comedy is lively.
              </Info>
            </span>
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="input">
              {STYLE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="label">
              Narrator
              <Info title="Narrator">
                Female or male storyteller. A suitable voice is picked for the mood automatically (shown on the button). Try both in
                the Voice Lab if you are unsure.
              </Info>
            </span>
            <div className="flex gap-1.5">
              {(["female", "male"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={`flex-1 rounded-xl border px-2 py-2.5 text-sm font-semibold transition ${gender === g ? "chip-on" : "chip-off"}`}
                >
                  {g === "female" ? "♀ Female" : "♂ Male"}
                  {gender === g && voice ? <span className="block text-[11px] font-medium opacity-80">{voice}</span> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
        <details className="mt-3">
          <summary className="flex cursor-pointer list-none items-center text-xs font-semibold text-muted">
            ⚙ Voice engine (advanced)
            <Info title="Voice engine">
              The AI model that speaks. Gemini Flash TTS is chosen by default because it handles Bangladeshi Bangla and emotions best.
              Change only if you want to compare.
            </Info>
          </summary>
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
            <p className="label !mb-1 !text-xs text-muted">
              Video length: {total.toFixed(1)} s
              <Info title="Video timeline">
                Each coloured block is one scene. Its width is how long the narration takes, plus a short breath. Pictures and video
                clips are fitted to these exact lengths, so sound and picture stay in sync.
              </Info>
            </p>
            <div className="flex h-8 overflow-hidden rounded-xl text-[11px] font-bold text-[#1a1d3b]">
              {slots.map((sl, i) => (
                <div
                  key={i}
                  className="flex items-center justify-center border-r border-bg/60 last:border-0"
                  style={{ width: `${((sl.end - sl.start) / total) * 100}%`, background: SCENE_COLORS[i % SCENE_COLORS.length] }}
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
        what="Draws one picture per scene in your art style. 🎬 scenes then become short moving clips, cut to fit the voice."
        meta="About 1 minute · a few cents per picture · clips about $0.10–0.20 each, shown before you approve"
        done={visualsReady}
        locked={!audioReady ? "Make the voice in step 2 first; it sets each scene's length." : undefined}
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
        {videoScenes.length > 0 && !picturesDone && audioReady && <p className="hint mt-2">Draw the pictures first: each clip starts from its scene&apos;s picture.</p>}

        {confirmVideo && (
          <div className="mt-4 rounded-2xl border-2 border-accent bg-accent/10 p-4 text-sm">
            <p className="font-bold">Approve the video cost</p>
            {videoPlan.map((p) => (
              <p key={p.i} className="mt-1">
                Scene {p.i + 1}: {(slots[p.i].end - slots[p.i].start).toFixed(1)} s of voice → a <b>{p.dur} s clip</b> ({vModel?.name},{" "}
                {videoRes || "default"}). Estimated <b>{p.cost !== null ? formatUsd(p.cost) : "unknown"}</b>
              </p>
            ))}
            <p className="hint mt-1">Charged by OpenRouter to your key. Takes about 1–5 minutes.</p>
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
          <summary className="flex cursor-pointer list-none items-center text-xs font-semibold text-muted">
            ⚙ Picture &amp; video engines (advanced)
            <Info title="Picture & video engines">
              The AI models that draw and animate. The defaults are chosen for good quality at low cost and for keeping characters the
              same between scenes. Change only to compare.
            </Info>
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">
                Picture engine
                <Info title="Picture engine">
                  Draws the scene pictures. Engines marked “keeps characters” look at scene 1&apos;s picture while drawing the others,
                  so faces and clothes stay the same.
                </Info>
              </span>
              <select value={imageModel} onChange={(e) => setImageModel(e.target.value)} className="input">
                {imageModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.acceptsReferences ? " · keeps characters" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">
                Video engine
                <Info title="Video engine">Turns a picture into a short moving clip. Prices differ a lot; the cost is always shown before it runs.</Info>
              </span>
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
                <span className="label">
                  Clip quality
                  <Info title="Clip quality">
                    Sharpness of the moving clip. 480p is cheapest and looks fine on phones; higher costs more per second.
                  </Info>
                </span>
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
        </details>
      </Step>

      {/* STEP 4 */}
      <Step
        id="video"
        n={4}
        title="Make the final video"
        what="Joins voice, pictures, motion and subtitles into one video file. The spoken word lights up yellow in the subtitles."
        meta="Takes as long as the video itself · free"
        done={!!output}
        locked={!audioReady ? "Make the voice first (step 2)." : !visualsReady ? "Make all pictures and clips first (step 3)." : undefined}
      >
        <div className="flex items-center">
          <button onClick={render} disabled={!!busy || !audioReady || !visualsReady} className="btn-primary w-full sm:w-auto">
            {busy === "render" ? `Recording… ${Math.round(progress * 100)}%` : output ? "↻ Make the video again" : "🎞 Make the final video"}
          </button>
          <Info title="How the final video is made">
            Your browser plays the voice and draws each picture (with motion and subtitles) at exactly the right moment, and records
            it. It runs in real time, so a 20-second video takes about 20 seconds. Keep this screen on and the tab open.
          </Info>
        </div>
        {busy === "render" && (
          <>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
            </div>
            <button onClick={() => abortRef.current?.abort()} className="btn-secondary mt-2">
              Cancel
            </button>
          </>
        )}
        {output && (
          <div className="mt-4">
            <video src={output.url} controls playsInline className="mx-auto max-h-[70vh] rounded-2xl bg-black shadow-xl" />
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <a href={output.url} download={`golpo-video.${output.ext}`} className="btn-primary">
                ⬇ Download video
              </a>
              <button onClick={shareOutput} className="btn-secondary">
                📤 Share / save to phone
              </button>
            </div>
            <p className="hint mt-2 flex items-center justify-center">
              {output.mime.includes("avc1") ? "MP4 (H.264), plays everywhere." : `Format: ${output.mime.split(";")[0]}`}
              <Info title="Video format">
                MP4 with H.264 plays on every phone and uploads to Facebook. Some browsers record a different format; if the file
                won&apos;t play on iPhone, make the video in Safari or desktop Chrome.
              </Info>
            </p>
            <details className="mt-3">
              <summary className="flex cursor-pointer list-none items-center text-xs font-semibold text-muted">
                ⏱ Timing check
                <Info title="Timing check">
                  Shows when each scene starts and ends and how long its voice is, so you can confirm sound and picture match.
                </Info>
              </summary>
              <table className="mt-2 w-full text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1">Scene</th>
                    <th>Voice</th>
                    <th>On screen</th>
                    <th>Visual</th>
                  </tr>
                </thead>
                <tbody>
                  {output.report.map((r) => (
                    <tr key={r.scene} className="border-t border-line">
                      <td className="py-1">{r.scene}</td>
                      <td>{r.audioSeconds.toFixed(2)} s</td>
                      <td>
                        {r.slotStart.toFixed(2)}–{r.slotEnd.toFixed(2)} s
                      </td>
                      <td>{r.visual === "video" ? `clip at ${r.playbackRate ?? 1}× speed` : "picture + motion"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        )}
        <p className="hint mt-4">
          Spent this session: pictures {formatUsd(imgCost || null)}, video clips {formatUsd(vidCost || null)}, voice about $0.01
        </p>
      </Step>

      {showPreviewMaker && (
        <details className="card mb-5">
          <summary className="cursor-pointer text-sm font-semibold">🧪 Make the art style preview pictures</summary>
          <div className="mt-3">
            <StylePreviewMaker apiKey={apiKey} imageModel={imageModel} />
          </div>
        </details>
      )}

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
    <section id={id} className={`card mb-5 scroll-mt-28 ${done ? "!border-ok/50" : ""} ${locked ? "opacity-80" : ""}`}>
      <div className="mb-4 flex gap-3.5">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl font-display text-lg font-extrabold ${
            done ? "bg-ok text-white" : locked ? "bg-surface-2 text-muted" : "bg-accent text-accent-ink"
          }`}
          aria-hidden
        >
          {done ? "✓" : locked ? "🔒" : n}
        </span>
        <div className="min-w-0">
          <h2 className="text-xl font-bold leading-tight">
            <span className="sr-only">Step {n}: </span>
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{what}</p>
          <p className="mt-1.5 inline-block rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-semibold text-muted">{meta}</p>
        </div>
      </div>
      {locked && <p className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">🔒 {locked}</p>}
      {children}
    </section>
  );
}

function Note({ kind, children }: { kind: "info" | "error" | "ok"; children: React.ReactNode }) {
  const cls =
    kind === "error" ? "border-bad/60 bg-bad/15 text-bad" : kind === "ok" ? "border-ok/60 bg-ok/15 text-ok" : "border-line bg-surface-2 text-ink";
  return (
    <div role="status" className={`fixed inset-x-3 bottom-3 z-40 mx-auto max-w-xl rounded-2xl border p-3.5 text-sm font-medium shadow-2xl backdrop-blur ${cls}`}>
      {children}
    </div>
  );
}
