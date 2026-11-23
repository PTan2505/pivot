// The component preview origin (docs/component-store-plan.md, Phase 4): a separate server that serves component
// previews and nothing else, with a CSP that gives the third-party code no network, framed only by PIVOT. The bundle
// used here is written for the test.
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let comps: typeof import("../src/components");
let preview: typeof import("../src/component-preview");
let server: typeof import("../src/preview-server");
let msgs: typeof import("../src/preview-messages");
let assets: typeof import("../src/assets");
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pivot-preview-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  comps = await import("../src/components");
  preview = await import("../src/component-preview");
  server = await import("../src/preview-server");
  msgs = await import("../src/preview-messages");
  assets = await import("../src/assets");
  resources = await import("../src/resources");
  db = await import("../src/db/client");
});
afterAll(async () => {
  await db.closeDb();
  await fsp.rm(tmp, { recursive: true, force: true });
});

let nextId = 70000;
const component = async () =>
  (
    await comps.saveComponent({
      provider: "21st",
      providerId: ++nextId,
      name: `Fixture ${nextId}`,
      pageUrl: `https://21st.dev/@tester/components/fixture-${nextId}`,
      author: { username: "tester" },
      licence: { spdx: "MIT", source: "component_page" },
      files: [{ path: "x.tsx", role: "component", language: "tsx", code: `export const X${nextId} = () => null;` }],
      status: "fetched",
    })
  ).resource;

const PAGE = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>fixture</title></head><body>${body}</body></html>`;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

/** A raw request, so the Host header can be anything. */
const request = (port: number, opts: { path: string; host?: string; method?: string }) =>
  new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: opts.path,
        method: opts.method ?? "GET",
        headers: { host: opts.host ?? `127.0.0.1:${port}` },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });

describe("storing a preview", () => {
  it("attaches one file with role component-preview, records it, and replaces the last one", async () => {
    const r = await component();
    const first = await preview.setComponentPreview(r.id, PAGE("one"));
    expect(first).toMatchObject({ status: "ready", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const second = await preview.setComponentPreview(r.id, PAGE("two"));
    const after = (await resources.getResource(r.id))!;
    expect((after.meta.component as { preview: unknown }).preview).toMatchObject({ sha256: second.sha256 });
    expect(after.assets.map((a) => a.role)).toEqual(["component-preview"]);
    expect(await preview.findPreviewAsset(first.sha256!)).toBeNull();
    expect((await preview.findPreviewAsset(second.sha256!))?.id).toBe(second.assetId);
    // stored as plain text, so PIVOT's own asset route never serves it as a page
    expect((await assets.getAsset(second.assetId!))?.mimeType).toBe("text/plain");
  });

  it("refuses anything but a component, and more than 5 MB", async () => {
    const ref = await resources.createResource({ type: "reference", title: "R", sourceUrl: "https://a.dev" });
    await expect(preview.setComponentPreview(ref.id, PAGE("x"))).rejects.toBeInstanceOf(preview.PreviewError);
    const r = await component();
    await expect(preview.setComponentPreview(r.id, "x".repeat(5 * 1024 * 1024 + 1))).rejects.toThrow(/5 MB/);
  });
});

describe("the preview server", () => {
  let port: number;
  let srv: http.Server;
  let sha: string;
  const appPort = 4999;
  beforeAll(async () => {
    port = await freePort();
    srv = server.createPreviewServer({ port, appPort });
    await new Promise<void>((r) => srv.listen(port, "127.0.0.1", r));
    const r = await component();
    sha = (await preview.setComponentPreview(r.id, PAGE('<a href="https://evil.example/">x</a>'))).sha256!;
  });
  afterAll(() => new Promise<void>((r) => srv.close(() => r())));

  it("serves a component preview with the strict headers and the link guard first", async () => {
    const res = await request(port, { path: `/p/${sha}.html?theme=dark` });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'none'; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors http://127.0.0.1:4999 http://localhost:4999",
    );
    expect(res.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "same-site",
    });
    expect(res.headers["permissions-policy"]).toContain("camera=()");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body.indexOf("data-pivot-guard")).toBeGreaterThan(res.body.indexOf("<head>"));
    expect(res.body.indexOf("data-pivot-guard")).toBeLessThan(res.body.indexOf("<meta"));
    const head = await request(port, { path: `/p/${sha}.html`, method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
  });

  it("refuses other hosts and ports (DNS rebinding) and other methods", async () => {
    for (const host of [`evil.example:${port}`, `127.0.0.1:${port + 1}`, "127.0.0.1", `127.0.0.1.nip.io:${port}`]) {
      expect((await request(port, { path: `/p/${sha}.html`, host })).status, host).toBe(403);
    }
    for (const host of [`localhost:${port}`, `[::1]:${port}`]) {
      expect((await request(port, { path: `/p/${sha}.html`, host })).status, host).toBe(200);
    }
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const res = await request(port, { path: `/p/${sha}.html`, method });
      expect(res.status, method).toBe(405);
      expect(res.headers.allow).toBe("GET, HEAD");
    }
  });

  it("serves nothing else: no API, no other file, no other role, nothing in the Trash", async () => {
    const attachment = await assets.saveAsset({ data: Buffer.from(PAGE("attached")), fileName: "a.html" });
    const holder = await resources.createResource({ type: "reference", title: "H", sourceUrl: "https://h.dev" });
    await assets.attachAsset(holder.id, attachment.id, "attachment");
    const trashed = await component();
    const tsha = (await preview.setComponentPreview(trashed.id, PAGE("trashed"))).sha256!;
    await resources.trashResources([trashed.id]);
    for (const p of [
      "/",
      "/api/settings/token",
      "/api/resources",
      `/p/${sha.toUpperCase()}.html`,
      `/p/${sha}.htm`,
      `/p/${sha}.html/`,
      `/p/../p/${sha}.html`,
      `/p/%2e%2e/${sha}.html`,
      `/x/${sha}.html`,
      `/p/${attachment.sha256}.html`,
      `/p/${tsha}.html`,
    ]) {
      const res = await request(port, { path: p });
      expect(res.status, p).toBe(404);
      expect(res.headers["set-cookie"], p).toBeUndefined();
    }
  });

  it("puts the guard after <head>, or first when there is none", () => {
    expect(server.withGuard("<html><HEAD lang=x><title>t</title>")).toMatch(
      /^<html><HEAD lang=x><script data-pivot-guard>/,
    );
    expect(server.withGuard("<div>no head</div>")).toMatch(/^<script data-pivot-guard>.*<div>no head<\/div>$/);
  });

  it("takes its port from PIVOT_PREVIEW_PORT, else PIVOT's + 1", () => {
    expect(server.previewPort({ PIVOT_PREVIEW_PORT: "5001" })).toBe(5001);
    expect(server.previewPort({ PORT: "4400" })).toBe(4401);
    expect(server.previewPort({})).toBe(4322);
    expect(server.previewPort({ PIVOT_PREVIEW_PORT: "nope", PORT: "4410" })).toBe(4411);
  });
});

describe("messages from the frame", () => {
  const frame = { id: "frame" };
  const origin = "http://127.0.0.1:4322";
  it("reads only 'ready' from that frame and that origin", () => {
    const ok = { source: frame, origin, data: { type: "21st-preview-ready" } };
    expect(msgs.previewMessage(ok, frame, origin)).toBe("ready");
    expect(msgs.previewMessage({ ...ok, source: {} }, frame, origin)).toBeNull();
    expect(msgs.previewMessage({ ...ok, origin: "http://127.0.0.1:4321" }, frame, origin)).toBeNull();
    expect(msgs.previewMessage({ ...ok, origin: "null" }, frame, origin)).toBeNull();
    expect(msgs.previewMessage({ ...ok, data: { type: "21st-preview-key", key: "a" } }, frame, origin)).toBeNull();
    expect(msgs.previewMessage({ ...ok, data: "21st-preview-ready" }, frame, origin)).toBeNull();
    expect(msgs.previewMessage(ok, null, origin)).toBeNull();
  });
  it("puts the preview on the page's own host name, at the preview port", () => {
    expect(msgs.previewOriginFor({ protocol: "http:", hostname: "127.0.0.1" }, 4322)).toBe("http://127.0.0.1:4322");
    expect(msgs.previewOriginFor({ protocol: "http:", hostname: "[::1]" }, 4401)).toBe("http://[::1]:4401");
  });
});

describe("PIVOT sets no cookies (same-site ports share them)", () => {
  it("has no cookie writes in the web app or core", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const t = fs.readFileSync(p, "utf8");
          if (/set-cookie|document\.cookie\s*=|cookies\(\)\.set|\.cookies\.set\(/i.test(t)) hits.push(p);
        }
      }
    };
    walk(path.resolve(__dirname, "../../../apps/web/src"));
    walk(path.resolve(__dirname, "../src"));
    // the scan rules name document.cookie as something to flag in third-party code; that is a pattern, not a write
    expect(hits.filter((h) => !h.endsWith(path.join("src", "components.ts")))).toEqual([]);
  });
});

// ---- in Chromium: the CSP and the sandbox hold against a hostile bundle -----------------------------------------

const { playwrightStatus, closeCaptureBrowser } = await import("../src/capture");
const browser = await playwrightStatus();

const PROBE = `<script>
(async () => {
  const r = {};
  const v = [];
  addEventListener("securitypolicyviolation", (e) => v.push(e.violatedDirective));
  const app = "http://127.0.0.1:" + new URLSearchParams(location.search).get("app");
  try { await fetch(app + "/steal?fetch"); r.fetch = "sent"; } catch { r.fetch = "blocked"; }
  try {
    await new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open("GET", app + "/steal?xhr"); x.onload = ok; x.onerror = no; x.send(); });
    r.xhr = "sent";
  } catch { r.xhr = "blocked"; }
  try { new WebSocket(app.replace("http", "ws") + "/steal?ws"); r.ws = "created"; } catch { r.ws = "blocked"; }
  try { navigator.sendBeacon(app + "/steal?beacon") ? (r.beacon = "queued") : (r.beacon = "refused"); } catch { r.beacon = "blocked"; }
  await new Promise((ok) => { const s = document.createElement("script"); s.src = app + "/steal.js"; s.onload = () => { r.script = "loaded"; ok(); }; s.onerror = () => { r.script = "blocked"; ok(); }; document.head.appendChild(s); });
  await new Promise((ok) => { const i = new Image(); i.onload = () => { r.httpImage = "loaded"; ok(); }; i.onerror = () => { r.httpImage = "blocked"; ok(); }; i.src = app + "/steal.png"; });
  try { r.parentDom = parent.document.title; } catch { r.parentDom = "blocked"; }
  try { localStorage.setItem("k", "1"); r.storage = localStorage.getItem("k"); } catch { r.storage = "blocked"; }
  try { top.location.href = app + "/steal?top"; r.top = "navigated"; } catch { r.top = "blocked"; }
  const a = document.createElement("a"); a.href = app + "/steal?link"; a.textContent = "x"; document.body.appendChild(a); a.click();
  r.stayed = location.pathname.startsWith("/p/");
  const f = document.createElement("form"); f.action = app + "/steal?form"; f.method = "post"; document.body.appendChild(f);
  try { f.submit(); } catch {}
  await new Promise((ok) => setTimeout(ok, 400));
  r.violations = v;
  parent.postMessage({ type: "probe", r }, "*");
  parent.postMessage({ type: "21st-preview-ready" }, "*");
})();
</script>`;

describe.skipIf(!browser.installed)("in Chromium, a preview in PIVOT's frame", () => {
  let appPort: number;
  let previewPortN: number;
  let appSrv: http.Server;
  let prevSrv: http.Server;
  let sha: string;
  const hits: string[] = [];

  beforeAll(async () => {
    appPort = await freePort();
    previewPortN = await freePort();
    const r = await component();
    sha = (await preview.setComponentPreview(r.id, PAGE(`<h1>fixture</h1>${PROBE}`))).sha256!;
    prevSrv = server.createPreviewServer({ port: previewPortN, appPort });
    await new Promise<void>((ok) => prevSrv.listen(previewPortN, "127.0.0.1", ok));
    // stands in for PIVOT's page: it frames the preview exactly as component-detail.tsx does
    appSrv = http.createServer((req, res) => {
      if (req.url?.startsWith("/steal")) {
        hits.push(req.url);
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("x");
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<!doctype html><title>PIVOT</title><iframe sandbox="allow-scripts allow-same-origin" allow="" referrerpolicy="no-referrer" src="http://127.0.0.1:${previewPortN}/p/${sha}.html?app=${appPort}"></iframe>
<script>window.got = []; addEventListener("message", (e) => window.got.push({ origin: e.origin, data: e.data }));</script>`,
      );
    });
    // a WebSocket attempt arrives as an upgrade, not a request
    appSrv.on("upgrade", (req, socket) => {
      hits.push(`upgrade ${req.url}`);
      socket.destroy();
    });
    await new Promise<void>((ok) => appSrv.listen(appPort, "127.0.0.1", ok));
  });
  afterAll(async () => {
    await closeCaptureBrowser();
    await new Promise<void>((ok) => appSrv.close(() => ok()));
    await new Promise<void>((ok) => prevSrv.close(() => ok()));
  });

  it("can't reach the network, PIVOT's page or the top window, and still runs", async () => {
    const { chromium } = await import("playwright");
    const b = await chromium.launch();
    try {
      const page = await b.newPage();
      await page.goto(`http://127.0.0.1:${appPort}/`);
      await page.waitForFunction(
        () => (window as unknown as { got: { data: { type?: string } }[] }).got.some((m) => m.data?.type === "probe"),
        null,
        { timeout: 15_000 },
      );
      const got = await page.evaluate(() => (window as unknown as { got: { origin: string; data: unknown }[] }).got);
      const probe = got.find((m) => (m.data as { type?: string }).type === "probe")!;
      expect(probe.origin).toBe(`http://127.0.0.1:${previewPortN}`);
      const r = (probe.data as { r: Record<string, unknown> }).r;
      expect(r).toMatchObject({
        fetch: "blocked",
        xhr: "blocked",
        script: "blocked",
        httpImage: "blocked",
        parentDom: "blocked",
        storage: "1", // its own origin's storage works (allow-same-origin), PIVOT's isn't reachable
        stayed: true, // the link guard kept the frame on the preview
      });
      expect(r.violations).toEqual(expect.arrayContaining(["connect-src", "script-src-elem", "img-src"]));
      expect(page.url()).toBe(`http://127.0.0.1:${appPort}/`); // top navigation blocked by the sandbox
      expect(hits).toEqual([]); // nothing reached PIVOT's origin: no fetch, XHR, WebSocket, beacon, script, image or form
    } finally {
      await b.close();
    }
  }, 30_000);

  it("refuses to be framed by any other page (frame-ancestors)", async () => {
    const otherPort = await freePort();
    const other = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><iframe src="http://127.0.0.1:${previewPortN}/p/${sha}.html?app=${appPort}"></iframe>`);
    });
    await new Promise<void>((ok) => other.listen(otherPort, "127.0.0.1", ok));
    const { chromium } = await import("playwright");
    const b = await chromium.launch();
    try {
      const page = await b.newPage();
      const blocked = new Promise<boolean>((ok) => {
        page.on("console", (m) => {
          if (/frame-ancestors/.test(m.text())) ok(true);
        });
        setTimeout(() => ok(false), 8000);
      });
      await page.goto(`http://127.0.0.1:${otherPort}/`);
      expect(await blocked).toBe(true);
    } finally {
      await b.close();
      await new Promise<void>((ok) => other.close(() => ok()));
    }
  }, 30_000);
});
