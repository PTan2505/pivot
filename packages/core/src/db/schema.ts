import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { DesignFeedbackPin } from "../types";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const resources = pgTable(
  "resources",
  {
    id: id(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    sourceUrl: text("source_url"),
    notes: text("notes").notNull().default(""),
    content: text("content").notNull().default(""),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    coverAssetId: text("cover_asset_id"),
    captureStatus: text("capture_status"),
    captureError: text("capture_error"),
    /** How the latest server capture looks: "looks_good", "needs_review" or "unavailable". */
    captureQuality: text("capture_quality"),
    /** "needs_review" for quick saves waiting in the Inbox; null once reviewed. Doesn't hide it from search. */
    reviewStatus: text("review_status"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("resources_type_idx").on(t.type),
    index("resources_deleted_idx").on(t.deletedAt),
    index("resources_source_url_idx").on(t.sourceUrl),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_kind_name_idx").on(t.kind, sql`lower(${t.name})`)],
);

export const resourceTags = pgTable(
  "resource_tags",
  {
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.tagId] }), index("resource_tags_tag_idx").on(t.tagId)],
);

export const assets = pgTable(
  "assets",
  {
    id: id(),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    /** Object key: a path relative to the data directory (local) or inside the R2 bucket. */
    storagePath: text("storage_path").notNull(),
    /** Which store holds the bytes: "local" or "r2". */
    storage: text("storage").notNull().default("local"),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256").notNull(),
    sourceUrl: text("source_url"),
    notes: text("notes").notNull().default(""),
    /** For screenshots: how they were taken (colorScheme, viewport, capturedAt, finalUrl, method). */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("assets_sha_idx").on(t.sha256)],
);

export const resourceAssets = pgTable(
  "resource_assets",
  {
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("attachment"),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.assetId] }), index("resource_assets_asset_idx").on(t.assetId)],
);

/** A set of skills that come from one place: a GitHub repo, a Claude Code plugin, or an author. */
export const skillPacks = pgTable("skill_packs", {
  /** "owner/repo", "plugin:<name>", "author:<name>" or "local". */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  author: text("author"),
  kind: text("kind").notNull().default("repo"),
  repoUrl: text("repo_url"),
  homepage: text("homepage"),
  description: text("description").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const collections = pgTable("collections", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const collectionItems = pgTable(
  "collection_items",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.resourceId] })],
);

/**
 * One run of the screenshot capture for a resource. The first successful attempt holds the Original shots, the
 * newest successful one the Latest; failed, partial and cancelled runs stay as history.
 */
export const captureAttempts = pgTable(
  "capture_attempts",
  {
    id: id(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    /** "server" (Playwright) or "extension" (the tab the user saw). */
    method: text("method").notNull().default("server"),
    /** queued | capturing | completed | partial | failed | cancelled */
    status: text("status").notNull().default("queued"),
    /** looks_good | needs_review | unavailable */
    quality: text("quality"),
    qualityReasons: jsonb("quality_reasons").$type<string[]>().notNull().default([]),
    error: text("error"),
    /** What was asked for and what was seen: expandContent, colorScheme, viewport, finalUrl, retries. */
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    viewportAssetId: text("viewport_asset_id"),
    fullAssetId: text("full_asset_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("capture_attempts_resource_idx").on(t.resourceId, t.requestedAt),
    index("capture_attempts_status_idx").on(t.status),
  ],
);

/** App-wide settings that should follow the library (Neon or PGlite), keyed by area: { capture: {...} }. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
});

/**
 * A save request the browser extension may send more than once (it retries when the answer got lost). The first one
 * claims the id; later ones get the resource it created instead of a duplicate.
 */
export const clipRequests = pgTable("clip_requests", {
  id: text("id").primaryKey(),
  /** Null while the first request is still saving. */
  resourceId: text("resource_id").references(() => resources.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

/**
 * Links between references: `same_source_page`, `part_of` (a section of a page), `related_to`, `variant_of`,
 * `newer_version_of`. Only links PIVOT is sure of are made automatically; the rest wait as suggestions
 * (`confirmed` false) or are added by hand.
 */
export const resourceLinks = pgTable(
  "resource_links",
  {
    id: id(),
    fromId: text("from_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    toId: text("to_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    confirmed: integer("confirmed").notNull().default(1),
    /** "auto" (made by PIVOT), "user", or "agent". */
    origin: text("origin").notNull().default("user"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("resource_links_unique_idx").on(t.fromId, t.toId, t.kind),
    index("resource_links_to_idx").on(t.toId),
  ],
);

/**
 * One piece of design work done with the pivot:design skill, from the first complete brief on. Small fixes don't get
 * one. Briefs and decisions live here, never in the target project's repository.
 */
export const designSessions = pgTable(
  "design_sessions",
  {
    id: id(),
    title: text("title").notNull(),
    /** The project being designed for, as the agent names it (folder or repo name). */
    targetProject: text("target_project").notNull().default(""),
    /** What is being designed: "pricing page", "settings sidebar"… */
    surface: text("surface").notNull().default(""),
    /** exploring | approved | building | done | abandoned */
    status: text("status").notNull().default("exploring"),
    /** When the session last went back to exploring (reopened, or a major change): approvals before it no longer count. */
    approvalResetAt: timestamp("approval_reset_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("design_sessions_project_idx").on(t.targetProject, t.updatedAt)],
);

/** A brief as Markdown at a milestone: the first complete one, the approved one, and each major change. */
export const designSnapshots = pgTable(
  "design_snapshots",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => designSessions.id, { onDelete: "cascade" }),
    /** initial | approved | major_change */
    milestone: text("milestone").notNull(),
    markdown: text("markdown").notNull(),
    referenceIds: jsonb("reference_ids").$type<string[]>().notNull().default([]),
    note: text("note").notNull().default(""),
    /** sha256 of the Markdown, so a repeated save returns the same snapshot. */
    digest: text("digest").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("design_snapshots_session_idx").on(t.sessionId, t.createdAt)],
);

/** What was decided and when: approvals, changes after approval, deviations found in QA. */
export const designDecisions = pgTable(
  "design_decisions",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => designSessions.id, { onDelete: "cascade" }),
    /** approval | change | deviation */
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    direction: text("direction").notNull().default(""),
    details: text("details").notNull().default(""),
    /** agent (recorded through MCP) | owner (the user pressed Approve on a mockup in PIVOT) */
    source: text("source").notNull().default("agent"),
    /** The mockup version an approval is bound to, and its digest when approved; null for approvals made before. */
    mockupId: text("mockup_id"),
    mockupDigest: text("mockup_digest"),
    /**
     * An approval of a version whose round proposed a DESIGN.md change: that change's digest when approved, so the
     * agent writes exactly what the owner saw. Null otherwise.
     */
    designSystemDigest: text("design_system_digest"),
    createdAt: createdAt(),
  },
  (t) => [index("design_decisions_session_idx").on(t.sessionId, t.createdAt)],
);

/**
 * A mockup version an agent saved for a session: standalone, self-contained HTML (CSS inlined, images from PIVOT or
 * data URIs), grouped in rounds. Served sandboxed, never run on the app's origin.
 */
export const designMockups = pgTable(
  "design_mockups",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => designSessions.id, { onDelete: "cascade" }),
    /** The brief it illustrates, when known. */
    snapshotId: text("snapshot_id"),
    /** 1, 2… per session: each save is a new round; earlier rounds stay as history. */
    round: integer("round").notNull(),
    /** The version number inside the round, from 1. */
    n: integer("n").notNull(),
    title: text("title").notNull(),
    html: text("html").notNull(),
    /** Whether the version runs its own scripts (an interactive prototype); static versions never do. */
    interactive: boolean("interactive").notNull().default(false),
    /** The version's content identity, `mockupDigest(html, interactive)`: what an approval is bound to. */
    digest: text("digest").notNull(),
    /** sha256 of the round's titles and HTML, so saving the same set again returns the same round. */
    roundDigest: text("round_digest").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("design_mockups_version_idx").on(t.sessionId, t.round, t.n)],
);

/**
 * What an agent said about a round when it saved it: the owner's feedback it answers, and the change to the target
 * project's DESIGN.md it proposes (written into the project only after the owner approves a version of the round).
 * Saved once with the round, never edited.
 */
export const designRounds = pgTable(
  "design_rounds",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => designSessions.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    /** Ids of the feedback this round answers. */
    addressesFeedback: jsonb("addresses_feedback").$type<string[]>().notNull().default([]),
    /** The proposed DESIGN.md change: one line, and the change as Markdown (the new text or a diff). */
    designSystemSummary: text("design_system_summary"),
    designSystemMarkdown: text("design_system_markdown"),
    /** sha256 of the summary and Markdown: what an approval of this round's versions binds. */
    designSystemDigest: text("design_system_digest"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("design_rounds_round_idx").on(t.sessionId, t.round)],
);

/**
 * The owner's feedback on a round, written in PIVOT and sent to the agent, which answers it with a new round. Text, and
 * pins on a version's full-page render at one width. It never approves anything.
 */
export const designFeedback = pgTable(
  "design_feedback",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => designSessions.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    /** The version it is about, and its digest when sent; null for feedback on the whole round. */
    mockupId: text("mockup_id"),
    mockupDigest: text("mockup_digest"),
    text: text("text").notNull().default(""),
    /** The render width the pins were placed on (1440, 834 or 390); null without pins. */
    width: integer("width"),
    /** Pins on the version's full-page render at `width`, in its pixels; a pin may name the element it is about. */
    pins: jsonb("pins").$type<DesignFeedbackPin[]>().notNull().default([]),
    /** open | addressed */
    status: text("status").notNull().default("open"),
    /** The round that answered it. */
    addressedRound: integer("addressed_round"),
    /** owner: only PIVOT's own page can send feedback. */
    source: text("source").notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [index("design_feedback_session_idx").on(t.sessionId, t.createdAt)],
);

/**
 * A reference proposed for a design session (gate 1): one from the library (`resourceId`) or a real page found outside
 * it (`url`, with a preview PIVOT captured itself). External candidates stay with the session and are never added to the
 * library; the user saves one only by asking. `selected` is set from the user's own pick, kept word for word.
 */
export const designCandidates = pgTable(
  "design_candidates",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => designSessions.id, { onDelete: "cascade" }),
    /** 1, 2… per session, the number the user picks by. */
    n: integer("n").notNull(),
    /** A library reference, or null for an external page. */
    resourceId: text("resource_id"),
    title: text("title").notNull(),
    url: text("url"),
    /** Where it came from: "library", or the site or search it was found through. */
    source: text("source").notNull(),
    /**
     * "layout" (a whole page or design) or "component" (a single component, e.g. React Bits, shadcn). Null for rows
     * proposed before it existed: those are inferred when read.
     */
    category: text("category"),
    why: text("why").notNull().default(""),
    take: text("take").notNull().default(""),
    avoid: text("avoid").notNull().default(""),
    /** Blob key of PIVOT's own capture of an external page, and the store it is in. */
    previewKey: text("preview_key"),
    previewStorage: text("preview_storage"),
    /**
     * A component-only preview image the agent passed (e.g. a 21st.dev component's preview, on an allowed image host),
     * fetched instead of capturing the page. Null when the page is captured.
     */
    previewImageUrl: text("preview_image_url"),
    /** What the stored preview is: "image" (the previewImageUrl) or "capture" (PIVOT's capture of the page). */
    previewKind: text("preview_kind"),
    /** Why there is no preview (blocked, timed out…), shown instead of one. */
    previewError: text("preview_error"),
    selected: boolean("selected").notNull().default(false),
    /** The user's own words when they picked, kept word for word. */
    selectedWords: text("selected_words"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("design_candidates_n_idx").on(t.sessionId, t.n)],
);

/**
 * Metadata an agent suggests for a reference: a facet, a collection, a title, a visual description. Searchable, but not
 * official until you accept it; accepting never overwrites what you confirmed yourself.
 */
export const resourceSuggestions = pgTable(
  "resource_suggestions",
  {
    id: id(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    /** facet | collection | title | description */
    kind: text("kind").notNull(),
    /** facet: { kind, name }; collection: { id?, name }; title / description: { text } */
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    reason: text("reason").notNull().default(""),
    /** "agent" today; a model name or tool can go here later. */
    source: text("source").notNull().default("agent"),
    /** pending | accepted | rejected */
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("resource_suggestions_resource_idx").on(t.resourceId),
    index("resource_suggestions_status_idx").on(t.status),
  ],
);

/**
 * Notes pinned to a place on a screenshot: a point or a box, in fractions of the image (0–1) so they survive
 * resizing. A separate layer: the screenshot's pixels are never changed (redaction is the opposite, done before upload).
 */
export const assetAnnotations = pgTable(
  "asset_annotations",
  {
    id: id(),
    resourceId: text("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    /** pin | region */
    kind: text("kind").notNull().default("region"),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    width: doublePrecision("width").notNull().default(0),
    height: doublePrecision("height").notNull().default(0),
    note: text("note").notNull().default(""),
    /** "user" or "agent". */
    author: text("author").notNull().default("user"),
    createdAt: createdAt(),
  },
  (t) => [index("asset_annotations_resource_idx").on(t.resourceId), index("asset_annotations_asset_idx").on(t.assetId)],
);
