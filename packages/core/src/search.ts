import crypto from "node:crypto";
import { countResources, listResources, resolveTagNames, type ListFilters } from "./resources";
import { hostOf } from "./source-match";
import {
  SECTIONS,
  TAG_KINDS,
  type ResourceDTO,
  type SearchHit,
  type SearchPage,
  type SearchRequest,
  type SearchSort,
} from "./types";

/**
 * Paged search over the library, shared by `GET /api/resources?paged=1` and the MCP tools, on top of `listResources`
 * so the web list and an agent see the same matches in the same order.
 */

export class SearchInputError extends Error {
  constructor(
    public code: "invalid_cursor" | "invalid_input",
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DESCRIPTION_CHARS = 280;
const MAX_FACETS = 8;

/** Identifies a request without its page position, so a cursor can't be reused with other filters. */
function fingerprint(req: SearchRequest) {
  const { cursor: _cursor, limit: _limit, ...rest } = req;
  return crypto.createHash("sha256").update(JSON.stringify(rest)).digest("base64url").slice(0, 12);
}

function encodeCursor(offset: number, req: SearchRequest) {
  return Buffer.from(JSON.stringify({ o: offset, f: fingerprint(req) })).toString("base64url");
}

function decodeCursor(cursor: string, req: SearchRequest) {
  try {
    const { o, f } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { o: unknown; f: unknown };
    if (typeof o === "number" && Number.isInteger(o) && o >= 0 && f === fingerprint(req)) return o;
  } catch {
    // falls through to the error below
  }
  throw new SearchInputError("invalid_cursor", "This cursor belongs to another search; start again without it.");
}

function httpOnly(url: string | null) {
  if (!url) return null;
  try {
    return /^https?:$/.test(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

export function toSearchHit(r: ResourceDTO): SearchHit {
  const facets = [...r.tags]
    .sort(
      (a, b) =>
        Number(a.kind === "tag") - Number(b.kind === "tag") || TAG_KINDS.indexOf(a.kind) - TAG_KINDS.indexOf(b.kind),
    )
    .slice(0, MAX_FACETS)
    .map(({ kind, name }) => ({ kind, name }));
  const description =
    r.description.length > DESCRIPTION_CHARS ? `${r.description.slice(0, DESCRIPTION_CHARS - 1)}…` : r.description;
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    host: hostOf(r.sourceUrl),
    sourceUrl: httpOnly(r.sourceUrl),
    description,
    facets,
    hasScreenshot: !!(r.coverAssetId || r.fullShot),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function searchResources(req: SearchRequest): Promise<SearchPage> {
  const limit = req.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw new SearchInputError("invalid_input", `limit must be a whole number from 1 to ${MAX_LIMIT}.`);
  const query = req.query?.trim() ?? "";
  if (query.length > 200) throw new SearchInputError("invalid_input", "query is longer than 200 characters.");
  const sort: SearchSort = req.sort ?? (query ? "relevance" : "updated");
  const offset = req.cursor ? decodeCursor(req.cursor, req) : 0;

  const { ids: tagIds, unknown } = await resolveTagNames(req.facets ?? []);
  if (unknown.length) return { results: [], total: 0, nextCursor: null, sort, unknownFacets: unknown };

  const section = req.section ? SECTIONS.find((s) => s.id === req.section) : undefined;
  if (req.section && !section) throw new SearchInputError("invalid_input", `Unknown section "${req.section}".`);
  const filters: ListFilters = {
    q: query || undefined,
    types: section ? [...section.types] : req.types?.length ? req.types : ["reference"],
    tagIds,
    collectionId: req.collectionId,
    via: req.sourceId,
    // relevance is the list's own order with a query: its tiers come first, then recently edited
    sort: sort === "relevance" ? "updated" : sort,
  };
  const [rows, total] = await Promise.all([listResources({ ...filters, limit, offset }), countResources(filters)]);
  const next = offset + rows.length;
  return {
    results: rows.map(toSearchHit),
    total,
    nextCursor: next < total ? encodeCursor(next, req) : null,
    sort,
  };
}
