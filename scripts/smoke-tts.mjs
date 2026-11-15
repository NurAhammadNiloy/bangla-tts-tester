#!/usr/bin/env node
/**
 * Real-world Bengali TTS feasibility check against OpenRouter.
 *
 *   Windows PowerShell:  $env:OPENROUTER_API_KEY="sk-or-v1-..."; npm run smoke
 *   macOS / Linux:       OPENROUTER_API_KEY=sk-or-v1-... npm run smoke
 *
 * Options:
 *   --models a/b,c/d   test these model IDs (default: every model whose provider docs list Bengali)
 *   --list             only list live speech models with voices and pricing, no generation
 *   --text "..."       override the default Bengali sentence
 *
 * Writes audio + report.json to ./smoke-output. The key is read from the
 * environment only and is never printed or written to disk.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = "https://openrouter.ai/api/v1";
const DEFAULT_TEXT =
  "আসসালামু আলাইকুম। আমার নাম জারভিস। আমি একজন বাংলা এআই সহকারী। আজ আমরা বাংলা ভয়েস জেনারেশন পরীক্ষা করছি।";
const BENGALI_DOCUMENTED = [/^elevenlabs\/eleven-v3/, /^google\/gemini-.*tts/];

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const listOnly = args.includes("--list");
const text = arg("--text") ?? DEFAULT_TEXT;

function voicesOf(m) {
  return (Array.isArray(m.supported_voices) ? m.supported_voices : [])
    .map((v) => (typeof v === "string" ? v : v?.id ?? v?.voice_id ?? v?.name))
    .filter(Boolean);
}

function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  const len = pcm.length - (pcm.length % 2);
  h.write("RIFF", 0); h.writeUInt32LE(36 + len, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36);
  h.writeUInt32LE(len, 40);
  return Buffer.concat([h, pcm.subarray(0, len)]);
}

async function speak(key, model, voice, format) {
  const body = { model, input: text, response_format: format };
  if (voice) body.voice = voice;
  const t0 = performance.now();
  const res = await fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Bangla TTS Tester (smoke)" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf, ms: Math.round(performance.now() - t0) };
}

async function cost(key, id) {
  for (const d of [1500, 3000, 5000, 8000]) {
    await new Promise((r) => setTimeout(r, d));
    const res = await fetch(`${BASE}/generation?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 404) continue;
    if (!res.ok) return null;
    const { data } = await res.json();
    if (typeof data?.total_cost === "number") return { usd: data.total_cost, provider: data.provider_name ?? null };
  }
  return null;
}

async function main() {
  const modelsRes = await fetch(`${BASE}/models?output_modalities=speech`);
  if (!modelsRes.ok) throw new Error(`Models API returned HTTP ${modelsRes.status}`);
  const all = (await modelsRes.json()).data ?? [];
  console.log(`\nOpenRouter lists ${all.length} speech models:\n`);
  for (const m of all) {
    const bn = BENGALI_DOCUMENTED.some((r) => r.test(m.id)) ? " [Bengali in provider docs]" : "";
    const price = Object.entries(m.pricing ?? {}).filter(([, v]) => Number(v) !== 0).map(([k, v]) => `${k}=$${v}`).join(" ");
    console.log(`  ${m.id}${bn}\n     voices: ${voicesOf(m).slice(0, 8).join(", ") || "(none listed)"}${voicesOf(m).length > 8 ? ", …" : ""}\n     pricing: ${price || "(none listed)"}`);
  }
  if (listOnly) return;

  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    console.error("\nSet OPENROUTER_API_KEY to run generation tests (see header of this file).");
    process.exit(1);
  }

  const wanted = arg("--models")?.split(",").map((s) => s.trim()).filter(Boolean);
  const targets = wanted
    ? wanted.map((id) => all.find((m) => m.id === id) ?? { id, supported_voices: [] })
    : all.filter((m) => BENGALI_DOCUMENTED.some((r) => r.test(m.id)));
  if (targets.length === 0) {
    console.error("\nNo target models found. Pass --models explicitly.");
    process.exit(1);
  }

  const outDir = join(process.cwd(), "smoke-output");
  await mkdir(outDir, { recursive: true });
  console.log(`\nGenerating "${text.slice(0, 40)}…" (${[...text].length} chars) with ${targets.length} model(s)…\n`);

  const report = [];
  for (const m of targets) {
    const voice = voicesOf(m)[0];
    let { res, buf, ms } = await speak(key, m.id, voice, "mp3");
    let format = "mp3";
    if (res.status === 400) {
      ({ res, buf, ms } = await speak(key, m.id, voice, "pcm"));
      format = "pcm";
    }
    const row = { model: m.id, voice: voice ?? "(default)", endpoint: `POST ${BASE}/audio/speech`, httpStatus: res.status, generationMs: ms };
    if (!res.ok || /json/.test(res.headers.get("content-type") ?? "")) {
      row.error = buf.toString("utf8").slice(0, 300).replaceAll(key, "[redacted]");
      console.log(`  ✗ ${m.id}: HTTP ${res.status} ${row.error}`);
    } else {
      const file = join(outDir, `${m.id.replace(/[^a-z0-9]+/gi, "_")}.${format === "pcm" ? "wav" : "mp3"}`);
      await writeFile(file, format === "pcm" ? wav(buf) : buf);
      const genId = res.headers.get("x-generation-id");
      const c = genId ? await cost(key, genId) : null;
      Object.assign(row, { outputFormat: format === "pcm" ? "PCM→WAV (24 kHz assumed)" : "MP3", bytes: buf.length, file, generationId: genId, costUsd: c?.usd ?? null, provider: c?.provider ?? null });
      console.log(`  ✓ ${m.id}  ${(ms / 1000).toFixed(2)} s  ${(buf.length / 1024).toFixed(1)} KB  ${row.outputFormat}  cost ${c ? "$" + c.usd.toFixed(6) : "n/a"}  → ${file}`);
    }
    report.push(row);
  }
  await writeFile(join(outDir, "report.json"), JSON.stringify({ text, at: new Date().toISOString(), results: report }, null, 2));
  console.log(`\nReport: ${join(outDir, "report.json")}\nNow listen to each file and rate pronunciation in the web UI or by hand.\n`);
}

main().catch((e) => {
  console.error("Smoke test failed:", e.message);
  process.exit(1);
});
