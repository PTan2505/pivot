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
] as const;

export type ApiFeature = (typeof API_FEATURES)[number];
