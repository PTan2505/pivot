import type {
  CollectionDTO,
  DesignDecisionKind,
  DesignMilestone,
  DesignSessionDetailDTO,
  DesignSessionDTO,
  DirectProviderId,
  ExternalSearchPage,
  SuggestionDTO,
  SuggestionKind,
  TagKind,
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
  /**
   * Hybrid search, external side: free public catalogs searched by the app, plus search links for other sites.
   * Optional, so an older app (or a source without it) makes `search_external` say so instead of failing.
   */
  externalSearch?(req: {
    query: string;
    providers?: DirectProviderId[];
    limit?: number;
  }): Promise<ExternalSearchPage | null>;
}

/**
 * Writes, kept apart from reads: briefs and decisions of a design session, suggestions, notes and new references.
 * None of them overwrites what the user confirmed. A source without them makes the write tools say so.
 */
export interface PivotWriter {
  saveDesignBrief(input: {
    sessionId?: string;
    title: string;
    targetProject?: string;
    surface?: string;
    milestone: DesignMilestone;
    markdown: string;
    referenceIds?: string[];
    note?: string;
  }): Promise<{ sessionId: string; snapshotId: string; created: boolean; duplicate: boolean }>;
  recordDesignDecision(
    sessionId: string,
    input: { kind: DesignDecisionKind; summary: string; direction?: string; details?: string },
  ): Promise<{ id: string }>;
  getDesignSession(id: string): Promise<DesignSessionDetailDTO | null>;
  listDesignSessions(targetProject?: string): Promise<DesignSessionDTO[]>;
  addSuggestions(
    resourceId: string,
    suggestions: { kind: SuggestionKind; value: Record<string, unknown>; reason?: string }[],
  ): Promise<{ added: SuggestionDTO[]; skipped: { kind: string; value: Record<string, unknown>; why: string }[] }>;
  annotate(resourceId: string, note: string): Promise<{ line: string }>;
  saveReference(input: {
    url: string;
    type?: string;
    title?: string;
    notes?: string;
    tags?: { kind: TagKind; name: string }[];
    collectionIds?: string[];
  }): Promise<{ id: string; path: string; existing?: boolean; title?: string }>;
}

export function canWrite(source: PivotSource): source is PivotSource & PivotWriter {
  return typeof (source as Partial<PivotWriter>).saveDesignBrief === "function";
}

export type ToolErrorCode =
  | "not_found"
  | "invalid_input"
  | "invalid_cursor"
  | "app_unreachable"
  | "no_images"
  | "read_only"
  | "unauthorized"
  | "not_supported";

/** An error the agent can act on: the code says what kind, the message says what to do. */
export class ToolError extends Error {
  constructor(
    public code: ToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}
