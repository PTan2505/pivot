import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// One test server reachable two ways: 127.0.0.1 plays a public site, "localhost" a private host the guard blocks.
vi.mock("../src/net-guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/net-guard")>();
  return {
    ...real,
    assertPublicUrl: async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "localhost") throw new real.UnsafeUrlError("private host");
      return url;
    },
  };
});

const { closeCaptureBrowser, playwrightStatus, screenshotUrl } = await import("../src/capture");

let server: http.Server;
let pub: string;
let priv: string;
const secretHits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    res.setHeader("content-type", "text/html");
    if (url.pathname === "/secret") {
      secretHits.push(req.headers.host ?? "");
      return res.end("<title>Secret</title><body>internal admin</body>");
    }
    if (url.pathname === "/redirect") {
      res.statusCode = 302;
      res.setHeader("location", `${priv}secret`);
      return res.end();
    }
    // redirects only the browser, so the pre-check with a plain request doesn't see it
    if (url.pathname === "/browser-redirect" && req.headers["user-agent"]?.includes("Chrome")) {
      res.statusCode = 302;
      res.setHeader("location", `${priv}secret`);
      return res.end();
    }
    if (url.pathname === "/image") return res.end(`<body><img src="/image-hop"></body>`);
    if (url.pathname === "/image-hop") {
      res.statusCode = 302;
      res.setHeader("location", `${priv}secret.png`);
      return res.end();
    }
    if (url.pathname === "/meta")
      return res.end(`<meta http-equiv="refresh" content="0;url=${priv}secret"><body>moving</body>`);
    if (url.pathname === "/script")
      return res.end(`<body><script>location.href = ${JSON.stringify(`${priv}secret`)}</script></body>`);
    res.end("<title>Fine</title><body style='height:1200px'>public page</body>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  pub = `http://127.0.0.1:${port}/`;
  priv = `http://localhost:${port}/`;
});

afterAll(async () => {
  await closeCaptureBrowser();
  await new Promise((resolve) => server.close(resolve));
});

describe.skipIf(!(await playwrightStatus()).installed)("capture guard", () => {
  it("still captures a public page", { timeout: 60_000 }, async () => {
    const shot = await screenshotUrl(pub, { fullPage: false });
    expect(shot.viewport.length).toBeGreaterThan(0);
  });

  for (const path of ["redirect", "meta", "script"]) {
    it(`never shows a private page reached by a ${path} redirect`, { timeout: 60_000 }, async () => {
      secretHits.length = 0;
      await expect(screenshotUrl(`${pub}${path}`, { fullPage: false })).rejects.toThrow();
      expect(secretHits).toEqual([]);
    });
  }

  // The browser follows these hops before anything can stop them, so the private host does get the request; what
  // matters is that nothing from it ends up in a saved screenshot.
  it("refuses a page the browser alone is redirected away from", { timeout: 60_000 }, async () => {
    await expect(screenshotUrl(`${pub}browser-redirect`, { fullPage: false })).rejects.toThrow(/private address/);
  });

  it("refuses a page whose image redirects to a private host", { timeout: 60_000 }, async () => {
    await expect(screenshotUrl(`${pub}image`, { fullPage: false })).rejects.toThrow(/private address/);
  });
});
