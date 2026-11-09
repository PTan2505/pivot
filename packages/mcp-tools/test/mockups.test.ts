// Regression tests for the mockup inliner's containment: nothing outside a mockup's folder may end up in PIVOT.
// Every test uses a temporary folder and a synthetic secret next to (outside) the mockup's folder.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyRef,
  INLINE_BUDGET,
  inlineMockup,
  type InlineReport,
  MockupRejected,
  stripActive,
  within,
} from "../src/mockups";
import type { PivotSource } from "../src/source";
import { runTool } from "../src/tools";
import { WRITE_TOOLS } from "../src/write-tools";

const ID = "11111111-2222-4333-8444-555555555555";
const SECRET = `PIVOT-SYNTHETIC-SECRET-${crypto.randomUUID()}`;
const saveTool = WRITE_TOOLS.find((t) => t.name === "save_design_mockups")!;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let base: string;
let root: string;
let outside: string;

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-inliner-"));
  root = path.join(base, "mock");
  outside = path.join(base, "outside");
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.png"), SECRET);
  await fs.writeFile(path.join(outside, "secret.woff2"), SECRET);
  await fs.writeFile(path.join(outside, "secret.css"), `.s{content:"${SECRET}"}`);
  await fs.writeFile(path.join(base, "secret.png"), SECRET);
});
afterEach(() => fs.rm(base, { recursive: true, force: true }));

async function put(rel: string, data: string | Buffer) {
  const p = path.join(root, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data);
  return p;
}
const page = (body: string, name = "m.html") => put(name, `<!doctype html>${body}`);

/** The secret, as text or inside any base64 payload (data: URIs). */
function leaks(s: string): boolean {
  if (s.includes(SECRET)) return true;
  for (const m of s.matchAll(/base64,([A-Za-z0-9+/=]+)/g))
    if (Buffer.from(m[1], "base64").toString("latin1").includes(SECRET)) return true;
  return false;
}

/** Runs fn while recording everything written to the console, stdout and stderr. */
async function captured<T>(fn: () => Promise<T>): Promise<{ value: T; logs: string }> {
  const logs: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))),
  );
  const writes = [process.stdout, process.stderr].map((s) => {
    const orig = s.write.bind(s);
    return vi.spyOn(s, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      logs.push(String(chunk));
      return (orig as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof s.write);
  });
  try {
    return { value: await fn(), logs: logs.join("\n") };
  } finally {
    [...spies, ...writes].forEach((s) => s.mockRestore());
  }
}

function writerSource() {
  const sent: { mockups: { title: string; html: string }[] }[] = [];
  const source = {
    search: async () => ({ results: [], total: 0, nextCursor: null, sort: "relevance" }),
    getResource: async () => null,
    saveDesignBrief: async () => {
      throw new Error("not used");
    },
    saveDesignMockups: async (_id: string, body: { mockups: { title: string; html: string }[] }) => {
      sent.push(body);
      return { round: 1, ids: ["m1"], created: true };
    },
    appUrl: "http://127.0.0.1:4321",
  } as unknown as PivotSource;
  return { source, sent };
}

/** The mockup is refused: no secret in the error, the logs, the tool's reply or anything stored. */
async function expectRejected(file: string, match?: RegExp): Promise<MockupRejected> {
  const { value, logs } = await captured(() =>
    inlineMockup(file).then(
      (ok) => ({ ok, err: null }),
      (err: unknown) => ({ ok: null, err }),
    ),
  );
  expect(value.ok).toBeNull();
  expect(value.err).toBeInstanceOf(MockupRejected);
  const err = value.err as MockupRejected;
  if (match) expect(err.message).toMatch(match);
  expect(leaks(`${err.message}\n${err.stack}\n${JSON.stringify(err.problems)}`)).toBe(false);
  expect(leaks(logs)).toBe(false);
  const { source, sent } = writerSource();
  const tool = await captured(() =>
    runTool(saveTool, source, { sessionId: ID, mockups: [{ title: "v", path: file }] }),
  );
  expect(tool.value.isError).toBe(true);
  expect((tool.value.content[0] as { text: string }).text).toMatch(/was not saved: .*inside its own folder/);
  expect(sent).toHaveLength(0);
  expect(leaks(JSON.stringify(tool.value)) || leaks(tool.logs)).toBe(false);
  return err;
}

/** The mockup is inlined: no secret in the HTML, its data: URIs, the report, the logs or the stored payload. */
async function expectSafe(file: string): Promise<InlineReport> {
  const { value: r, logs } = await captured(() => inlineMockup(file));
  expect(leaks(JSON.stringify(r)) || leaks(logs)).toBe(false);
  const { source, sent } = writerSource();
  const res = await runTool(saveTool, source, { sessionId: ID, mockups: [{ title: "v", path: file }] });
  expect(res.isError).toBeFalsy();
  expect(sent).toHaveLength(1);
  expect(sent[0].mockups[0].html).toBe(r.html);
  expect(leaks(JSON.stringify(sent)) || leaks(JSON.stringify(res))).toBe(false);
  return r;
}

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_URI = `data:image/png;base64,${PNG.toString("base64")}`;

describe("inliner: path checks", () => {
  it("compares path segments, not string prefixes", () => {
    expect(within("/a/mock", "/a/mock/x.png")).toBe(true);
    expect(within("/a/mock", "/a/mock")).toBe(true);
    expect(within("/a/mock", "/a/mock/..x.png")).toBe(true);
    expect(within("/a/mock", "/a/mockup/x.png")).toBe(false);
    expect(within("/a/mock", "/a/mock/../x.png")).toBe(false);
    expect(within("/a/mock", "/a")).toBe(false);
  });

  it("classifies references without touching the disk, decoding once", () => {
    expect(classifyRef("img/a.png")).toEqual({ kind: "local", rel: "img/a.png" });
    expect(classifyRef("my%20pic.png?v=2#x")).toEqual({ kind: "local", rel: "my pic.png" });
    expect(classifyRef("%252e%252e/a.png")).toEqual({ kind: "local", rel: "%2e%2e/a.png" });
    for (const keep of ["", "  ", "#grad", "data:image/png;base64,AA", "about:blank"])
      expect(classifyRef(keep).kind).toBe("keep");
    for (const ext of ["https://x.example/a.png", "HTTP://x/a", "//x.example/a.png", "javascript:alert(1)", "blob:x"])
      expect(classifyRef(ext).kind).toBe("external");
    for (const bad of [
      "/etc/passwd",
      "file:///etc/passwd",
      "FILE:/etc/passwd",
      "C:/Windows/win.ini",
      "c:\\Windows\\win.ini",
      "..\\secret.png",
      "\\\\server\\share\\a.png",
      "a.png\0.txt",
      "a.png%00.txt",
      "%2Fetc%2Fpasswd",
      "..%5Csecret.png",
      "C%3A/Windows/win.ini",
      "file%3A///etc/passwd",
      "%E0%A4%A",
      "%zz.png",
    ])
      expect(classifyRef(bad).kind, bad).toBe("reject");
  });
});

describe("inliner: containment", () => {
  it("1. inlines a valid relative image inside the folder", async () => {
    await put("img/dot.png", PNG);
    const r = await expectSafe(await page(`<img src="img/dot.png" alt="">`));
    expect(r.html).toBe(`<!doctype html><img src="${PNG_URI}" alt="">`);
    expect(r.dropped.concat(r.missing, r.skipped)).toEqual([]);
  });

  it("2. inlines nested CSS, resolving each reference against the stylesheet that makes it", async () => {
    await put("img/dot.png", PNG);
    await put("fonts/i.woff2", Buffer.from("wOF2"));
    await put("css/parts/base.css", "body{background:url(../../img/dot.png)}");
    await put("css/site.css", '@import "parts/base.css"; @font-face{src:url(../fonts/i.woff2)}');
    const r = await expectSafe(await page(`<link rel="stylesheet" href="css/site.css">`));
    expect(r.html).toBe(
      `<!doctype html><style>body{background:url("${PNG_URI}")} @font-face{src:url("data:font/woff2;base64,${Buffer.from("wOF2").toString("base64")}")}</style>`,
    );
  });

  it("3. rejects ../ traversal out of the folder, whether or not the target exists", async () => {
    await expectRejected(await page(`<img src="../outside/secret.png">`), /points outside the mockup's folder/);
    await expectRejected(await page(`<img src="img/../../secret.png">`));
    // a missing file outside is rejected too, not reported as missing: no existence oracle
    const err = await expectRejected(await page(`<img src="../outside/none.png">`));
    expect(err.message).toContain("points outside");
  });

  it("4. rejects absolute paths", async () => {
    await expectRejected(await page(`<img src="${path.join(outside, "secret.png")}">`), /is an absolute path/);
    await expectRejected(await page(`<img src="${path.join(root, "inside.png")}">`), /is an absolute path/);
  });

  it("5. rejects percent-encoded traversal", async () => {
    await expectRejected(await page(`<img src="%2e%2e/outside/secret.png">`), /points outside/);
    await expectRejected(await page(`<img src="%2E%2E%2Foutside%2Fsecret.png">`), /points outside/);
    await expectRejected(await page(`<img src=".%2e/outside/secret.png">`), /points outside/);
  });

  it("6. decodes exactly once, so double-encoded traversal stays a literal name inside the folder", async () => {
    await put("%2e%2e/outside/secret.png", PNG); // a folder literally named %2e%2e, inside the mockup's folder
    const r = await expectSafe(await page(`<img src="%252e%252e/outside/secret.png">`));
    expect(r.html).toContain(PNG_URI);
    await fs.rm(path.join(root, "%2e%2e"), { recursive: true });
    const gone = await expectSafe(await page(`<img src="%252e%252e/outside/secret.png">`));
    expect(gone.missing).toEqual([path.join(root, "%2e%2e/outside/secret.png")]);
  });

  it("7. rejects symlinks that lead out of the folder, and follows ones that stay inside", async () => {
    await fs.symlink(path.join(outside, "secret.png"), path.join(root, "link.png"));
    await expectRejected(await page(`<img src="link.png">`), /through a symlink/);
    await fs.symlink(outside, path.join(root, "linked-dir"));
    await expectRejected(await page(`<img src="linked-dir/secret.png">`), /through a symlink/);
    await expectRejected(await page(`<link rel="stylesheet" href="linked-dir/secret.css">`), /through a symlink/);
    await put("img/dot.png", PNG);
    await fs.symlink(path.join(root, "img/dot.png"), path.join(root, "alias.png"));
    expect((await expectSafe(await page(`<img src="alias.png">`))).html).toContain(PNG_URI);
  });

  it("7b. rejects a mockup file that is itself a symlink out of its folder", async () => {
    await fs.writeFile(path.join(outside, "page.html"), `<p>${SECRET}</p>`);
    await fs.symlink(path.join(outside, "page.html"), path.join(root, "m.html"));
    await expectRejected(path.join(root, "m.html"), /is a symlink/);
  });

  it("8. rejects CSS url() that leaves the folder, in <style>, style attributes and linked sheets", async () => {
    await expectRejected(await page(`<style>.a{background:url(../outside/secret.png)}</style>`));
    await expectRejected(await page(`<div style="background:url('../secret.png')"></div>`));
    await expectRejected(await page(`<style>@font-face{src:url("../outside/secret.woff2")}</style>`));
    await put("css/a.css", ".a{background:url(../../outside/secret.png)}");
    await expectRejected(await page(`<link rel="stylesheet" href="css/a.css">`));
  });

  it("9. rejects <link> and @import (direct and nested) that leave the folder", async () => {
    await expectRejected(await page(`<link rel="stylesheet" href="../outside/secret.css">`));
    await expectRejected(await page(`<style>@import "../outside/secret.css";</style>`));
    await expectRejected(await page(`<style>@import url(../outside/secret.css);</style>`));
    await put("css/a.css", '@import "b.css";');
    await put("css/b.css", '@import url("../../outside/secret.css");');
    await expectRejected(await page(`<link rel="stylesheet" href="css/a.css">`), /points outside/);
  });

  it("10. stops circular imports and inlines each sheet once", async () => {
    await put("a.css", '@import "b.css"; .a{}');
    await put("b.css", '@import "a.css"; .b{}');
    const r = await expectSafe(await page(`<link rel="stylesheet" href="a.css">`));
    expect(r.html).toBe("<!doctype html><style> .b{} .a{}</style>");
    expect(r.skipped).toEqual(["a.css (circular @import)"]);
    await put("self.css", '@import "self.css"; .s{}');
    const s = await expectSafe(await page(`<style>@import "self.css";</style>`));
    expect(s.html).toBe("<!doctype html><style> .s{}</style>");
    expect(s.skipped).toEqual(["self.css (circular @import)"]);
  });

  it("11. follows at most 4 levels of @import", async () => {
    for (let i = 1; i <= 6; i++) await put(`l${i}.css`, `${i < 6 ? `@import "l${i + 1}.css";` : ""} .l${i}{}`);
    const r = await expectSafe(await page(`<style>@import "l1.css";</style>`));
    expect(r.html).toContain(".l4{}");
    expect(r.html).not.toContain(".l5{}");
    expect(r.skipped).toEqual(["l5.css (@import more than 4 levels deep)"]);
    // an escape at the depth limit still fails the mockup: references are checked before the depth is
    await put("l4.css", '@import "../outside/secret.css";');
    await expectRejected(await page(`<style>@import "l1.css";</style>`), /points outside/);
    // a sheet past the limit is never read, so nothing in it can be inlined
    await put("l4.css", '@import "l5.css";');
    await put("l5.css", `@import "../outside/secret.css"; .l5{content:"${SECRET}"}`);
    const past = await expectSafe(await page(`<style>@import "l1.css";</style>`));
    expect(past.skipped).toEqual(["l5.css (@import more than 4 levels deep)"]);
  });

  it("12. rejects an asset over the budget before reading it", async () => {
    const big = Buffer.alloc(INLINE_BUDGET + 1, 0x41);
    Buffer.from(SECRET).copy(big);
    await put("big.png", big);
    await expectRejected(await page(`<img src="big.png">`), /over the 2 MB inlining budget/);
    await put("big.css", big);
    await expectRejected(await page(`<link rel="stylesheet" href="big.css">`), /over the 2 MB inlining budget/);
  });

  it("13. counts every use toward the 2 MB budget, nested CSS included", async () => {
    const chunk = (n: number) => Buffer.alloc(n, 0x42);
    await put("a.png", chunk(600 * 1024));
    // one 600 KB image used 4 times: 3.2 MB of data: URIs
    await expectRejected(await page(`<img src="a.png"><img src="a.png"><img src="a.png"><img src="a.png">`), /budget/);
    // the same through CSS: a linked sheet that imports a sheet that uses the image twice
    await put("css/inner.css", ".x{background:url(../a.png)} .y{background:url(../a.png)}");
    await put("css/outer.css", '@import "inner.css"; .z{background:url(../a.png)}');
    await expectRejected(await page(`<link rel="stylesheet" href="css/outer.css"><img src="a.png">`), /budget/);
    // within the budget: two uses are fine
    const ok = await expectSafe(await page(`<img src="a.png"><img src="a.png">`));
    expect(ok.html.length).toBeGreaterThan(1_600_000);
  });

  it("14. leaves out files of unsupported types instead of inlining them", async () => {
    await put("notes.txt", "notes");
    await put("data.json", "{}");
    await put("clip.mp4", "mp4");
    await put("img/dot.png", PNG);
    const r = await expectSafe(
      await page(
        `<img src="notes.txt"><video src="clip.mp4" poster="img/dot.png"></video><link rel="stylesheet" href="img/dot.png"><style>@import "data.json"; .a{background:url(notes.txt)}</style>`,
      ),
    );
    expect(r.html).not.toMatch(/notes|data:text|data:application|mp4"/);
    expect(r.html).toContain(`poster="${PNG_URI}"`);
    expect(r.skipped.sort()).toEqual([
      "clip.mp4 (not an image or font)",
      "data.json (not a stylesheet)",
      "img/dot.png (not a stylesheet)",
      "notes.txt (not an image or font)",
    ]);
  });

  it("15. rejects malformed percent-encoding", async () => {
    await expectRejected(await page(`<img src="%E0%A4%A.png">`), /malformed percent-encoding/);
    await expectRejected(await page(`<style>.a{background:url(%zz.png)}</style>`), /malformed percent-encoding/);
  });

  it("16. drops remote and protocol-relative URLs without fetching them", async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits++;
      res.end(SECRET);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const r = await expectSafe(
        await page(
          `<img src="http://127.0.0.1:${port}/a.png"><img src="//127.0.0.1:${port}/b.png">` +
            `<link rel="stylesheet" href="http://127.0.0.1:${port}/c.css"><link rel="stylesheet" href="//127.0.0.1:${port}/d.css">` +
            `<style>@import url(http://127.0.0.1:${port}/e.css); .a{background:url(//127.0.0.1:${port}/f.png)}</style>`,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(hits).toBe(0);
      expect(r.html).not.toContain(`127.0.0.1:${port}`);
      expect(r.dropped).toHaveLength(6);
    } finally {
      server.close();
    }
  });

  it("17. rejects Windows-style paths and backslash traversal", async () => {
    for (const ref of [
      "..\\outside\\secret.png",
      "..%5Coutside%5Csecret.png",
      "C:\\Windows\\win.ini",
      "C:/Windows/win.ini",
      "\\\\server\\share\\secret.png",
      "/\\server/secret.png",
    ])
      await expectRejected(await page(`<img src="${ref}">`));
    await expectRejected(await page(`<style>.a{background:url(\\2e\\2e/outside/secret.png)}</style>`), /backslash/);
  });

  it("17b. rejects file: URLs and NUL bytes", async () => {
    await expectRejected(await page(`<img src="file://${path.join(outside, "secret.png")}">`), /file: URL/);
    await expectRejected(await page(`<link rel="stylesheet" href="FILE://${path.join(outside, "secret.css")}">`));
    await put("a.png", PNG);
    await expectRejected(await page(`<img src="a.png%00.txt">`), /NUL/);
    await expectRejected(await page(`<img src="a.png\0">`), /NUL/);
  });

  it.skipIf(process.platform === "win32")(
    "18. rejects directories, FIFOs and sockets without hanging",
    async () => {
      await put("img/dot.png", PNG);
      await expectRejected(await page(`<img src="img">`), /not a regular file/);
      await expectRejected(await page(`<link rel="stylesheet" href="img/">`));
      execFileSync("mkfifo", [path.join(root, "pipe.png")]);
      await expectRejected(await page(`<img src="pipe.png">`), /not a regular file/);
      const sock = path.join(root, "s.png");
      const server = net.createServer().listen(sock);
      await new Promise((resolve) => server.once("listening", resolve));
      try {
        await expectRejected(await page(`<img src="s.png">`), /not a regular file/);
      } finally {
        server.close();
      }
      // a device is outside the folder, so a symlink to one fails containment first
      await fs.symlink("/dev/zero", path.join(root, "zero.png"));
      await expectRejected(await page(`<img src="zero.png">`), /through a symlink/);
    },
    10_000,
  );

  it("19. keeps the output of a valid static mockup byte for byte", async () => {
    await put("dot.png", Buffer.from("89504e47", "hex"));
    await put("base.css", "body{color:red}");
    await put("site.css", '@import "base.css"; .hero{background:url(dot.png)}');
    const file = await put(
      "m.html",
      `<!doctype html><link rel="stylesheet" href="site.css"><script src="app.js"></script>\n<img src="dot.png" alt="Dot" srcset="dot.png 2x"><p style="background:url('dot.png')">Hi</p><a href="#x">x</a>`,
    );
    const r = await expectSafe(file);
    // the output of the inliner before this change, for the same files
    expect(r.html).toBe(
      `<!doctype html><style>body{color:red} .hero{background:url("data:image/png;base64,iVBORw==")}</style>\n<img src="data:image/png;base64,iVBORw==" alt="Dot"><p style="background:url('data:image/png;base64,iVBORw==')">Hi</p><a href="#x">x</a>`,
    );
    expect(r).toMatchObject({ dropped: ["app.js"], missing: [], skipped: [] });
  });

  it("20. keeps JavaScript, frames and redirects out of static mockups", async () => {
    const r = await expectSafe(
      await page(
        `<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example">` +
          `<meta http-equiv="Content-Security-Policy" content="script-src *"><script src="a.js"></script><SCRIPT>alert(1)</SCRIPT>` +
          `<svg><script>alert(2)</script></svg><iframe src="https://evil.example"></iframe><object data="x.swf"></object>` +
          `<embed src="x.swf"><p>kept</p><script>never closed`,
      ),
    );
    expect(r.html).toBe("<!doctype html><svg></svg><p>kept</p>");
    expect(r.dropped).toEqual(
      expect.arrayContaining([
        "a.js",
        "inline <script>",
        "<iframe>",
        "<object>",
        "<embed>",
        "<base>",
        "<meta http-equiv>",
      ]),
    );
    // and PIVOT still serves mockups with no script source and a sandbox without allow-scripts
    const route = await fs.readFile(path.join(repo, "apps/web/src/app/api/design/mockups/[id]/route.ts"), "utf8");
    expect(route).toContain(
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; sandbox",
    );
    expect(route).not.toMatch(/script-src|allow-scripts/);
  });

  it("reports every problem at once and stores nothing from the round", async () => {
    await put("ok.png", PNG);
    const good = await page(`<img src="ok.png">`, "good.html");
    const bad = await page(`<img src="../outside/secret.png"><img src="/etc/passwd"><img src="ok.png">`, "bad.html");
    const err = await expectRejected(bad);
    expect(err.problems).toHaveLength(2);
    const { source, sent } = writerSource();
    const res = await runTool(saveTool, source, {
      sessionId: ID,
      mockups: [
        { title: "good", path: good },
        { title: "bad", path: bad },
      ],
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toMatch(/^invalid_input: Version 2 was not saved/);
    expect(sent).toHaveLength(0);
  });
});

// ---- Review findings on PR #70: F2 hard links, F3 the HTML entry point, F4 linear sanitizing, F6 race defenses ----

/** Counts FileHandle reads (the only way the inliner reads file contents), with the bytes each asked for. */
async function readSpy() {
  const probe = await fs.open(path.join(base, "secret.png"));
  const proto = Object.getPrototypeOf(probe) as { read: (...a: unknown[]) => unknown };
  await probe.close();
  return vi.spyOn(proto, "read");
}

describe("inliner: hard links (F2)", () => {
  it("rejects hard-linked images, fonts and stylesheets before reading them", async () => {
    await fs.link(path.join(outside, "secret.png"), path.join(root, "h.png"));
    await fs.link(path.join(outside, "secret.woff2"), path.join(root, "h.woff2"));
    await fs.link(path.join(outside, "secret.css"), path.join(root, "h.css"));
    const reads = await readSpy();
    try {
      await expectRejected(await page(`<img src="h.png">`), /other hard links/);
      await expectRejected(await page(`<style>@font-face{src:url(h.woff2)}</style>`), /other hard links/);
      await expectRejected(await page(`<link rel="stylesheet" href="h.css">`), /other hard links/);
      await put("css/a.css", '@import "../h.css";');
      await expectRejected(await page(`<link rel="stylesheet" href="css/a.css">`), /other hard links/);
      // only the HTML files and a.css were read, never a hard-linked file: each read asked for at most a.css's size
      for (const call of reads.mock.calls) expect(call[2]).not.toBe(SECRET.length);
    } finally {
      reads.mockRestore();
    }
  });

  it("keeps inlining files with a single name (positive control)", async () => {
    await put("img/dot.png", PNG);
    expect((await expectSafe(await page(`<img src="img/dot.png">`))).html).toContain(PNG_URI);
  });
});

describe("inliner: the HTML entry point (F3)", () => {
  it("rejects a path to a file that isn't .html or .htm, such as a secret", async () => {
    await expectRejected(path.join(outside, "secret.png"), /not an \.html or \.htm file/);
    await fs.writeFile(path.join(outside, "id_key"), SECRET);
    await expectRejected(path.join(outside, "id_key"), /not an \.html or \.htm file/);
  });

  it("rejects relative paths and paths with NUL", async () => {
    await expect(inlineMockup("mock/m.html")).rejects.toThrow(/not an absolute path/);
    await expect(inlineMockup(`${root}/m.html\0.png`)).rejects.toThrow(/not an absolute path/);
  });

  it("rejects a hard-linked or symlinked HTML file, even one pointing inside the folder", async () => {
    await fs.writeFile(path.join(outside, "page.html"), `<p>${SECRET}</p>`);
    await fs.link(path.join(outside, "page.html"), path.join(root, "hl.html"));
    await expectRejected(path.join(root, "hl.html"), /other hard links/);
    await put("real.html", "<p>inside</p>");
    await fs.symlink(path.join(root, "real.html"), path.join(root, "alias.html"));
    await expectRejected(path.join(root, "alias.html"), /is a symlink/);
  });

  it("rejects an HTML file over 2 MB without reading it", async () => {
    const big = await put("big.html", Buffer.alloc(INLINE_BUDGET + 1, 0x20));
    const reads = await readSpy();
    try {
      // compare messages only: printing a 2 MB result on failure would take minutes
      const outcome = await inlineMockup(big).then(
        () => "inlined",
        (e: Error) => e.message,
      );
      expect(outcome).toMatch(/is over 2 MB/);
      expect(reads.mock.calls.length).toBe(0);
    } finally {
      reads.mockRestore();
    }
  });

  it.skipIf(process.platform === "win32")("rejects directories, FIFOs and sockets named .html", async () => {
    await fs.mkdir(path.join(root, "dir.html"));
    await expectRejected(path.join(root, "dir.html"), /not a regular file/);
    execFileSync("mkfifo", [path.join(root, "pipe.html")]);
    await expectRejected(path.join(root, "pipe.html"), /not a regular file/);
    const sock = path.join(root, "s.html");
    const server = net.createServer().listen(sock);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      await expectRejected(sock, /not a regular file/);
    } finally {
      server.close();
    }
  });

  it("accepts .html and .htm in any case, and a renamed text file: the name is a filter, not proof", async () => {
    for (const name of ["a.html", "b.HTM", "c.Html"]) await expectSafe(await put(name, "<p>ok</p>"));
    // what the agent saves under an .html name is read as the mockup; the inliner can't tell it apart
    const renamed = await put("notes.html", "plain text, not markup");
    expect((await inlineMockup(renamed)).html).toBe("plain text, not markup");
  });
});

/** The three regex passes this sweep replaced (PR #70 head), kept here as the reference behaviour. */
function regexOracle(html: string) {
  const dropped: string[] = [];
  const attrOf = (tag: string, name: string) =>
    tag
      .match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
      ?.slice(1)
      .find((v) => v != null);
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/>|<script\b[^>]*>[\s\S]*$/gi, (m) => {
    dropped.push(attrOf(m, "src") ?? "inline <script>");
    return "";
  });
  html = html.replace(/<(iframe|frame|object|embed|applet)\b[^>]*>(?:[\s\S]*?<\/\1\s*>)?/gi, (m, n: string) => {
    dropped.push(`<${n.toLowerCase()}>`);
    return "";
  });
  html = html.replace(
    /<base\b[^>]*>|<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy|set-cookie)\b[^>]*>/gi,
    (m) => {
      dropped.push(m.toLowerCase().startsWith("<base") ? "<base>" : "<meta http-equiv>");
      return "";
    },
  );
  return { html, dropped };
}

describe("inliner: linear sanitizing (F4)", () => {
  it("removes exactly what the regexes it replaced removed", () => {
    const parts = [
      "<script>",
      "<SCRIPT src='a.js'>",
      "<script src=b.js/>",
      "</script>",
      "</script >",
      "<scripts>",
      "<iframe src=x>",
      "</iframe>",
      "</IFRAME  >",
      "<frame>",
      "</frame>",
      "<object>",
      "</object>",
      "<embed>",
      "<applet>",
      "</applet>",
      "<frameset>",
      "<base href=x>",
      "<BASE",
      "<meta http-equiv=refresh>",
      '<meta http-equiv="Content-Security-Policy">',
      "<meta charset=utf-8>",
      "<meta x http-equiv='set-cookie'>",
      "<meta http-equiv=refreshx>",
      "<meta",
      "http-equiv=refresh",
      ">",
      "<",
      "/",
      " ",
      "text",
      "<p>",
      "<embedx>",
    ];
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let i = 0; i < 4000; i++) {
      let s = "";
      for (let j = 1 + rnd(25); j > 0; j--) s += parts[rnd(parts.length)];
      const dropped: string[] = [];
      expect({ html: stripActive(s, dropped), dropped }, s).toEqual(regexOracle(s));
    }
  });

  it("stays linear on 2 MB of incomplete, repeated markup", async () => {
    const n = INLINE_BUDGET - 1024; // under the HTML size limit, so the sweep really runs
    for (const [pre, unit, post] of [
      ["", "<script ", ""],
      ["", "<base ", ""],
      ["", "<meta ", ""],
      ["", "<meta ", ">"],
      ["", "<iframe>", ""],
      ["", "<embed>", ""],
      ["<meta ", "http-equiv=refresh ", ""],
    ]) {
      const file = await page(pre + unit.repeat(Math.floor(n / unit.length)) + post);
      const t = performance.now();
      const r = await inlineMockup(file); // valid input with no assets: it must be processed, not refused
      // the regexes took 37 s to over 60 s on these inputs; the sweep takes milliseconds
      expect(performance.now() - t, unit).toBeLessThan(2000);
      expect(r.html.length).toBeGreaterThan(0);
    }
  }, 60_000);
});

/**
 * Deterministic stand-ins for a concurrent writer: hooks on fs/promises run a swap at the exact step of the inliner's
 * check-then-open sequence that a racing process would hit. They show what each defense catches; the double swap
 * (swap, open, swap back) across a parent directory is the open race F1 and is not claimed here.
 */
describe("inliner: defenses between the check and the open (F6)", () => {
  const realOpen = fs.open.bind(fs);
  const realStat = fs.stat.bind(fs);
  const realRealpath = fs.realpath.bind(fs);
  let sub: string;
  let target: string;
  beforeEach(async () => {
    sub = path.join(root, "sub");
    await fs.mkdir(sub);
    target = path.join(sub, "s.png");
    await fs.writeFile(target, PNG);
    await fs.writeFile(path.join(outside, "s.png"), SECRET);
  });
  const realTarget = () => fsSync.realpathSync(target);
  /** sub/ becomes a symlink to the outside folder (and back). */
  const swapParent = () => {
    fsSync.renameSync(sub, `${sub}.real`);
    fsSync.symlinkSync(outside, sub);
  };
  /** sub/s.png becomes a symlink to the outside secret (and back). */
  const swapFile = () => {
    fsSync.renameSync(target, `${target}.real`);
    fsSync.symlinkSync(path.join(outside, "s.png"), target);
  };
  const unswapFile = () => {
    fsSync.unlinkSync(target);
    fsSync.renameSync(`${target}.real`, target);
  };
  const statCalls = (p: string) => {
    let n = 0;
    return (q: unknown) => q === p && ++n === 2; // the 2nd stat of the target is read()'s check before the open
  };

  it("positive control: without a swap the image inlines", async () => {
    expect((await expectSafe(await page(`<img src="sub/s.png">`))).html).toContain(PNG_URI);
  });

  it("catches a parent swapped between the check and the open (inode check)", async () => {
    const t = realTarget();
    const open = vi.spyOn(fs, "open").mockImplementation((async (p: string, ...rest: unknown[]) => {
      if (p === t) swapParent();
      return (realOpen as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.open);
    try {
      await expectRejected(await page(`<img src="sub/s.png">`), /changed while it was being read/);
    } finally {
      open.mockRestore();
    }
  });

  it("catches a parent swapped for the open and back before the recheck (inode check)", async () => {
    const t = realTarget();
    let swapped = false;
    const open = vi.spyOn(fs, "open").mockImplementation((async (p: string, ...rest: unknown[]) => {
      if (p === t) {
        swapParent();
        swapped = true;
      }
      return (realOpen as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.open);
    const real = vi.spyOn(fs, "realpath").mockImplementation((async (p: string, ...rest: unknown[]) => {
      if (swapped && p === t) {
        fsSync.unlinkSync(sub); // back to the real folder: the path looks untouched again
        fsSync.renameSync(`${sub}.real`, sub);
        swapped = false;
      }
      return (realRealpath as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.realpath);
    try {
      await expectRejected(await page(`<img src="sub/s.png">`), /changed while it was being read/);
    } finally {
      [open, real].forEach((s) => s.mockRestore());
    }
  });

  it("catches a parent swapped before the check, while it stays swapped (realpath recheck)", async () => {
    const t = realTarget();
    const second = statCalls(t);
    const stat = vi.spyOn(fs, "stat").mockImplementation((async (p: string, ...rest: unknown[]) => {
      if (second(p)) swapParent();
      return (realStat as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.stat);
    try {
      await expectRejected(await page(`<img src="sub/s.png">`), /changed while it was being read/);
    } finally {
      stat.mockRestore();
    }
  });

  it("refuses a file that turns into a symlink and back around the open (O_NOFOLLOW, fail closed on ELOOP)", async () => {
    const t = realTarget();
    const second = statCalls(t);
    let opened = false;
    const stat = vi.spyOn(fs, "stat").mockImplementation((async (p: string, ...rest: unknown[]) => {
      if (second(p)) swapFile(); // the check sees the outside file through the new symlink
      return (realStat as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.stat);
    const open = vi.spyOn(fs, "open").mockImplementation((async (p: string, ...rest: unknown[]) => {
      if (p === t) opened = true;
      return (realOpen as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.open);
    const real = vi.spyOn(fs, "realpath").mockImplementation((async (p: string, ...rest: unknown[]) => {
      if (opened && p === t && fsSync.lstatSync(t).isSymbolicLink()) unswapFile(); // and back before the recheck
      return (realRealpath as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.realpath);
    try {
      // without O_NOFOLLOW the open follows the symlink to the secret, whose inode the check saw, and the recheck
      // finds the file back in place; with it the open fails (ELOOP), which must reject, not count as missing
      await expectRejected(await page(`<img src="sub/s.png">`), /changed while it was being read/);
    } finally {
      [stat, open, real].forEach((s) => s.mockRestore());
    }
  });

  it.skipIf(process.platform === "win32")(
    "doesn't hang when a FIFO is swapped in before the open (O_NONBLOCK)",
    async () => {
      const t = realTarget();
      const open = vi.spyOn(fs, "open").mockImplementation((async (p: string, ...rest: unknown[]) => {
        if (p === t) {
          fsSync.unlinkSync(t);
          execFileSync("mkfifo", [t]);
        }
        return (realOpen as (...a: unknown[]) => unknown)(p, ...rest);
      }) as typeof fs.open);
      try {
        const run = inlineMockup(await page(`<img src="sub/s.png">`)).then(
          () => "ok",
          (e: Error) => e.message,
        );
        const timer = new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 3000));
        const result = await Promise.race([run, timer]);
        if (result === "hung") {
          // release the blocked open (a writer appears), so the test process can end
          const w = fsSync.openSync(t, fsSync.constants.O_WRONLY | fsSync.constants.O_NONBLOCK);
          fsSync.closeSync(w);
          await run;
        }
        expect(result).toMatch(/changed while it was being read/);
      } finally {
        open.mockRestore();
      }
    },
    10_000,
  );
});

describe("inliner: budget accounting (F6)", () => {
  it("counts the base64 expansion of data: URIs, not the file's raw size", async () => {
    // 1.6 MB raw is 2.13 MB as base64: over the budget, though the raw bytes fit
    await put("big.png", Buffer.alloc(Math.floor(1.6 * 1024 * 1024), 0x41));
    await expectRejected(await page(`<img src="big.png">`), /over the 2 MB inlining budget/);
    // positive control: 1.4 MB raw is 1.87 MB as base64
    await put("ok.png", Buffer.alloc(Math.floor(1.4 * 1024 * 1024), 0x41));
    await expectSafe(await page(`<img src="ok.png">`));
  });

  it("checks an asset's size before reading it", async () => {
    await put("huge.png", Buffer.alloc(INLINE_BUDGET + 1, 0x41));
    await put("small.png", PNG);
    const reads = await readSpy();
    try {
      await expect(inlineMockup(await page(`<img src="huge.png">`))).rejects.toThrow(/budget/);
      expect(reads.mock.calls.length).toBe(1); // the HTML file only
      reads.mockClear();
      await inlineMockup(await page(`<img src="small.png">`)); // positive control: HTML, then the image
      expect(reads.mock.calls.length).toBe(2);
    } finally {
      reads.mockRestore();
    }
  });
});
