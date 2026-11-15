import { errorResponse, guard, JOB_ID } from "@/lib/apiGuard";
import { getVideoStatus } from "@/lib/openrouter/media";

/** GET /api/video/{id} → { status, costUsd, error } */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = guard(req, "vidpoll", 60);
  if ("response" in g) return g.response;
  const { id } = await params;
  if (!JOB_ID.test(id)) return Response.json({ error: "Invalid job id." }, { status: 400 });
  try {
    return Response.json(await getVideoStatus(g.key, id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
