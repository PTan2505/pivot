import { createCollection, listCollections } from "@stan-bag/core/resources";
import { body, json, route } from "@/lib/server/http";

export const GET = route(async () => json(await listCollections()));

export const POST = route(async (req: Request) => {
  const c = await createCollection(await body(req));
  return json(c, { status: 201 });
});
