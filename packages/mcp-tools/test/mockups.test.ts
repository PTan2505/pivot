// Regression tests for the mockup inliner's containment: nothing outside a mockup's folder may end up in PIVOT.
// Every test uses a temporary folder and a synthetic secret next to (outside) the mockup's folder.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyRef, INLINE_BUDGET, inlineMockup, type InlineReport, MockupRejected, within } from "../src/mockups";
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
    await expectRejected(path.join(root, "m.html"), /symlink to a file outside its folder/);
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
