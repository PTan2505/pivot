import { describe, expect, it } from "vitest";
import { isPrivateAddress, normalizeUrl, urlKey, assertPublicUrl } from "../src/net-guard";
import { extractVariables, fillVariables } from "../src/prompt-vars";
import { estimateImageTokens, estimateTextTokens, scaledImageSize } from "../src/tokens";
import { slugify } from "../src/context";

describe("prompt variables", () => {
  it("extracts unique names with defaults", () => {
    const vars = extractVariables("Build a {{component}} in {{ stack | Next.js }} — {{component}} again");
    expect(vars).toEqual([
      { name: "component", defaultValue: "" },
      { name: "stack", defaultValue: "Next.js" },
    ]);
  });

  it("fills values, falls back to defaults, keeps unknown placeholders", () => {
    const out = fillVariables("{{a}} / {{b|bee}} / {{c}}", { a: "ay" });
    expect(out).toBe("ay / bee / {{c}}");
  });
});

describe("urls", () => {
  it("normalizes bare domains and strips hashes", () => {
    expect(normalizeUrl("linear.app/#top")).toBe("https://linear.app/");
  });

  it("builds duplicate keys that ignore protocol, www and trailing slash", () => {
    expect(urlKey("http://www.Linear.app/features/")).toBe(urlKey("https://linear.app/features"));
    expect(urlKey("https://linear.app/a")).not.toBe(urlKey("https://linear.app/b"));
  });

  it("flags private and loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("rejects non-http schemes and private hosts", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("http://127.0.0.1:4321/api")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://localhost/")).rejects.toThrow(/private/);
  });
});

describe("token estimates", () => {
  it("counts ~4 chars per token", () => {
    expect(estimateTextTokens("a".repeat(400))).toBe(100);
  });

  it("scales images to a 1568px long edge before estimating", () => {
    expect(scaledImageSize(1440, 900)).toEqual({ width: 1440, height: 900 });
    expect(scaledImageSize(3136, 1000)).toEqual({ width: 1568, height: 500 });
    expect(estimateImageTokens(1440, 900)).toBe(Math.ceil((1440 * 900) / 750));
  });
});

describe("slugify", () => {
  it("makes filesystem-safe names", () => {
    expect(slugify("Dashboard — Tiếng Việt / v2!")).toBe("dashboard-tieng-viet-v2");
    expect(slugify("???")).toBe("item");
  });
});
