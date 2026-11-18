import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isOtherSection,
  isOtherType,
  OTHER_TYPES,
  RESOURCE_TYPES,
  SECTIONS,
  visibleSections,
  visibleTypes,
} from "../src/types";

let tmp: string;
let settings: typeof import("../src/settings");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-test-"));
  process.env.PIVOT_DATA_DIR = path.join(tmp, "data");
  process.env.PIVOT_MIGRATIONS_DIR = path.resolve(__dirname, "../src/db/migrations");
  delete process.env.DATABASE_URL;
  settings = await import("../src/settings");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("other resource types (design focus)", () => {
  it("are exactly the Knowledge and Skills sections' types", () => {
    const fromSections = SECTIONS.filter((s) => isOtherSection(s.id)).flatMap((s) => s.types);
    expect([...fromSections].sort()).toEqual([...OTHER_TYPES].sort());
    expect(RESOURCE_TYPES.filter(isOtherType).sort()).toEqual([...OTHER_TYPES].sort());
  });

  it("hide from the sections and types unless shown", () => {
    expect(visibleSections(false).map((s) => s.id)).toEqual(["library", "sources"]);
    expect(visibleSections(true).map((s) => s.id)).toEqual(SECTIONS.map((s) => s.id));
    expect(visibleTypes(false)).toEqual(["reference", "library", "media", "icon", "animation", "typography", "source"]);
    expect(visibleTypes(true)).toEqual([...RESOURCE_TYPES]);
  });

  it("start hidden, and the setting keeps only valid values", async () => {
    expect(await settings.getUiSettings()).toEqual({ showOtherTypes: false });
    expect(await settings.setUiSettings({ showOtherTypes: true, junk: 1 })).toEqual({ showOtherTypes: true });
    expect(await settings.getUiSettings()).toEqual({ showOtherTypes: true });
    await settings.setUiSettings({ showOtherTypes: "yes" });
    expect(await settings.getUiSettings()).toEqual({ showOtherTypes: true });
    await settings.setUiSettings({ showOtherTypes: false });
    expect(await settings.getUiSettings()).toEqual({ showOtherTypes: false });
  });
});
