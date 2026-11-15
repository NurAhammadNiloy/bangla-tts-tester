import { connection } from "next/server";
import { listImageModels, listVideoModels, type ImageModel, type VideoModel } from "@/lib/openrouter/media";
import { OpenRouterError } from "@/lib/openrouter/errors";

let cache: { at: number; image: ImageModel[]; video: VideoModel[] } | null = null;

/** Live 9:16-capable image and video models. Public data, no key. */
export async function GET() {
  await connection();
  try {
    if (!cache || Date.now() - cache.at > 10 * 60_000) {
      const [image, video] = await Promise.all([listImageModels(), listVideoModels()]);
      cache = { at: Date.now(), image, video };
    }
    return Response.json({ image: cache.image, video: cache.video });
  } catch (err) {
    const status = err instanceof OpenRouterError ? err.status : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Failed to list models." }, { status });
  }
}
