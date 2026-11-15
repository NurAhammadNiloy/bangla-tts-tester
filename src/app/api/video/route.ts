import { errorResponse, guard, isImageDataUrl, MODEL_ID } from "@/lib/apiGuard";
import { submitVideo } from "@/lib/openrouter/media";

/** POST /api/video { model, prompt, duration, resolution?, firstFrame?: dataUrl } → { id } */
export async function POST(req: Request) {
  const g = guard(req, "vid", 6);
  if ("response" in g) return g.response;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const model = typeof b.model === "string" ? b.model : "";
  const prompt = typeof b.prompt === "string" ? b.prompt.trim().slice(0, 4000) : "";
  const duration = Number(b.duration);
  const resolution = typeof b.resolution === "string" && /^[0-9a-z]{2,6}$/i.test(b.resolution) ? b.resolution : undefined;
  if (!MODEL_ID.test(model)) return Response.json({ error: "Choose a video model." }, { status: 400 });
  if (!prompt) return Response.json({ error: "Video prompt is empty." }, { status: 400 });
  if (!Number.isInteger(duration) || duration < 1 || duration > 30) {
    return Response.json({ error: "Duration must be 1–30 seconds." }, { status: 400 });
  }
  const firstFrame = isImageDataUrl(b.firstFrame) ? b.firstFrame : undefined;
  try {
    return Response.json(await submitVideo({ apiKey: g.key, model, prompt, duration, resolution, firstFrame }));
  } catch (err) {
    return errorResponse(err);
  }
}
