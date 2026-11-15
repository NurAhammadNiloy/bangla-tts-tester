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
import { suggestCaption, CAPTION_STYLES, estimateSeconds, GENRES, partSeconds, partText, type CaptionStyle, type PlanScene, type StoryPlan } from "@/lib/storyPlan";
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
  const [mode, setMode] = useState<"story" | "manual">("story");
  const [storyText, setStoryText] = useState("");
  const [partMinutes, setPartMinutes] = useState("auto");
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [activePart, setActivePart] = useState<number | null>(null);
  const [madeParts, setMadeParts] = useState<number[]>([]);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("box");
  const [captionPicked, setCaptionPicked] = useState(false);
  const [planning, setPlanning] = useState<null | "outline" | number>(null);
  const [confirmNew, setConfirmNew] = useState(false);

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

  /* ---------- saved story (browser only, so Part 2 can be made later) ---------- */
  const STORE = "golpo.story.v1";
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
        if (!saved) return;
        if (typeof saved.storyText === "string") setStoryText(saved.storyText);
        if (saved.plan?.parts?.length) setPlan(saved.plan);
        if (Array.isArray(saved.madeParts)) setMadeParts(saved.madeParts);
        if (saved.look) {
          if (saved.look.artId) setArtId(saved.look.artId);
          if (saved.look.captionStyle) setCaptionStyle(saved.look.captionStyle);
          if (saved.look.captionPicked) setCaptionPicked(true);
          if (saved.look.presetId) setPresetId(saved.look.presetId);
          if (saved.look.characters) setCharacters(saved.look.characters);
          if (saved.look.setting) setSetting(saved.look.setting);
        }
      } catch {
        /* storage unavailable or corrupt: start fresh */
      } finally {
        setRestored(true);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!restored) return; // never overwrite the saved story before it has been read back
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({ storyText, plan, madeParts, look: { artId, captionStyle, captionPicked, presetId, characters, setting } }),
      );
    } catch {
      /* quota or private mode: the plan just won't survive a reload */
    }
  }, [restored, storyText, plan, madeParts, artId, captionStyle, captionPicked, presetId, characters, setting]);

  function loadScenes(list: PlanScene[]) {
    setScenes(list.map((x) => ({ narration: x.narration, prompt: x.picture, kind: "image", speaker: x.speaker, titleTag: x.titleTag })));
    setOutput(null);
    setImagesStyle(null);
  }

  async function planStory() {
    if (needKey()) return;
    setPlanning("outline");
    setMessage({ kind: "info", text: "The Story Editor is reading your story and choosing where each part ends… (about 30–90 seconds)" });
    try {
      const r = await postJson<{ plan: StoryPlan; model: string }>("/api/plan", apiKey.trim(), {
        mode: "outline",
        story: storyText,
        partMinutes: partMinutes === "auto" ? undefined : Number(partMinutes),
      });
      const g = GENRES[r.plan.genre];
      setPlan(r.plan);
      setMadeParts([]);
      setActivePart(null);
      setArtId(g.art);
      setCaptionStyle(suggestCaption(r.plan.genre, g.art));
      setCaptionPicked(false);
      setPresetId(g.mood);
      if (r.plan.characters) setCharacters(r.plan.characters);
      if (r.plan.setting) setSetting(r.plan.setting);
      setMessage({
        kind: "ok",
        text: `Planned as ${g.emoji} ${g.label} in ${r.plan.parts.length} part${r.plan.parts.length > 1 ? "s" : ""}. Open Part 1 to see its scenes.`,
      });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Planning failed." });
    } finally {
      setPlanning(null);
    }
  }

  async function openPart(i: number) {
    if (!plan) return;
    const part = plan.parts[i];
    if (part.scenes?.length) {
      setActivePart(i);
      loadScenes(part.scenes);
      setMessage({ kind: "ok", text: `Part ${i + 1} is open below. Next: make the voice.` });
      return;
    }
    if (needKey()) return;
    setPlanning(i);
    setMessage({ kind: "info", text: `Splitting Part ${i + 1} into scenes…` });
    try {
      const r = await postJson<{ scenes: PlanScene[] }>("/api/plan", apiKey.trim(), {
        mode: "scenes",
        text: partText(plan, part),
        genre: plan.genre,
        characters,
        setting,
        partTitle: part.title,
        hook: part.hook,
        isLast: i === plan.parts.length - 1,
      });
      const next = { ...plan, parts: plan.parts.map((p, j) => (j === i ? { ...p, scenes: r.scenes } : p)) };
      setPlan(next);
      setActivePart(i);
      loadScenes(r.scenes);
      setMessage({ kind: "ok", text: `Part ${i + 1}: ${r.scenes.length} scenes ready below. Check them, then make the voice.` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Could not plan this part." });
    } finally {
      setPlanning(null);
    }
  }

  function startNewStory() {
    setPlan(null);
    setActivePart(null);
    setMadeParts([]);
    setStoryText("");
    setScenes(DEFAULT_SCENES.map((x) => ({ ...x })));
    setOutput(null);
    setConfirmNew(false);
  }

  function exportPlan() {
    if (!plan) return;
    const blob = new Blob([JSON.stringify({ plan, madeParts, look: { artId, captionStyle, presetId, characters, setting } }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${plan.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "story"}-plan.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function importPlan(file: File) {
    try {
      const j = JSON.parse(await file.text());
      if (!j.plan?.parts?.length || !Array.isArray(j.plan.sentences)) throw new Error("bad");
      setPlan(j.plan);
      setMadeParts(Array.isArray(j.madeParts) ? j.madeParts : []);
      if (j.look?.artId) setArtId(j.look.artId);
      if (j.look?.captionStyle) setCaptionStyle(j.look.captionStyle);
      if (j.look?.presetId) setPresetId(j.look.presetId);
      if (j.look?.characters) setCharacters(j.look.characters);
      if (j.look?.setting) setSetting(j.look.setting);
      setActivePart(null);
      setMessage({ kind: "ok", text: "Story plan loaded." });
    } catch {
      setMessage({ kind: "error", text: "That file is not a Golpo Studio story plan." });
    }
  }

  /** Keep edits to the open part's scenes saved in the plan. */
  function syncPart(next: SceneState[]) {
    if (activePart === null || !plan) return;
    const sc: PlanScene[] = next.map((x) => ({ narration: x.narration, picture: x.prompt, speaker: x.speaker ?? "", titleTag: x.titleTag ?? "" }));
    setPlan({ ...plan, parts: plan.parts.map((p, j) => (j === activePart ? { ...p, scenes: sc } : p)) });
  }

  function addScene() {
    const next = [...scenes, { narration: "", prompt: "", kind: "image" as const }];
    setScenes(next);
    syncPart(next);
  }

  function removeScene(i: number) {
    if (scenes.length <= 1) return;
    const next = scenes.filter((_, j) => j !== i);
    setScenes(next);
    syncPart(next);
  }

  const update = (i: number, patch: Partial<SceneState>) =>
    setScenes((prev) => {
      const next = prev.map((s, j) => (j === i ? { ...s, ...patch } : s));
      if ("narration" in patch || "prompt" in patch || "speaker" in patch || "titleTag" in patch) syncPart(next);
      return next;
    });

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
      // Scene 1 first: it becomes the character reference for the rest.
      let done = 0;
      const draw = async (i: number, reference?: string) => {
        const r = await postJson<{ dataUrl: string; costUsd: number | null }>("/api/image", apiKey.trim(), {
          model: iModel.id,
          prompt: promptFor(scenes[i].prompt),
          references: reference && iModel.acceptsReferences ? [reference] : undefined,
        });
        update(i, { imageUrl: r.dataUrl, imageCost: r.costUsd });
        done++;
        setMessage({ kind: "info", text: `Drawing pictures… ${done} of ${scenes.length}` });
        return r.dataUrl;
      };
      setMessage({ kind: "info", text: `Drawing pictures… 0 of ${scenes.length}` });
      const reference = await draw(0);
      // Then 3 at a time.
      const queue = scenes.map((_, i) => i).slice(1);
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          for (let i = queue.shift(); i !== undefined; i = queue.shift()) await draw(i, reference);
        }),
      );
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
          speaker: s.speaker || undefined,
          titleTag: s.titleTag || undefined,
          visual:
            s.kind === "video" && s.video?.url
              ? { kind: "video" as const, video: await loadVideo(s.video.url), clipSeconds: s.video.seconds ?? 0 }
              : { kind: "image" as const, image: await loadImage(s.imageUrl!) },
        })),
      );
      const r = await renderVideo(ac, prepared, slots, { onProgress: setProgress, signal: ctrl.signal, captionStyle });
      const ext = r.mimeType.includes("mp4") ? "mp4" : "webm";
      setOutput({ url: URL.createObjectURL(r.blob), blob: r.blob, ext, mime: r.mimeType, seconds: r.durationSeconds, report: r.report });
      if (activePart !== null) setMadeParts((m) => (m.includes(activePart) ? m : [...m, activePart]));
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
  const storyReady = (mode === "manual" || activePart !== null) && scenes.length > 0 && scenes.every((s) => s.narration.trim() && s.prompt.trim());
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
      <Step
        id="story"
        n={1}
        title="Your story"
        what="Paste a whole story and let the Story Editor split it into parts and scenes, or write scenes yourself."
        meta="Planning costs about $0.01–0.05"
        done={storyReady && (mode === "manual" || activePart !== null)}
      >
        <div className="mb-4 flex rounded-full border border-line bg-bg p-1 text-sm font-semibold" role="tablist">
          {(
            [
              ["story", "📜 Paste a whole story"],
              ["manual", "✍️ Write scenes myself"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-full px-3 py-2 transition ${mode === m ? "bg-accent text-accent-ink" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "story" && !plan && (
          <div>
            <label className="label" htmlFor="story-text">
              Your story (Bangla)
              <Info title="Paste a whole story">
                Paste the full story exactly as written, of any length. The Story Editor AI reads all of it, works out the type of
                story, and cuts it into parts (each 6 minutes at most) that end at a moment of curiosity, so viewers want the next
                part. Your own words are kept.
              </Info>
            </label>
            <textarea
              id="story-text"
              value={storyText}
              onChange={(e) => setStoryText(e.target.value)}
              rows={9}
              lang="bn"
              placeholder="এখানে পুরো গল্পটা পেস্ট করুন…"
              className="input bangla text-base leading-relaxed"
            />
            <p className="hint mt-1">
              {[...storyText].length.toLocaleString()} letters · about {Math.max(0, estimateSeconds(storyText) / 60).toFixed(1)} min when read aloud
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block min-w-[10rem] flex-1">
                <span className="label">
                  Length of each part
                  <Info title="Length of each part">
                    “Let the editor decide” is best: it picks the number of parts from the story itself, usually 2–3 minutes each.
                    Choose a length only if you want every part about that long. A part is never longer than 6 minutes.
                  </Info>
                </span>
                <select value={partMinutes} onChange={(e) => setPartMinutes(e.target.value)} className="input">
                  <option value="auto">Let the editor decide</option>
                  <option value="2">About 2 minutes</option>
                  <option value="3">About 3 minutes</option>
                  <option value="5">About 5 minutes</option>
                </select>
              </label>
              <button onClick={planStory} disabled={!!planning || [...storyText.trim()].length < 40} className="btn-primary">
                {planning === "outline" ? "Reading your story…" : "✨ Plan my story"}
              </button>
            </div>
            <label className="mt-3 inline-flex cursor-pointer items-center text-xs font-semibold text-muted">
              <input type="file" accept="application/json" className="sr-only" onChange={(e) => e.target.files?.[0] && importPlan(e.target.files[0])} />
              📂 Open a saved story plan
            </label>
          </div>
        )}

        {mode === "story" && plan && (
          <div>
            <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="bangla text-xl font-bold leading-snug">{plan.title}</h3>
                  <p className="mt-0.5 flex items-center text-xs text-muted">
                    {GENRES[plan.genre].emoji} {GENRES[plan.genre].label} · {plan.parts.length} part{plan.parts.length > 1 ? "s" : ""} · about{" "}
                    {(plan.parts.reduce((a, p) => a + partSeconds(plan, p), 0) / 60).toFixed(1)} min in total
                    <Info title="What the Story Editor decided">
                      The story type sets the suggested look below: art style, subtitle style and voice mood. Each part ends on a
                      hook (🪝) so viewers want the next one. The plan is saved in this browser, so you can make Part 1 now and Part 2
                      later.
                    </Info>
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={exportPlan} className="btn-secondary !px-2.5 !py-1.5 !text-xs">
                    💾 Save file
                  </button>
                  <button onClick={() => setConfirmNew(true)} className="btn-secondary !px-2.5 !py-1.5 !text-xs">
                    New story
                  </button>
                </div>
              </div>
              {confirmNew && (
                <div className="mt-3 rounded-xl border border-bad/50 bg-bad/10 p-3 text-sm">
                  Start a new story? This plan will be removed from this browser (save the file first if you need it).
                  <div className="mt-2 flex gap-2">
                    <button onClick={startNewStory} className="btn-primary !py-1.5">
                      Yes, start new
                    </button>
                    <button onClick={() => setConfirmNew(false)} className="btn-secondary !py-1.5">
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </div>

            <ol className="mt-3 space-y-2">
              {plan.parts.map((p, i) => {
                const open = activePart === i;
                const made = madeParts.includes(i);
                const secs = partSeconds(plan, p);
                return (
                  <li
                    key={i}
                    className={`rounded-2xl border p-3.5 transition ${open ? "border-accent bg-accent/10" : "border-line bg-surface"}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold ${made ? "bg-ok text-white" : "bg-surface-2"}`}>
                        {made ? "✓" : i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <span className="bangla font-bold">
                            Part {i + 1}: {p.title}
                          </span>
                          <span className="text-xs text-muted">
                            ~{Math.floor(secs / 60)}:{String(Math.round(secs % 60)).padStart(2, "0")} min
                            {p.scenes?.length ? ` · ${p.scenes.length} scenes` : ""}
                          </span>
                        </div>
                        {p.summary && <p className="bangla mt-0.5 text-sm text-muted">{p.summary}</p>}
                        {p.hook && i < plan.parts.length - 1 && <p className="bangla mt-1 text-sm">🪝 {p.hook}</p>}
                      </div>
                    </div>
                    <div className="mt-2.5 flex justify-end">
                      <button onClick={() => openPart(i)} disabled={planning !== null || !!busy} className={open ? "btn-secondary !py-1.5" : "btn-primary !py-1.5"}>
                        {planning === i ? "Making scenes…" : open ? "Open below ↓" : made ? "Open again" : p.scenes?.length ? "Open this part" : "Make scenes for this part"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Look: art + subtitles */}
        <div className="mt-6 border-t border-line pt-5">
          <div className="label">
            Art style
            <Info title="Art style">
              How every picture is drawn. The Story Editor suggests one for the story type; you can change it any time and just redraw the
              pictures.
            </Info>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {ART_STYLES.map((a) => {
              const src = previewSrc(a.id);
              const on = artId === a.id;
              return (
                <div key={a.id} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setArtId(a.id);
                      if (!captionPicked) setCaptionStyle(suggestCaption(plan?.genre, a.id));
                    }}
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
                        <span className="flex h-full items-center justify-center bg-[#1c1c22] text-3xl">{a.emoji}</span>
                      )}
                      {on && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-ink">✓</span>}
                    </div>
                    <div className={`px-2 py-1.5 ${on ? "bg-accent/15" : "bg-surface"}`}>
                      <span className="block truncate text-xs font-bold leading-tight">{a.label}</span>
                      <span className="block truncate text-[10px] text-muted">{a.goodFor}</span>
                    </div>
                  </button>
                  <span className="absolute right-1 top-1 rounded-full bg-surface/90 p-0.5">
                    <Info title={a.label}>{a.about}</Info>
                  </span>
                </div>
              );
            })}
          </div>
          {styleChanged && <p className="mt-2 text-xs font-semibold text-accent-strong">Style changed: redraw the pictures in step 3 to see it.</p>}

          <div className="label mt-5">
            Subtitle style
            <Info title="Subtitle style">
              How the Bangla words appear on the video. It is picked for you from the story type and art style (marked ✨ Suggested):
              horror and sci-fi get clean text, explainers get big headlines, emotional, drama and comedy get the dark box. Tap another
              to override it. The word being spoken always lights up in yellow. Lines a character says aloud
              appear in a speech bubble, and time jumps get a small tag at the top, whichever style you choose.
            </Info>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {CAPTION_STYLES.map((c) => {
              const on = captionStyle === c.id;
              return (
                <div key={c.id} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setCaptionStyle(c.id);
                      setCaptionPicked(c.id !== suggestCaption(plan?.genre, artId));
                    }}
                    aria-pressed={on}
                    className={`block w-full overflow-hidden rounded-2xl border-2 text-left transition ${on ? "border-accent" : "border-line hover:border-accent/60"}`}
                  >
                    <div
                      className={`bangla relative flex aspect-[4/3] justify-center bg-gradient-to-b from-[#3b4a6b] to-[#1f2740] px-1.5 text-[13px] font-bold text-white ${
                        c.id === "headline" ? "items-start pt-3 text-base" : "items-end pb-3"
                      }`}
                      aria-hidden
                    >
                      {c.id === "box" && (
                        <span className="rounded-md bg-[#2a1d12]/85 px-2 py-0.5">
                          এক <span className="text-[#FFD43B]">বৃষ্টির</span> দুপুরে
                        </span>
                      )}
                      {c.id === "clean" && (
                        <span style={{ textShadow: "0 0 3px #000, 0 0 3px #000, 0 2px 6px #000" }}>
                          এক <span className="text-[#FFD43B]">বৃষ্টির</span> দুপুরে
                        </span>
                      )}
                      {c.id === "headline" && (
                        <span className="leading-tight" style={{ textShadow: "0 2px 6px #000" }}>
                          দরজা পার হতেই <span className="text-[#FFD43B]">মাথা ফাঁকা</span>
                        </span>
                      )}
                    </div>
                    <div className={`px-2 py-1.5 text-xs font-bold ${on ? "bg-accent/15" : "bg-surface"}`}>
                      {c.label}
                      {c.id === suggestCaption(plan?.genre, artId) && <span className="block text-[10px] font-semibold text-accent-strong">✨ Suggested</span>}
                    </div>
                  </button>
                  <span className="absolute right-1 top-1 rounded-full bg-surface/90 p-0.5">
                    <Info title={`${c.label} subtitles`}>{c.about}</Info>
                  </span>
                </div>
              );
            })}
          </div>

          <details className="mt-4 rounded-2xl border border-line bg-surface-2/60 p-3.5">
            <summary className="flex cursor-pointer list-none items-center text-sm font-semibold">
              👥 Characters &amp; place
              <Info title="Characters & place">
                A short English description of each person (age, hair, clothes) and where the story happens. It is added to every
                picture so people look the same in every scene. The Story Editor fills this in from your story.
              </Info>
              <span className="ml-auto text-xs text-muted">Edit ▾</span>
            </summary>
            <textarea value={characters} onChange={(e) => setCharacters(e.target.value)} rows={4} className="input mt-3 text-sm" aria-label="Characters" />
            <input value={setting} onChange={(e) => setSetting(e.target.value)} className="input mt-2 text-sm" aria-label="Place" />
          </details>
        </div>

        {/* Scenes of the open part (or manual scenes) */}
        {(mode === "manual" || activePart !== null) && (
          <div className="mt-6 border-t border-line pt-5">
            <div className="label">
              {mode === "story" && activePart !== null ? `Scenes of Part ${activePart + 1}` : "Scenes"} · {scenes.length} · about{" "}
              {(scenes.reduce((a, x) => a + estimateSeconds(x.narration), 0) / 60).toFixed(1)} min
              <Info title="Scenes">
                Each scene is one picture plus its narration. Check the wording, fix anything you like, add or remove scenes. Changes are
                saved with the story.
              </Info>
            </div>
            <div className="space-y-3">
              {scenes.map((s, i) => (
                <div key={i} className="rounded-2xl border border-line bg-bg/40 p-3.5" style={{ borderLeft: `4px solid ${SCENE_COLORS[i % SCENE_COLORS.length]}` }}>
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold">Scene {i + 1}</span>
                    <div className="flex items-center gap-1">
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
                        <b>🖼 Picture</b>: one still picture with a slow zoom and pan. A few cents, always in sync with the voice.
                        <br />
                        <b>🎬 AI video</b>: the picture becomes a short moving clip. Livelier, but about $0.10–0.20 per scene and 1–5 minutes to
                        make.
                      </Info>
                      {scenes.length > 1 && (
                        <button onClick={() => removeScene(i)} aria-label={`Remove scene ${i + 1}`} className="ml-1 rounded-full px-2 py-1 text-muted hover:text-bad">
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                  <label className="label !text-xs !font-semibold text-muted" htmlFor={`n${i}`}>
                    🗣 Narrator says
                    <Info title="Narrator says">
                      The exact Bangla words the voice reads. English tags like [sad] or [whispers] guide the feeling; they are not spoken or
                      shown.
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
                      What is in the picture, in English: who, doing what, where, time of day and camera (wide or close-up).
                    </Info>
                  </label>
                  <textarea
                    id={`p${i}`}
                    value={s.prompt}
                    onChange={(e) => update(i, { prompt: e.target.value, imageUrl: undefined, video: undefined })}
                    rows={2}
                    className="input text-sm"
                  />
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="label !mb-1 !text-xs !font-semibold text-muted">
                        💬 Speaker
                        <Info title="Speaker">
                          If this line is a character talking (dialogue), write their name. The words then appear in a speech bubble
                          instead of the bottom subtitle. Leave empty for the narrator.
                        </Info>
                      </span>
                      <input value={s.speaker ?? ""} onChange={(e) => update(i, { speaker: e.target.value })} placeholder="Narrator" className="input bangla !py-2 text-sm" />
                    </label>
                    <label className="block">
                      <span className="label !mb-1 !text-xs !font-semibold text-muted">
                        🏷 Top tag
                        <Info title="Top tag">
                          A short label at the top of the screen for a time or place jump, like “৩ মাস পর • বৃষ্টির দুপুর”. Leave empty
                          for none.
                        </Info>
                      </span>
                      <input value={s.titleTag ?? ""} onChange={(e) => update(i, { titleTag: e.target.value })} placeholder="None" className="input bangla !py-2 text-sm" />
                    </label>
                  </div>
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
            <button onClick={addScene} className="btn-secondary mt-3 w-full">
              ＋ Add a scene
            </button>
          </div>
        )}
      </Step>

      {/* STEP 2 */}
      <Step
        id="voice"
        n={2}
        title="Make the voice"
        what="Reads every scene aloud in Bangla. The length of each line decides how long its picture stays on screen."
        meta={`About ${Math.max(1, Math.round(scenes.length * 3 / 60))} min for ${scenes.length} scenes · about $0.01–0.05`}
        done={audioReady}
        locked={!storyReady ? (mode === "story" ? "Plan your story and open a part in step 1 first." : "Fill in every scene in step 1 first.") : undefined}
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
              <a href={output.url} download={`golpo-${activePart !== null ? `part-${activePart + 1}` : "video"}.${output.ext}`} className="btn-primary">
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
