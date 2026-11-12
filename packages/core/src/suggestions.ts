import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db/client";
import { collections, resources, resourceSuggestions, tags } from "./db/schema";
import { addToCollection, createCollection, getResource, updateResource } from "./resources";
import { SUGGESTION_KINDS, TAG_KINDS, type SuggestionDTO, type SuggestionKind, type TagKind } from "./types";

export class SuggestionError extends Error {}

export interface SuggestionInput {
  kind: SuggestionKind;
  value: Record<string, unknown>;
  reason?: string;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A comparable key for "the same suggestion", so a repeat isn't stored twice. */
function keyOf(kind: string, value: Record<string, unknown>) {
  if (kind === "facet") return `facet:${text(value.kind)}:${text(value.name).toLowerCase()}`;
  if (kind === "collection") return `collection:${text(value.id) || text(value.name).toLowerCase()}`;
  return `${kind}:${text(value.text).toLowerCase()}`;
}

function toDTO(r: typeof resourceSuggestions.$inferSelect, resourceTitle?: string): SuggestionDTO {
  return {
    id: r.id,
    resourceId: r.resourceId,
    kind: r.kind as SuggestionKind,
    value: r.value,
    reason: r.reason,
    source: r.source,
    status: r.status as SuggestionDTO["status"],
    createdAt: r.createdAt.toISOString(),
    ...(resourceTitle !== undefined ? { resourceTitle } : {}),
  };
}

/**
 * Stores an agent's suggestions for a reference, pending your review. Facet names are matched to the facets you
 * already use (any case) so no near-duplicate is introduced; a suggestion the reference already has, or one already
 * suggested, is skipped. Nothing on the reference changes until a suggestion is accepted.
 */
export async function addSuggestions(resourceId: string, items: SuggestionInput[], source = "agent") {
  const r = await getResource(resourceId);
  if (!r || r.deletedAt) throw new SuggestionError(`No reference ${resourceId}.`);
  const db = await getDb();
  const allTags = await db.select().from(tags);
  const allCollections = await db.select().from(collections);
  const existing = await db.select().from(resourceSuggestions).where(eq(resourceSuggestions.resourceId, resourceId));
  const known = new Set(existing.filter((e) => e.status !== "rejected").map((e) => keyOf(e.kind, e.value)));
  const added: SuggestionDTO[] = [];
  const skipped: { kind: string; value: Record<string, unknown>; why: string }[] = [];

  for (const item of items) {
    if (!(SUGGESTION_KINDS as readonly string[]).includes(item.kind)) {
      skipped.push({ ...item, why: "unknown kind" });
      continue;
    }
    let value = item.value;
    if (item.kind === "facet") {
      const kind = text(value.kind) as TagKind;
      const name = text(value.name);
      if (!(TAG_KINDS as readonly string[]).includes(kind) || !name) {
        skipped.push({ ...item, why: "a facet needs a known kind and a name" });
        continue;
      }
      const match = allTags.find((t) => t.kind === kind && t.name.toLowerCase() === name.toLowerCase());
      value = { kind, name: match?.name ?? name, existing: !!match };
      if (r.tags.some((t) => t.kind === kind && t.name.toLowerCase() === name.toLowerCase())) {
        skipped.push({ kind: item.kind, value, why: "already on the reference" });
        continue;
      }
    } else if (item.kind === "collection") {
      const name = text(value.name);
      const match = allCollections.find((c) => c.id === text(value.id) || c.name.toLowerCase() === name.toLowerCase());
      if (!match && !name) {
        skipped.push({ ...item, why: "a collection needs an id or a name" });
        continue;
      }
      value = match ? { id: match.id, name: match.name, existing: true } : { name, existing: false };
    } else {
      const t = text(value.text);
      if (!t) {
        skipped.push({ ...item, why: "empty text" });
        continue;
      }
      value = { text: t.slice(0, item.kind === "title" ? 300 : 2000) };
    }
    const key = keyOf(item.kind, value);
    if (known.has(key)) {
      skipped.push({ kind: item.kind, value, why: "already suggested" });
      continue;
    }
    known.add(key);
    const [row] = await db
      .insert(resourceSuggestions)
      .values({ resourceId, kind: item.kind, value, reason: (item.reason ?? "").slice(0, 500), source })
      .returning();
    added.push(toDTO(row));
  }
  return { added, skipped };
}

export async function listSuggestions({
  status = "pending",
  resourceId,
  limit = 200,
}: { status?: SuggestionDTO["status"]; resourceId?: string; limit?: number } = {}) {
  const db = await getDb();
  const rows = await db
    .select({ s: resourceSuggestions, title: resources.title, deletedAt: resources.deletedAt })
    .from(resourceSuggestions)
    .innerJoin(resources, eq(resources.id, resourceSuggestions.resourceId))
    .where(
      and(
        eq(resourceSuggestions.status, status),
        resourceId ? eq(resourceSuggestions.resourceId, resourceId) : undefined,
      ),
    )
    .orderBy(desc(resourceSuggestions.createdAt))
    .limit(limit);
  return rows.filter((r) => !r.deletedAt).map((r) => toDTO(r.s, r.title));
}

/**
 * Accepts or rejects suggestions. Accepting applies it the way you would: adds the facet or the collection (creating a
 * suggested collection only now, since you chose it), or sets the title or description.
 */
export async function decideSuggestions(ids: string[], accept: boolean) {
  if (!ids.length) return 0;
  const db = await getDb();
  const rows = await db
    .select()
    .from(resourceSuggestions)
    .where(and(inArray(resourceSuggestions.id, ids), eq(resourceSuggestions.status, "pending")));
  for (const s of rows) {
    if (accept) await apply(s);
    await db
      .update(resourceSuggestions)
      .set({ status: accept ? "accepted" : "rejected", decidedAt: new Date() })
      .where(eq(resourceSuggestions.id, s.id));
  }
  return rows.length;
}

async function apply(s: typeof resourceSuggestions.$inferSelect) {
  const r = await getResource(s.resourceId);
  if (!r) return;
  const v = s.value;
  if (s.kind === "facet") {
    const tagsNow = r.tags.map((t) => ({ kind: t.kind, name: t.name }));
    await updateResource(r.id, { tags: [...tagsNow, { kind: text(v.kind) as TagKind, name: text(v.name) }] });
  } else if (s.kind === "collection") {
    const id = text(v.id) || (await createCollection({ name: text(v.name) })).id;
    await addToCollection(id, [r.id]);
  } else if (s.kind === "title") {
    await updateResource(r.id, { title: text(v.text) });
  } else if (s.kind === "description") {
    await updateResource(r.id, { description: text(v.text) });
  }
}

/**
 * Adds an agent's note to a reference without touching yours: appended on its own line, marked "agent" and dated.
 */
export async function annotateReference(resourceId: string, note: string) {
  const r = await getResource(resourceId);
  if (!r || r.deletedAt) throw new SuggestionError(`No reference ${resourceId}.`);
  const line = `agent (${new Date().toISOString().slice(0, 10)}): ${note.trim().slice(0, 2000)}`;
  await updateResource(resourceId, { notes: r.notes.trim() ? `${r.notes.trimEnd()}\n\n${line}` : line });
  return line;
}
