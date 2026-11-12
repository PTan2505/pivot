import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { clipRequests } from "./db/schema";

/**
 * Claims a client request id before saving. Returns null when this call owns it (go ahead and save), or the
 * resource id an earlier request with the same id created. Throws when that earlier request is still saving.
 */
export async function claimClipRequest(id: string, { waitMs = 10_000 } = {}): Promise<string | null> {
  const db = await getDb();
  const inserted = await db.insert(clipRequests).values({ id }).onConflictDoNothing().returning();
  if (inserted.length) return null;
  const started = Date.now();
  for (;;) {
    const [row] = await db.select().from(clipRequests).where(eq(clipRequests.id, id)).limit(1);
    // the earlier request failed and let go of the id, or its resource was deleted for good: save again
    if (!row) return claimClipRequest(id, { waitMs: Math.max(0, waitMs - (Date.now() - started)) });
    if (row.resourceId) return row.resourceId;
    if (Date.now() - started >= waitMs) throw new ClipInProgressError();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export class ClipInProgressError extends Error {
  constructor() {
    super("This save is already in progress. Try again in a moment.");
  }
}

/** Records the resource a claimed request created. */
export async function completeClipRequest(id: string, resourceId: string) {
  const db = await getDb();
  await db.update(clipRequests).set({ resourceId }).where(eq(clipRequests.id, id));
}

/** Lets go of a claim whose save failed, so a retry can save. */
export async function releaseClipRequest(id: string) {
  const db = await getDb();
  await db.delete(clipRequests).where(eq(clipRequests.id, id));
}
