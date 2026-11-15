/**
 * Types for OpenRouter's text-to-speech surface.
 *
 * Verified against OpenRouter docs (Nov 2026):
 *  - POST /api/v1/audio/speech  (OpenAI-compatible, returns raw audio bytes)
 *  - GET  /api/v1/models?output_modalities=speech  (public model list, `supported_voices`)
 *  - GET  /api/v1/generation?id=...  (usage metadata incl. `total_cost`)
 */

/** Formats accepted by OpenRouter's `response_format` enum. `wav` is NOT in the enum. */
export type UpstreamAudioFormat = "mp3" | "pcm";

/** What the tester asks for. `auto` = try mp3, fall back to pcm (wrapped as WAV). */
export type RequestedFormat = "auto" | UpstreamAudioFormat;

export interface SpeechRequest {
  model: string;
  input: string;
  voice?: string;
  response_format: UpstreamAudioFormat;
  /** Delivery guidance. Honoured by OpenAI gpt-4o-mini-tts, Gemini TTS and Fish Audio only. */
  instructions?: string;
  provider?: {
    /** Provider-specific passthrough, keyed by provider slug (e.g. `elevenlabs`). */
    options?: Record<string, Record<string, unknown>>;
  };
}

export interface SpeechResult {
  audio: Uint8Array;
  /** Content-Type returned by OpenRouter, e.g. `audio/mpeg` or `audio/pcm`. */
  contentType: string;
  /** Format actually returned by upstream. */
  format: UpstreamAudioFormat;
  generationId: string | null;
  /** Wall-clock ms from request start until the full body was received. */
  elapsedMs: number;
  /** True when the first attempt (mp3) was rejected and we retried with pcm. */
  fellBackToPcm: boolean;
}

export interface SpeechModel {
  id: string;
  name: string;
  description: string;
  voices: string[];
  /** Raw non-zero pricing entries as reported by the Models API (USD per unit). */
  pricing: Record<string, string>;
  /** True when the provider's own documentation lists Bengali for this model family. */
  bengaliDocumented: boolean;
}

export interface GenerationStats {
  id: string;
  model: string | null;
  providerName: string | null;
  totalCostUsd: number | null;
  latencyMs: number | null;
  generationTimeMs: number | null;
}
