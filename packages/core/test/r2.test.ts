import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import S3rver from "s3rver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the R2 code path against s3rver, a local S3-compatible server, so no Cloudflare account is needed.
let tmp: string;
let server: S3rver;
let core: {
  storage: typeof import("../src/storage");
  assets: typeof import("../src/assets");
  resources: typeof import("../src/resources");
  context: typeof import("../src/context");
  db: typeof import("../src/db/client");
};

const BUCKET = "stan-bag-test";

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "stan-bag-r2-"));
  server = new S3rver({
    port: 0,
    address: "127.0.0.1",
    silent: true,
    directory: path.join(tmp, "s3"),
    configureBuckets: [{ name: BUCKET, configs: [] }],
  });
  const { port } = (await server.run()) as { port: number };
  process.env.STAN_BAG_DATA_DIR = path.join(tmp, "data");
  process.env.CLAUDE_SKILLS_DIR = path.join(tmp, "skills");
  process.env.CLAUDE_PLUGINS_DIR = path.join(tmp, "plugins");
  process.env.AGENTS_SKILL_LOCK = path.join(tmp, "skill-lock.json");
  process.env.STAN_BAG_MIGRATIONS_DIR = path.resolve(__dirname, "../src/db/migrations");
  delete process.env.DATABASE_URL;
  // s3rver accepts these fixed credentials.
  process.env.R2_ACCESS_KEY_ID = "S3RVER";
  process.env.R2_SECRET_ACCESS_KEY = "S3RVER";
  process.env.R2_BUCKET = BUCKET;
  process.env.R2_ENDPOINT = `http://127.0.0.1:${port}`;
  core = {
    storage: await import("../src/storage"),
    assets: await import("../src/assets"),
    resources: await import("../src/resources"),
    context: await import("../src/context"),
    db: await import("../src/db/client"),
  };
});

afterAll(async () => {
  await core.db.closeDb();
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("R2 store", () => {
  it("is selected when the R2 keys are present", () => {
    expect(core.storage.storageMode()).toBe("r2");
  });

  it("round-trips, ranges and deletes objects", async () => {
    const store = core.storage.writeStore();
    expect(await core.storage.checkStore(store)).toMatchObject({ target: `r2://${BUCKET}` });
    await store.put("assets/x/hello.txt", Buffer.from("hello world"), "text/plain");
    expect(await store.size("assets/x/hello.txt")).toBe(11);
    const part = await store.stream("assets/x/hello.txt", { start: 6, end: 10 });
    expect(part?.length).toBe(5);
    expect(await new Response(part!.body).text()).toBe("world");
    await store.delete("assets/x/hello.txt");
    expect(await store.get("assets/x/hello.txt")).toBeNull();
    expect(await store.size("assets/x/hello.txt")).toBeNull();
  });

  it("refuses keys that escape the bucket prefix", async () => {
    await expect(core.storage.writeStore().put("../evil", Buffer.from("x"), "text/plain")).rejects.toThrow(
      /Invalid storage key/,
    );
  });
});

describe("assets on R2", () => {
  it("saves to R2 with a thumbnail, keeps nothing local, and cleans up", async () => {
    const { saveAsset, attachAsset, readAssetBytes, streamThumbnail, materializeAsset } = core.assets;
    const { createResource, purgeResources } = core.resources;
    const png = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#1500ff" } })
      .png()
      .toBuffer();

    const asset = await saveAsset({ data: png, fileName: "shot.png" });
    expect(asset.storage).toBe("r2");
    expect((await readAssetBytes(asset))?.equals(png)).toBe(true);
    const thumb = await streamThumbnail(asset);
    expect(thumb?.length).toBeGreaterThan(0);
    // Nothing was written to the local assets folder.
    await expect(fs.access(path.join(process.env.STAN_BAG_DATA_DIR!, asset.storagePath))).rejects.toThrow();

    const r = await createResource({ type: "media", title: "Indigo" });
    await attachAsset(r.id, asset.id);

    // Clipboard context points at a local cached copy Claude Code can open.
    const clip = await core.context.buildClipboardContext([r.id]);
    const cached = await materializeAsset(asset);
    expect(cached).toContain(path.join("cache", "assets"));
    expect(clip.markdown).toContain(cached!);

    // Export writes the bytes (resized to Claude's 1568px edge) into the bundle.
    const out = await core.context.exportBundle({
      resourceIds: [r.id],
      targetDir: path.join(tmp, "out"),
      bundleName: "r2",
      resizeImages: true,
    });
    const meta = await sharp(path.join(out.path, "assets", "indigo.png")).metadata();
    expect(meta.width).toBe(1568);

    await purgeResources([r.id]);
    expect(await readAssetBytes(asset)).toBeNull();
    await expect(fs.access(cached!)).rejects.toThrow();
    expect(await streamThumbnail(asset)).toBeNull();
  });

  it("moves local files to R2", async () => {
    const { LocalStore } = core.storage;
    const db = await core.db.getDb();
    const { assets } = await import("../src/db/schema");
    // Simulate an asset saved before R2 was configured.
    const local = new LocalStore();
    await local.put("assets/2026-10/legacy.txt", Buffer.from("legacy"), "text/plain");
    const [row] = await db
      .insert(assets)
      .values({
        kind: "text",
        fileName: "legacy.txt",
        storagePath: "assets/2026-10/legacy.txt",
        storage: "local",
        mimeType: "text/plain",
        size: 6,
        sha256: "legacy",
      })
      .returning();

    const result = await core.assets.migrateLocalAssets();
    expect(result).toMatchObject({ moved: 1, missing: [], total: 1 });
    const moved = (await core.assets.getAsset(row.id))!;
    expect(moved.storage).toBe("r2");
    expect((await core.assets.readAssetBytes(moved))?.toString()).toBe("legacy");
    expect(await local.get("assets/2026-10/legacy.txt")).toBeNull();
  });
});
