import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "./db/client";
import { resourceLinks, resources } from "./db/schema";
import { findByUrl } from "./resources";
import type { LinkKind, ResourceLinkDTO } from "./types";
import { LINK_KINDS } from "./types";

/** Kinds that read the same both ways: one row covers both directions. */
const SYMMETRIC = new Set<LinkKind>(["same_source_page", "related_to"]);

export class LinkError extends Error {}

export function isLinkKind(v: unknown): v is LinkKind {
  return typeof v === "string" && (LINK_KINDS as readonly string[]).includes(v);
}

/** Adds a link unless the same one exists (either way round for symmetric kinds). Returns its id. */
export async function createLink(input: {
  fromId: string;
  toId: string;
  kind: LinkKind;
  confirmed?: boolean;
  origin?: "auto" | "user" | "agent";
}) {
  if (input.fromId === input.toId) throw new LinkError("A reference can't be linked to itself.");
  const db = await getDb();
  const found = await db
    .select({ id: resources.id })
    .from(resources)
    .where(inArray(resources.id, [input.fromId, input.toId]));
  if (found.length !== 2) throw new LinkError("Both references must exist.");
  const pairs = SYMMETRIC.has(input.kind)
    ? or(
        and(eq(resourceLinks.fromId, input.fromId), eq(resourceLinks.toId, input.toId)),
        and(eq(resourceLinks.fromId, input.toId), eq(resourceLinks.toId, input.fromId)),
      )
    : and(eq(resourceLinks.fromId, input.fromId), eq(resourceLinks.toId, input.toId));
  const [existing] = await db
    .select()
    .from(resourceLinks)
    .where(and(eq(resourceLinks.kind, input.kind), pairs))
    .limit(1);
  if (existing) {
    // a suggestion the user now makes themselves becomes confirmed
    if (input.confirmed !== false && !existing.confirmed) await confirmLink(existing.id);
    return existing.id;
  }
  const [row] = await db
    .insert(resourceLinks)
    .values({
      fromId: input.fromId,
      toId: input.toId,
      kind: input.kind,
      confirmed: input.confirmed === false ? 0 : 1,
      origin: input.origin ?? "user",
    })
    .returning({ id: resourceLinks.id });
  return row.id;
}

export async function confirmLink(id: string) {
  const db = await getDb();
  await db.update(resourceLinks).set({ confirmed: 1 }).where(eq(resourceLinks.id, id));
}

export async function deleteLink(id: string) {
  const db = await getDb();
  await db.delete(resourceLinks).where(eq(resourceLinks.id, id));
}

/** A reference's links in both directions, with the other reference's title, type and cover. Trashed ones are left out. */
export async function listLinks(resourceId: string): Promise<ResourceLinkDTO[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(resourceLinks)
    .where(or(eq(resourceLinks.fromId, resourceId), eq(resourceLinks.toId, resourceId)));
  if (!rows.length) return [];
  const otherIds = rows.map((r) => (r.fromId === resourceId ? r.toId : r.fromId));
  const others = await db
    .select({
      id: resources.id,
      title: resources.title,
      type: resources.type,
      coverAssetId: resources.coverAssetId,
      deletedAt: resources.deletedAt,
    })
    .from(resources)
    .where(inArray(resources.id, otherIds));
  const byId = new Map(others.map((o) => [o.id, o]));
  return rows
    .map((r) => {
      const other = byId.get(r.fromId === resourceId ? r.toId : r.fromId);
      if (!other || other.deletedAt) return null;
      return {
        id: r.id,
        kind: r.kind as LinkKind,
        direction: r.fromId === resourceId ? "out" : "in",
        confirmed: !!r.confirmed,
        origin: r.origin as ResourceLinkDTO["origin"],
        other: { id: other.id, title: other.title, type: other.type, coverAssetId: other.coverAssetId },
        createdAt: r.createdAt.toISOString(),
      } satisfies ResourceLinkDTO;
    })
    .filter((l): l is ResourceLinkDTO => !!l);
}

const isSection = (meta: Record<string, unknown> | null | undefined) => !!meta && typeof meta.section === "object";

/**
 * Links a new reference to the others saved from the very same page: a section becomes `part_of` the page, anything
 * else `same_source_page`. Same website alone is never enough. Returns how many links were made.
 */
export async function autoLinkSamePage(resourceId: string) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  if (!row?.sourceUrl) return 0;
  const others = await findByUrl(row.sourceUrl, resourceId);
  let made = 0;
  for (const other of others) {
    const meSection = isSection(row.meta);
    const otherSection = isSection(other.meta);
    if (meSection !== otherSection) {
      const [section, page] = meSection ? [resourceId, other.id] : [other.id, resourceId];
      await createLink({ fromId: section, toId: page, kind: "part_of", origin: "auto" });
    } else {
      await createLink({ fromId: resourceId, toId: other.id, kind: "same_source_page", origin: "auto" });
    }
    made++;
  }
  return made;
}
