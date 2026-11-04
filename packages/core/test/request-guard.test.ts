import { describe, expect, it } from "vitest";
import { guardApiRequest, type ApiRequest } from "../src/request-guard";

const HOST = "127.0.0.1:4321";
const req = (over: Partial<ApiRequest> = {}): ApiRequest => ({
  method: "GET",
  pathname: "/api/resources",
  host: HOST,
  origin: null,
  fetchSite: null,
  fetchMode: null,
  hasToken: () => false,
  ...over,
});
const allowed = (over: Partial<ApiRequest>) => guardApiRequest(req(over)).ok;
const APPROVE = "/api/design/mockups/abc/approve";

describe("guardApiRequest", () => {
  it("answers only requests addressed to this machine", () => {
    expect(allowed({})).toBe(true);
    expect(allowed({ host: "localhost:4321" })).toBe(true);
    expect(allowed({ host: "[::1]:4321" })).toBe(true);
    expect(guardApiRequest(req({ host: "evil.example" }))).toEqual({ ok: false, error: "Forbidden host" });
    expect(allowed({ host: null })).toBe(false);
  });

  it("lets the app's own pages write, by Origin or by Sec-Fetch-Site", () => {
    expect(allowed({ method: "POST", origin: `http://${HOST}` })).toBe(true);
    expect(allowed({ method: "POST", fetchSite: "same-origin" })).toBe(true);
  });

  it("blocks writes from other origins, null origins and unreadable origins unless they carry the token", () => {
    for (const origin of [
      "http://127.0.0.1:9999",
      "https://evil.example",
      "null",
      "not a url",
      "chrome-extension://abc",
    ]) {
      expect(allowed({ method: "POST", pathname: APPROVE, origin }), origin).toBe(false);
      expect(allowed({ method: "POST", pathname: APPROVE, origin, hasToken: () => true }), origin).toBe(true);
    }
    // a sandboxed mockup frame posting to approve: Origin null, cross-site
    expect(
      guardApiRequest(req({ method: "POST", pathname: APPROVE, origin: "null", fetchSite: "cross-site" })),
    ).toEqual({
      ok: false,
      error: "Cross-origin request blocked",
    });
    expect(guardApiRequest(req({ method: "POST", origin: "chrome-extension://abc" }))).toEqual({
      ok: false,
      error: "Invalid API token — copy it again from PIVOT › Settings.",
    });
  });

  it("asks for the token on a write with neither Origin nor Sec-Fetch-Site (curl, scripts)", () => {
    expect(allowed({ method: "DELETE" })).toBe(false);
    expect(allowed({ method: "DELETE", hasToken: () => true })).toBe(true);
    expect(allowed({ method: "PATCH", fetchSite: "cross-site" })).toBe(false);
  });

  it("checks the token only when it decides the outcome", () => {
    let asked = 0;
    const hasToken = () => (asked++, false);
    guardApiRequest(req({ hasToken }));
    guardApiRequest(req({ method: "POST", origin: `http://${HOST}`, hasToken }));
    expect(asked).toBe(0);
  });

  it("blocks another site or a sandboxed frame from opening API pages, except mockups and assets", () => {
    for (const fetchSite of ["cross-site", "same-site"]) {
      expect(allowed({ fetchSite, fetchMode: "navigate", pathname: "/api/settings/token" }), fetchSite).toBe(false);
      expect(allowed({ fetchSite, fetchMode: "navigate", pathname: "/api/resources" }), fetchSite).toBe(false);
      expect(allowed({ fetchSite, fetchMode: "navigate", pathname: "/api/design/mockups/abc" }), fetchSite).toBe(true);
      expect(allowed({ fetchSite, fetchMode: "navigate", pathname: "/api/assets/abc" }), fetchSite).toBe(true);
      expect(allowed({ fetchSite, fetchMode: "navigate", pathname: APPROVE }), fetchSite).toBe(false);
      expect(allowed({ fetchSite, fetchMode: "navigate", pathname: "/api/assets/abc/extra" }), fetchSite).toBe(false);
    }
    // the app's own navigation and a typed address still work
    expect(allowed({ fetchSite: "same-origin", fetchMode: "navigate", pathname: "/api/resources" })).toBe(true);
    expect(allowed({ fetchSite: "none", fetchMode: "navigate", pathname: "/api/resources" })).toBe(true);
  });

  it("lets only the app's own pages and non-browser callers read the API token", () => {
    const token = { pathname: "/api/settings/token" };
    expect(allowed({ ...token, fetchSite: "same-origin", fetchMode: "cors" })).toBe(true);
    expect(allowed({ ...token })).toBe(true); // curl, a script: no Sec-Fetch-* headers
    for (const fetchSite of ["cross-site", "same-site", "none"]) {
      for (const fetchMode of ["no-cors", "cors", "navigate"]) {
        expect(allowed({ ...token, fetchSite, fetchMode }), `${fetchSite} ${fetchMode}`).toBe(false);
      }
    }
    // rotating it is a write: same rules as other writes
    expect(allowed({ ...token, method: "POST", origin: `http://${HOST}` })).toBe(true);
    expect(allowed({ ...token, method: "POST", origin: "null" })).toBe(false);
  });

  it("leaves ordinary cross-site reads alone (responses stay unreadable without CORS)", () => {
    expect(allowed({ fetchSite: "cross-site", fetchMode: "no-cors", pathname: "/api/resources" })).toBe(true);
  });
});
