// The preview origin (docs/component-store-plan.md, Phase 4). A component's preview runs third-party code, so it never
// runs on PIVOT's own origin: this tiny server, on its own port (PIVOT's + 1), serves component previews and nothing
// else. No API, no token, no cookies, no listing, no other file. Its pages get a strict CSP (no network: connect-src
// 'none', no external scripts), and PIVOT embeds them in a sandboxed frame (allow-scripts allow-same-origin, where
// same-origin is this origin, never PIVOT's).
import http from "node:http";
import { findPreviewAsset } from "./component-preview";
import { readAssetBytes, type AssetRow } from "./assets";
import { hostname, LOCAL_HOSTS } from "./request-guard";

export const PREVIEW_PATH = /^\/p\/([0-9a-f]{64})\.html$/;

/** The preview origin's port: `PIVOT_PREVIEW_PORT`, else PIVOT's port + 1. */
export function previewPort(env: NodeJS.ProcessEnv = process.env): number {
  const set = Number(env.PIVOT_PREVIEW_PORT);
  if (Number.isInteger(set) && set > 0 && set < 65536) return set;
  return Number(env.PORT || 4321) + 1;
}

/**
 * PIVOT's own origins, the only pages allowed to frame a preview. CSP host sources can't name an IPv6 literal, so
 * `[::1]` isn't listed (PIVOT binds 127.0.0.1 only, so it isn't served there anyway).
 */
export function appOrigins(appPort: number | string) {
  return [`http://127.0.0.1:${appPort}`, `http://localhost:${appPort}`];
}

/**
 * The policy every preview page gets. Scripts and styles only from the page itself (inline, as a single-file bundle
 * has them); images and media also from https (a demo's stock photos: the owner's choice, 2026-11-23); fonts only
 * inline; no fetch, XHR, WebSocket or EventSource; no frames, forms or <base>; framed only by PIVOT.
 */
export function previewCsp(appPort: number | string) {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'self'",
    "style-src 'unsafe-inline' 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "worker-src blob:",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${appOrigins(appPort).join(" ")}`,
  ].join("; ");
}

const PERMISSIONS =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), clipboard-read=(), publickey-credentials-get=()";

export function previewHeaders(appPort: number | string): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": previewCsp(appPort),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
    "Permissions-Policy": PERMISSIONS,
    "Cache-Control": "private, max-age=31536000, immutable",
  };
}

/**
 * First thing in every preview: a link to another page or site does nothing (the frame would otherwise leave the
 * preview). Forms are already blocked by `form-action 'none'`, popups and top navigation by the sandbox.
 */
export const LINK_GUARD = `<script data-pivot-guard>(()=>{addEventListener("click",(e)=>{const t=e.target;const a=t&&t.closest?t.closest("a[href]"):null;if(!a)return;let u;try{u=new URL(a.getAttribute("href"),location.href)}catch{e.preventDefault();return}if(u.origin!==location.origin||u.pathname!==location.pathname)e.preventDefault()},true)})()</script>`;

/** The page as served: the guard right after `<head>` (or first, when the file has no head). */
export function withGuard(html: string) {
  const m = /<head(\s[^>]*)?>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + LINK_GUARD + html.slice(m.index + m[0].length) : LINK_GUARD + html;
}

export interface PreviewServerOptions {
  /** The port this server answers on (its Host header must name it). */
  port: number;
  /** PIVOT's port, for frame-ancestors. */
  appPort: number | string;
  /** Testing seams. */
  find?: (sha256: string) => Promise<AssetRow | null>;
  read?: (row: AssetRow) => Promise<Buffer | null>;
}

const plain = (res: http.ServerResponse, status: number, text: string, extra: Record<string, string> = {}) => {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    ...extra,
  });
  res.end(text);
};

/** The request handler: only GET/HEAD `/p/<sha256>.html` of a component preview, addressed to this port on this machine. */
export function previewHandler({
  port,
  appPort,
  find = findPreviewAsset,
  read = readAssetBytes,
}: PreviewServerOptions) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const host = req.headers.host ?? "";
      const hostPort = host.slice(hostname(host).length + 1);
      // DNS rebinding: only this machine's names, and only this port
      if (!LOCAL_HOSTS.has(hostname(host)) || hostPort !== String(port)) return plain(res, 403, "Forbidden host");
      if (req.method !== "GET" && req.method !== "HEAD")
        return plain(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
      const pathname = (req.url ?? "").split("?")[0];
      const m = PREVIEW_PATH.exec(pathname);
      const row = m ? await find(m[1]) : null;
      const bytes = row ? await read(row) : null;
      if (!bytes) return plain(res, 404, "Not found");
      const body = Buffer.from(withGuard(bytes.toString("utf8")), "utf8");
      res.writeHead(200, { ...previewHeaders(appPort), "Content-Length": String(body.byteLength) });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (err) {
      console.error("[pivot] preview server:", err instanceof Error ? err.message : err);
      if (!res.headersSent) plain(res, 500, "Preview failed");
      else res.end();
    }
  };
}

export function createPreviewServer(opts: PreviewServerOptions) {
  return http.createServer(previewHandler(opts));
}

const KEY = Symbol.for("pivot.previewServer");
type Holder = { [KEY]?: { server: http.Server; port: number } };

/** Starts the preview origin once per process (Next may load instrumentation again in dev); logs, never throws. */
export function startPreviewServer(env: NodeJS.ProcessEnv = process.env) {
  const g = globalThis as Holder;
  if (g[KEY]) return g[KEY];
  const port = previewPort(env);
  const appPort = env.PORT || String(port - 1);
  if (String(port) === String(appPort)) {
    console.error(`[pivot] preview server: port ${port} is PIVOT's own; previews are off.`);
    return null;
  }
  const server = createPreviewServer({ port, appPort });
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(
      err.code === "EADDRINUSE"
        ? `[pivot] preview server: port ${port} is in use, so component previews are off (set PIVOT_PREVIEW_PORT).`
        : `[pivot] preview server: ${err.message}`,
    );
    delete g[KEY];
  });
  server.listen(port, "127.0.0.1");
  g[KEY] = { server, port };
  return g[KEY];
}
