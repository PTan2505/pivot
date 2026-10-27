import { createResource, listResources, type ListFilters } from "@stan-bag/core/resources";
import { isResourceType } from "@stan-bag/core/types";
import { body, json, route } from "@/lib/server/http";

export const GET = route(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type");
  const sort = sp.get("sort");
  const filters: ListFilters = {
    q: sp.get("q") ?? undefined,
    type: isResourceType(type) ? type : undefined,
    excludeTypes: sp.get("exclude")?.split(",").filter(isResourceType),
    tagIds: sp.get("tags")?.split(",").filter(Boolean),
    collectionId: sp.get("collection") ?? undefined,
    trash: sp.get("trash") === "1",
    sort: sort === "created" || sort === "title" ? sort : "updated",
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  };
  return json(await listResources(filters));
});

export const POST = route(async (req: Request) => {
  const created = await createResource(await body(req));
  return json(created, { status: 201 });
});
