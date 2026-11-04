import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config";

// A per-install secret that lets the browser extension (a different origin) write to the API.
const tokenFile = () => path.join(dataDir(), "api-token");

export function apiToken(): string {
  try {
    const existing = fs.readFileSync(tokenFile(), "utf8").trim();
    if (existing) return existing;
  } catch {}
  return regenerateApiToken();
}

export function regenerateApiToken(): string {
  fs.mkdirSync(dataDir(), { recursive: true });
  const token = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(tokenFile(), token, { mode: 0o600 });
  return token;
}

/** The saved token, or null when there is none yet. Reading never creates one. */
function savedApiToken(): string | null {
  try {
    return fs.readFileSync(tokenFile(), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Whether `candidate` is the saved token (constant-time compare). Checking writes nothing: before any token exists,
 * every candidate is invalid, so a request carrying a made-up token can't create one.
 */
export function isValidApiToken(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const saved = savedApiToken();
  if (!saved) return false;
  const expected = Buffer.from(saved);
  const given = Buffer.from(candidate);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
