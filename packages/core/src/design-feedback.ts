import { and, asc, eq, inArray } from "drizzle-orm";
import { MAX_EDGE } from "./agent-images";
import { MAX_FULL_PAGE_HEIGHT, renderHtml } from "./capture";
import { getDb } from "./db/client";
import { designFeedback, designMockups, designSessions } from "./db/schema";
import { DesignError } from "./design";
import { OwnerAuthError } from "./owner-approval";
import { storeFor, writeStore, type StorageKind } from "./storage";
import type { DesignFeedbackDTO, DesignFeedbackPin } from "./types";

/**
 * The owner's feedback on a mockup round, written in PIVOT and sent to the agent (docs/mockup-feedback-plan.md). Text,
 * and pins on a version's full-page render: a sandboxed mockup frame can't report where it was clicked or scrolled,
 * so pins sit on PIVOT's own picture of the version, at one of the session page's widths. Feedback never approves
 * anything, so it needs no passphrase, but only PIVOT's own page sends it: a request with the API token (an agent's)
 * is refused.
 */

export const FEEDBACK_LIMITS = { text: 5000, pins: 30, pinText: 1000 } as const;
/** The widths the session page shows a version at (Desktop, Tablet, Phone): the only ones pins are placed on. */
export const RENDER_WIDTHS = [1440, 834, 390] as const;

type FeedbackRow = typeof designFeedback.$inferSelect;

export function feedbackDTO(r: FeedbackRow): DesignFeedbackDTO {
  return {
    id: r.id,
    sessionId: r.sessionId,
    round: r.round,
    mockupId: r.mockupId,
    mockupDigest: r.mockupDigest,
    text: r.text,
    width: r.width,
    pins: r.pins ?? [],
    status: r.status === "addressed" ? "addressed" : "open",
    addressedRound: r.addressedRound,
    createdAt: r.createdAt.toISOString(),
  };
}

/** A session's feedback, oldest first. */
export async function listFeedback(sessionId: string): Promise<DesignFeedbackDTO[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(designFeedback)
    .where(eq(designFeedback.sessionId, sessionId))
    .orderBy(asc(designFeedback.createdAt), asc(designFeedback.id));
  return rows.map(feedbackDTO);
}

export async function getFeedback(id: string): Promise<DesignFeedbackDTO | null> {
  const db = await getDb();
  const [r] = await db.select().from(designFeedback).where(eq(designFeedback.id, id)).limit(1);
  return r ? feedbackDTO(r) : null;
}

/**
 * Stores the owner's feedback on a round of an exploring session: text for the round or one version, and pins on that
 * version's render at a width. Refuses a request carrying the API token. Throws DesignError for anything else wrong.
 */
export async function addFeedback(input: {
  sessionId: string;
  round: number;
  mockupId?: string | null;
  text?: string;
  width?: number | null;
  pins?: DesignFeedbackPin[];
  /** The request's Authorization header: any value is an agent's request. */
  bearer?: string | null;
}): Promise<DesignFeedbackDTO> {
  if (input.bearer)
    throw new OwnerAuthError(
      "Only the owner sends feedback, from PIVOT's own page. A request with the API token (an agent's) is refused.",
      403,
    );
  const text = String(input.text ?? "").trim();
  const pins = (input.pins ?? []).map((p) => ({ x: p.x, y: p.y, text: String(p.text ?? "").trim() }));
  if (text.length > FEEDBACK_LIMITS.text)
    throw new DesignError(`Feedback is at most ${FEEDBACK_LIMITS.text} characters.`);
  if (pins.length > FEEDBACK_LIMITS.pins) throw new DesignError(`At most ${FEEDBACK_LIMITS.pins} pins at a time.`);
  if (!text && !pins.some((p) => p.text)) throw new DesignError("Write what to change, in the text or on a pin.");
  const db = await getDb();
  const [s] = await db.select().from(designSessions).where(eq(designSessions.id, input.sessionId)).limit(1);
  if (!s) throw new DesignError(`No design session ${input.sessionId}.`);
  if (s.status !== "exploring")
    throw new DesignError(
      `The session is ${s.status}. Feedback asks for a new round, which is made while the session is exploring.`,
    );
  const roundVersions = await db
    .select({ id: designMockups.id, digest: designMockups.digest })
    .from(designMockups)
    .where(and(eq(designMockups.sessionId, input.sessionId), eq(designMockups.round, input.round)));
  if (!roundVersions.length) throw new DesignError(`This session has no round ${input.round}.`);
  const version = input.mockupId ? roundVersions.find((m) => m.id === input.mockupId) : undefined;
  if (input.mockupId && !version) throw new DesignError("That version isn't in this round.");
  let width: number | null = null;
  if (pins.length) {
    if (!version) throw new DesignError("Pins are placed on one version: say which (mockupId).");
    if (!RENDER_WIDTHS.includes(input.width as (typeof RENDER_WIDTHS)[number]))
      throw new DesignError(`Pins are placed on the render at ${RENDER_WIDTHS.join(", ")} px wide.`);
    width = input.width!;
    for (const [i, p] of pins.entries()) {
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > width ||
        p.y < 0 ||
        p.y > MAX_FULL_PAGE_HEIGHT
      )
        throw new DesignError(`Pin ${i + 1} is outside the page.`);
      if (p.text.length > FEEDBACK_LIMITS.pinText)
        throw new DesignError(`Pin ${i + 1}'s note is over ${FEEDBACK_LIMITS.pinText} characters.`);
    }
  }
  const [row] = await db
    .insert(designFeedback)
    .values({
      sessionId: input.sessionId,
      round: input.round,
      mockupId: version?.id ?? null,
      mockupDigest: version?.digest ?? null,
      text,
      width,
      pins: pins.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), text: p.text })),
      source: "owner",
    })
    .returning();
  await db.update(designSessions).set({ updatedAt: new Date() }).where(eq(designSessions.id, input.sessionId));
  return feedbackDTO(row);
}

/**
 * Marks feedback as answered by `round` (called when the agent saves a round with `addressesFeedback`). Every id must
 * be this session's feedback.
 */
export async function markFeedbackAddressed(sessionId: string, ids: string[], round: number) {
  if (!ids.length) return;
  const db = await getDb();
  const found = await db
    .select({ id: designFeedback.id })
    .from(designFeedback)
    .where(and(eq(designFeedback.sessionId, sessionId), inArray(designFeedback.id, ids)));
  if (found.length !== new Set(ids).size)
    throw new DesignError("addressesFeedback names feedback this session doesn't have.");
  await db
    .update(designFeedback)
    .set({ status: "addressed", addressedRound: round })
    .where(and(eq(designFeedback.sessionId, sessionId), inArray(designFeedback.id, ids)));
}

/** Checks `addressesFeedback` before anything is saved: this session's feedback, each named once. */
export async function checkFeedbackIds(sessionId: string, ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new DesignError("addressesFeedback names the same feedback twice.");
  if (!ids.length) return;
  const db = await getDb();
  const found = await db
    .select({ id: designFeedback.id })
    .from(designFeedback)
    .where(and(eq(designFeedback.sessionId, sessionId), inArray(designFeedback.id, ids)));
  if (found.length !== ids.length) throw new DesignError("addressesFeedback names feedback this session doesn't have.");
}

const renderKey = (digest: string, width: number) => `design-renders/${digest}-${width}.jpg`;

/**
 * A version's full-page render at one of the page's widths (JPEG), made once per content digest and width and kept in
 * the blob store. Interactive versions are rendered without their scripts, like on the session page.
 */
export async function renderMockup(
  mockupId: string,
  width: number,
): Promise<{ data: Buffer; width: number; height: number } | null> {
  if (!RENDER_WIDTHS.includes(width as (typeof RENDER_WIDTHS)[number]))
    throw new DesignError(`Renders are made at ${RENDER_WIDTHS.join(", ")} px wide.`);
  const db = await getDb();
  const [m] = await db
    .select({ html: designMockups.html, digest: designMockups.digest })
    .from(designMockups)
    .where(eq(designMockups.id, mockupId))
    .limit(1);
  if (!m) return null;
  const key = renderKey(m.digest, width);
  const store = writeStore();
  const cached = await store.get(key).catch(() => null);
  const sharp = (await import("sharp")).default;
  if (cached) {
    const meta = await sharp(cached, { limitInputPixels: false }).metadata();
    return { data: cached, width: meta.width ?? width, height: meta.height ?? 0 };
  }
  const shot = await renderHtml(m.html, { width });
  await store.put(key, shot.data, "image/jpeg");
  return shot;
}

/** The pin's number in a round marker, drawn over the crop. */
const marker = (n: number, cx: number, cy: number, w: number, h: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<circle cx="${cx}" cy="${cy}" r="15" fill="#ff6a13" stroke="#0c0806" stroke-width="3"/>` +
      `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#0c0806">${n}</text></svg>`,
  );

export interface PinImage {
  index: number;
  pin: DesignFeedbackPin;
  data: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  /** The part of the page it shows, in render pixels. */
  region: { left: number; top: number; width: number; height: number };
}

/**
 * What the agent looks at for one pin: the area around it on the version's render (up to 960 × 720 page pixels, the
 * pin kept inside), with the pin's number drawn on its spot. Null when the feedback, pin or version is gone.
 */
export async function pinImage(feedbackId: string, index: number): Promise<PinImage | null> {
  const fb = await getFeedback(feedbackId);
  const pin = fb?.pins[index];
  if (!fb || !pin || !fb.mockupId || !fb.width) return null;
  const render = await renderMockup(fb.mockupId, fb.width);
  if (!render) return null;
  const w = Math.min(render.width, 960);
  const h = Math.min(render.height, 720);
  const left = Math.max(0, Math.min(render.width - w, Math.round(pin.x - w / 2)));
  const top = Math.max(0, Math.min(render.height - h, Math.round(pin.y - h / 2)));
  const cx = Math.min(w - 16, Math.max(16, Math.round(pin.x - left)));
  const cy = Math.min(h - 16, Math.max(16, Math.round(pin.y - top)));
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(render.data, { limitInputPixels: false })
    .extract({ left, top, width: w, height: h })
    .composite([{ input: marker(index + 1, cx, cy, w, h), left: 0, top: 0 }])
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    index,
    pin,
    data,
    mimeType: "image/jpeg",
    width: info.width,
    height: info.height,
    region: { left, top, width: w, height: h },
  };
}

/** For tests: where a render of this version at this width is cached. */
export const renderStoreKey = renderKey;
export const renderStore = (kind?: StorageKind) => (kind ? storeFor(kind) : writeStore());
