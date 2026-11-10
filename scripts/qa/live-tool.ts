// Dev-only: calls one PIVOT MCP tool against a SCRATCH PIVOT, exactly as the stdio MCP server would (HttpSource).
// Usage: PIVOT_URL=http://127.0.0.1:4400 PIVOT_DATA_DIR=<scratch> npx tsx scripts/qa/live-tool.ts <tool> '<json input>' [imageDir]
import fs from "node:fs";
import path from "node:path";
import { HttpSource } from "../../apps/mcp/src/http-source";
import { runTool, TOOLS } from "../../packages/mcp-tools/src/tools";
import { WRITE_TOOLS } from "../../packages/mcp-tools/src/write-tools";
import { EXTERNAL_TOOLS } from "../../packages/mcp-tools/src/external-tools";
import { assertScratch } from "./scratch-guard.mjs";

const [name, json = "{}", imageDir] = process.argv.slice(2);
await assertScratch({ base: process.env.PIVOT_URL!, dataDir: process.env.PIVOT_DATA_DIR! });
const tool = [...TOOLS, ...WRITE_TOOLS, ...EXTERNAL_TOOLS].find((t) => t.name === name);
if (!tool) throw new Error(`no tool ${name}`);
const r = await runTool(tool, new HttpSource(), JSON.parse(json));
let i = 0;
for (const c of r.content) {
  if (c.type === "text") console.log(c.text);
  else if (imageDir) {
    fs.mkdirSync(imageDir, { recursive: true });
    const f = path.join(imageDir, `${name}-${++i}.${c.mimeType.split("/")[1]}`);
    fs.writeFileSync(f, Buffer.from(c.data, "base64"));
    console.log(`[image saved: ${f}]`);
  }
}
if (r.structuredContent && process.env.LIVE_OUT)
  fs.writeFileSync(process.env.LIVE_OUT, JSON.stringify(r.structuredContent, null, 2));
