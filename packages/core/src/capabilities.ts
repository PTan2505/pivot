/**
 * What this server supports, for clients that may be newer or older than it (the browser extension). Clients check
 * for the features they need instead of comparing version numbers; a feature is only ever added here, never renamed.
 */
export const API_VERSION = 4;

export const API_FEATURES = [
  "clip",
  /** `/api/clip` answers a repeated `clientRequestId` with the first result. */
  "clip.client-request-id",
  /** `/api/clip` takes `expandContent` for the server capture. */
  "clip.expand-content",
  /** `POST /api/resources/[id]/capture` takes `{ expandContent?, theme? }`; DELETE cancels. */
  "capture.options",
  "capture.cancel",
  "capture.history",
  /** `GET /api/visibility?url=`: is the page private without your login? */
  "visibility",
  /** `/api/clip` takes `section` (a part of the page as its own reference). */
  "clip.section",
  /** `/api/resources/[id]/links` and `/api/links/[id]`. */
  "links",
  /** Design sessions, brief snapshots and decisions (`/api/design/*`). */
  "design",
  /** Agent suggestions (`/api/resources/[id]/suggestions`, `/api/suggestions`) and notes (`/annotate`). */
  "suggestions",
  /** Hybrid search: `GET /api/search/external` (free direct catalogs plus link-outs). */
  "search.external",
  /** `GET|PATCH /api/settings/ui`: `{ showOtherTypes }`, whether the types outside design are shown. */
  "settings.ui",
  /**
   * The owner's feedback on mockups (`/api/design/sessions/[id]/feedback`, renders and pin crops), rounds that answer it
   * and propose a DESIGN.md change (`addressesFeedback`, `designSystemChange` when saving mockups).
   */
  "design.feedback",
  /**
   * Feedback on an element (the Select tool): `GET /api/design/mockups/[id]/elements?width=` (a render's element map),
   * and a pin's `element: { selector }`, stored with the element's tag, box and HTML.
   */
  "design.feedback.elements",
  /**
   * Renders, element maps and feedback at any width from 320 to 2560, and live notes from the interactive preview: a
   * pin's `live: true` with the element as the preview saw it and its `capture` (a crop, kept by its sha256).
   */
  "design.feedback.live",
  /**
   * Components saved with their code: `POST /api/components` (save, by 21st id) and `GET /api/components/lookup`
   * (`?id=`, `?url=` or `?resourceId=`), each with PIVOT's scan of the code.
   */
  "components",
  /**
   * The owner's own designs, saved to be rebuilt exactly: `POST /api/my-designs` (save, or update with `id`; 409 on
   * different code without `replaceCode`), `GET /api/my-designs/lookup` (`?id=` or `?name=`),
   * `POST /api/my-designs/[id]/assets` (a file, screenshot or video), and the agent search's `organisation` filter
   * (`GET /api/resources?paged=1&organisation=`).
   */
  "my-designs",
] as const;

export type ApiFeature = (typeof API_FEATURES)[number];
