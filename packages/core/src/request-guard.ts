// Who may call the local API. The API has no login, so `apps/web/src/proxy.ts` asks this for every /api request:
// - it only answers requests addressed to this machine (blocks DNS rebinding);
// - writes must come from the app's own pages or carry the API token (blocks other sites and local scripts);
// - another site, or a sandboxed mockup frame, can't open API pages in a frame or tab, except a mockup or an asset;
// - reads with side effects (fetching other sites, writing storage, syncing, heavy image work) and the API token answer
//   only the app's own pages, a caller with the API token, or a non-browser caller: never a request a page on another
//   site, a sandboxed mockup or a file can make the browser send (an <img>, a fetch, a frame).

export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The host name of a Host header, without its port (IPv6 brackets kept). */
export function hostname(hostHeader: string | null): string {
  if (!hostHeader) return "";
  return hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
}

export interface ApiRequest {
  method: string;
  pathname: string;
  host: string | null;
  origin: string | null;
  /** The Referer header, when the browser sent one. */
  referer: string | null;
  /** The `Sec-Fetch-Site` header: `same-origin`, `same-site`, `cross-site` or `none`; null when the caller isn't a browser. */
  fetchSite: string | null;
  /** The `Sec-Fetch-Mode` header: `navigate` for a page or frame load. */
  fetchMode: string | null;
  /** Whether the request carries a valid `Authorization: Bearer` API token. Called only when it matters. */
  hasToken: () => boolean;
}

export type Verdict = { ok: true } | { ok: false; error: string };

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
/** API pages another site or a mockup frame may still open: a mockup to look at, and stored assets. */
const OPENABLE = [/^\/api\/design\/mockups\/[^/]+$/, /^\/api\/assets\/[^/]+$/];
/** Reads with side effects, and the token. Each needs a caller allowed by `sideEffectsAllowed`. */
const SIDE_EFFECT_READS = [
  /^\/api\/settings\/token$/, // returns the secret, and creates it the first time
  /^\/api\/favicon$/, // fetches a site's icon and stores it
  /^\/api\/search\/external$/, // may download a provider catalog and store it (R2)
  /^\/api\/metadata$/, // fetches the given URL
  /^\/api\/visibility$/, // fetches the given URL
  /^\/api\/resources\/[^/]+\/compare(\/image)?$/, // decodes and diffs full-size images
];

/** The host of an Origin or Referer value, or null when it is missing, `null` (sandboxed frames, files) or not a URL. */
function originHost(origin: string | null): string | null {
  if (!origin || origin === "null") return null;
  try {
    return new URL(origin).host || null;
  } catch {
    return null;
  }
}

/**
 * Who may trigger a read with side effects:
 * - a caller with the API token (the extension, the MCP server);
 * - the app's own pages: `Sec-Fetch-Site: same-origin`, with no Origin or Referer from anywhere else;
 * - a caller that isn't a browser: no Fetch Metadata, no Origin and no Referer from anywhere else. Browsers send
 *   `Sec-Fetch-Site` to localhost (Chrome, Firefox, Safari 16.4+), so this is a script or tool on this machine, which
 *   could read the token file anyway, or a browser too old for Fetch Metadata (a documented residual).
 * Same-site isn't same-origin: another port on this machine is another app.
 */
function sideEffectsAllowed(req: ApiRequest): boolean {
  if (req.hasToken()) return true;
  if (req.origin !== null && originHost(req.origin) !== req.host) return false;
  if (req.referer !== null && originHost(req.referer) !== req.host) return false;
  return req.fetchSite === null || req.fetchSite === "same-origin";
}

export function guardApiRequest(req: ApiRequest): Verdict {
  if (!LOCAL_HOSTS.has(hostname(req.host))) return { ok: false, error: "Forbidden host" };

  const read = READS.has(req.method);
  const otherSite = req.fetchSite === "cross-site" || req.fetchSite === "same-site";

  if (req.fetchMode === "navigate" && otherSite && !(read && OPENABLE.some((p) => p.test(req.pathname)))) {
    return { ok: false, error: "Opening the API from another site is blocked" };
  }

  if (read && SIDE_EFFECT_READS.some((p) => p.test(req.pathname)) && !sideEffectsAllowed(req)) {
    return { ok: false, error: "Only PIVOT's own pages can do this" };
  }

  if (!read) {
    const host = originHost(req.origin);
    // A write names its origin; one with neither header (curl, a script) needs the token. A `null` or unreadable
    // origin is never the app's own page.
    const sameOrigin = req.origin ? host !== null && host === req.host : req.fetchSite === "same-origin";
    if (!sameOrigin && !req.hasToken()) {
      return {
        ok: false,
        error: req.origin?.startsWith("chrome-extension://")
          ? "Invalid API token — copy it again from PIVOT › Settings."
          : "Cross-origin request blocked",
      };
    }
  }
  return { ok: true };
}
