import { z } from "zod";
import { createResource, listResources, type ListFilters } from "@pivot/core/resources";
import { SearchInputError, searchResources } from "@pivot/core/search";
import { isResourceType, SEARCH_SORTS, SECTIONS, TAG_KINDS } from "@pivot/core/types";
import { body, json, route } from "@/lib/server/http";

// `facet=pageType:Pricing`, repeatable; the name may itself contain ":".
const facet = z.string().transform((v, ctx) => {
  const at = v.indexOf(":");
  const kind = v.slice(0, at);
  const name = v.slice(at + 1).trim();
  if (at < 1 || !name || !(TAG_KINDS as readonly string[]).includes(kind)) {
    ctx.addIssue({ code: "custom", message: `"${v}" is not kind:name with a known kind (${TAG_KINDS.join(", ")}).` });
    return z.NEVER;
  }
  return { kind: kind as (typeof TAG_KINDS)[number], name };
});

/** `paged=1`: the agent-facing search (see packages/core/src/search.ts). */
const paged = z.object({
  q: z.string().max(200).optional(),
  types: z
    .string()
    .optional()
    .transform((v) => v?.split(",").filter(isResourceType)),
  section: z.enum(SECTIONS.map((s) => s.id) as [string, ...string[]]).optional(),
  facet: z.array(facet).max(10),
  collection: z.string().max(100).optional(),
  via: z.string().max(100).optional(),
  sort: z.enum(SEARCH_SORTS).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().max(500).optional(),
});

async function pagedSearch(sp: URLSearchParams) {
  const p = paged.parse({
    ...Object.fromEntries([...sp].filter(([k]) => k !== "facet" && k !== "paged")),
    facet: sp.getAll("facet"),
  });
  try {
    return json(
      await searchResources({
        query: p.q,
        types: p.types,
        section: p.section as (typeof SECTIONS)[number]["id"] | undefined,
        facets: p.facet,
        collectionId: p.collection,
        sourceId: p.via,
        sort: p.sort,
        limit: p.limit,
        cursor: p.cursor,
      }),
    );
  } catch (err) {
    if (err instanceof SearchInputError) return json({ error: err.message, code: err.code }, { status: 400 });
    throw err;
  }
}

export const GET = route(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  if (sp.get("paged") === "1") return pagedSearch(sp);
  const type = sp.get("type");
  const sort = sp.get("sort");
  const filters: ListFilters = {
    q: sp.get("q") ?? undefined,
    type: isResourceType(type) ? type : undefined,
    types: sp.get("types")?.split(",").filter(isResourceType),
    via: sp.get("via") ?? undefined,
    tagIds: sp.get("tags")?.split(",").filter(Boolean),
    collectionId: sp.get("collection") ?? undefined,
    needsReview: sp.get("review") === "needs",
    url: sp.get("url") ?? undefined,
    host: sp.get("host") ?? undefined,
    trash: sp.get("trash") === "1",
    sort: sort === "created" || sort === "oldest" || sort === "title" ? sort : "updated",
    limit:
      Number.isInteger(Number(sp.get("limit"))) && Number(sp.get("limit")) > 0 ? Number(sp.get("limit")) : undefined,
  };
  return json(await listResources(filters));
});

export const POST = route(async (req: Request) => {
  const created = await createResource(await body(req));
  return json(created, { status: 201 });
});
