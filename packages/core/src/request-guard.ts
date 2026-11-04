// Who may call the local API. The API has no login, so `apps/web/src/proxy.ts` asks this for every /api request:
// - it only answers requests addressed to this machine (blocks DNS rebinding);
// - writes must come from the app's own pages or carry the API token (blocks other sites and local scripts);
// - another site, or a sandboxed mockup frame, can't open API pages in a frame or tab, except a mockup or an asset;
// - the API token itself is readable only by the app's own pages and by non-browser callers.

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
const TOKEN_PATH = "/api/settings/token";

/** The Origin header's host, or null when it is missing, `null` (sandboxed frames, files) or not a URL. */
function originHost(origin: string | null): string | null {
  if (!origin || origin === "null") return null;
  try {
    return new URL(origin).host || null;
  } catch {
    return null;
  }
}

export function guardApiRequest(req: ApiRequest): Verdict {
  if (!LOCAL_HOSTS.has(hostname(req.host))) return { ok: false, error: "Forbidden host" };

  const read = READS.has(req.method);
  const otherSite = req.fetchSite === "cross-site" || req.fetchSite === "same-site";

  if (req.fetchMode === "navigate" && otherSite && !(read && OPENABLE.some((p) => p.test(req.pathname)))) {
    return { ok: false, error: "Opening the API from another site is blocked" };
  }

  // Browsers always send Sec-Fetch-Site; only the app's own pages may read the token. Non-browser callers (scripts,
  // curl) have no Sec-Fetch-* headers and are allowed, as they can read the token file anyway.
  if (req.pathname === TOKEN_PATH && read && req.fetchSite !== null && req.fetchSite !== "same-origin") {
    return { ok: false, error: "The API token is only readable by PIVOT's own pages" };
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
