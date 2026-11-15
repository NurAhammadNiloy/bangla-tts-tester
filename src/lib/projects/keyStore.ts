/**
 * The user's OpenRouter key, kept in this browser's localStorage so it survives
 * a reload. It is only ever sent to this app's own API routes (header
 * x-openrouter-key), which pass it to OpenRouter for that one request.
 * Every function is SSR-safe: on the server they do nothing.
 */
export const KEY_STORAGE = "golpo.openrouterKey.v1";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null; // blocked (privacy mode, sandboxed iframe)
  }
}

export function getKey(): string {
  try {
    return (storage()?.getItem(KEY_STORAGE) ?? "").trim();
  } catch {
    return "";
  }
}

/** Save the key (trimmed). An empty key clears it. Returns false if the browser refused. */
export function setKey(k: string): boolean {
  const key = k.trim();
  if (!key) {
    clearKey();
    return true;
  }
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(KEY_STORAGE, key);
    return true;
  } catch {
    return false;
  }
}

export function clearKey(): void {
  try {
    storage()?.removeItem(KEY_STORAGE);
  } catch {
    /* nothing to clear */
  }
}

export function hasKey(): boolean {
  return getKey().length > 0;
}
