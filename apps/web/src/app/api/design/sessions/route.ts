import { listDesignSessions } from "@pivot/core/design";
import { json, route } from "@/lib/server/http";

/** Design sessions, most recently changed first; `?project=` narrows to one target project. */
export const GET = route(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  return json({
    sessions: await listDesignSessions({
      targetProject: sp.get("project") ?? undefined,
      limit: Math.min(200, Number(sp.get("limit")) || 50),
    }),
  });
});
