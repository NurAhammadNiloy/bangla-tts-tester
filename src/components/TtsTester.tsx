"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bengaliRatio, codePointLength, DEFAULT_BENGALI_TEXT } from "@/lib/bengali";
import type { GenerationStats, RequestedFormat, SpeechModel } from "@/lib/openrouter/types";
import { MAX_INPUT_CHARS } from "@/lib/validation";
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
  const [instructions, setInstructions] = useState("");
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
    setModelId((cur) => (cur && list.some((m) => m.id === cur) ? cur : list[0]?.id ?? ""));
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
      : (model?.voices[0] ?? CUSTOM_VOICE);
  const setVoiceChoice = setRawVoiceChoice;

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
  }, []);

  async function generate() {
    if (!apiKey.trim()) return setStatus({ kind: "error", message: "Enter your OpenRouter API key first." });
    if (!modelId) return setStatus({ kind: "error", message: "Choose a model." });
    if (!chars) return setStatus({ kind: "error", message: "Enter some Bengali text." });
    if (chars > MAX_INPUT_CHARS) return setStatus({ kind: "error", message: `Keep the text under ${MAX_INPUT_CHARS} characters.` });

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
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700 dark:text-teal-400">
          Phase 0 · Feasibility test
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Bangla TTS Tester</h1>
        <p className="mt-2 text-stone-600 dark:text-stone-400">
          Generate Bengali speech through OpenRouter with your own API key, then record how well each model
          pronounces it.
        </p>
      </header>

      {/* 1. API key */}
      <Section step="1" title="OpenRouter API key">
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
        <p className="mt-2 text-xs text-stone-500">
          Kept only in this page&apos;s memory. It is sent over HTTPS to this app&apos;s server, used for one
          request to OpenRouter, and never stored or logged. Reloading the page forgets it. Get a key at{" "}
          <a className="underline" href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
            openrouter.ai/settings/keys
          </a>
          . Tip: create a separate key with a small credit limit for testing.
        </p>
      </Section>

      {/* 2. Model and voice */}
      <Section step="2" title="Model and voice">
        {modelsLoading ? (
          <p className="text-sm text-stone-500">Loading live model list from OpenRouter…</p>
        ) : modelsError ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {modelsError}{" "}
            <button onClick={loadModels} className="font-semibold underline">
              Retry
            </button>
          </div>
        ) : models.length === 0 ? (
          <p className="text-sm text-stone-500">OpenRouter returned no speech models.</p>
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
              <select value={voiceChoice} onChange={(e) => setVoiceChoice(e.target.value)} className="input">
                {model?.voices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
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
              <div className="sm:col-span-2 rounded-lg bg-stone-100 p-3 text-xs text-stone-600 dark:bg-stone-800/60 dark:text-stone-400">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <code className="font-mono text-stone-800 dark:text-stone-200">{model.id}</code>
                  {model.bengaliDocumented ? (
                    <span className="rounded-full bg-teal-100 px-2 py-0.5 font-semibold text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">
                      Bengali in provider docs
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
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
          className="mt-4 text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
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
            {supportsInstructions && (
              <label className="block sm:col-span-2">
                <span className="label">Delivery instructions (this model supports them)</span>
                <input
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. Speak in warm, natural Bangladeshi Bengali, calm storytelling pace"
                  className="input"
                />
              </label>
            )}
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

      {/* 3. Text */}
      <Section step="3" title="Bengali text">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          lang="bn"
          className="input bangla text-lg leading-relaxed"
        />
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-stone-500">
          <span className={chars > MAX_INPUT_CHARS ? "font-semibold text-red-600" : ""}>
            {chars.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()} characters
          </span>
          {chars > 0 && ratio < 0.6 && (
            <span className="text-amber-700 dark:text-amber-400">Text is mostly non-Bengali script.</span>
          )}
          <button onClick={() => setText(DEFAULT_BENGALI_TEXT)} className="underline">
            Reset to default test text
          </button>
        </div>
      </Section>

      {/* Generate */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={generate}
          disabled={busy || modelsLoading || !!modelsError}
          className="flex-1 rounded-xl bg-teal-700 px-6 py-3.5 text-lg font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
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
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              : status.kind === "loading"
                ? "border-stone-300 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                : "border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200"
          }`}
        >
          {status.message}
        </div>
      )}

      {/* 4. Result */}
      {result && (
        <Section step="4" title="Result">
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
            <p className="mt-2 break-all text-xs text-stone-500">
              Generation ID: <code className="font-mono">{result.generationId}</code>
            </p>
          )}

          <div className="mt-6 border-t border-stone-200 pt-4 dark:border-stone-800">
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
            <button onClick={saveToLog} className="mt-3 rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900">
              Save to results log
            </button>
          </div>
        </Section>
      )}

      {/* 5. Log */}
      {log.length > 0 && (
        <Section step="5" title={`Results log (${log.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-stone-500">
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
                  <tr key={i} className="border-t border-stone-200 dark:border-stone-800">
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
          <p className="mt-2 text-xs text-stone-500">The log stays in this tab only. Export it before closing.</p>
        </Section>
      )}

      <footer className="mt-10 text-center text-xs text-stone-500">
        You pay OpenRouter directly for every generation. This app adds no charges.
      </footer>
    </div>
  );
}

function Section({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-sm text-white">
          {step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-stone-500">{label}</dt>
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
                ? "border-teal-700 bg-teal-700 text-white"
                : "border-stone-300 text-stone-500 hover:border-teal-600 dark:border-stone-700"
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
