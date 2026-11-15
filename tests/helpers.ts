import { vi } from "vitest";

export const FAKE_KEY = "sk-or-v1-0123456789abcdef0123456789abcdef";

export type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Install a fetch mock and return the recorded calls. */
export function mockFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> | null }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    let body: Record<string, unknown> | null = null;
    if (typeof init.body === "string") body = JSON.parse(init.body);
    calls.push({ url, init, body });
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

export function audioResponse(bytes: number[], contentType: string, generationId = "gen-test-123") {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": contentType, "x-generation-id": generationId },
  });
}

export function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { code: status, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
