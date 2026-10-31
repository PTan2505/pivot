import crypto from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { designDecisions, designSessions, designSnapshots } from "./db/schema";
import type {
  DesignDecisionDTO,
  DesignDecisionKind,
  DesignMilestone,
  DesignSessionDetailDTO,
  DesignSessionDTO,
  DesignSnapshotDTO,
  DesignStatus,
} from "./types";

export class DesignError extends Error {}

type SessionRow = typeof designSessions.$inferSelect;

function sessionDTO(r: SessionRow): DesignSessionDTO {
  return {
    id: r.id,
    title: r.title,
    targetProject: r.targetProject,
    surface: r.surface,
    status: r.status as DesignStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function snapshotDTO(r: typeof designSnapshots.$inferSelect): DesignSnapshotDTO {
  return {
    id: r.id,
    sessionId: r.sessionId,
    milestone: r.milestone as DesignMilestone,
    markdown: r.markdown,
    referenceIds: r.referenceIds ?? [],
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}

function decisionDTO(r: typeof designDecisions.$inferSelect): DesignDecisionDTO {
  return {
    id: r.id,
    sessionId: r.sessionId,
    kind: r.kind as DesignDecisionKind,
    summary: r.summary,
    direction: r.direction,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
  };
}

async function touch(sessionId: string, set: Partial<typeof designSessions.$inferInsert> = {}) {
  const db = await getDb();
  await db
    .update(designSessions)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(designSessions.id, sessionId));
}

/**
 * Stores a brief snapshot. The first complete brief (`initial`) opens a session when none is given; the other
 * milestones need the session. Saving the same Markdown at the same milestone again returns the same snapshot.
 * A major change after approval puts the session back to "exploring": it needs approving again.
 */
export async function saveDesignBrief(input: {
  sessionId?: string;
  title: string;
  targetProject?: string;
  surface?: string;
  milestone: DesignMilestone;
  markdown: string;
  referenceIds?: string[];
  note?: string;
}) {
  const db = await getDb();
  let sessionId = input.sessionId;
  let created = false;
  if (sessionId) {
    const [s] = await db.select().from(designSessions).where(eq(designSessions.id, sessionId)).limit(1);
    if (!s) throw new DesignError(`No design session ${sessionId}.`);
  } else {
    if (input.milestone !== "initial") {
      throw new DesignError("Only the first complete brief (milestone initial) starts a session; pass sessionId.");
    }
    const [s] = await db
      .insert(designSessions)
      .values({
        title: input.title.trim() || "Untitled design",
        targetProject: input.targetProject?.trim() ?? "",
        surface: input.surface?.trim() ?? "",
      })
      .returning();
    sessionId = s.id;
    created = true;
  }
  const digest = crypto.createHash("sha256").update(input.markdown).digest("hex");
  const [same] = await db
    .select()
    .from(designSnapshots)
    .where(
      and(
        eq(designSnapshots.sessionId, sessionId),
        eq(designSnapshots.milestone, input.milestone),
        eq(designSnapshots.digest, digest),
      ),
    )
    .limit(1);
  if (same) return { sessionId, snapshotId: same.id, created: false, duplicate: true };
  const [snap] = await db
    .insert(designSnapshots)
    .values({
      sessionId,
      milestone: input.milestone,
      markdown: input.markdown,
      referenceIds: input.referenceIds ?? [],
      note: input.note ?? "",
      digest,
    })
    .returning({ id: designSnapshots.id });
  await touch(sessionId, input.milestone === "major_change" ? { status: "exploring" } : {});
  return { sessionId, snapshotId: snap.id, created, duplicate: false };
}

/** Records a decision. An approval marks the session approved; a change or a deviation is kept as history. */
export async function recordDesignDecision(input: {
  sessionId: string;
  kind: DesignDecisionKind;
  summary: string;
  direction?: string;
  details?: string;
}) {
  const db = await getDb();
  const [s] = await db.select().from(designSessions).where(eq(designSessions.id, input.sessionId)).limit(1);
  if (!s) throw new DesignError(`No design session ${input.sessionId}.`);
  const [row] = await db
    .insert(designDecisions)
    .values({
      sessionId: input.sessionId,
      kind: input.kind,
      summary: input.summary,
      direction: input.direction ?? "",
      details: input.details ?? "",
    })
    .returning({ id: designDecisions.id });
  await touch(input.sessionId, input.kind === "approval" ? { status: "approved" } : {});
  return row.id;
}

export async function setDesignSessionStatus(sessionId: string, status: DesignStatus) {
  await touch(sessionId, { status });
}

export async function listDesignSessions({
  targetProject,
  limit = 50,
}: { targetProject?: string; limit?: number } = {}) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(designSessions)
    .where(targetProject ? eq(designSessions.targetProject, targetProject) : undefined)
    .orderBy(desc(designSessions.updatedAt))
    .limit(limit);
  return rows.map(sessionDTO);
}

export async function getDesignSession(id: string): Promise<DesignSessionDetailDTO | null> {
  const db = await getDb();
  const [s] = await db.select().from(designSessions).where(eq(designSessions.id, id)).limit(1);
  if (!s) return null;
  const snapshots = await db
    .select()
    .from(designSnapshots)
    .where(eq(designSnapshots.sessionId, id))
    .orderBy(asc(designSnapshots.createdAt));
  const decisions = await db
    .select()
    .from(designDecisions)
    .where(eq(designDecisions.sessionId, id))
    .orderBy(asc(designDecisions.createdAt));
  return { ...sessionDTO(s), snapshots: snapshots.map(snapshotDTO), decisions: decisions.map(decisionDTO) };
}
