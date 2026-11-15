import { errorResponse, guard, isImageDataUrl, MODEL_ID } from "@/lib/apiGuard";
import { generateImage } from "@/lib/openrouter/media";

export const maxDuration = 120;

/** POST /api/image { model, prompt, references?: dataUrl[] } → { dataUrl, costUsd } */
export async function POST(req: Request) {
  const g = guard(req, "img", 20);
  if ("response" in g) return g.response;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const model = typeof b.model === "string" ? b.model : "";
  const prompt = typeof b.prompt === "string" ? b.prompt.trim().slice(0, 4000) : "";
  if (!MODEL_ID.test(model)) return Response.json({ error: "Choose an image model." }, { status: 400 });
  if (!prompt) return Response.json({ error: "Image prompt is empty." }, { status: 400 });
  const refs = Array.isArray(b.references) ? b.references.filter(isImageDataUrl).slice(0, 4) : [];
  try {
    const r = await generateImage({ apiKey: g.key, model, prompt, aspectRatio: "9:16", references: refs });
    return Response.json(
      { dataUrl: `data:${r.mediaType};base64,${r.b64}`, costUsd: r.costUsd },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
