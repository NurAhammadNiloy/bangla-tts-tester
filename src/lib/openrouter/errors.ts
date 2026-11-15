/** Error raised for any non-2xx answer from OpenRouter, with a key-free message. */
export class OpenRouterError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string | number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

/** Human hints for the documented error codes of /audio/speech. */
const STATUS_HINTS: Record<number, string> = {
  400: "The model rejected the request (bad parameter, unsupported voice or audio format).",
  401: "OpenRouter rejected the API key. Check that it is correct and not revoked.",
  402: "Your OpenRouter account has insufficient credits.",
  403: "This key is not allowed to use this model (check key limits or guardrails).",
  404: "Model not found. It may have been renamed or removed.",
  413: "Text is too long for this model.",
  429: "Rate limited by OpenRouter or the provider. Wait a moment and retry.",
  500: "OpenRouter internal error. Retry shortly.",
  502: "The speech provider failed upstream. Failed generations are not billed.",
  503: "Service temporarily unavailable.",
  524: "The request timed out at OpenRouter's edge.",
  529: "The provider is overloaded. Retry shortly.",
};

export function hintForStatus(status: number): string {
  return STATUS_HINTS[status] ?? `Unexpected response (HTTP ${status}).`;
}

/**
 * Remove anything that looks like a secret from a string before it is
 * returned to the browser or written anywhere.
 */
export function redact(text: string, secret?: string): string {
  let out = text;
  if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  // OpenRouter keys look like sk-or-v1-<hex>; also catch generic bearer tokens.
  out = out.replace(/sk-or-[A-Za-z0-9-_]{6,}/g, "[redacted]");
  out = out.replace(/Bearer\s+[A-Za-z0-9-_.]{8,}/gi, "Bearer [redacted]");
  return out;
}

/** Build an OpenRouterError from a failed fetch Response. */
export async function errorFromResponse(res: Response, secret?: string): Promise<OpenRouterError> {
  let upstreamMessage = "";
  let code: string | number | undefined;
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: { message?: string; code?: string | number } };
      upstreamMessage = json.error?.message ?? text;
      code = json.error?.code;
    } catch {
      upstreamMessage = text;
    }
  } catch {
    /* body unreadable */
  }
  const hint = hintForStatus(res.status);
  const detail = redact(upstreamMessage.slice(0, 500), secret).trim();
  return new OpenRouterError(res.status, detail ? `${hint} Provider said: ${detail}` : hint, code);
}
