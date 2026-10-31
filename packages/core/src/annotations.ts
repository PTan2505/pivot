import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import { assetAnnotations, resourceAssets } from "./db/schema";
import type { AnnotationDTO } from "./types";

export class AnnotationError extends Error {}

const fraction = z.number().min(0).max(1);

export const annotationInput = z.object({
  assetId: z.string().min(1),
  kind: z.enum(["pin", "region"]).default("region"),
  x: fraction,
  y: fraction,
  width: fraction.default(0),
  height: fraction.default(0),
  note: z.string().max(2000).default(""),
  author: z.enum(["user", "agent"]).default("user"),
});

/** Only what is sent changes: no defaults here, or a note edit would reset the box's size. */
export const annotationPatch = z
  .object({
    kind: z.enum(["pin", "region"]),
    x: fraction,
    y: fraction,
    width: fraction,
    height: fraction,
    note: z.string().max(2000),
  })
  .partial();

function toDTO(r: typeof assetAnnotations.$inferSelect): AnnotationDTO {
  return {
    id: r.id,
    resourceId: r.resourceId,
    assetId: r.assetId,
    kind: r.kind as AnnotationDTO["kind"],
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    note: r.note,
    author: r.author as AnnotationDTO["author"],
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listAnnotations(resourceId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(assetAnnotations)
    .where(eq(assetAnnotations.resourceId, resourceId))
    .orderBy(asc(assetAnnotations.createdAt));
  return rows.map(toDTO);
}

/** Adds a pin or a box with a note on one of the reference's own screenshots. */
export async function addAnnotation(resourceId: string, input: z.input<typeof annotationInput>) {
  const data = annotationInput.parse(input);
  const db = await getDb();
  const linked = await db
    .select({ assetId: resourceAssets.assetId })
    .from(resourceAssets)
    .where(eq(resourceAssets.resourceId, resourceId));
  if (!linked.some((l) => l.assetId === data.assetId)) {
    throw new AnnotationError("That screenshot doesn't belong to this reference.");
  }
  // a box can't run past the image's edge
  const width = Math.min(data.width, 1 - data.x);
  const height = Math.min(data.height, 1 - data.y);
  const [row] = await db
    .insert(assetAnnotations)
    .values({ ...data, resourceId, width, height })
    .returning();
  return toDTO(row);
}

export async function updateAnnotation(id: string, patch: z.input<typeof annotationPatch>) {
  const data = annotationPatch.parse(patch);
  const db = await getDb();
  const [row] = await db.update(assetAnnotations).set(data).where(eq(assetAnnotations.id, id)).returning();
  return row ? toDTO(row) : null;
}

export async function deleteAnnotation(id: string) {
  const db = await getDb();
  await db.delete(assetAnnotations).where(eq(assetAnnotations.id, id));
}
