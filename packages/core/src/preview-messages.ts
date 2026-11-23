// Messages from a component preview frame (isomorphic). PIVOT sends nothing into the frame and reads one thing from
// it: that it finished loading. Anything else, or anything from another window or origin, is ignored.

export interface FrameMessage {
  source: unknown;
  origin: string;
  data: unknown;
}

/** "ready" only for `{ type: "21st-preview-ready" }` sent by that very frame from the preview origin; else null. */
export function previewMessage(e: FrameMessage, frame: unknown, previewOrigin: string): "ready" | null {
  if (!frame || e.source !== frame || e.origin !== previewOrigin) return null;
  const d = e.data;
  return d && typeof d === "object" && (d as { type?: unknown }).type === "21st-preview-ready" ? "ready" : null;
}

/** The preview origin for a PIVOT page at `location`: the same host name, the preview port. */
export function previewOriginFor(location: { protocol: string; hostname: string }, port: number) {
  return `${location.protocol}//${location.hostname}:${port}`;
}
