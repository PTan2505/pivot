import { listRecentCaptureAttempts } from "@pivot/core/capture";
import { json, route } from "@/lib/server/http";

/** Recent capture attempts across the library, newest first. `?status=queued,failed` narrows them. */
export const GET = route(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const statuses = params.get("status")?.split(",").filter(Boolean);
  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
  return json({ attempts: await listRecentCaptureAttempts({ limit, statuses }) });
});
