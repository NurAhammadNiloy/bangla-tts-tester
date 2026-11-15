"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Info from "@/components/Info";
import { bengaliRatio, codePointLength, DEFAULT_BENGALI_TEXT, SAMPLE_STORY } from "@/lib/bengali";
import type { GenerationStats, RequestedFormat, SpeechModel } from "@/lib/openrouter/types";
import { MAX_INPUT_CHARS } from "@/lib/validation";
import {
  countTags,
  GEMINI_MAX_BYTES,
  insertTag,
  pickDefaultSpeechModel,
  presetVoice,
  STYLE_PRESETS,
  tagFamilyFor,
  tagsFor,
  utf8Bytes,
} from "@/lib/voiceDirector";
import { type Gender, groupVoices, voiceLabel } from "@/lib/voices";
import { downloadText, formatBytes, formatUsd, toCsv, type TestRecord } from "@/lib/report";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

interface Generated {
  url: string;
  blob: Blob;
  ext: "mp3" | "wav";
  model: string;
  voice: string;
  generationId: string | null;
  elapsedMs: number;
  fellBack: boolean;
  upstreamContentType: string;
  chars: number;
  durationSec: number | null;
  stats: GenerationStats | null;
  costState: "pending" | "done" | "unavailable";
}

const CUSTOM_VOICE = "__custom__";

function pickDefaultModel(list: SpeechModel[]): string {
  return pickDefaultSpeechModel(list.map((m) => m.id));
}

async function requestModels(): Promise<SpeechModel[]> {
  const res = await fetch("/api/models");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Failed to load models.");
  return json.models as SpeechModel[];
}

export default function TtsTester() {
  // The key lives only in this component's memory. It is never written to
  // localStorage/sessionStorage/cookies and disappears on reload.
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const [models, setModels] = useState<SpeechModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelId, setModelId] = useState("");
  const [rawVoiceChoice, setRawVoiceChoice] = useState("");
  const [customVoice, setCustomVoice] = useState("");

  const [text, setText] = useState(DEFAULT_BENGALI_TEXT);
  const [format, setFormat] = useState<RequestedFormat>("auto");
  const [instructions, setInstructions] = useState(STYLE_PRESETS[0].instructions);
  const [presetId, setPresetId] = useState(STYLE_PRESETS[0].id);
  const [gender, setGender] = useState<Gender>("female");
  const [showNote, setShowNote] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [preTagText, setPreTagText] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const [forceBn, setForceBn] = useState(false);
  const [sampleRate, setSampleRate] = useState(24000);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [result, setResult] = useState<Generated | null>(null);
  const [quality, setQuality] = useState(0);
  const [pronunciation, setPronunciation] = useState(0);
  const [notes, setNotes] = useState("");
  const [log, setLog] = useState<TestRecord[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const applyModels = useCallback((list: SpeechModel[]) => {
    setModels(list);
    setModelsError(null);
    setModelsLoading(false);
    setModelId((cur) => (cur && list.some((m) => m.id === cur) ? cur : pickDefaultModel(list)));
  }, []);
  const applyModelsError = useCallback((e: unknown) => {
    setModelsError(e instanceof Error ? e.message : "Failed to load models.");
    setModelsLoading(false);
  }, []);

  useEffect(() => {
    requestModels().then(applyModels, applyModelsError);
  }, [applyModels, applyModelsError]);

  const loadModels = () => {
    setModelsLoading(true);
    setModelsError(null);
    requestModels().then(applyModels, applyModelsError);
  };

  const model = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);

  // A stale choice from another model falls back to this model's first voice.
  const voiceChoice =
    rawVoiceChoice && (rawVoiceChoice === CUSTOM_VOICE || model?.voices.includes(rawVoiceChoice))
      ? rawVoiceChoice
      : (presetVoiceFor(model) ?? model?.voices[0] ?? CUSTOM_VOICE);
  const setVoiceChoice = setRawVoiceChoice;

  function presetVoiceFor(m: SpeechModel | undefined): string | undefined {
    const p = STYLE_PRESETS.find((x) => x.id === presetId);
    if (!m || !p) return undefined;
    const v = presetVoice(p, tagFamilyFor(m.id), gender);
    return v && m.voices.includes(v) ? v : undefined;
  }

  // Free the previous audio blob URL.
  useEffect(() => {
    return () => {
      if (result?.url) URL.revokeObjectURL(result.url);
    };
  }, [result?.url]);

  const voice = voiceChoice === CUSTOM_VOICE ? customVoice.trim() : voiceChoice;
  const chars = codePointLength(text.trim());
  const ratio = bengaliRatio(text);
  const isEleven = modelId.startsWith("elevenlabs/");
  const supportsInstructions = /^(openai\/|google\/|fishaudio\/|fish-audio\/)/.test(modelId);
  const busy = status.kind === "loading";
  const tagFamily = tagFamilyFor(modelId);
  const bytes = utf8Bytes(text.trim());
  const overLimit = tagFamily === "gemini" ? bytes > GEMINI_MAX_BYTES : chars > MAX_INPUT_CHARS;

  function pickVoice(p: (typeof STYLE_PRESETS)[number], g: Gender) {
    const wanted = presetVoice(p, tagFamily, g);
    if (wanted && model?.voices.includes(wanted)) {
      setVoiceChoice(wanted);
      return;
    }
    // Model without a preset voice: take the first labelled voice of that gender.
    const first = model ? groupVoices(model.id, model.voices)[g][0] : undefined;
    if (first) setVoiceChoice(first);
  }

  function applyPreset(id: string) {
    const p = STYLE_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setInstructions(p.instructions);
    pickVoice(p, gender);
  }

  function applyGender(g: Gender) {
    setGender(g);
    const p = STYLE_PRESETS.find((x) => x.id === presetId);
    if (p) pickVoice(p, g);
  }

  function addTag(tag: string) {
    const el = textRef.current;
    const cursor = el ? el.selectionStart : text.length;
    const r = insertTag(text, cursor, tag);
    setText(r.text);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(r.cursor, r.cursor);
    });
  }

  async function autoTag() {
    if (!apiKey.trim()) return setStatus({ kind: "error", message: "Enter your OpenRouter API key first." });
    setTagging(true);
    setStatus({ kind: "loading", message: "AI is reading the story and adding emotion tags…" });
    try {
      const res = await fetch("/api/autotag", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-openrouter-key": apiKey.trim() },
        body: JSON.stringify({ text, ttsModel: modelId, presetId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Auto-tag failed (HTTP ${res.status}).`);
      setPreTagText(text);
      setText(json.text);
      setStatus({ kind: "success", message: `Added ${json.tags} tag(s) using ${json.helperModel}. Check them, then Generate Voice.` });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "Auto-tag failed." });
    } finally {
      setTagging(false);
    }
  }

  function undoTags() {
    if (preTagText !== null) setText(preTagText);
    setPreTagText(null);
  }

  const pollCost = useCallback(async (generationId: string, key: string) => {
    const delays = [1000, 2000, 3000, 5000, 8000];
    for (const d of delays) {
      await new Promise((r) => setTimeout(r, d));
      try {
        const res = await fetch(`/api/generation?id=${encodeURIComponent(generationId)}`, {
          headers: { "x-openrouter-key": key },
        });
        if (res.status === 202) continue;
        if (!res.ok) break;
        const stats = (await res.json()) as GenerationStats;
        setResult((r) =>
          r && r.generationId === generationId
            ? { ...r, stats, costState: stats.totalCostUsd === null ? "pending" : "done" }
            : r,
        );
        if (stats.totalCostUsd !== null) return;
      } catch {
        break;
      }
    }
    setResult((r) => (r && r.generationId === generationId && r.costState !== "done" ? { ...r, costState: "unavailable" } : r));
  }, [setResult]);

  async function generate() {
    if (!apiKey.trim()) return setStatus({ kind: "error", message: "Enter your OpenRouter API key first." });
    if (!modelId) return setStatus({ kind: "error", message: "Choose a model." });
    if (!chars) return setStatus({ kind: "error", message: "Enter some Bengali text." });
    if (overLimit) return setStatus({ kind: "error", message: tagFamily === "gemini" ? "Text is over Gemini's 4,000-byte limit. Shorten it." : `Keep the text under ${MAX_INPUT_CHARS} characters.` });

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus({ kind: "loading", message: "Generating voice…" });
    setQuality(0);
    setPronunciation(0);
    setNotes("");

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json", "x-openrouter-key": apiKey.trim() },
        body: JSON.stringify({
          model: modelId,
          text,
          voice: voice || undefined,
          format,
          instructions: supportsInstructions ? instructions : undefined,
          elevenLabsLanguageCode: isEleven && forceBn ? "bn" : undefined,
          sampleRate,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Request failed (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const ext = res.headers.get("x-audio-format") === "wav" ? "wav" : "mp3";
      const generationId = res.headers.get("x-generation-id");
      const gen: Generated = {
        url: URL.createObjectURL(blob),
        blob,
        ext,
        model: modelId,
        voice: voice || "(default)",
        generationId,
        elapsedMs: Number(res.headers.get("x-elapsed-ms") ?? 0),
        fellBack: res.headers.get("x-fell-back-to-pcm") === "true",
        upstreamContentType: res.headers.get("x-upstream-content-type") ?? "",
        chars,
        durationSec: null,
        stats: null,
        costState: generationId ? "pending" : "unavailable",
      };
      setResult(gen);
      setStatus({ kind: "success", message: "Voice generated. Listen, then rate it below." });
      if (generationId) pollCost(generationId, apiKey.trim());
    } catch (e) {
      if ((e as Error).name === "AbortError") return setStatus({ kind: "idle" });
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "Generation failed." });
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setStatus({ kind: "idle" });
  }

  function download() {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `bangla-tts-${result.model.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}.${result.ext}`;
    a.click();
  }

  // Mobile: hand the file to the OS share sheet (Save to Files, WhatsApp, Drive…).
  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    !!result &&
    navigator.canShare({ files: [new File([result.blob], `voice.${result.ext}`, { type: result.blob.type })] });

  async function share() {
    if (!result) return;
    const file = new File([result.blob], `bangla-tts-${Date.now()}.${result.ext}`, { type: result.blob.type });
    try {
      await navigator.share({ files: [file], title: "Bangla TTS test" });
    } catch (e) {
      if ((e as Error).name !== "AbortError") download();
    }
  }

  function saveToLog() {
    if (!result) return;
    setLog((l) => [
      ...l,
      {
        time: new Date().toISOString(),
        model: result.model,
        provider: result.stats?.providerName ?? result.model.split("/")[0],
        endpoint: "POST https://openrouter.ai/api/v1/audio/speech",
        voice: result.voice,
        outputFormat: result.ext.toUpperCase() + (result.fellBack ? " (PCM→WAV)" : ""),
        characters: result.chars,
        audioSeconds: result.durationSec,
        sizeBytes: result.blob.size,
        generationMs: result.elapsedMs,
        costUsd: result.stats?.totalCostUsd ?? null,
        audioQuality: quality || null,
        pronunciation: pronunciation || null,
        notes,
        generationId: result.generationId,
      },
    ]);
    setStatus({ kind: "success", message: "Saved to the results log." });
  }

  const bengaliModels = models.filter((m) => m.bengaliDocumented);
  const otherModels = models.filter((m) => !m.bengaliDocumented);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">🔊 Voice Lab</h1>
        <p className="mt-1.5 text-muted">
          Try Bangla voices, moods and emotion tags on one piece of text before making a video. Optional: the Video Maker
          already uses the best settings.
        </p>
        <ol className="mt-3 grid gap-1.5 text-sm text-muted sm:grid-cols-3">
          <li className="rounded-xl border border-line bg-surface px-3 py-2">① Paste your key</li>
          <li className="rounded-xl border border-line bg-surface px-3 py-2">② Pick a mood and voice</li>
          <li className="rounded-xl border border-line bg-surface px-3 py-2">③ Generate, listen, rate</li>
        </ol>
      </header>

      {/* 1. API key */}
      <Section step="1" title="OpenRouter API key" info="Your personal password for the AI voice service. Get one at openrouter.ai → Keys. It stays only in this browser tab and is forgotten when you reload. Each voice you generate is charged to your OpenRouter balance.">
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
          {apiKey && (
            <button type="button" onClick={() => setApiKey("")} className="btn-secondary">
              Clear
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          Kept only in this page&apos;s memory. It is sent over HTTPS to this app&apos;s server, used for one
          request to OpenRouter, and never stored or logged. Reloading the page forgets it. Get a key at{" "}
          <a className="underline" href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
            openrouter.ai/settings/keys
          </a>
          . Tip: create a separate key with a small credit limit for testing.
        </p>
      </Section>

      {/* 2. Model and voice */}
      <Section step="2" title="Model and voice" info="The model is the AI engine that speaks; the voice is the person you hear. Models marked ‘Bengali in provider docs’ officially support Bangla. Use ♀/♂ to switch between female and male voices.">
        {modelsLoading ? (
          <p className="text-sm text-muted">Loading live model list from OpenRouter…</p>
        ) : modelsError ? (
          <div className="rounded-lg border border-bad/60 bg-bad/15 p-3 text-sm text-bad">
            {modelsError}{" "}
            <button onClick={loadModels} className="font-semibold underline">
              Retry
            </button>
          </div>
        ) : models.length === 0 ? (
          <p className="text-sm text-muted">OpenRouter returned no speech models.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">Model ({models.length} available)</span>
              <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="input">
                {bengaliModels.length > 0 && (
                  <optgroup label="Bengali listed in provider docs">
                    {bengaliModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Other speech models (Bengali untested)">
                  {otherModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="block">
              <span className="label">Voice</span>
              <div className="mb-2 flex gap-1.5" role="radiogroup" aria-label="Narrator gender">
                {(["female", "male"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={gender === g}
                    onClick={() => applyGender(g)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                      gender === g
                        ? "chip-on"
                        : "chip-off"
                    }`}
                  >
                    {g === "female" ? "♀ Female" : "♂ Male"}
                  </button>
                ))}
              </div>
              <select value={voiceChoice} onChange={(e) => setVoiceChoice(e.target.value)} className="input">
                {model &&
                  (() => {
                    const groups = groupVoices(model.id, model.voices);
                    const order: { key: keyof typeof groups; label: string }[] =
                      gender === "male"
                        ? [{ key: "male", label: "Male voices" }, { key: "female", label: "Female voices" }, { key: "other", label: "Other voices" }]
                        : [{ key: "female", label: "Female voices" }, { key: "male", label: "Male voices" }, { key: "other", label: "Other voices" }];
                    return order
                      .filter((o) => groups[o.key].length > 0)
                      .map((o) => (
                        <optgroup key={o.key} label={o.label}>
                          {groups[o.key].map((v) => (
                            <option key={v} value={v}>
                              {voiceLabel(model.id, v)}
                            </option>
                          ))}
                        </optgroup>
                      ));
                  })()}
                <option value={CUSTOM_VOICE}>Custom voice ID…</option>
              </select>
              {voiceChoice === CUSTOM_VOICE && (
                <input
                  value={customVoice}
                  onChange={(e) => setCustomVoice(e.target.value)}
                  placeholder={isEleven ? "e.g. george, or an ElevenLabs voice ID" : "Voice ID (blank = provider default)"}
                  className="input mt-2"
                />
              )}
            </label>
            {model && (
              <div className="sm:col-span-2 rounded-lg bg-surface-2 p-3 text-xs text-muted">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <code className="font-mono text-ink">{model.id}</code>
                  {model.bengaliDocumented ? (
                    <span className="rounded-full bg-ok/15 px-2 py-0.5 font-semibold text-ok">
                      Bengali in provider docs
                    </span>
                  ) : (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 font-semibold text-accent-strong">
                      Bengali untested
                    </span>
                  )}
                </div>
                <PricingLine pricing={model.pricing} />
                {model.description && <p className="mt-1 line-clamp-3">{model.description}</p>}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          className="mt-4 text-sm font-medium text-accent-strong hover:underline"
        >
          {showAdvanced ? "▾ Hide advanced options" : "▸ Advanced options"}
        </button>
        {showAdvanced && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">Output format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as RequestedFormat)} className="input">
                <option value="auto">Auto (MP3, fall back to WAV)</option>
                <option value="mp3">MP3 only</option>
                <option value="pcm">PCM → WAV</option>
              </select>
            </label>
            <label className="block">
              <span className="label">PCM sample rate (WAV only)</span>
              <select value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))} className="input">
                {[16000, 22050, 24000, 44100, 48000].map((r) => (
                  <option key={r} value={r}>
                    {r} Hz{r === 24000 ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {isEleven && (
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={forceBn} onChange={(e) => setForceBn(e.target.checked)} className="mt-1" />
                <span>
                  Send <code className="font-mono">language_code: &quot;bn&quot;</code> to ElevenLabs. Can help
                  pronunciation; some ElevenLabs models reject it with a 400 error.
                </span>
              </label>
            )}
          </div>
        )}
      </Section>

      {/* 3. Story style */}
      <Section step="3" title="Story style" info="The mood of the reading. Each style gives the narrator directions: Bangladeshi Dhaka accent, a character, a scene and a feeling, so the same text can sound sad, scary or funny.">
        <p className="mb-3 text-sm text-muted">
          Pick the mood. This sets a director&apos;s note (Bangladeshi accent, character, scene) and a matching voice.
        </p>
        <div className="flex flex-wrap gap-2">
          {STYLE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              aria-pressed={presetId === p.id}
              className={`rounded-full border px-3.5 py-2 text-sm font-medium transition ${
                presetId === p.id
                  ? "chip-on"
                  : "chip-off"
              }`}
            >
              {p.emoji} {p.label}
            </button>
          ))}
        </div>
        {supportsInstructions ? (
          <details className="mt-4" open={showNote} onToggle={(e) => setShowNote(e.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-medium text-accent-strong">
              Director&apos;s note {instructions ? "(set)" : "(empty)"}: edit how it should sound
            </summary>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={6}
              placeholder="Describe the narrator, the scene, the accent and the emotion…"
              className="input mt-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted">
              Write in English. Avoid words like &quot;quiet&quot;, &quot;flat&quot; or &quot;careful&quot;: they make the voice dull.
            </p>
          </details>
        ) : (
          <p className="mt-3 text-xs text-muted">
            {tagFamily === "elevenlabs"
              ? "ElevenLabs ignores director's notes, so emotion comes from the tags in your text (step 4). For the strongest emotion in Bangla, try a Gemini TTS model."
              : "This model doesn't support director's notes or emotion tags. For emotional Bangla, choose a Gemini TTS model."}
          </p>
        )}
      </Section>

      {/* 4. Text */}
      <Section step="4" title="Bengali text" info="The words that will be spoken. Add English tags like [sad], [whispers] or [long pause] where the feeling changes; they guide the voice and are not read aloud.">
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          lang="bn"
          className="input bangla text-lg leading-relaxed"
        />
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
          <span className={overLimit ? "font-semibold text-bad" : ""}>
            {tagFamily === "gemini"
              ? `${bytes.toLocaleString()} / ${GEMINI_MAX_BYTES.toLocaleString()} bytes (Gemini limit ≈ 1,300 Bengali letters)`
              : `${chars.toLocaleString()} / ${MAX_INPUT_CHARS.toLocaleString()} characters`}
          </span>
          {chars > 0 && ratio < 0.6 && (
            <span className="text-accent-strong">Text is mostly non-Bengali script.</span>
          )}
          <span className="flex gap-3">
            <button onClick={() => setText(SAMPLE_STORY)} className="underline">
              Emotional sample
            </button>
            <button onClick={() => setText(DEFAULT_BENGALI_TEXT)} className="underline">
              Reset text
            </button>
          </span>
        </div>

        {tagFamily !== "none" && (
          <div className="mt-4 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center text-sm font-semibold">
                Emotion tags
                <Info title="Emotion tags">
                  Small directions for the voice, written in English inside [brackets]. Put the cursor where the feeling changes and tap
                  a tag. Yellow tags change the feeling, grey ones change the pace or add sounds like a sigh. “Auto-add” lets AI place
                  them for you without changing your words.
                </Info>
              </span>
              <button
                type="button"
                onClick={autoTag}
                disabled={tagging || !chars}
                className="btn-primary"
              >
                {tagging ? "Adding tags…" : "✨ Auto-add tags with AI"}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              Tap where the feeling changes in the text, then tap a tag. Tags stay in English, even in a Bangla story.
              {countTags(text) > 0 && ` ${countTags(text)} tag(s) in text.`}
            </p>
            {(["emotion", "delivery"] as const).map((group) => (
              <div key={group} className="mt-2 flex flex-wrap gap-1.5">
                {tagsFor(tagFamily)[group].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addTag(t)}
                    className={`rounded-md border px-2 py-1 font-mono text-xs transition hover:border-accent ${
                      group === "emotion"
                        ? "border-accent/50 bg-accent/10"
                        : "border-line bg-surface-2"
                    }`}
                  >
                    [{t}]
                  </button>
                ))}
              </div>
            ))}
            {preTagText !== null && (
              <button type="button" onClick={undoTags} className="mt-2 text-xs underline">
                Undo auto-tags
              </button>
            )}
          </div>
        )}
      </Section>

      {/* Generate */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={generate}
          disabled={busy || modelsLoading || !!modelsError}
          className="flex-1 btn-primary !py-3.5 !text-lg"
        >
          {busy ? "Generating…" : "Generate Voice"}
        </button>
        {busy && (
          <button onClick={cancel} className="btn-secondary py-3.5">
            Cancel
          </button>
        )}
      </div>

      {status.kind !== "idle" && (
        <div
          role="status"
          className={`mb-6 rounded-lg border p-3 text-sm ${
            status.kind === "error"
              ? "border-bad/60 bg-bad/15 text-bad"
              : status.kind === "loading"
                ? "border-line bg-surface-2 text-ink"
                : "border-ok/60 bg-ok/15 text-ok"
          }`}
        >
          {status.message}
        </div>
      )}

      {/* 4. Result */}
      {result && (
        <Section step="5" title="Result" info="Listen to the voice, download it, and rate how good it sounds. Ratings go into the results log so you can compare models later.">
          <audio
            key={result.url}
            controls
            src={result.url}
            className="w-full"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d)) setResult((r) => (r ? { ...r, durationSec: d } : r));
            }}
          />
          <div className="mt-3 flex gap-2">
            <button onClick={download} className="btn-secondary">
              ⬇ Download .{result.ext}
            </button>
            {canShareFiles && (
              <button onClick={share} className="btn-secondary">
                Share / Save to phone
              </button>
            )}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Metric label="Model" value={result.model} mono />
            <Metric label="Provider" value={result.stats?.providerName ?? "…"} />
            <Metric label="Voice" value={result.voice} />
            <Metric label="Output" value={`${result.ext.toUpperCase()}${result.fellBack ? " (MP3 rejected → PCM)" : ""}`} />
            <Metric label="Size" value={formatBytes(result.blob.size)} />
            <Metric label="Audio length" value={result.durationSec ? `${result.durationSec.toFixed(1)} s` : "…"} />
            <Metric label="Generation time" value={`${(result.elapsedMs / 1000).toFixed(2)} s`} />
            <Metric label="Characters billed" value={result.chars.toLocaleString()} />
            <Metric
              label="Actual cost"
              value={
                result.costState === "done"
                  ? formatUsd(result.stats?.totalCostUsd ?? null)
                  : result.costState === "pending"
                    ? "Fetching…"
                    : "Not reported. Check OpenRouter Activity"
              }
            />
          </dl>
          {result.generationId && (
            <p className="mt-2 break-all text-xs text-muted">
              Generation ID: <code className="font-mono">{result.generationId}</code>
            </p>
          )}

          <div className="mt-6 border-t border-line pt-4">
            <h3 className="font-semibold">Rate this result</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Stars label="Audio quality" value={quality} onChange={setQuality} />
              <Stars label="Bengali pronunciation" value={pronunciation} onChange={setPronunciation} />
            </div>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes, e.g. 'জারভিস' mispronounced, sounds Indian rather than Bangladeshi…"
              className="input mt-3"
            />
            <button onClick={saveToLog} className="mt-3 btn-primary">
              Save to results log
            </button>
          </div>
        </Section>
      )}

      {/* 5. Log */}
      {log.length > 0 && (
        <Section step="6" title={`Results log (${log.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  {["Model", "Voice", "Format", "Time", "Cost", "Quality", "Pronunc."].map((h) => (
                    <th key={h} className="py-1 pr-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-mono">{r.model}</td>
                    <td className="pr-3">{r.voice}</td>
                    <td className="pr-3">{r.outputFormat}</td>
                    <td className="pr-3">{(r.generationMs / 1000).toFixed(1)} s</td>
                    <td className="pr-3">{formatUsd(r.costUsd)}</td>
                    <td className="pr-3">{r.audioQuality ?? "–"}/5</td>
                    <td className="pr-3">{r.pronunciation ?? "–"}/5</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => downloadText("bangla-tts-results.csv", toCsv(log), "text/csv")} className="btn-secondary">
              Export CSV
            </button>
            <button
              onClick={() => downloadText("bangla-tts-results.json", JSON.stringify(log, null, 2), "application/json")}
              className="btn-secondary"
            >
              Export JSON
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">The log stays in this tab only. Export it before closing.</p>
        </Section>
      )}

      <footer className="mt-10 text-center text-xs text-muted">
        You pay OpenRouter directly for every generation. This app adds no charges.
      </footer>
    </div>
  );
}

function Section({ step, title, info, children }: { step: string; title: string; info?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-6 card">
      <h2 className="mb-4 flex items-center gap-3 text-xl font-bold">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-accent font-display text-base font-extrabold text-accent-ink">
          {step}
        </span>
        {title}
        {info && <Info title={title}>{info}</Info>}
      </h2>
      {children}
    </section>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`truncate font-medium ${mono ? "font-mono text-xs leading-5" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

function Stars({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={`h-9 w-9 rounded-lg border text-sm font-semibold transition ${
              n <= value
                ? "chip-on"
                : "chip-off"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function PricingLine({ pricing }: { pricing: Record<string, string> }) {
  const entries = Object.entries(pricing);
  if (entries.length === 0) return <p>Pricing: not listed (may be free). Check the model page.</p>;
  return (
    <p>
      Pricing (from OpenRouter, USD per unit):{" "}
      {entries.map(([k, v]) => (
        <span key={k} className="mr-2 font-mono">
          {k}=${v}
        </span>
      ))}
    </p>
  );
}
