import { z } from "zod";
import { createLink, LinkError, listLinks } from "@pivot/core/links";
import { LINK_KINDS } from "@pivot/core/types";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  return json({ links: await listLinks(id) });
});

const input = z.object({ toId: z.string().min(1), kind: z.enum(LINK_KINDS) });

/** Links this reference to another one, by hand (confirmed). */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const { toId, kind } = input.parse(await body(req));
  try {
    return json({ id: await createLink({ fromId: id, toId, kind, origin: "user" }) }, { status: 201 });
  } catch (err) {
    if (err instanceof LinkError) throw new HttpError(400, err.message);
    throw err;
  }
});
