import type {
  CollectionDTO,
  ResourceDetailDTO,
  ResourceType,
  SearchPage,
  SearchRequest,
  TagDTO,
} from "@pivot/core/types";

/**
 * Where the tools get their data. The stdio server implements it over the running app's HTTP API; a remote server
 * could implement it over `@pivot/core` directly. The tools never know which.
 */
export interface PivotSource {
  search(req: SearchRequest): Promise<SearchPage>;
  /** Null when there is no such resource (trashed ones count as gone). */
  getResource(id: string): Promise<ResourceDetailDTO | null>;
  /** Every tag and facet with how many live resources carry it. */
  listTags(): Promise<TagDTO[]>;
  listCollections(): Promise<CollectionDTO[]>;
  /** Live resources per type. */
  counts(): Promise<Partial<Record<ResourceType, number>>>;
  /** Every saved source (to count them by category); a library has tens, not thousands. */
  listSources(): Promise<{ id: string; title: string; sourceUrl: string | null; meta: Record<string, unknown> }[]>;
  /** An asset's bytes: its small thumbnail, or the original file. */
  getImage(assetId: string, variant: "thumb" | "original"): Promise<{ data: Buffer; mimeType: string }>;
}

export type ToolErrorCode = "not_found" | "invalid_input" | "invalid_cursor" | "app_unreachable" | "no_images";

/** An error the agent can act on: the code says what kind, the message says what to do. */
export class ToolError extends Error {
  constructor(
    public code: ToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}
