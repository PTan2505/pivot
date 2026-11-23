import type {
  UiSettings,
  DesignFeedbackDTO,
  DesignCandidateDTO,
  CollectionDTO,
  DesignDecisionKind,
  DesignMilestone,
  DesignSessionDetailDTO,
  DesignQaInput,
  DesignStatus,
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
  SourceCategory,
  TagDTO,
} from "@pivot/core/types";
import type { MotionTrack } from "@pivot/core/motion-track";
import type { ImagePart, PageSlices } from "./images";

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
  /** A screenshot shrunk to fit the edge Claude reads at (1568px), prepared by the app. */
  agentImage(assetId: string): Promise<ImagePart>;
  /** `count` slices of a full-page screenshot from slice `from`, 960px wide, prepared by the app. */
  agentSlices(assetId: string, from: number, count: number): Promise<PageSlices>;
  /**
   * A reference's motion track (the `motion-track` asset's JSON), or null when it can't be read. Optional: a source
   * without it serves the motion evidence alone.
   */
  motionTrack?(assetId: string): Promise<MotionTrack | null>;
  /**
   * Hybrid search, external side: free public catalogs searched by the app, plus search links for other sites.
   * Optional, so an older app (or a source without it) makes `search_external` say so instead of failing.
   */
  externalSearch?(req: {
    query: string;
    providers?: DirectProviderId[];
    limit?: number;
    /** Only catalogs and search links of this kind. */
    category?: SourceCategory;
  }): Promise<ExternalSearchPage | null>;
  /**
   * App-wide display settings: whether the types outside design (Knowledge, Skills) are shown. Optional; a source
   * without it (or an app that predates the setting) shows everything.
   */
  uiSettings?(): Promise<UiSettings>;
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
  /** The user's approval given in the chat, recorded with their words (source "chat"). Optional: an older app says so. */
  approveInChat?(
    sessionId: string,
    input: { userWords: string; mockupId?: string; mockupDigest?: string; note?: string },
  ): Promise<{ id: string; sessionId: string }>;
  recordDesignDecision(
    sessionId: string,
    input: {
      kind: DesignDecisionKind;
      summary: string;
      direction?: string;
      details?: string;
      mockupId?: string;
      mockupDigest?: string;
    },
  ): Promise<{ id: string }>;
  /**
   * Stores a round of self-contained mockup versions; the app refuses it unless the session is exploring. The round may
   * name the owner's feedback it answers and propose a change to the project's DESIGN.md (an app before mockup feedback
   * refuses those fields).
   */
  saveDesignMockups(
    sessionId: string,
    input: {
      snapshotId?: string;
      mockups: { title: string; html: string; interactive?: boolean }[];
      addressesFeedback?: string[];
      designSystemChange?: { summary: string; markdown: string };
    },
  ): Promise<{ round: number; ids: string[]; created: boolean }>;
  /**
   * The area around one of the owner's feedback pins on the version's render, its number drawn on the spot, prepared by
   * the app. Null when there is no such pin. Optional: an app before mockup feedback makes the tool say so.
   */
  feedbackPinImage?(
    feedbackId: string,
    index: number,
  ): Promise<(ImagePart & { region: { left: number; top: number; width: number; height: number } }) | null>;
  /** One piece of the owner's feedback. Optional, like feedbackPinImage. */
  getFeedback?(id: string): Promise<DesignFeedbackDTO | null>;
  /**
   * Gate 1: proposes references for a session (library ones by id, external pages by URL; PIVOT captures a preview of
   * each external page in the background). Optional, so an older app makes the tool say so.
   */
  proposeReferences?(
    sessionId: string,
    candidates: {
      resourceId?: string;
      url?: string;
      title?: string;
      source?: string;
      category?: DesignCandidateDTO["category"];
      why: string;
      take?: string;
      avoid?: string;
    }[],
  ): Promise<{ candidates: DesignCandidateDTO[] }>;
  listCandidates?(sessionId: string): Promise<DesignCandidateDTO[]>;
  /** Records the user's pick, with their own words. */
  selectReferences?(
    sessionId: string,
    input: { numbers: number[]; userWords: string },
  ): Promise<{ selected: DesignCandidateDTO[] }>;
  /** PIVOT's capture of an external candidate. */
  getCandidatePreview?(candidateId: string): Promise<{ data: Buffer; mimeType: string } | null>;
  /** Where the user opens PIVOT, for links to a session page. */
  readonly appUrl?: string;
  /**
   * Records a session's QA report while it is building; the app refuses "done" from an agent without one. Optional, so
   * an older app makes the tool say so.
   */
  recordDesignQa?(sessionId: string, input: DesignQaInput): Promise<{ id: string }>;
  /** Sets a session's status by hand (PATCH); the app refuses "approved" without an approval record. */
  setDesignStatus(sessionId: string, status: DesignStatus): Promise<DesignSessionDetailDTO>;
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
  /** The app answers but is older than this MCP server: it lacks a feature the tools need. */
  | "app_outdated"
  | "no_images"
  | "read_only"
  | "unauthorized"
  | "not_supported"
  /** The request is valid but the item's current state doesn't allow it (a status out of order). */
  | "conflict";

/** An error the agent can act on: the code says what kind, the message says what to do. */
export class ToolError extends Error {
  constructor(
    public code: ToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}
