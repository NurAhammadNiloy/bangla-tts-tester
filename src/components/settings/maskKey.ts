/** "sk-or-v1-••••cdef": enough to recognise a key, never enough to use it. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return "";
  if (k.length < 16) return "••••";
  const prefix = k.startsWith("sk-or-v1-") ? "sk-or-v1-" : k.slice(0, 4);
  return `${prefix}••••${k.slice(-4)}`;
}
