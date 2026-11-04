import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiToken, isValidApiToken, regenerateApiToken } from "../src/api-token";

let tmp: string;
const previous = process.env.PIVOT_DATA_DIR;
const tokenFile = () => path.join(tmp, "api-token");

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-token-"));
  process.env.PIVOT_DATA_DIR = tmp;
});
afterAll(() => {
  if (previous === undefined) delete process.env.PIVOT_DATA_DIR;
  else process.env.PIVOT_DATA_DIR = previous;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("API token", () => {
  it("before any token exists, every candidate is invalid and checking creates nothing", () => {
    for (const candidate of ["made-up", "x".repeat(32), "", null, undefined]) {
      expect(isValidApiToken(candidate)).toBe(false);
    }
    expect(fs.existsSync(tokenFile())).toBe(false);
  });

  it("accepts only the saved token, compared in full", () => {
    const token = apiToken();
    expect(fs.existsSync(tokenFile())).toBe(true);
    expect(isValidApiToken(token)).toBe(true);
    expect(isValidApiToken(token.slice(0, -1))).toBe(false); // shorter
    expect(isValidApiToken(token + "x")).toBe(false); // longer
    expect(isValidApiToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBe(false); // same length
    expect(isValidApiToken(` ${token}`)).toBe(false);
    expect(isValidApiToken(`Bearer ${token}`)).toBe(false); // the proxy strips the scheme, nothing else does
  });

  it("rotating the token invalidates the old one", () => {
    const old = apiToken();
    const fresh = regenerateApiToken();
    expect(isValidApiToken(old)).toBe(false);
    expect(isValidApiToken(fresh)).toBe(true);
  });
});
