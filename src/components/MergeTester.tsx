"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ART_STYLES, buildImagePrompt } from "@/lib/artStyles";
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
  const [artId, setArtId] = useState(ART_STYLES[0].id);
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700 dark:text-teal-400">Merge test · audio first</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Voice + Video Merge</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          Narration is made first. Its exact length decides each scene, then pictures and video are fitted to it and merged
          into one 9:16 video, right in your browser.
        </p>
      </header>

      {loadError && <Note kind="error">{loadError}</Note>}

      <Card n="1" title="API key">
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-v1-…"
            autoComplete="off"
            spellCheck={false}
            aria-label="OpenRouter API key"
            className="input font-mono"
          />
          <button type="button" onClick={() => setShowKey((s) => !s)} className="btn-secondary w-20">
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-2 text-xs text-stone-500">Kept only in this page&apos;s memory. Reloading forgets it.</p>
      </Card>

      <Card n="2" title="Story (4 scenes)">
        <div className="mb-4">
          <span className="label">Art style</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...ART_STYLES, { id: "custom", label: "Custom…", emoji: "✍️", prompt: "", goodFor: "Describe your own" }].map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setArtId(a.id)}
                aria-pressed={artId === a.id}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  artId === a.id ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 hover:border-teal-600 dark:border-stone-700"
                }`}
              >
                <span className="block text-sm font-semibold">
                  {a.emoji} {a.label}
                </span>
                <span className={`block text-xs ${artId === a.id ? "text-teal-50" : "text-stone-500"}`}>{a.goodFor}</span>
              </button>
            ))}
          </div>
          {artId === "custom" && (
            <textarea
              value={customArt}
              onChange={(e) => setCustomArt(e.target.value)}
              rows={3}
              placeholder="Describe the look in English, e.g. 'oil painting, warm golden light, thick brush strokes'"
              className="input mt-2 text-sm"
            />
          )}
          {styleChanged && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Style changed: tap “Redraw pictures” to apply it.</p>
          )}
        </div>
        <details className="mb-3">
          <summary className="cursor-pointer text-sm font-medium text-teal-700 dark:text-teal-400">
            Characters &amp; setting (kept the same in every picture)
          </summary>
          <label className="mt-2 block">
            <span className="label">Characters</span>
            <textarea value={characters} onChange={(e) => setCharacters(e.target.value)} rows={4} className="input text-sm" />
          </label>
          <label className="mt-2 block">
            <span className="label">Setting</span>
            <input value={setting} onChange={(e) => setSetting(e.target.value)} className="input text-sm" />
          </label>
        </details>
        <div className="space-y-4">
          {scenes.map((s, i) => (
            <div key={i} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Scene {i + 1}</span>
                <div className="flex gap-1 text-xs">
                  {(["image", "video"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => update(i, { kind: k })}
                      className={`rounded-md border px-2 py-1 ${s.kind === k ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 dark:border-stone-700"}`}
                    >
                      {k === "image" ? "🖼 Image + motion" : "🎬 AI video"}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                value={s.narration}
                onChange={(e) => update(i, { narration: e.target.value, audio: undefined })}
                rows={2}
                lang="bn"
                className="input bangla text-base"
                aria-label={`Scene ${i + 1} narration`}
              />
              <textarea
                value={s.prompt}
                onChange={(e) => update(i, { prompt: e.target.value, imageUrl: undefined, video: undefined })}
                rows={2}
                className="input mt-2 text-xs"
                aria-label={`Scene ${i + 1} picture description`}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-stone-500">
                {s.audio ? (
                  <>
                    <audio controls src={s.audio.url} className="h-8 max-w-full" />
                    <span className="font-semibold text-teal-700 dark:text-teal-400">🔊 {s.audio.seconds.toFixed(2)} s</span>
                  </>
                ) : (
                  <span>No narration yet</span>
                )}
              </div>
              {(s.imageUrl || s.video?.url) && (
                <div className="mt-2 flex gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- generated data: URL, no optimisation possible */}
                  {s.imageUrl && <img src={s.imageUrl} alt={`Scene ${i + 1}`} className="h-32 rounded-lg object-cover" />}
                  {s.video?.url && <video src={s.video.url} className="h-32 rounded-lg" muted loop autoPlay playsInline />}
                </div>
              )}
              {s.video?.status && !s.video.url && <p className="mt-1 text-xs text-stone-500">Video: {s.video.status}</p>}
            </div>
          ))}
        </div>
      </Card>

      <Card n="3" title="Step 1 · Narration (always first)">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-3">
            <span className="label">Voice model</span>
            <select value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} className="input">
              {speech.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="label">Story style</span>
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="input">
              {STYLE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="label">Narrator</span>
            <div className="flex gap-1">
              {(["female", "male"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={`flex-1 rounded-lg border px-2 py-2.5 text-sm ${gender === g ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 dark:border-stone-700"}`}
                >
                  {g === "female" ? "♀" : "♂"} {voice && gender === g ? voice : g === "female" ? "Female" : "Male"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button onClick={makeVoices} disabled={!!busy || !tts} className="btn-primary mt-4">
          {busy === "voice" ? "Generating narration…" : audioReady ? "↻ Regenerate narration" : "Generate narration"}
        </button>
        {audioReady && (
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            Timeline locked to audio: <b>{totalDuration(slots).toFixed(1)} s</b> total (
            {slots.map((s) => `${(s.end - s.start).toFixed(1)}s`).join(" + ")}).
          </p>
        )}
      </Card>

      <Card n="4" title="Step 2 · Pictures and video, fitted to the audio">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Image model</span>
            <select value={imageModel} onChange={(e) => setImageModel(e.target.value)} className="input">
              {imageModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.acceptsReferences ? " ✓ref" : ""}
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
              <span className="label">Video resolution</span>
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
        <p className="mt-2 text-xs text-stone-500">
          Scene 1&apos;s picture is reused as a character reference for the others (models marked ✓ref). The video scene
          animates its own picture.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={makeImages} disabled={!!busy || !audioReady || !iModel} className="btn-primary">
            {busy === "images" ? "Drawing…" : scenes.every((s) => s.imageUrl) ? "↻ Redraw pictures" : "Draw pictures"}
          </button>
          {videoScenes.length > 0 && (
            <button
              onClick={() => setConfirmVideo(true)}
              disabled={!!busy || !audioReady || !videoScenes.every(({ s }) => s.imageUrl) || !vModel}
              className="btn-primary"
            >
              🎬 Animate video scene
            </button>
          )}
          {busy === "video" && (
            <button onClick={() => abortRef.current?.abort()} className="btn-secondary">
              Stop waiting
            </button>
          )}
        </div>
        {!audioReady && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Make the narration first: it sets each scene&apos;s length.</p>}

        {confirmVideo && (
          <div className="mt-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
            <p className="font-semibold">Approve video cost</p>
            {videoPlan.map((p) => (
              <p key={p.i} className="mt-1">
                Scene {p.i + 1}: audio slot {(slots[p.i].end - slots[p.i].start).toFixed(2)} s → clip of <b>{p.dur} s</b> with{" "}
                {vModel?.name} at {videoRes || "default"}. Estimated <b>{p.cost !== null ? formatUsd(p.cost) : "unknown"}</b>
              </p>
            ))}
            <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">Billed by OpenRouter to your key. Takes about 1–5 minutes.</p>
            <div className="mt-3 flex gap-2">
              <button onClick={makeVideos} className="btn-primary">
                Approve &amp; generate
              </button>
              <button onClick={() => setConfirmVideo(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card n="5" title="Step 3 · Merge into one video">
        <button onClick={render} disabled={!!busy || !audioReady || !visualsReady} className="btn-primary">
          {busy === "render" ? `Rendering… ${Math.round(progress * 100)}%` : "🎞 Render final video"}
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
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={output.url} download={`golpo-test.${output.ext}`} className="btn-secondary">
                ⬇ Download .{output.ext}
              </a>
              <button onClick={shareOutput} className="btn-secondary">
                Share / Save to phone
              </button>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Format: {output.mime.includes("avc1") ? "MP4 (H.264 + AAC), plays everywhere" : `${output.mime}. If it won't upload or play on iPhone, render in Safari or desktop Chrome for H.264.`}
            </p>
            <h3 className="mt-4 text-sm font-semibold">Sync report</h3>
            <table className="mt-1 w-full text-left text-xs">
              <thead className="text-stone-500">
                <tr>
                  <th className="py-1">Scene</th>
                  <th>Audio</th>
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
                    <td>{r.visual === "video" ? `video ×${r.playbackRate ?? 1} speed` : "image + motion"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-stone-500">
          Spent so far: pictures {formatUsd(imgCost || null)}, video {formatUsd(vidCost || null)}, narration ≈ $0.01.
        </p>
      </Card>

      {message && <Note kind={message.kind}>{message.text}</Note>}
    </div>
  );
}

function Card({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-sm text-white">{n}</span>
        {title}
      </h2>
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
