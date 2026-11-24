import crypto from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { MAX_EDGE } from "./agent-images";
import { elementsHtml, MAX_FULL_PAGE_HEIGHT, renderHtml, type RenderedElement } from "./capture";
import { getDb } from "./db/client";
import { designFeedback, designMockups, designSessions } from "./db/schema";
import { DesignError } from "./design";
import { OwnerAuthError } from "./owner-approval";
import { storeFor, writeStore, type StorageKind } from "./storage";
import type { DesignFeedbackDTO, DesignFeedbackElement, DesignFeedbackPin } from "./types";

/**
 * The owner's feedback on a mockup round, written in PIVOT and sent to the agent (docs/mockup-feedback-plan.md). Text,
 * and pins on a version's full-page render: a sandboxed mockup frame can't report where it was clicked or scrolled,
 * so pins sit on PIVOT's own picture of the version, at one of the session page's widths. Feedback never approves
 * anything, so it needs no passphrase, but only PIVOT's own page sends it: a request with the API token (an agent's)
 * is refused. A pin may name an element the owner selected (the Select tool): PIVOT finds it in its own element map
 * of the same render, so the agent gets the element's selector, box and HTML rather than a spot.
 */

export const FEEDBACK_LIMITS = {
  text: 5000,
  pins: 30,
  pinText: 1000,
  captureBytes: 400_000,
  captureTotal: 6_000_000,
  captureEdge: 2400,
} as const;
/**
 * The widths a version is rendered and commented at: the session page's Tablet (834) and Phone (390), and Desktop at
 * 1440 or at the window's own width in the full-screen view and the preview window.
 */
export const RENDER_WIDTH = { min: 320, max: 2560 } as const;

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
export interface FeedbackPinInput {
  x: number;
  y: number;
  text: string;
  n?: number;
  element?: {
    selector: string;
    tag?: string;
    id?: string;
    classes?: string[];
    text?: string;
    label?: string;
    box?: { x: number; y: number; w: number; h: number };
    html?: string;
  };
  live?: boolean;
  capture?: { image: string; region: { left: number; top: number; width: number; height: number } };
}

const clip = (v: unknown, max: number) => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t ? t.slice(0, max) : undefined;
};
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN);

/** A live note's element, as the preview reported it, cut to the stored limits. Null when it isn't usable. */
function liveElement(e: FeedbackPinInput["element"], width: number): DesignFeedbackElement | null {
  if (!e) return null;
  const tag = clip(e.tag, 40)?.toLowerCase();
  const selector = clip(e.selector, 1000);
  const box = e.box && { x: int(e.box.x), y: int(e.box.y), w: int(e.box.w), h: int(e.box.h) };
  if (!tag || !/^[a-z][a-z0-9-]*$/.test(tag) || !selector || !box) return null;
  if (Object.values(box).some((n) => !Number.isFinite(n) || n < 0) || box.x > width || box.y > MAX_FULL_PAGE_HEIGHT)
    return null;
  const classes = (Array.isArray(e.classes) ? e.classes : [])
    .map((c) => clip(c, 60))
    .filter(Boolean)
    .slice(0, 3);
  const id = clip(e.id, 80);
  const text = clip(e.text, 80);
  const label = clip(e.label, 80);
  const html = typeof e.html === "string" && e.html.trim() ? e.html.trim().slice(0, 2000) : undefined;
  return {
    selector,
    tag,
    ...(id ? { id } : {}),
    ...(classes.length ? { classes: classes as string[] } : {}),
    ...(text ? { text } : {}),
    ...(label ? { label } : {}),
    box,
    ...(html ? { html } : {}),
  };
}

const captureKey = (sha256: string) => `design-captures/${sha256}.jpg`;

/**
 * Stores a live note's crop: decoded as an image (JPEG or PNG only), at most `captureBytes` and `captureEdge` pixels a
 * side, and re-encoded as JPEG, so what is kept is a picture and nothing else. Returns its sha256.
 */
async function storeCapture(image: string, i: number) {
  const raw = Buffer.from(String(image ?? "").replace(/^data:image\/(?:jpeg|png);base64,/, ""), "base64");
  if (!raw.length || raw.length > FEEDBACK_LIMITS.captureBytes)
    throw new DesignError(`Pin ${i + 1}'s picture is empty or over ${FEEDBACK_LIMITS.captureBytes / 1000} kB.`);
  const sharp = (await import("sharp")).default;
  const meta = await sharp(raw, { limitInputPixels: 40_000_000 })
    .metadata()
    .catch(() => null);
  if (!meta || (meta.format !== "jpeg" && meta.format !== "png"))
    throw new DesignError(`Pin ${i + 1}'s picture isn't a JPEG or PNG image.`);
  if ((meta.width ?? 0) > FEEDBACK_LIMITS.captureEdge || (meta.height ?? 0) > FEEDBACK_LIMITS.captureEdge)
    throw new DesignError(`Pin ${i + 1}'s picture is over ${FEEDBACK_LIMITS.captureEdge}px a side.`);
  const jpeg = await sharp(raw).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const sha256 = crypto.createHash("sha256").update(jpeg).digest("hex");
  await writeStore().put(captureKey(sha256), jpeg, "image/jpeg");
  return sha256;
}

export async function addFeedback(input: {
  sessionId: string;
  round: number;
  mockupId?: string | null;
  text?: string;
  width?: number | null;
  /** The height of the owner's frame when the pins were made (`100vh`), 900 when not given. */
  height?: number | null;
  /**
   * A pin's `element` needs only its `selector`: the rest comes from PIVOT's element map. A live pin (the interactive
   * preview) carries the element as the preview saw it and its `capture`: a JPEG or PNG crop, base64.
   */
  pins?: FeedbackPinInput[];
  /** The request's Authorization header: any value is an agent's request. */
  bearer?: string | null;
}): Promise<DesignFeedbackDTO> {
  if (input.bearer)
    throw new OwnerAuthError(
      "Only the owner sends feedback, from PIVOT's own page. A request with the API token (an agent's) is refused.",
      403,
    );
  const text = String(input.text ?? "").trim();
  // the number the owner saw; a pin without one gets the next number no pin uses
  const given = (input.pins ?? []).map((p) => (Number.isInteger(p.n) && p.n! >= 1 && p.n! <= 999 ? p.n! : null));
  const numbered = given.filter((n): n is number => n !== null);
  if (new Set(numbered).size !== numbered.length) throw new DesignError("Two pins have the same number.");
  let free = Math.max(0, ...numbered);
  const pins = (input.pins ?? []).map((p, i) => ({
    x: p.x,
    y: p.y,
    text: String(p.text ?? "").trim(),
    n: given[i] ?? ++free,
    live: p.live === true,
    selector: p.live !== true && typeof p.element?.selector === "string" ? p.element.selector : null,
    raw: p,
  }));
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
    checkWidth(input.width ?? NaN);
    width = input.width!;
    if (input.height != null) checkHeight(input.height);
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
      if (p.selector !== null && (!p.selector || p.selector.length > 1000))
        throw new DesignError(`Pin ${i + 1}'s element has no usable selector.`);
      if (p.live && !p.raw.capture) throw new DesignError(`Pin ${i + 1} is live but has no picture.`);
      if (p.live && p.raw.element && !liveElement(p.raw.element, width))
        throw new DesignError(`Pin ${i + 1}'s element isn't usable.`);
    }
  }
  // live notes keep what the preview saw: its element and its crop (stored as a picture, by its sha256)
  const captures = new Map<number, NonNullable<DesignFeedbackPin["capture"]>>();
  const total = pins.reduce((sum, p) => sum + (p.live ? String(p.raw.capture?.image ?? "").length * 0.75 : 0), 0);
  if (total > FEEDBACK_LIMITS.captureTotal)
    throw new DesignError(
      `The pictures are over ${FEEDBACK_LIMITS.captureTotal / 1_000_000} MB in all: send fewer notes at once.`,
    );
  for (const [i, p] of pins.entries()) {
    if (!p.live || !p.raw.capture) continue;
    const r = p.raw.capture.region ?? {};
    const region = { left: int(r.left), top: int(r.top), width: int(r.width), height: int(r.height) };
    if (Object.values(region).some((n) => !Number.isFinite(n) || n < 0))
      throw new DesignError(`Pin ${i + 1}'s picture has no usable region.`);
    captures.set(i, { sha256: await storeCapture(p.raw.capture.image, i), region });
  }
  const vh = input.height ?? DEFAULT_VIEWPORT_HEIGHT;
  // the elements the owner selected, as PIVOT's own map of that render describes them
  const elements = new Map<number, DesignFeedbackElement>();
  const withElement = pins.flatMap((p, i) => (p.selector ? [i] : []));
  if (withElement.length && version && width) {
    const map = await mockupElements(version.id, width, vh);
    const html = await versionHtml(version.id);
    if (!map || html === null) throw new DesignError("That version is gone.");
    const bySelector = new Map(map.map((e) => [e.sel, e]));
    const found = withElement.map((i) => {
      const e = bySelector.get(pins[i].selector!);
      if (!e) throw new DesignError(`Pin ${i + 1}'s element isn't on this version at ${width}px.`);
      return e;
    });
    const snippets = await elementsHtml(
      withDoctype(html),
      found.map((e) => e.sel),
      { width, viewportHeight: vh },
    );
    for (const [k, i] of withElement.entries()) {
      const e = found[k];
      elements.set(i, {
        selector: e.sel,
        tag: e.tag,
        ...(e.id ? { id: e.id } : {}),
        ...(e.cls ? { classes: e.cls } : {}),
        ...(e.text ? { text: e.text } : {}),
        ...(e.label ? { label: e.label } : {}),
        box: { x: e.x, y: e.y, w: e.w, h: e.h },
        ...(snippets[k] ? { html: snippets[k]! } : {}),
      });
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
      pins: pins.map((p, i) => {
        if (p.live) {
          const element = liveElement(p.raw.element, width!);
          return {
            n: p.n,
            x: Math.round(p.x),
            y: Math.round(p.y),
            text: p.text,
            live: true,
            ...(element ? { element } : {}),
            capture: captures.get(i)!,
          };
        }
        const element = elements.get(i);
        // an element pin sits on its element: a point outside the box moves to the box's centre
        const b = element?.box;
        const inside = !b || (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
        return {
          n: p.n,
          x: Math.round(inside ? p.x : b.x + b.w / 2),
          y: Math.round(inside ? p.y : b.y + b.h / 2),
          text: p.text,
          ...(element ? { element } : {}),
          // the frame's height, when it wasn't the default: the crop is rendered the same way
          ...(vh !== DEFAULT_VIEWPORT_HEIGHT ? { vh } : {}),
        };
      }),
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

/** The viewport height renders use unless the owner's frame said otherwise (`100vh` resolves against it). */
export const DEFAULT_VIEWPORT_HEIGHT = 900;
const sized = (width: number, height: number) =>
  height === DEFAULT_VIEWPORT_HEIGHT ? `${width}` : `${width}x${height}`;
const renderKey = (digest: string, width: number, height = DEFAULT_VIEWPORT_HEIGHT) =>
  `design-renders/${digest}-${sized(width, height)}.jpg`;
const elementsKey = (digest: string, width: number, height = DEFAULT_VIEWPORT_HEIGHT) =>
  `design-renders/${digest}-${sized(width, height)}.elements.json`;
/** A page with no doctype renders in standards mode, like the frame PIVOT shows it in (a srcdoc is always one). */
export const withDoctype = (html: string) => (/^\s*<!doctype/i.test(html) ? html : `<!doctype html>\n${html}`);
const checkHeight = (height: number) => {
  if (!Number.isInteger(height) || height < 200 || height > 4000)
    throw new DesignError("Viewport heights are whole pixels from 200 to 4000.");
};

const checkWidth = (width: number) => {
  if (!Number.isInteger(width) || width < RENDER_WIDTH.min || width > RENDER_WIDTH.max)
    throw new DesignError(`Widths are whole pixels from ${RENDER_WIDTH.min} to ${RENDER_WIDTH.max}.`);
};

async function versionRow(mockupId: string) {
  const db = await getDb();
  const [m] = await db
    .select({ html: designMockups.html, digest: designMockups.digest })
    .from(designMockups)
    .where(eq(designMockups.id, mockupId))
    .limit(1);
  return m ?? null;
}

async function versionHtml(mockupId: string) {
  return (await versionRow(mockupId))?.html ?? null;
}

/** Renders a version with its element map and keeps both, so a picture and its map always come from one layout. */
async function renderAndStore(m: { html: string; digest: string }, width: number, height = DEFAULT_VIEWPORT_HEIGHT) {
  const shot = await renderHtml(withDoctype(m.html), { width, elements: true, viewportHeight: height });
  const store = writeStore();
  await store.put(renderKey(m.digest, width, height), shot.data, "image/jpeg");
  await store.put(
    elementsKey(m.digest, width, height),
    Buffer.from(JSON.stringify(shot.elements ?? [])),
    "application/json",
  );
  return shot;
}

/**
 * A version's full-page render at one of the page's widths (JPEG), made once per content digest and width and kept in
 * the blob store. Interactive versions are rendered without their scripts, like on the session page.
 */
export async function renderMockup(
  mockupId: string,
  width: number,
  viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
): Promise<{ data: Buffer; width: number; height: number } | null> {
  checkWidth(width);
  checkHeight(viewportHeight);
  const m = await versionRow(mockupId);
  if (!m) return null;
  const cached = await writeStore()
    .get(renderKey(m.digest, width, viewportHeight))
    .catch(() => null);
  if (cached) {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(cached, { limitInputPixels: false }).metadata();
    return { data: cached, width: meta.width ?? width, height: meta.height ?? 0 };
  }
  const shot = await renderAndStore(m, width, viewportHeight);
  return { data: shot.data, width: shot.width, height: shot.height };
}

/**
 * The element map of a version's render at one of the page's widths (`RenderedElement`s, document order, at most
 * `MAX_RENDER_ELEMENTS`): what the owner's Select tool hovers and picks. Kept with the render; a render made before
 * maps existed is made again, with its map.
 */
export async function mockupElements(
  mockupId: string,
  width: number,
  viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
): Promise<RenderedElement[] | null> {
  checkWidth(width);
  checkHeight(viewportHeight);
  const m = await versionRow(mockupId);
  if (!m) return null;
  const cached = await writeStore()
    .get(elementsKey(m.digest, width, viewportHeight))
    .catch(() => null);
  if (cached) return JSON.parse(cached.toString("utf8")) as RenderedElement[];
  return (await renderAndStore(m, width, viewportHeight)).elements ?? [];
}

/** The pin's number in a round marker, drawn over the crop. */
const marker = (n: number, cx: number, cy: number, w: number, h: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<circle cx="${cx}" cy="${cy}" r="15" fill="#ff6a13" stroke="#0c0806" stroke-width="3"/>` +
      `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#0c0806">${n}</text></svg>`,
  );

/** An outline around the selected element, drawn over the crop. */
const outline = (x: number, y: number, bw: number, bh: number, w: number, h: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect x="${x - 2}" y="${y - 2}" width="${bw + 4}" height="${bh + 4}" fill="none" stroke="#0c0806" stroke-width="5"/>` +
      `<rect x="${x - 2}" y="${y - 2}" width="${bw + 4}" height="${bh + 4}" fill="none" stroke="#ff6a13" stroke-width="3"/></svg>`,
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
 * pin kept inside), with the pin's number drawn on its spot. For an element pin, the element whole (up to 1600 × 1200,
 * its top kept when it is taller), outlined, with the number on its corner. Null when the feedback, pin or version is
 * gone.
 */
export async function pinImage(feedbackId: string, index: number): Promise<PinImage | null> {
  const fb = await getFeedback(feedbackId);
  const pin = fb?.pins[index];
  if (!fb || !pin || !fb.mockupId || !fb.width) return null;
  if (pin.capture) {
    // a live note shows what the preview captured, never PIVOT's scripts-off render
    const kept = await writeStore()
      .get(captureKey(pin.capture.sha256))
      .catch(() => null);
    if (!kept) return null;
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(kept)
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
      region: pin.capture.region,
    };
  }
  const render = await renderMockup(fb.mockupId, fb.width, pin.vh ?? DEFAULT_VIEWPORT_HEIGHT);
  if (!render) return null;
  const box = pin.element?.box;
  // an element is shown whole with some room around it (up to 1600 × 1200 page pixels); a spot, at its centre
  const w = Math.min(render.width, box ? Math.min(1600, Math.max(960, box.w + 96)) : 960);
  const h = Math.min(render.height, box ? Math.min(1200, Math.max(720, box.h + 96)) : 720);
  const cxPage = box ? box.x + box.w / 2 : pin.x;
  const cyPage = box ? (box.h + 96 > h ? box.y + h / 2 - 48 : box.y + box.h / 2) : pin.y;
  const left = Math.max(0, Math.min(render.width - w, Math.round(cxPage - w / 2)));
  const top = Math.max(0, Math.min(render.height - h, Math.round(cyPage - h / 2)));
  // the number sits on the pin, or on the element's top-left corner
  const cx = Math.min(w - 16, Math.max(16, Math.round((box ? box.x : pin.x) - left)));
  const cy = Math.min(h - 16, Math.max(16, Math.round((box ? box.y : pin.y) - top)));
  const sharp = (await import("sharp")).default;
  const overlays = [
    ...(box ? [{ input: outline(box.x - left, box.y - top, box.w, box.h, w, h), left: 0, top: 0 }] : []),
    { input: marker(pin.n ?? index + 1, cx, cy, w, h), left: 0, top: 0 },
  ];
  const { data, info } = await sharp(render.data, { limitInputPixels: false })
    .extract({ left, top, width: w, height: h })
    .composite(overlays)
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
export const elementsStoreKey = elementsKey;
export const captureStoreKey = captureKey;
export const renderStore = (kind?: StorageKind) => (kind ? storeFor(kind) : writeStore());
