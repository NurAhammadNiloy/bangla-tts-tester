import { errorResponse, guard, JOB_ID } from "@/lib/apiGuard";
import { fetchVideoContent } from "@/lib/openrouter/media";

export const maxDuration = 120;

/** GET /api/video/{id}/content → MP4 bytes, streamed through so the browser gets a same-origin file. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = guard(req, "vidget", 20);
  if ("response" in g) return g.response;
  const { id } = await params;
  if (!JOB_ID.test(id)) return Response.json({ error: "Invalid job id." }, { status: 400 });
  try {
    const upstream = await fetchVideoContent(g.key, id);
    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") || "video/mp4",
      "Cache-Control": "no-store",
    });
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    return new Response(upstream.body, { status: 200, headers });
  } catch (err) {
    return errorResponse(err);
  }
}
