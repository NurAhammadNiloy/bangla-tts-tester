# Bangla TTS Tester (Phase 0)

A small Next.js app that tests **Bengali text-to-speech through OpenRouter** with your own API key.
It is Part 1 of the AI Story-to-Video platform: we prove Bengali narration works before building anything else.

---

## 1. API compatibility findings (verified Nov 15, 2026)

| Question | Finding | Source |
|---|---|---|
| Does OpenRouter do TTS? | **Yes.** Dedicated `POST https://openrouter.ai/api/v1/audio/speech`, OpenAI-compatible, returns raw audio bytes (not JSON). | OpenRouter TTS guide |
| Request body | `model`, `input` (required); `voice`, `response_format`, `speed`, `instructions`, `input_references`, `provider` (optional). | OpenRouter API reference |
| Output formats | `response_format` accepts only **`mp3` or `pcm`** (default `pcm`, 16-bit LE). `wav` is not accepted. Gemini TTS and HeyGen are documented as pcm-only in the guide. | OpenRouter TTS guide |
| Finding models | `GET /api/v1/models?output_modalities=speech` (public, no key). Voices are in `supported_voices`. | OpenRouter TTS guide |
| Is ElevenLabs available? | **Yes.** 9 TTS models, e.g. `elevenlabs/eleven-v3`, `elevenlabs/eleven-v4`, `elevenlabs/eleven-multilingual-v2`, `elevenlabs/eleven-flash-v2.5`. 21 premade voices by name (george, sarah, …). Cloned voices need ElevenLabs BYOK. | OpenRouter "ElevenLabs is now on OpenRouter" |
| Bengali support | **ElevenLabs Eleven v3: yes** ("BEN Bengali" in ElevenLabs' 74-language list). **Gemini TTS: yes** ("Bangla (Bangladesh) bn-BD", GA, in Google's Gemini-TTS table). Other models: not documented, so test them. | ElevenLabs language list; Google Cloud Gemini-TTS docs |
| Price | Eleven v3: **$80 per 1M characters** on OpenRouter (≈ $0.008 for the 104-char default text). Gemini 3.1 Flash TTS: $1/M input tokens + $20/M output tokens. Most TTS is per character; billing counts Unicode code points. | OpenRouter model pages |
| Actual cost per request | Response header `X-Generation-Id`, then `GET /api/v1/generation?id=…` returns `total_cost` (USD). Stats can lag a few seconds. | OpenRouter generations API |
| Limits | Eleven v3: 5,000 chars/request. Eleven v4/Multilingual v2: 10,000. Failed generations (502) are not billed. | OpenRouter |

**Known risks to check when you listen:**
- ElevenLabs' default voices are English-trained and may carry an accent into Bengali. A Bengali voice from the ElevenLabs voice library may sound better.
- Google's forum has user reports of "No audio generated" for Bangla on Gemini 2.5 Pro TTS in AI Studio. Our test will show whether Gemini 3.1 TTS on OpenRouter has the same problem.
- Bangladeshi vs. Indian (Kolkata) pronunciation is the real test. Rate it in the app.

**Could not verify from here:** the build environment cannot reach `openrouter.ai`, so no real audio was generated yet. All code paths were tested against a mock server that mimics the documented API. **The live test runs on your machine** (step 5 below).

## 2. Recommended implementation

- The browser never calls OpenRouter directly. It sends the key in an `x-openrouter-key` header to our own route handler, which makes one call to OpenRouter and forgets the key.
- The model list comes **live** from OpenRouter. No model ID is hard-coded. Models whose provider docs list Bengali are only *labelled* and sorted first.
- "Auto" format asks for MP3. If the model rejects it (400), it retries once with PCM and wraps it as a playable WAV (24 kHz mono by default; adjustable).
- After generation the app polls the generations API to show the **real billed cost**.
- A results log records everything the plan asks for (model, provider, endpoint, quality, time, cost, format, pronunciation) and exports to CSV/JSON.

## 3. Project structure

```
src/
  app/
    page.tsx                  → renders the tester
    api/models/route.ts       → GET live speech models (public, cached 10 min)
    api/tts/route.ts          → POST generate speech (key in header, rate-limited)
    api/generation/route.ts   → GET billed cost for a generation id
  components/TtsTester.tsx    → the whole UI (client component)
  lib/
    openrouter/client.ts      → provider adapter: listSpeechModels, synthesize, getGeneration
    openrouter/errors.ts      → error hints + key redaction
    openrouter/types.ts
    audio/wav.ts              → PCM16 → WAV wrapper
    bengali.ts                → default text, Bengali-documented labels, char counting
    validation.ts             → input + key validation
    rateLimit.ts              → in-memory limiter (20 TTS req/min per client)
    report.ts                 → CSV/JSON export
scripts/smoke-tts.mjs         → CLI live test with your key
tests/                        → 38 unit + route tests (vitest)
```

## 4. Setup

Requirements: **Node.js 20.9+** (22 recommended).

```bash
npm install
npm run dev
```

Open http://localhost:3000, paste your OpenRouter key, keep the default Bengali sentence, and click **Generate Voice**.

No `.env` file is needed. The key is typed into the page. Golpo Studio keeps it in this browser's local storage so you do not retype it (any script running on the page could read it, so only use it on a device you trust; use **Settings → Forget key** to remove it). The server never stores the key; it only passes it to OpenRouter for each request.

## 5. Testing procedure

**Automated tests (no key, no cost):**
```bash
npm test          # 38 tests: adapter, routes, WAV, redaction, validation, CSV
npm run typecheck
npm run lint
```

**Live feasibility test (uses your credits, about $0.01 per run):**

1. Create a test key at https://openrouter.ai/settings/keys with a **$1 credit limit**.
2. List what is available right now (free, no key):
   ```bash
   npm run smoke -- --list
   ```
3. Generate the default sentence with every Bengali-documented model:
   ```powershell
   # Windows PowerShell
   $env:OPENROUTER_API_KEY="sk-or-v1-..."; npm run smoke
   ```
   ```bash
   # macOS / Linux
   OPENROUTER_API_KEY=sk-or-v1-... npm run smoke
   ```
   Audio files and `report.json` go to `./smoke-output/`. Test other models with `--models elevenlabs/eleven-v4,openai/gpt-4o-mini-tts-2025-12-15`.
4. In the web app, try each model with 2–3 voices. For ElevenLabs, also try the "Send language_code: bn" option. Rate quality and pronunciation, then **Export CSV**.
5. Success = at least one model scores **4/5 or more on Bengali pronunciation** with natural Bangladeshi delivery.

## 6. Security

- The key exists only in React state. It is never in localStorage, sessionStorage, cookies, URLs, logs or files. A reload forgets it.
- The server reads it from a header, uses it for one request, and redacts it from any error text (tested).
- The OpenRouter base URL is server-side only (`OPENROUTER_BASE_URL`, for tests). Users cannot redirect requests.
- Input is validated: model ID pattern, 5,000-char limit, voice charset, whitelisted formats and sample rates.
- Security headers: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`; `X-Powered-By` removed.
- Deploy only over HTTPS (Vercel does this by default). The rate limiter is in-memory, fine for one instance. Phase 7 moves it to Redis.

## 7. What comes next

When a model passes, record it as the default narrator, then start **Phase 1 (story processing)**: story input, LLM analysis to structured JSON, and scene planning. The `lib/openrouter` adapter is designed to be reused there.
