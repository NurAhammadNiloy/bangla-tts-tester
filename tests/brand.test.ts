import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as brandPost } from "@/app/api/brand/route";
import { cleanBrandName, MAX_SVG_BYTES, sanitizeSvg, svgFromDataUrl, svgToDataUrl } from "@/lib/brand";
import { _resetRateLimit } from "@/lib/rateLimit";
import { FAKE_KEY, mockFetch } from "./helpers";

const GOOD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512"><rect x="0" y="0" width="100" height="100" rx="22" fill="#1a1d3b"/><circle cx="50" cy="50" r="20" fill="#f4b13e"/></svg>`;

describe("sanitizeSvg", () => {
  it("keeps a simple logo and rebuilds it cleanly", () => {
    const out = sanitizeSvg(GOOD)!;
    expect(out).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" rx="22" fill="#1a1d3b"/><circle cx="50" cy="50" r="20" fill="#f4b13e"/></svg>`,
    );
    expect(sanitizeSvg(out)).toBe(out); // idempotent
  });

  it("requires a root svg with a viewBox and at least one shape", () => {
    expect(sanitizeSvg(`<svg><circle r="1"/></svg>`)).toBeNull();
    expect(sanitizeSvg(`<svg viewBox="0 0 0 10"><circle r="1"/></svg>`)).toBeNull();
    expect(sanitizeSvg(`<svg viewBox="0 0 10 10"><g></g></svg>`)).toBeNull();
    expect(sanitizeSvg(`<g><circle r="1"/></g>`)).toBeNull();
    expect(sanitizeSvg(42)).toBeNull();
    expect(sanitizeSvg("")).toBeNull();
  });

  it("drops scripts, text, style, foreignObject and images with their contents", () => {
    const svg = `<svg viewBox="0 0 10 10"><script>alert(1)</script><style>*{fill:url(#x)}</style><text x="1">Hi</text><foreignObject><div>x</div></foreignObject><image href="x.png"/><circle r="2"/></svg>`;
    const out = sanitizeSvg(svg)!;
    expect(out).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="2"/></svg>`);
  });

  it("drops event handlers, href, style and url() values", () => {
    const svg = `<svg viewBox="0 0 10 10" onload="alert(1)"><path d="M0 0L10 10Z" onclick="x()" href="javascript:alert(1)" xlink:href="#a" style="fill:red" fill="url(#g)" stroke="javascript:x"/></svg>`;
    expect(sanitizeSvg(svg)).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10Z"/></svg>`);
  });

  it("rejects DOCTYPE/entities, CDATA, broken nesting, stray < and trailing content", () => {
    expect(sanitizeSvg(`<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"><circle r="1"/></svg>`)).toBeNull();
    expect(sanitizeSvg(`<svg viewBox="0 0 1 1"><![CDATA[x]]><circle r="1"/></svg>`)).toBeNull();
    expect(sanitizeSvg(`<svg viewBox="0 0 1 1"><g><circle r="1"/></svg>`)).toBeNull();
    expect(sanitizeSvg(`<svg viewBox="0 0 1 1"><circle r="1"/> < </svg>`)).toBeNull();
    expect(sanitizeSvg(`<svg viewBox="0 0 1 1"><circle r="1"/></svg><script>x</script>`)).toBeNull();
    expect(sanitizeSvg(`<svg viewBox="0 0 1 1"><svg viewBox="0 0 1 1"><circle r="1"/></svg></svg>`)).toBeNull();
  });

  it("validates attribute values", () => {
    const out = sanitizeSvg(
      `<svg viewBox="0 0 10 10"><g transform="rotate(45 5 5)"><polygon points="1,1 9,1 5,9" fill="rgb(1,2,3)" stroke-linecap="round" opacity="0.5" r="evil()"/></g></svg>`,
    );
    expect(out).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g transform="rotate(45 5 5)"><polygon points="1,1 9,1 5,9" fill="rgb(1,2,3)" stroke-linecap="round" opacity="0.5"/></g></svg>`,
    );
  });

  it("strips XML declarations and comments, and enforces the size limit", () => {
    expect(sanitizeSvg(`<?xml version="1.0"?><!-- hi --><svg viewBox="0 0 1 1"><circle r="1"/></svg>`)).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle r="1"/></svg>`,
    );
    const many = Array.from({ length: 400 }, (_, i) => `<circle cx="${i}" cy="${i}" r="1"/>`).join("");
    expect(many.length).toBeGreaterThan(MAX_SVG_BYTES);
    expect(sanitizeSvg(`<svg viewBox="0 0 1 1">${many}</svg>`)).toBeNull();
  });

  it("round-trips data URLs", () => {
    const svg = sanitizeSvg(GOOD)!;
    expect(svgFromDataUrl(svgToDataUrl(svg))).toBe(svg);
    expect(svgFromDataUrl("data:image/png;base64,AAAA")).toBeNull();
  });
});

describe("cleanBrandName", () => {
  it("trims, removes markup characters and caps length", () => {
    expect(cleanBrandName("  গল্পের   <b>ঘর</b>\n")).toBe("গল্পের b ঘর /b");
    expect([...cleanBrandName("a".repeat(100))]).toHaveLength(40);
    expect(cleanBrandName(null)).toBe("");
  });
});

describe("POST /api/brand", () => {
  beforeEach(() => _resetRateLimit());
  afterEach(() => vi.unstubAllGlobals());

  const req = (body: unknown, key: string | null = FAKE_KEY) => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" };
    if (key) headers["x-openrouter-key"] = key;
    return new Request("http://localhost/api/brand", { method: "POST", headers, body: JSON.stringify(body) });
  };

  const handler = (contents: unknown[]) => {
    let n = 0;
    return (url: string) => {
      if (url.includes("/models"))
        return Response.json({ data: [{ id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"], architecture: { output_modalities: ["text"] } }] });
      return Response.json({ choices: [{ message: { content: JSON.stringify(contents[Math.min(n++, contents.length - 1)]) } }] });
    };
  };

  it("401 without a key and never calls upstream", async () => {
    const { calls } = mockFetch(handler([{}]));
    const res = await brandPost(req({}, null));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("returns a name and a sanitised logo, passing the hint", async () => {
    const { calls } = mockFetch(handler([{ name: "রাতের গল্প", logoSvg: GOOD.replace("<circle", `<script>x</script><circle onclick="y"`) }]));
    const res = await brandPost(req({ hint: "horror stories" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.name).toBe("রাতের গল্প");
    expect(j.logoSvg).not.toMatch(/script|onclick/);
    expect(sanitizeSvg(j.logoSvg)).toBe(j.logoSvg);
    const chat = calls.find((c) => c.url.includes("/chat/completions"))!;
    expect(JSON.stringify(chat.body!.messages)).toContain("horror stories");
    expect((chat.body!.response_format as { type: string }).type).toBe("json_schema");
  });

  it("retries once when the logo is unusable, then gives up with 502", async () => {
    mockFetch(handler([{ name: "x", logoSvg: "<svg><text>x</text></svg>" }, { name: "Golpo", logoSvg: GOOD }]));
    expect((await brandPost(req({}))).status).toBe(200);
    _resetRateLimit();
    const { calls } = mockFetch(handler([{ name: "x", logoSvg: "nope" }]));
    const res = await brandPost(req({}));
    expect(res.status).toBe(502);
    expect(calls.filter((c) => c.url.includes("/chat/completions"))).toHaveLength(2);
  });
});
