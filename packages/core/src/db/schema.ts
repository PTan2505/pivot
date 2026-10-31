import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
