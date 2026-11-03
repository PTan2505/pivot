// The local mockup viewer (.claude/skills/pivot-design/viewer/make-viewer.mjs): what it inlines, removes and allows.
// Browser behaviour (sandbox, policy, navigation) is checked by scripts/qa/preview-checks.mjs viewer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const { buildViewer, inlineMockup, versionPolicy, versionSandbox } = await import(
  pathToFileURL(path.resolve(here, "../../../.claude/skills/pivot-design/viewer/make-viewer.mjs")).href
);

const dirs = [];
const folder = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-viewer-test-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("viewer policy", () => {
  it("never allows same-origin, forms, popups or top navigation; scripts only when interactive", () => {
    expect(versionSandbox(false)).toBe("");
    expect(versionSandbox(true)).toBe("allow-scripts");
    expect(versionPolicy(false)).toContain("script-src 'none'");
    expect(versionPolicy(true)).toContain("script-src 'unsafe-inline'");
    for (const p of [versionPolicy(false), versionPolicy(true)]) {
      expect(p).toContain("default-src 'none'");
      expect(p).toContain("connect-src 'none'");
      expect(p).toContain("form-action 'none'");
      expect(p).not.toContain("'self'");
      expect(p).not.toMatch(/https?:/);
    }
  });
});

describe("inlineMockup", () => {
  it("inlines local styles, imports and images, and puts the policy first in <head>", () => {
    const dir = folder({
      "m.html": `<html><head><link rel="stylesheet" href="css/a.css"></head><body style="background:url('img/x.png')"><img src="img/x.png"></body></html>`,
      "css/a.css": `@import "b.css"; .a{background:url(../img/x.png)}`,
      "css/b.css": `.b{color:red}`,
      "img/x.png": "PNG",
    });
    const { html, removed } = inlineMockup(path.join(dir, "m.html"), dir);
    expect(removed).toEqual([]);
    expect(html).toMatch(/^<html><head><meta http-equiv="Content-Security-Policy"/);
    expect(html).toContain(".b{color:red}");
    expect(html).not.toMatch(/(href|src)="(css|img)\//);
    expect(html.match(/data:image\/png;base64,UE5H/g)).toHaveLength(3);
  });

  it("removes scripts and handlers' power from static versions, and keeps local scripts in interactive ones", () => {
    const dir = folder({
      "m.html": `<head></head><script>a()</script><script src="lib.js"></script><script src="https://cdn.example/x.js"></script>`,
      "lib.js": "window.lib = 1; // </script> inside",
    });
    const stat = inlineMockup(path.join(dir, "m.html"), dir);
    expect(stat.html).not.toContain("<script");
    expect(stat.removed).toEqual(expect.arrayContaining(["an inline script", "lib.js (script)"]));

    const live = inlineMockup(path.join(dir, "m.html"), dir, { interactive: true });
    expect(live.html).toContain("<script>a()</script>");
    expect(live.html).toContain("window.lib = 1; // <\\/script> inside");
    expect(live.html).not.toContain("cdn.example");
    expect(live.removed).toEqual(["https://cdn.example/x.js (not local)"]);
  });

  it("never reads outside the mockup folder, through ../ or a symlink", () => {
    const outside = folder({ "secret.css": ".secret{}" });
    const dir = folder({
      "m.html": `<head></head><link rel="stylesheet" href="../${path.basename(outside)}/secret.css"><link rel="stylesheet" href="link.css">`,
    });
    fs.symlinkSync(path.join(outside, "secret.css"), path.join(dir, "link.css"));
    const { html, removed } = inlineMockup(path.join(dir, "m.html"), dir);
    expect(html).not.toContain(".secret");
    expect(removed.filter((r) => r.endsWith("(outside the mockup folder)"))).toHaveLength(2);
  });

  it("drops remote references, policies, refresh, base and navigating links (keeps #anchors)", () => {
    const dir = folder({
      "m.html": `<head><meta http-equiv="refresh" content="0;url=https://x"><meta http-equiv="Content-Security-Policy" content="default-src *"><base href="https://x/"></head>
<img src="https://x/a.png"><a href="https://x/b">b</a><a href="#tab-2">tab</a><style>.c{background:url(https://x/c.png)}</style>`,
    });
    const { html, removed } = inlineMockup(path.join(dir, "m.html"), dir);
    expect(html).not.toContain("https://x");
    expect(html).toContain('<a href="#tab-2">');
    expect(html.match(/http-equiv/g)).toHaveLength(1); // only the viewer's own policy
    expect(removed).toEqual(
      expect.arrayContaining(["a <base> tag", "1 link (href removed)", "https://x/a.png (not local)"]),
    );
  });
});

describe("buildViewer", () => {
  it("embeds each version with its sandbox, and escapes markup inside the page script", () => {
    const dir = folder({
      "mockup-1-a.html": "<title>A</title><p>a</p><script>x()</script>",
      "mockup-2-b.html": "<title>B</title><p>b</p></script><script>y()</script>",
      "notes.html": "ignored",
    });
    const { page, versions } = buildViewer(dir, { title: "T", interactive: [2] });
    expect(versions.map((v) => [v.n, v.title, v.interactive])).toEqual([
      [1, "A", false],
      [2, "B", true],
    ]);
    const script = page.slice(page.lastIndexOf("<script>"));
    expect(script.match(/<\/script>/g)).toHaveLength(1);
    expect(page).toContain('"sandbox":"allow-scripts"');
    expect(page).toContain('"sandbox":""');
    expect(page).toContain("Content-Security-Policy");
    expect(page).not.toMatch(/https?:\/\//);
  });

  it("refuses a folder without mockups", () => {
    expect(() => buildViewer(folder({ "x.html": "" }))).toThrow(/No mockup-\*\.html/);
  });
});
