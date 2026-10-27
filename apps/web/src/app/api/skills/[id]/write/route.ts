import { writeSkillToDisk } from "@stan-bag/core/skills";
import { body, json, route, type IdParams } from "@/lib/server/http";

export const POST = route(async (req: Request, { params }: IdParams) => {
  const { force } = await body<{ force?: boolean }>(req);
  return json(await writeSkillToDisk((await params).id, { force: !!force }));
});
