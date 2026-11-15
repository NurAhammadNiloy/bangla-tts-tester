/** One row of the feasibility report (the "Record" list from the plan). */
export interface TestRecord {
  time: string;
  model: string;
  provider: string;
  endpoint: string;
  voice: string;
  outputFormat: string;
  characters: number;
  audioSeconds: number | null;
  sizeBytes: number;
  generationMs: number;
  costUsd: number | null;
  audioQuality: number | null;
  pronunciation: number | null;
  notes: string;
  generationId: string | null;
}

const COLUMNS: (keyof TestRecord)[] = [
  "time",
  "model",
  "provider",
  "endpoint",
  "voice",
  "outputFormat",
  "characters",
  "audioSeconds",
  "sizeBytes",
  "generationMs",
  "costUsd",
  "audioQuality",
  "pronunciation",
  "notes",
  "generationId",
];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: TestRecord[]): string {
  // BOM so Excel opens Bengali text as UTF-8.
  return "﻿" + [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\r\n");
}

export function formatUsd(v: number | null): string {
  if (v === null) return "–";
  if (v === 0) return "$0 (free)";
  return v < 0.01 ? `$${v.toFixed(6)}` : `$${v.toFixed(4)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function downloadText(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
