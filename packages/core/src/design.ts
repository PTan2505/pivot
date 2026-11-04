import crypto from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db/client";
import { designDecisions, designMockups, designSessions, designSnapshots } from "./db/schema";
import type {
  DesignDecisionDTO,
  DesignDecisionKind,
  DesignDecisionSource,
  DesignMilestone,
  DesignMockupDTO,
  DesignSessionDetailDTO,
  DesignSessionDTO,
  DesignSnapshotDTO,
  DesignStatus,
} from "./types";

export class DesignError extends Error {}

/**
 * A mockup version's content identity: its HTML and whether it runs scripts. An approval stores it, so it names
 * exactly what the owner saw. The migration that added it computes the same value in SQL for older versions.
 */
export function mockupDigest(html: string, interactive = false) {
  return crypto
    .createHash("sha256")
    .update(`pivot-mockup:v1:${interactive ? "interactive" : "static"}:${html}`)
    .digest("hex");
}

type SessionRow = typeof designSessions.$inferSelect;

function sessionDTO(r: SessionRow): DesignSessionDTO {
  return {
    id: r.id,
    title: r.title,
    targetProject: r.targetProject,
    surface: r.surface,
    status: r.status as DesignStatus,
    approvalResetAt: r.approvalResetAt?.toISOString() ?? null,
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

function decisionDTO(
  r: typeof designDecisions.$inferSelect,
  digests: Map<string, string> = new Map(),
): DesignDecisionDTO {
  const current = r.mockupId ? digests.get(r.mockupId) : undefined;
  return {
    id: r.id,
    sessionId: r.sessionId,
    kind: r.kind as DesignDecisionKind,
    summary: r.summary,
    direction: r.direction,
    details: r.details,
    source: r.source as DesignDecisionSource,
    binding:
      r.mockupId && r.mockupDigest
        ? {
            mockupId: r.mockupId,
            digest: r.mockupDigest,
            status: current === undefined ? "missing" : current === r.mockupDigest ? "bound" : "changed",
          }
        : null,
    createdAt: r.createdAt.toISOString(),
  };
}

const MOCKUP_COLUMNS = {
  id: designMockups.id,
  sessionId: designMockups.sessionId,
  snapshotId: designMockups.snapshotId,
  round: designMockups.round,
  n: designMockups.n,
  title: designMockups.title,
  interactive: designMockups.interactive,
  digest: designMockups.digest,
  createdAt: designMockups.createdAt,
};

function mockupDTO(r: Omit<DesignMockupDTO, "createdAt"> & { createdAt: Date }): DesignMockupDTO {
  return { ...r, createdAt: r.createdAt.toISOString() };
}

type ApprovalRow = { id: string; createdAt: Date; mockupId: string | null; mockupDigest: string | null };

/**
 * The approval that counts now, from a session's approvals: the newest one recorded after the session last went back
 * to exploring (`resetAt`). Approvals recorded at the same moment count only if they name the same version and digest;
 * otherwise none does, rather than picking one. Older approvals never count instead of a newer one.
 */
export function pickCurrentApproval<T extends ApprovalRow>(approvals: T[], resetAt: Date | null) {
  const sorted = [...approvals].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  const newest = sorted[0];
  if (!newest) return { approval: null, reason: "This session has no recorded approval yet." };
  if (resetAt && newest.createdAt.getTime() <= resetAt.getTime())
    return {
      approval: null,
      reason: "The session went back to exploring after its last approval: the direction needs approving again.",
    };
  const tied = sorted.filter((a) => a.createdAt.getTime() === newest.createdAt.getTime());
  if (tied.some((a) => a.mockupId !== newest.mockupId || a.mockupDigest !== newest.mockupDigest))
    return {
      approval: null,
      reason: "Approvals of different versions were recorded at the same moment, so none counts: approve again.",
    };
  return { approval: newest, reason: null };
}

async function currentApproval(sessionId: string) {
  const db = await getDb();
  const [s] = await db
    .select({ resetAt: designSessions.approvalResetAt })
    .from(designSessions)
    .where(eq(designSessions.id, sessionId))
    .limit(1);
  if (!s) throw new DesignError(`No design session ${sessionId}.`);
  const approvals = await db
    .select({
      id: designDecisions.id,
      createdAt: designDecisions.createdAt,
      mockupId: designDecisions.mockupId,
      mockupDigest: designDecisions.mockupDigest,
    })
    .from(designDecisions)
    .where(and(eq(designDecisions.sessionId, sessionId), eq(designDecisions.kind, "approval")));
  return pickCurrentApproval(approvals, s.resetAt);
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
  // a major change needs approving again: approvals recorded before it stop counting
  await touch(
    sessionId,
    input.milestone === "major_change" ? { status: "exploring", approvalResetAt: new Date() } : {},
  );
  return { sessionId, snapshotId: snap.id, created, duplicate: false };
}

/**
 * Checks a version of this session against its stored digest (recomputed from its HTML) and, when given, the digest
 * the caller saw (the full digest, or at least its first 12 characters). Returns the version's digest.
 */
async function verifiedDigest(sessionId: string, mockupId: string, seen?: string) {
  const db = await getDb();
  const [m] = await db
    .select({
      sessionId: designMockups.sessionId,
      html: designMockups.html,
      interactive: designMockups.interactive,
      digest: designMockups.digest,
    })
    .from(designMockups)
    .where(eq(designMockups.id, mockupId))
    .limit(1);
  if (!m || m.sessionId !== sessionId) throw new DesignError(`No mockup version ${mockupId} in this session.`);
  if (mockupDigest(m.html, m.interactive) !== m.digest)
    throw new DesignError(`Mockup version ${mockupId} no longer matches the content it was saved with.`);
  const want = seen?.trim().toLowerCase();
  if (want !== undefined && (want.length < 12 || !m.digest.startsWith(want)))
    throw new DesignError(
      `The version shown (digest ${want.slice(0, 12) || "none"}) isn't the stored one (digest ${m.digest.slice(0, 12)}): reload it before approving.`,
    );
  return m.digest;
}

/**
 * Records a decision. An approval marks the session approved; a change or a deviation is kept as history. With a
 * `mockupId`, the decision is bound to that version's content digest (checked against `mockupDigest` when given).
 */
export async function recordDesignDecision(input: {
  sessionId: string;
  kind: DesignDecisionKind;
  summary: string;
  direction?: string;
  details?: string;
  /** "owner" when the user approved in PIVOT; the agent's records are "agent". */
  source?: DesignDecisionSource;
  mockupId?: string;
  mockupDigest?: string;
}) {
  const db = await getDb();
  const [s] = await db.select().from(designSessions).where(eq(designSessions.id, input.sessionId)).limit(1);
  if (!s) throw new DesignError(`No design session ${input.sessionId}.`);
  if (input.mockupDigest && !input.mockupId) throw new DesignError("mockupDigest needs the mockupId it belongs to.");
  if (input.kind === "approval" && !input.mockupId) {
    // Once a session has mockups in PIVOT, an approval names the version approved (a mix names the version it starts
    // from, the rest goes in details). Only a session without any mockup can be approved without one.
    const [any] = await db
      .select({ id: designMockups.id })
      .from(designMockups)
      .where(eq(designMockups.sessionId, input.sessionId))
      .limit(1);
    if (any)
      throw new DesignError(
        "This session has mockups in PIVOT: pass the mockupId of the version the user approved (for a mix, the version it starts from).",
      );
  }
  const bound = input.mockupId ? await verifiedDigest(input.sessionId, input.mockupId, input.mockupDigest) : null;
  const [row] = await db
    .insert(designDecisions)
    .values({
      sessionId: input.sessionId,
      kind: input.kind,
      summary: input.summary,
      direction: input.direction ?? "",
      details: input.details ?? "",
      source: input.source ?? "agent",
      mockupId: input.mockupId ?? null,
      mockupDigest: bound,
    })
    .returning({ id: designDecisions.id });
  await touch(input.sessionId, input.kind === "approval" ? { status: "approved" } : {});
  return row.id;
}

/**
 * Changes a session's status by hand. "approved" and "building" need an approval that counts now (pickCurrentApproval):
 * an approval is the user's decision, recorded with record_design_decision or made in PIVOT, never a status flipped in
 * the UI. Building also checks that the approved version is still the content approved. Going back to exploring (Reopen)
 * means the direction needs approving again: approvals recorded before it stop counting.
 */
export async function setDesignSessionStatus(sessionId: string, status: DesignStatus) {
  if (status === "approved" || status === "building") {
    const { approval, reason } = await currentApproval(sessionId);
    if (!approval) throw new DesignError(`${reason} Approve a direction first.`);
    if (status === "building" && (approval.mockupId || approval.mockupDigest)) {
      if (!approval.mockupId || !approval.mockupDigest)
        throw new DesignError("The approval's binding is incomplete. Ask for approval again.");
      const now = await verifiedDigest(sessionId, approval.mockupId).catch((err: Error) => {
        throw new DesignError(`The approved version can't be checked: ${err.message} Ask for approval again.`);
      });
      if (now !== approval.mockupDigest)
        throw new DesignError("The approved version's content changed since it was approved. Ask for approval again.");
    }
  }
  await touch(sessionId, status === "exploring" ? { status, approvalResetAt: new Date() } : { status });
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
    .orderBy(asc(designDecisions.createdAt), asc(designDecisions.id));
  const mockups = await db
    .select(MOCKUP_COLUMNS)
    .from(designMockups)
    .where(eq(designMockups.sessionId, id))
    .orderBy(asc(designMockups.round), asc(designMockups.n));
  // A bound version counts as unchanged only if its HTML still hashes to its digest: recompute it for those versions.
  const boundIds = [...new Set(decisions.flatMap((d) => (d.mockupId ? [d.mockupId] : [])))];
  const checked = boundIds.length
    ? await db
        .select({ id: designMockups.id, html: designMockups.html, interactive: designMockups.interactive })
        .from(designMockups)
        // only this session's versions: an approval can't be confirmed by another session's mockup
        .where(and(eq(designMockups.sessionId, id), inArray(designMockups.id, boundIds)))
    : [];
  const digests = new Map(mockups.map((m) => [m.id, m.digest]));
  for (const c of checked) digests.set(c.id, mockupDigest(c.html, c.interactive));
  const current = pickCurrentApproval(
    decisions.filter((d) => d.kind === "approval"),
    s.approvalResetAt,
  );
  return {
    ...sessionDTO(s),
    currentApprovalId: current.approval?.id ?? null,
    snapshots: snapshots.map(snapshotDTO),
    decisions: decisions.map((d) => decisionDTO(d, digests)),
    mockups: mockups.map(mockupDTO),
  };
}

export const MOCKUP_LIMITS = { versions: 9, bytes: 2 * 1024 * 1024, title: 120 } as const;

/**
 * Saves a round of mockup versions while the session is exploring (a new direction or a major change). Each call is a
 * new round; the same titles and HTML again return the round already saved. The HTML must be self-contained: it is
 * served sandboxed, without scripts or other hosts.
 */
export async function saveDesignMockups(input: {
  sessionId: string;
  snapshotId?: string;
  mockups: { title: string; html: string }[];
}): Promise<{ round: number; ids: string[]; created: boolean }> {
  const { mockups } = input;
  if (mockups.length < 1 || mockups.length > MOCKUP_LIMITS.versions)
    throw new DesignError(`Save 1 to ${MOCKUP_LIMITS.versions} mockup versions at a time.`);
  for (const [i, m] of mockups.entries()) {
    if (!m.title.trim() || m.title.length > MOCKUP_LIMITS.title)
      throw new DesignError(`Version ${i + 1} needs a title of 1 to ${MOCKUP_LIMITS.title} characters.`);
    if (Buffer.byteLength(m.html) > MOCKUP_LIMITS.bytes)
      throw new DesignError(`Version ${i + 1} is over ${MOCKUP_LIMITS.bytes / 1024 / 1024} MB.`);
  }
  const db = await getDb();
  const [s] = await db.select().from(designSessions).where(eq(designSessions.id, input.sessionId)).limit(1);
  if (!s) throw new DesignError(`No design session ${input.sessionId}.`);
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify(mockups.map((m) => [m.title.trim(), m.html])))
    .digest("hex");
  const same = await db
    .select({ id: designMockups.id, round: designMockups.round })
    .from(designMockups)
    .where(and(eq(designMockups.sessionId, input.sessionId), eq(designMockups.roundDigest, digest)))
    .orderBy(asc(designMockups.n));
  if (same.length) return { round: same[0].round, ids: same.map((r) => r.id), created: false };
  if (s.status !== "exploring")
    throw new DesignError(
      `The session is ${s.status}. Mockups are saved while a direction is explored: a new brief, or a major change after approval.`,
    );
  const [last] = await db
    .select({ round: designMockups.round })
    .from(designMockups)
    .where(eq(designMockups.sessionId, input.sessionId))
    .orderBy(desc(designMockups.round))
    .limit(1);
  const round = (last?.round ?? 0) + 1;
  let snapshotId = input.snapshotId ?? null;
  if (!snapshotId) {
    const [snap] = await db
      .select({ id: designSnapshots.id })
      .from(designSnapshots)
      .where(eq(designSnapshots.sessionId, input.sessionId))
      .orderBy(desc(designSnapshots.createdAt))
      .limit(1);
    snapshotId = snap?.id ?? null;
  }
  const rows = await db
    .insert(designMockups)
    .values(
      mockups.map((m, i) => ({
        sessionId: input.sessionId,
        snapshotId,
        round,
        n: i + 1,
        title: m.title.trim(),
        html: m.html,
        interactive: false,
        digest: mockupDigest(m.html, false),
        roundDigest: digest,
      })),
    )
    .returning({ id: designMockups.id });
  await touch(input.sessionId);
  return { round, ids: rows.map((r) => r.id), created: true };
}

/** One mockup's HTML, for the sandboxed route. */
export async function getDesignMockupHtml(id: string) {
  const db = await getDb();
  const [m] = await db
    .select({ html: designMockups.html, title: designMockups.title })
    .from(designMockups)
    .where(eq(designMockups.id, id))
    .limit(1);
  return m ?? null;
}

/**
 * The owner approves one mockup version in PIVOT: an `approval` decision with source "owner", the version as the
 * direction and the owner's note, verbatim, as the details, bound to the version's digest. `seenDigest` is the digest
 * of the copy the page showed: a stale page can't approve content it didn't show. Only while the session is exploring.
 */
export async function approveDesignMockup(mockupId: string, note = "", seenDigest?: string) {
  const db = await getDb();
  const [m] = await db.select(MOCKUP_COLUMNS).from(designMockups).where(eq(designMockups.id, mockupId)).limit(1);
  if (!m) return null;
  const [s] = await db.select().from(designSessions).where(eq(designSessions.id, m.sessionId)).limit(1);
  if (s?.status !== "exploring")
    throw new DesignError(`The session is ${s?.status}. A version can be approved while the session is exploring.`);
  const id = await recordDesignDecision({
    sessionId: m.sessionId,
    kind: "approval",
    summary: `The owner approved version ${m.n}, "${m.title}" (round ${m.round}), in PIVOT.`,
    direction: `Version ${m.n}: ${m.title} (round ${m.round})`,
    details: note.trim(),
    source: "owner",
    mockupId,
    mockupDigest: seenDigest,
  });
  return { id, sessionId: m.sessionId };
}
