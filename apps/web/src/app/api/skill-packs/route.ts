import { listSkillPacks, packInput, updateSkillPack } from "@pivot/core/skills";
import { body, json, route } from "@/lib/server/http";

export const GET = route(async () => json(await listSkillPacks()));

/** Edits a pack's name, author, links or description. The id goes in the body (ids contain "/"). */
export const PATCH = route(async (req: Request) => {
  const data = packInput
    .partial()
    .required({ id: true })
    .parse(await body(req));
  await updateSkillPack(data.id, data);
  return json({ ok: true });
});
