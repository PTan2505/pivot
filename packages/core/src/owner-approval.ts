import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config";

/*
 * Who may approve a design (and restore a backup): the owner, proven by a passphrase only they know.
 *
 * PIVOT has no login, and the agent that builds a design holds the API token, can send any header (Origin,
 * Sec-Fetch-Site…) and runs on the same machine. None of that may approve. So owner actions need:
 * - the owner passphrase, set once from the owner's own terminal (`pnpm owner:passphrase`, never over HTTP, so a token
 *   holder can't set it first), stored only as a scrypt hash in the data folder;
 * - for an approval, a single-use challenge bound to the session, the version and its digest (no replay, no approving
 *   another version with the same request);
 * - no API token on the request: a request carrying one is an agent's and is refused outright.
 * Failed passphrases are counted in the data folder: 5 in 15 minutes lock owner actions for 15 minutes.
 *
 * Limits: this keeps approval out of reach of anything that only has PIVOT's API (the MCP server, the extension, a
 * page). It can't stop a process running as the same OS user with an unrestricted shell: that can read the hash to
 * guess offline, edit the data folder, or drive the owner's browser. A sandboxed agent that can't write the data folder
 * is held by it.
 */

export const PASSPHRASE_MIN = 12;
export const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 } as const;
const MAXMEM = 128 * 1024 * 1024;
const LOCK = { failures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 } as const;
const CHALLENGE_TTL_MS = 10 * 60_000;

const passFile = () => path.join(dataDir(), "owner-approval.json");
const attemptsFile = () => path.join(dataDir(), "owner-approval-attempts.json");

/** Why an owner action was refused, with the HTTP status the routes answer. Never carries the passphrase. */
export class OwnerAuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OwnerAuthError";
    this.status = status;
  }
}

interface StoredPassphrase {
  v: 1;
  algo: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
  setAt: string;
}

/** The stored form of a passphrase (the same format `scripts/owner-passphrase.mjs` writes). */
export function hashPassphrase(passphrase: string, setAt = new Date().toISOString()): StoredPassphrase {
  if (passphrase.length < PASSPHRASE_MIN)
    throw new Error(`The passphrase needs at least ${PASSPHRASE_MIN} characters.`);
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(passphrase.normalize("NFC"), salt, SCRYPT.keylen, { ...SCRYPT, maxmem: MAXMEM });
  return { v: 1, algo: "scrypt", ...SCRYPT, salt: salt.toString("base64"), hash: hash.toString("base64"), setAt };
}

function stored(): StoredPassphrase | null {
  try {
    const s = JSON.parse(fs.readFileSync(passFile(), "utf8")) as StoredPassphrase;
    return s?.v === 1 && s.algo === "scrypt" && s.salt && s.hash ? s : null;
  } catch {
    return null;
  }
}

/** Whether the owner set a passphrase, and when. Nothing secret. */
export function ownerPassphraseStatus(): { set: boolean; setAt: string | null } {
  const s = stored();
  return { set: !!s, setAt: s?.setAt ?? null };
}

/** Test and CLI helper: stores a passphrase (the CLI writes the same file itself). */
export function setOwnerPassphrase(passphrase: string) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(passFile(), JSON.stringify(hashPassphrase(passphrase)), { mode: 0o600 });
  fs.rmSync(attemptsFile(), { force: true });
}

function matches(passphrase: string): boolean {
  const s = stored();
  if (!s) return false;
  const want = Buffer.from(s.hash, "base64");
  const got = crypto.scryptSync(passphrase.normalize("NFC"), Buffer.from(s.salt, "base64"), want.length, {
    N: s.N,
    r: s.r,
    p: s.p,
    maxmem: MAXMEM,
  });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function attempts(): number[] {
  try {
    const a = JSON.parse(fs.readFileSync(attemptsFile(), "utf8"));
    return Array.isArray(a?.failures) ? a.failures.filter((t: unknown) => typeof t === "number") : [];
  } catch {
    return [];
  }
}

/** When owner actions unlock again, or null when they aren't locked. */
export function ownerLockedUntil(now = Date.now()): number | null {
  const recent = attempts().filter((t) => now - t < LOCK.windowMs);
  if (recent.length < LOCK.failures) return null;
  const until = Math.max(...recent) + LOCK.lockMs;
  return until > now ? until : null;
}

function recordFailure(now: number) {
  const recent = attempts().filter((t) => now - t < LOCK.windowMs);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(attemptsFile(), JSON.stringify({ failures: [...recent, now].slice(-20) }), { mode: 0o600 });
}

// ---- challenges ----------------------------------------------------------------------------------------------------

/** What a challenge is for: approving a design version, or writing a skill into Claude Code's skills folder. */
type Purpose = "approve" | "skill-write";
interface Bind {
  purpose?: Purpose;
  sessionId: string;
  mockupId: string;
  digest: string;
}
interface Challenge {
  purpose: Purpose;
  sessionId: string;
  mockupId: string;
  digest: string;
  expires: number;
}
const g = globalThis as unknown as { __pivotOwnerChallenges?: Map<string, Challenge> };
const challenges = (g.__pivotOwnerChallenges ??= new Map());

/** A single-use challenge for approving one version: valid 10 minutes, for this session, version and digest only. */
export function issueApprovalChallenge(
  bind: { sessionId: string; mockupId: string; digest: string },
  now = Date.now(),
) {
  for (const [k, c] of challenges) if (c.expires <= now) challenges.delete(k);
  while (challenges.size >= 200) challenges.delete(challenges.keys().next().value!);
  const challenge = crypto.randomBytes(24).toString("base64url");
  challenges.set(challenge, {
    ...bind,
    purpose: "approve",
    digest: bind.digest.toLowerCase(),
    expires: now + CHALLENGE_TTL_MS,
  });
  return { challenge, expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString() };
}

/**
 * A single-use challenge for writing one skill to disk, bound to the skill and to `binding` (skills.ts
 * `skillWriteBinding`: overwrite or not, the target folder and the hash of the content the owner is looking at), so a
 * request can't be replayed, and nothing else than what the owner saw is written.
 */
export function issueSkillWriteChallenge(bind: { resourceId: string; binding: string }, now = Date.now()) {
  const c = issueApprovalChallenge({ sessionId: "skill-write", mockupId: bind.resourceId, digest: bind.binding }, now);
  challenges.get(c.challenge)!.purpose = "skill-write";
  return c;
}

/** Uses up a challenge: true only for an unexpired one issued for exactly this session, version and digest. */
function consumeChallenge(challenge: string, bind: Bind, now: number) {
  const c = challenges.get(challenge);
  if (!c) return false;
  challenges.delete(challenge);
  return (
    c.expires > now &&
    c.purpose === (bind.purpose ?? "approve") &&
    c.sessionId === bind.sessionId &&
    c.mockupId === bind.mockupId &&
    c.digest === bind.digest.toLowerCase()
  );
}

// ---- the check -----------------------------------------------------------------------------------------------------

/**
 * Proves an owner action or throws OwnerAuthError. `bearer` is the request's Authorization header: any value means an
 * agent's request (the owner's page never sends one). `approval` adds the challenge check for approving a version.
 */
export function authorizeOwner({
  bearer,
  passphrase,
  approval,
  now = Date.now(),
}: {
  bearer: string | null | undefined;
  passphrase: string | null | undefined;
  approval?: Bind & { challenge: string | null | undefined };
  now?: number;
}) {
  if (bearer)
    throw new OwnerAuthError(
      "Only the owner can do this, in PIVOT's own page with the owner passphrase. A request with the API token (an agent's) is refused.",
      403,
    );
  if (!ownerPassphraseStatus().set)
    throw new OwnerAuthError(
      "Set the owner passphrase first, once, in a terminal in the PIVOT folder: pnpm owner:passphrase",
      428,
    );
  if (approval && !(approval.challenge && consumeChallenge(approval.challenge, approval, now)))
    throw new OwnerAuthError(
      approval.purpose === "skill-write"
        ? "This form expired or was already used, or the skill changed. Open the dialog again."
        : "This approval form expired or was already used, or names another version. Open the dialog again.",
      409,
    );
  const until = ownerLockedUntil(now);
  if (until)
    throw new OwnerAuthError(
      `Too many wrong passphrases: owner actions are locked until ${new Date(until).toLocaleTimeString()}.`,
      429,
    );
  if (!passphrase || !matches(passphrase)) {
    recordFailure(now);
    throw new OwnerAuthError("The owner passphrase is wrong.", 401);
  }
  fs.rmSync(attemptsFile(), { force: true });
}
