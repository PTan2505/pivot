import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import matter from "gray-matter";
import { z } from "zod";
import { deleteOrphanAssets, listResourceAssets } from "./assets";
import { getDb } from "./db/client";
import { assets, collectionItems, collections, resourceAssets, resources, resourceTags, tags } from "./db/schema";
import { normalizeUrl, urlKey } from "./net-guard";
import { parseQuery, type QueryTerm } from "./query";
import { hostOf, knownSourceFor, knownSourceMeta, matchHost } from "./source-match";
import {
  FACET_SUGGESTIONS,
  RESOURCE_TYPES,
  SOURCE_CATEGORIES,
  TAG_KINDS,
  type CaptureStatus,
  type ResourceDetailDTO,
  type ResourceDTO,
  type ResourceType,
  type TagDTO,
  type TagKind,
} from "./types";

export const TRASH_RETENTION_DAYS = 30;

const tagInput = z.object({ kind: z.enum(TAG_KINDS), name: z.string().trim().min(1).max(60) });

export const resourceInput = z.object({
  type: z.enum(RESOURCE_TYPES),
  title: z.string().trim().max(300),
  description: z.string().max(5000).optional(),
  sourceUrl: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().max(100_000).optional(),
  content: z.string().max(2_000_000).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(tagInput).max(100).optional(),
  coverAssetId: z.string().nullable().optional(),
});

export const resourcePatch = resourceInput.partial();

export type ResourceInput = z.infer<typeof resourceInput>;
export type ResourcePatch = z.infer<typeof resourcePatch>;

export interface ListFilters {
  q?: string;
  type?: ResourceType;
  /** Any of these types (a section); ignored when `type` is set. */
  types?: readonly ResourceType[];
  /** Only resources saved from this source (matched by host). */
  via?: string;
  tagIds?: string[];
  collectionId?: string;
  trash?: boolean;
  /** `created` is newest first, `oldest` is by creation date the other way. */
  sort?: "updated" | "created" | "oldest" | "title";
  limit?: number;
  /** Rows to skip, for paging (see search.ts). */
  offset?: number;
}

type ResourceRow = typeof resources.$inferSelect;

type FullShot = ResourceDTO["fullShot"];

function toDTO(row: ResourceRow, rowTags: TagDTO[], fullShot: FullShot = null): ResourceDTO {
  return {
    id: row.id,
    type: row.type as ResourceType,
    title: row.title,
    description: row.description,
    sourceUrl: row.sourceUrl,
    notes: row.notes,
    content: row.content,
    meta: row.meta ?? {},
    coverAssetId: row.coverAssetId,
    captureStatus: row.captureStatus as CaptureStatus | null,
    captureError: row.captureError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    tags: rowTags,
    fullShot,
  };
}

async function fullShotsFor(resourceIds: string[]): Promise<Map<string, NonNullable<FullShot>>> {
  const map = new Map<string, NonNullable<FullShot>>();
  if (resourceIds.length === 0) return map;
  const db = await getDb();
  const rows = await db
    .select({ resourceId: resourceAssets.resourceId, id: assets.id, width: assets.width, height: assets.height })
    .from(resourceAssets)
    .innerJoin(assets, eq(assets.id, resourceAssets.assetId))
    .where(and(inArray(resourceAssets.resourceId, resourceIds), eq(resourceAssets.role, "screenshot-full")));
  for (const r of rows) map.set(r.resourceId, { id: r.id, width: r.width, height: r.height });
  return map;
}

async function tagsFor(resourceIds: string[]): Promise<Map<string, TagDTO[]>> {
  const map = new Map<string, TagDTO[]>();
  if (resourceIds.length === 0) return map;
  const db = await getDb();
  const rows = await db
    .select({ resourceId: resourceTags.resourceId, id: tags.id, kind: tags.kind, name: tags.name })
    .from(resourceTags)
    .innerJoin(tags, eq(tags.id, resourceTags.tagId))
    .where(inArray(resourceTags.resourceId, resourceIds))
    .orderBy(asc(tags.kind), asc(tags.name));
  for (const r of rows) {
    const list = map.get(r.resourceId) ?? [];
    list.push({ id: r.id, kind: r.kind as TagKind, name: r.name });
    map.set(r.resourceId, list);
  }
  return map;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** True when the column matches any of the term's patterns (case-insensitive regular expressions). */
function matchesTerm(column: SQLWrapper, term: QueryTerm) {
  return sql`(${sql.join(
    term.patterns.map((p) => sql`${column} ~* ${p}`),
    sql` or `,
  )})`;
}

/** A source's category by its label ("Type & Color"), so "fonts" or "inspiration" find the sources filed there. */
const categoryLabel = sql`(case ${resources.meta}->>'category' ${sql.join(
  SOURCE_CATEGORIES.map((c) => sql`when ${c.value} then ${c.label}`),
  sql` `,
)} else '' end)`;

function tagMatches(db: Awaited<ReturnType<typeof getDb>>, term: QueryTerm) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(resourceTags)
      .innerJoin(tags, eq(tags.id, resourceTags.tagId))
      .where(and(eq(resourceTags.resourceId, resources.id), matchesTerm(tags.name, term))),
  );
}

/** The WHERE and ORDER BY of a list, shared by `listResources` and `countResources` so a page and its total agree. */
async function listQuery(filters: ListFilters) {
  const db = await getDb();
  const where: SQL[] = [filters.trash ? isNotNull(resources.deletedAt) : isNull(resources.deletedAt)];
  if (filters.type) where.push(eq(resources.type, filters.type));
  else if (filters.types?.length) where.push(inArray(resources.type, [...filters.types]));
  if (filters.via) {
    const ids = (await sourceAttribution()).get(filters.via) ?? [];
    where.push(ids.length ? inArray(resources.id, ids) : sql`false`);
  }

  const q = filters.q?.trim();
  const terms = q ? parseQuery(q) : [];
  // Every term must match somewhere: a field, a tag name, or a source's category (see query.ts for what a term is).
  for (const term of terms) {
    where.push(
      or(
        matchesTerm(resources.title, term),
        matchesTerm(resources.description, term),
        matchesTerm(resources.notes, term),
        matchesTerm(resources.content, term),
        matchesTerm(sql`coalesce(${resources.sourceUrl}, '')`, term),
        matchesTerm(categoryLabel, term),
        tagMatches(db, term),
      )!,
    );
  }

  // AND semantics: the resource must carry every selected tag.
  for (const tagId of filters.tagIds ?? []) {
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(resourceTags)
          .where(and(eq(resourceTags.resourceId, resources.id), eq(resourceTags.tagId, tagId))),
      ),
    );
  }

  if (filters.collectionId) {
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(collectionItems)
          .where(
            and(eq(collectionItems.resourceId, resources.id), eq(collectionItems.collectionId, filters.collectionId)),
          ),
      ),
    );
  }

  // With a search: the whole query in the title, then every term in the title, then a tag or category match, then the
  // description, then the rest (notes, content, URL). Within a tier, the chosen sort.
  const relevance = terms.length
    ? [
        asc(sql`case
          when ${resources.title} ilike ${`%${escapeLike(q!)}%`} then 0
          when ${and(...terms.map((t) => matchesTerm(resources.title, t)))} then 1
          when ${or(...terms.map((t) => or(tagMatches(db, t), matchesTerm(categoryLabel, t))!))} then 2
          when ${or(...terms.map((t) => matchesTerm(resources.description, t)))} then 3
          else 4 end`),
      ]
    : [];
  const order =
    filters.sort === "title"
      ? [asc(sql`lower(${resources.title})`)]
      : filters.sort === "created"
        ? [desc(resources.createdAt)]
        : filters.sort === "oldest"
          ? [asc(resources.createdAt)]
          : filters.trash
            ? [desc(resources.deletedAt)]
            : [desc(resources.updatedAt)];
  // the id settles ties, so the same query always lists in the same order and pages never overlap
  return { db, where: and(...where), orderBy: [...relevance, ...order, asc(resources.id)] };
}

export async function listResources(filters: ListFilters = {}): Promise<ResourceDTO[]> {
  const { db, where, orderBy } = await listQuery(filters);
  const rows = await db
    .select()
    .from(resources)
    .where(where)
    .orderBy(...orderBy)
    .limit(filters.limit ?? 1000)
    .offset(filters.offset ?? 0);
  const ids = rows.map((r) => r.id);
  const [tagMap, shots] = await Promise.all([tagsFor(ids), fullShotsFor(ids)]);
  return rows.map((r) => toDTO(r, tagMap.get(r.id) ?? [], shots.get(r.id)));
}

export async function getResource(id: string): Promise<ResourceDetailDTO | null> {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, id)).limit(1);
  if (!row) return null;
  const [tagMap, shots, assetList, cols] = await Promise.all([
    tagsFor([id]),
    fullShotsFor([id]),
    listResourceAssets(id),
    db
      .select({ id: collections.id, name: collections.name })
      .from(collectionItems)
      .innerJoin(collections, eq(collections.id, collectionItems.collectionId))
      .where(eq(collectionItems.resourceId, id))
      .orderBy(asc(collections.name)),
  ]);
  return { ...toDTO(row, tagMap.get(id) ?? [], shots.get(id)), assets: assetList, collections: cols };
}

export async function getResourcesByIds(ids: string[]): Promise<ResourceDTO[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows = await db.select().from(resources).where(inArray(resources.id, ids));
  const [tagMap, shots] = await Promise.all([tagsFor(ids), fullShotsFor(ids)]);
  const byId = new Map(rows.map((r) => [r.id, toDTO(r, tagMap.get(r.id) ?? [], shots.get(r.id))]));
  return ids.map((id) => byId.get(id)).filter((r): r is ResourceDTO => !!r);
}

async function upsertTags(input: { kind: TagKind; name: string }[]): Promise<string[]> {
  const db = await getDb();
  const ids: string[] = [];
  for (const t of input) {
    const name = t.name.trim().replace(/\s+/g, " ");
    const find = () =>
      db
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.kind, t.kind), sql`lower(${tags.name}) = lower(${name})`))
        .limit(1);
    let [found] = await find();
    if (!found) {
      await db.insert(tags).values({ kind: t.kind, name }).onConflictDoNothing();
      [found] = await find();
    }
    if (found && !ids.includes(found.id)) ids.push(found.id);
  }
  return ids;
}

async function setResourceTags(resourceId: string, input: { kind: TagKind; name: string }[]) {
  const db = await getDb();
  const ids = await upsertTags(input);
  await db.delete(resourceTags).where(eq(resourceTags.resourceId, resourceId));
  if (ids.length) await db.insert(resourceTags).values(ids.map((tagId) => ({ resourceId, tagId })));
}

/** Skills keep their title/description in SKILL.md frontmatter; mirror them into the columns. */
function deriveFromSkill(content: string) {
  try {
    const fm = matter(content).data as { name?: unknown; description?: unknown };
    return {
      title: typeof fm.name === "string" ? fm.name : undefined,
      description: typeof fm.description === "string" ? fm.description : undefined,
    };
  } catch {
    return {};
  }
}

function cleanUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    return normalizeUrl(url);
  } catch {
    return url.trim() || null;
  }
}

export async function createResource(input: ResourceInput): Promise<ResourceDetailDTO> {
  const data = resourceInput.parse(input);
  const db = await getDb();
  const derived: { title?: string; description?: string } =
    data.type === "skill" && data.content ? deriveFromSkill(data.content) : {};
  if (data.type === "source") {
    // A site we know starts with its category, search URL and pricing filled in.
    data.meta = { ...knownSourceMeta(data.sourceUrl), ...data.meta };
    derived.description = knownSourceFor(data.sourceUrl)?.description;
  }
  const [row] = await db
    .insert(resources)
    .values({
      type: data.type,
      title: data.title || derived.title || "Untitled",
      // An empty description (a form left blank) still takes the derived one.
      description: data.description || derived.description || "",
      sourceUrl: cleanUrl(data.sourceUrl),
      notes: data.notes ?? "",
      content: data.content ?? "",
      meta: data.meta ?? {},
      coverAssetId: data.coverAssetId ?? null,
    })
    .returning();
  if (data.tags?.length) await setResourceTags(row.id, data.tags);
  return (await getResource(row.id))!;
}

export async function updateResource(id: string, patch: ResourcePatch): Promise<ResourceDetailDTO | null> {
  const data = resourcePatch.parse(patch);
  const db = await getDb();
  const [current] = await db.select().from(resources).where(eq(resources.id, id)).limit(1);
  if (!current) return null;

  const set: Partial<typeof resources.$inferInsert> = { updatedAt: new Date() };
  if (data.type !== undefined) set.type = data.type;
  if (data.title !== undefined) set.title = data.title || "Untitled";
  if (data.description !== undefined) set.description = data.description;
  if (data.sourceUrl !== undefined) set.sourceUrl = cleanUrl(data.sourceUrl);
  if (data.notes !== undefined) set.notes = data.notes;
  if (data.content !== undefined) set.content = data.content;
  if (data.meta !== undefined) set.meta = { ...(current.meta ?? {}), ...data.meta };
  if (data.coverAssetId !== undefined) set.coverAssetId = data.coverAssetId;
  if ((data.type ?? current.type) === "skill" && data.content !== undefined) {
    const d = deriveFromSkill(data.content);
    if (d.title) set.title = d.title;
    if (d.description !== undefined) set.description = d.description;
  }

  await db.update(resources).set(set).where(eq(resources.id, id));
  if (data.tags) await setResourceTags(id, data.tags);
  return getResource(id);
}

/** Internal updates (capture jobs, skill sync) that must not bump updatedAt. */
export async function setResourceFields(id: string, set: Partial<typeof resources.$inferInsert>) {
  const db = await getDb();
  await db.update(resources).set(set).where(eq(resources.id, id));
}

export async function trashResources(ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.update(resources).set({ deletedAt: new Date() }).where(inArray(resources.id, ids));
}

export async function restoreResources(ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.update(resources).set({ deletedAt: null }).where(inArray(resources.id, ids));
}

/** Permanently deletes resources, then any asset files nothing else uses. */
export async function purgeResources(ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  const linked = await db
    .select({ assetId: resourceAssets.assetId })
    .from(resourceAssets)
    .where(inArray(resourceAssets.resourceId, ids));
  await db.delete(resources).where(inArray(resources.id, ids));
  await deleteOrphanAssets([...new Set(linked.map((l) => l.assetId))]);
}

export async function emptyTrash() {
  const db = await getDb();
  const rows = await db.select({ id: resources.id }).from(resources).where(isNotNull(resources.deletedAt));
  await purgeResources(rows.map((r) => r.id));
  return rows.length;
}

export async function purgeExpiredTrash() {
  const db = await getDb();
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: resources.id })
    .from(resources)
    .where(and(isNotNull(resources.deletedAt), lt(resources.deletedAt, cutoff)));
  await purgeResources(rows.map((r) => r.id));
  return rows.length;
}

/** How many resources the filters match, ignoring `limit` and `offset`. */
export async function countResources(filters: ListFilters = {}): Promise<number> {
  const { db, where } = await listQuery(filters);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(resources)
    .where(where);
  return row?.n ?? 0;
}

/** Tag ids for facet or tag names, matched by kind and case-insensitively; names that don't exist are returned apart. */
export async function resolveTagNames(names: { kind: TagKind; name: string }[]) {
  if (!names.length) return { ids: [] as string[], unknown: [] as { kind: TagKind; name: string }[] };
  const db = await getDb();
  const ids: string[] = [];
  const unknown: { kind: TagKind; name: string }[] = [];
  for (const n of names) {
    const [row] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.kind, n.kind), sql`lower(${tags.name}) = lower(${n.name.trim()})`))
      .limit(1);
    if (row) ids.push(row.id);
    else unknown.push(n);
  }
  return { ids, unknown };
}

/** Live resources whose URL matches, ignoring protocol, www and trailing slashes. */
export async function findByUrl(url: string, excludeId?: string): Promise<ResourceDTO[]> {
  const key = urlKey(url);
  const host = key.split("/")[0];
  if (!host) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(resources)
    .where(
      and(
        isNull(resources.deletedAt),
        ilike(resources.sourceUrl, `%${escapeLike(host)}%`),
        excludeId ? ne(resources.id, excludeId) : undefined,
      ),
    );
  return rows.filter((r) => r.sourceUrl && urlKey(r.sourceUrl) === key).map((r) => toDTO(r, []));
}

/**
 * Which saved resources came from which source, by host. Each resource goes to the most specific
 * source that matches it, so a styles.refero.design page belongs to that source, not refero.design.
 */
export async function sourceAttribution(): Promise<Map<string, string[]>> {
  const db = await getDb();
  const rows = await db
    .select({ id: resources.id, type: resources.type, sourceUrl: resources.sourceUrl })
    .from(resources)
    .where(and(isNull(resources.deletedAt), isNotNull(resources.sourceUrl)))
    // two sources on one host: the one saved first owns it, every time
    .orderBy(asc(resources.createdAt), asc(resources.id));
  const sourceByHost = new Map<string, string>();
  for (const r of rows) {
    const host = r.type === "source" ? hostOf(r.sourceUrl) : null;
    if (!host) continue;
    // a known site's old domains (godly.website for recent.design) belong to the same source
    const known = knownSourceFor(r.sourceUrl);
    const hosts = known?.host === host ? [host, ...(known.aliases ?? [])] : [host];
    for (const h of hosts) if (!sourceByHost.has(h)) sourceByHost.set(h, r.id);
  }
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (r.type === "source") continue;
    const host = hostOf(r.sourceUrl);
    const match = host && matchHost(host, sourceByHost.keys());
    if (!match) continue;
    const id = sourceByHost.get(match)!;
    out.set(id, [...(out.get(id) ?? []), r.id]);
  }
  return out;
}

/** Number of saved resources per source id. */
export async function sourceStats(): Promise<Record<string, number>> {
  return Object.fromEntries([...(await sourceAttribution())].map(([id, ids]) => [id, ids.length]));
}

export async function typeCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({ type: resources.type, count: sql<number>`count(*)::int` })
    .from(resources)
    .where(isNull(resources.deletedAt))
    .groupBy(resources.type);
  const trash = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(resources)
    .where(isNotNull(resources.deletedAt));
  const counts: Record<string, number> = { trash: Number(trash[0]?.count ?? 0), all: 0 };
  for (const r of rows) {
    counts[r.type] = Number(r.count);
    counts.all += Number(r.count);
  }
  return counts;
}

// ---- Tags ----------------------------------------------------------------

let seeded = false;

async function seedFacets() {
  if (seeded) return;
  const db = await getDb();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tags)
    .where(ne(tags.kind, "tag"));
  if (Number(count) === 0) {
    const values = Object.entries(FACET_SUGGESTIONS).flatMap(([kind, names]) => names.map((name) => ({ kind, name })));
    await db.insert(tags).values(values).onConflictDoNothing();
  }
  seeded = true;
}

export async function listTags(): Promise<TagDTO[]> {
  await seedFacets();
  const db = await getDb();
  const rows = await db
    .select({
      id: tags.id,
      kind: tags.kind,
      name: tags.name,
      count: sql<number>`count(${resources.id})::int`,
    })
    .from(tags)
    .leftJoin(resourceTags, eq(resourceTags.tagId, tags.id))
    .leftJoin(resources, and(eq(resources.id, resourceTags.resourceId), isNull(resources.deletedAt)))
    .groupBy(tags.id)
    .orderBy(asc(tags.kind), asc(sql`lower(${tags.name})`));
  return rows.map((r) => ({ id: r.id, kind: r.kind as TagKind, name: r.name, count: Number(r.count) }));
}

export async function renameTag(id: string, name: string) {
  const db = await getDb();
  const clean = tagInput.shape.name.parse(name);
  const [tag] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  if (!tag) return;
  const [clash] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.kind, tag.kind), sql`lower(${tags.name}) = lower(${clean})`, ne(tags.id, id)))
    .limit(1);
  if (clash) {
    // Merge into the existing tag with that name.
    await db.execute(
      sql`insert into resource_tags (resource_id, tag_id) select resource_id, ${clash.id} from resource_tags where tag_id = ${id} on conflict do nothing`,
    );
    await db.delete(tags).where(eq(tags.id, id));
    return;
  }
  await db.update(tags).set({ name: clean }).where(eq(tags.id, id));
}

export async function deleteTag(id: string) {
  const db = await getDb();
  await db.delete(tags).where(eq(tags.id, id));
}

// ---- Collections ---------------------------------------------------------

export const collectionInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(5000).optional(),
});

export async function listCollections() {
  const db = await getDb();
  const rows = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      count: sql<number>`count(${resources.id})::int`,
    })
    .from(collections)
    .leftJoin(collectionItems, eq(collectionItems.collectionId, collections.id))
    .leftJoin(resources, and(eq(resources.id, collectionItems.resourceId), isNull(resources.deletedAt)))
    .groupBy(collections.id)
    .orderBy(asc(sql`lower(${collections.name})`));
  return rows.map((r) => ({
    ...r,
    count: Number(r.count),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getCollection(id: string) {
  return (await listCollections()).find((c) => c.id === id) ?? null;
}

export async function createCollection(input: z.infer<typeof collectionInput>) {
  const data = collectionInput.parse(input);
  const db = await getDb();
  const [row] = await db
    .insert(collections)
    .values({ name: data.name, description: data.description ?? "" })
    .returning();
  return row;
}

export async function updateCollection(id: string, input: Partial<z.infer<typeof collectionInput>>) {
  const data = collectionInput.partial().parse(input);
  const db = await getDb();
  await db
    .update(collections)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(collections.id, id));
}

export async function deleteCollection(id: string) {
  const db = await getDb();
  await db.delete(collections).where(eq(collections.id, id));
}

export async function addToCollection(collectionId: string, resourceIds: string[]) {
  if (!resourceIds.length) return;
  const db = await getDb();
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${collectionItems.position}), -1)` })
    .from(collectionItems)
    .where(eq(collectionItems.collectionId, collectionId));
  await db
    .insert(collectionItems)
    .values(resourceIds.map((resourceId, i) => ({ collectionId, resourceId, position: Number(max) + 1 + i })))
    .onConflictDoNothing();
  await db.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, collectionId));
}

export async function removeFromCollection(collectionId: string, resourceIds: string[]) {
  if (!resourceIds.length) return;
  const db = await getDb();
  await db
    .delete(collectionItems)
    .where(and(eq(collectionItems.collectionId, collectionId), inArray(collectionItems.resourceId, resourceIds)));
}

/** Resource ids in a collection, in the order they were added. */
export async function collectionResourceIds(collectionId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: collectionItems.resourceId })
    .from(collectionItems)
    .innerJoin(resources, eq(resources.id, collectionItems.resourceId))
    .where(and(eq(collectionItems.collectionId, collectionId), isNull(resources.deletedAt)))
    .orderBy(asc(collectionItems.position));
  return rows.map((r) => r.id);
}
