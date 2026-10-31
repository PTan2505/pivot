/**
 * What this server supports, for clients that may be newer or older than it (the browser extension). Clients check
 * for the features they need instead of comparing version numbers; a feature is only ever added here, never renamed.
 */
export const API_VERSION = 2;

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
] as const;

export type ApiFeature = (typeof API_FEATURES)[number];
