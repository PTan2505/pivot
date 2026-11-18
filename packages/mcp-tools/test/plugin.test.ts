// The Claude Code plugin (plugin/ and .claude-plugin/marketplace.json): its manifests agree with each other, the agent
// only gets read tools that exist, the committed MCP bundle matches the source, and the SessionStart hook speaks only
// when PIVOT is down. `pnpm plugin:validate` runs Claude Code's own validator on top of this.
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { EXTERNAL_TOOLS } from "../src/external-tools";
import { TOOLS } from "../src/tools";
import { WRITE_TOOLS } from "../src/write-tools";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const P = (...p: string[]) => path.join(root, ...p);
const read = (...p: string[]) => fs.readFileSync(P(...p), "utf8");
const json = (...p: string[]) => JSON.parse(read(...p));

const marketplace = json(".claude-plugin/marketplace.json");
const manifest = json("plugin/.claude-plugin/plugin.json");
const mcp = json("plugin/.mcp.json");
const hooks = json("plugin/hooks/hooks.json");
const options = Object.keys(manifest.userConfig ?? {});

describe("plugin manifests", () => {
  it("the marketplace lists the pivot plugin from ./plugin", () => {
    expect(marketplace.name).toBe("pivot");
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: "pivot", source: "./plugin" })]);
    expect(manifest.name).toBe("pivot");
    expect(manifest.license).toBe("MIT");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("the MCP server is the bundled file, started with node, at the configured address", () => {
    expect(mcp.mcpServers.pivot).toEqual({
      command: "node",
      args: ["${CLAUDE_PLUGIN_ROOT}/server/server.js"],
      env: { PIVOT_URL: "${user_config.pivot_url}" },
    });
    expect(manifest.userConfig.pivot_url.default).toBe("http://127.0.0.1:4321");
  });

  it("every ${user_config.*} the plugin uses is declared", () => {
    const files = [
      "plugin/.mcp.json",
      "plugin/hooks/hooks.json",
      "plugin/skills/design/SKILL.md",
      "plugin/skills/redesign/SKILL.md",
      "plugin/agents/specialist.md",
    ];
    const used = files.flatMap((f) => [...read(f).matchAll(/\$\{user_config\.(\w+)\}/g)].map((m) => m[1]));
    expect(used.length).toBeGreaterThan(0);
    for (const key of used) expect(options).toContain(key);
  });

  it("no file in the plugin reaches outside it (the cache copy only has plugin/)", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        expect(e.isSymbolicLink(), p).toBe(false);
        return e.isDirectory() ? walk(p) : [p];
      });
    for (const file of walk(P("plugin")).filter((f) => /\.(md|json|mjs|html)$/.test(f))) {
      const text = fs.readFileSync(file, "utf8");
      // Links to ../design from redesign stay inside; nothing climbs out of plugin/.
      expect(text, file).not.toMatch(/\.\.\/\.\.\/\.\.\//);
      expect(text, file).not.toContain(".claude/skills/pivot-");
    }
  });
});

describe("the specialist agent", () => {
  const agent = read("plugin/agents/specialist.md");
  const tools = (/^tools: (.+)$/m.exec(agent)?.[1] ?? "").split(",").map((t) => t.trim());
  const reads = new Set([...TOOLS, ...EXTERNAL_TOOLS].map((t) => t.name).concat("get_design_session"));
  const all = new Set([...TOOLS, ...EXTERNAL_TOOLS, ...WRITE_TOOLS].map((t) => t.name));

  it("names the plugin's own MCP tools, each one an existing read tool", () => {
    const mcpTools = tools.filter((t) => t.startsWith("mcp__"));
    expect(mcpTools.length).toBeGreaterThan(0);
    for (const t of mcpTools) {
      expect(t).toMatch(/^mcp__plugin_pivot_pivot__/);
      const name = t.replace(/^mcp__plugin_pivot_pivot__/, "");
      expect(all.has(name) || name === "get_design_session", t).toBe(true);
      expect(reads.has(name), t).toBe(true);
    }
  });

  it("the skills call it by its plugin name", () => {
    expect(read("plugin/skills/design/specialists.md")).toContain('subagent_type: "pivot:specialist"');
  });
});

describe("the committed MCP bundle", () => {
  it("matches what the source builds today (run pnpm mcp:build when this fails)", async () => {
    const { bundle } = await import(pathToFileURL(P("apps/mcp/build.mjs")).href);
    expect((await bundle()) === read("plugin/server/server.js")).toBe(true);
  }, 60_000);
});

describe("the SessionStart hook", () => {
  const run = promisify(execFile);
  const command = hooks.hooks.SessionStart[0].hooks[0];
  const script = P("plugin", String(command.args[0]).replace("${CLAUDE_PLUGIN_ROOT}/", ""));
  const hook = (url: string) =>
    run(process.execPath, [script], { env: { ...process.env, CLAUDE_PLUGIN_OPTION_PIVOT_URL: url }, timeout: 15_000 });

  it("is a node script inside the plugin", () => {
    expect(command.command).toBe("node");
    expect(fs.existsSync(script)).toBe(true);
  });

  it("says nothing when PIVOT answers", async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ app: "pivot", apiVersion: 1, features: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { stdout } = await hook(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      expect(stdout).toBe("");
    } finally {
      server.close();
    }
  });

  it("tells Claude and the user how to start PIVOT when nothing answers", async () => {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    server.close();
    const { stdout } = await hook(`http://127.0.0.1:${port}`);
    const out = JSON.parse(stdout);
    expect(out.systemMessage).toContain(`isn't running at http://127.0.0.1:${port}`);
    expect(out.hookSpecificOutput).toEqual({ hookEventName: "SessionStart", additionalContext: out.systemMessage });
  });
});
