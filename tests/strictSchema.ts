/** Walk a JSON schema and list every strict-mode violation (additionalProperties / required). */
export function strictProblems(schema: unknown, path = "$"): string[] {
  const out: string[] = [];
  const s = schema as Record<string, unknown>;
  if (!s || typeof s !== "object") return out;
  if (s.type === "object") {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    if (s.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
    const req = (s.required ?? []) as string[];
    const keys = Object.keys(props);
    if (req.length !== keys.length || !keys.every((k) => req.includes(k))) out.push(`${path}: required must list all keys`);
    for (const k of keys) out.push(...strictProblems(props[k], `${path}.${k}`));
  }
  if (s.type === "array") {
    if (!s.items) out.push(`${path}: array without items`);
    out.push(...strictProblems(s.items, `${path}[]`));
  }
  if (!s.type) out.push(`${path}: missing type`);
  return out;
}
