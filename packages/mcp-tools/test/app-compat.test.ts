// The MCP server refuses to call a PIVOT app older than itself: the plugin updates from GitHub and the app from npm, so
// they can drift apart. Checked through HttpSource (apps/mcp) against a small fake app.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { API_FEATURES } from "@pivot/core/capabilities";
import { afterEach, describe, expect, it } from "vitest";
import { HttpSource } from "../../../apps/mcp/src/http-source";
import { missingAppFeatures, REQUIRED_APP_FEATURES, UPDATE_APP } from "../src/app-compat";
import type { ToolError } from "../src/source";

describe("missingAppFeatures", () => {
  it("names the required features an answer lacks, and treats an unreadable answer as lacking them all", () => {
    expect(REQUIRED_APP_FEATURES.length).toBeGreaterThan(0);
    for (const f of REQUIRED_APP_FEATURES) expect(API_FEATURES).toContain(f);
    expect(missingAppFeatures({ app: "pivot", features: [...API_FEATURES] })).toEqual([]);
    expect(missingAppFeatures({ features: REQUIRED_APP_FEATURES.slice(1) })).toEqual([REQUIRED_APP_FEATURES[0]]);
    expect(missingAppFeatures({ features: "design" })).toEqual(REQUIRED_APP_FEATURES);
    expect(missingAppFeatures(null)).toEqual(REQUIRED_APP_FEATURES);
  });
});

describe("HttpSource against an older app", () => {
  let server: http.Server | undefined;
  afterEach(() => server?.close());

  /** A fake app: `features` decides /api/capabilities (null: no such route), every other route answers {}. */
  async function fakeApp(state: { features: string[] | null }) {
    const hits: string[] = [];
    server = http.createServer((req, res) => {
      const route = req.url!.split("?")[0];
      hits.push(route);
      res.setHeader("content-type", "application/json");
      if (route === "/api/capabilities" && state.features === null) {
        res.statusCode = 404;
        return res.end("{}");
      }
      if (route === "/api/capabilities")
        return res.end(JSON.stringify({ app: "pivot", apiVersion: 4, features: state.features }));
      res.end(JSON.stringify({ items: [], nextCursor: null }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, hits, source: new HttpSource(base) };
  }

  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null as ToolError | null,
      (e: ToolError) => e,
    );

  it("refuses with app_outdated and the update steps, without calling the route, until the app is updated", async () => {
    const state = { features: ["design"] as string[] | null };
    const { base, hits, source } = await fakeApp(state);

    const err = await failure(source.search({ query: "pricing" }));
    expect(err?.code).toBe("app_outdated");
    expect(err?.message).toContain(`The PIVOT app at ${base} is older than this plugin`);
    expect(err?.message).toContain(REQUIRED_APP_FEATURES.filter((f) => f !== "design").join(", "));
    expect(err?.message).toContain(UPDATE_APP);
    expect(hits).toEqual(["/api/capabilities"]);

    // updated in place: the next call checks again and goes through, and the check isn't repeated after that
    state.features = [...API_FEATURES];
    await source.search({ query: "pricing" });
    await source.search({ query: "hero" });
    expect(hits).toEqual(["/api/capabilities", "/api/capabilities", "/api/resources", "/api/resources"]);
  });

  it("treats an app without /api/capabilities as outdated", async () => {
    const { source } = await fakeApp({ features: null });
    expect((await failure(source.search({ query: "pricing" })))?.code).toBe("app_outdated");
  });

  it("still says app_unreachable when nothing answers", async () => {
    const { base } = await fakeApp({ features: [] });
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
    expect((await failure(new HttpSource(base).search({ query: "pricing" })))?.code).toBe("app_unreachable");
  });
});
