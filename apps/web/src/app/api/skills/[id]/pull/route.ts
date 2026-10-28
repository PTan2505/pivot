import { pullSkillFromDisk } from "@pivot/core/skills";
import { json, route, type IdParams } from "@/lib/server/http";

export const POST = route(async (_req: Request, { params }: IdParams) => {
  await pullSkillFromDisk((await params).id);
  return json({ ok: true });
});
