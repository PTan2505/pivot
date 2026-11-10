// The approval gate is the owner's: an agent holding only PIVOT's API token (or forging browser headers) can't create,
// change or replay an owner approval, and building needs a current owner approval of the exact version.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tmp: string;
let design: typeof import("../src/design");
let owner: typeof import("../src/owner-approval");
let db: typeof import("../src/db/client");
const PASS = "correct horse battery staple";
const TOKEN = "Bearer an-agent-api-token";

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-owner-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  design = await import("../src/design");
  owner = await import("../src/owner-approval");
  db = await import("../src/db/client");
});
afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  // a fresh passphrase and no failed attempts before each test
  await fs.rm(path.join(tmp, "data", "owner-approval-attempts.json"), { force: true });
  owner.setOwnerPassphrase(PASS);
});

async function exploring(n = 2) {
  const { sessionId } = await design.saveDesignBrief({ title: "Gate", milestone: "initial", markdown: "## Gate" });
  const { ids } = await design.saveDesignMockups({
    sessionId,
    mockups: Array.from({ length: n }, (_, i) => ({ title: `V${i + 1}`, html: `<p>${i + 1}-${Math.random()}</p>` })),
  });
  const s = (await design.getDesignSession(sessionId))!;
  return { sessionId, ids, mockups: s.mockups };
}
/** What the owner's page sends: a fresh challenge for this version and digest, and the passphrase. */
function asOwner(s: { sessionId: string; mockups: { id: string; digest: string }[] }, i = 0, extra = {}) {
  const m = s.mockups[i];
  const { challenge } = owner.issueApprovalChallenge({ sessionId: s.sessionId, mockupId: m.id, digest: m.digest });
  return { mockupId: m.id, sessionId: s.sessionId, digest: m.digest, challenge, passphrase: PASS, ...extra };
}
const status = async (sessionId: string) => (await design.getDesignSession(sessionId))!.status;

describe("the owner can approve", () => {
  it("positive control: the owner's approval is recorded, bound to the version's digest, and allows building", async () => {
    const s = await exploring();
    const r = await design.approveAsOwner({ ...asOwner(s, 1), note: "Go" });
    expect(r).toMatchObject({ sessionId: s.sessionId });
    const after = (await design.getDesignSession(s.sessionId))!;
    expect(after.status).toBe("approved");
    expect(after.decisions.at(-1)).toMatchObject({
      kind: "approval",
      source: "owner",
      details: "Go",
      binding: { mockupId: s.mockups[1].id, digest: s.mockups[1].digest, status: "bound" },
    });
    await design.setDesignSessionStatus(s.sessionId, "building");
    expect(await status(s.sessionId)).toBe("building");
  });
});

describe("an agent can't approve", () => {
  it("a request carrying the API token is refused, even with the right passphrase and challenge", async () => {
    const s = await exploring();
    await expect(design.approveAsOwner({ ...asOwner(s), bearer: TOKEN })).rejects.toMatchObject({ status: 403 });
    expect(await status(s.sessionId)).toBe("exploring");
  });

  it("without the owner passphrase nothing is approved: missing, wrong, or from forged browser headers alone", async () => {
    const s = await exploring();
    // the core never reads Origin, Referer or Sec-Fetch-Site: a request with only those (no passphrase) proves nothing
    await expect(design.approveAsOwner({ ...asOwner(s), passphrase: undefined })).rejects.toMatchObject({
      status: 401,
    });
    await expect(design.approveAsOwner({ ...asOwner(s), passphrase: "" })).rejects.toMatchObject({ status: 401 });
    await expect(design.approveAsOwner({ ...asOwner(s), passphrase: `${PASS}!` })).rejects.toMatchObject({
      status: 401,
    });
    expect(await status(s.sessionId)).toBe("exploring");
  });

  it("an agent can't record an approval through the decision route, and old agent approvals don't count", async () => {
    const s = await exploring();
    for (const source of [undefined, "agent" as const])
      await expect(
        design.recordDesignDecision({
          sessionId: s.sessionId,
          kind: "approval",
          summary: "the user said yes in the chat",
          mockupId: s.mockups[0].id,
          mockupDigest: s.mockups[0].digest,
          source,
        }),
      ).rejects.toThrow(/Approvals are the owner's/);
    // an approval an agent recorded before this rule existed (as stored rows look) doesn't unlock anything
    const { designDecisions } = await import("../src/db/schema");
    await (await db.getDb()).insert(designDecisions).values({
      sessionId: s.sessionId,
      kind: "approval",
      source: "agent",
      summary: "legacy chat approval",
      mockupId: s.mockups[0].id,
      mockupDigest: s.mockups[0].digest,
    });
    await expect(design.setDesignSessionStatus(s.sessionId, "approved")).rejects.toThrow(/no recorded approval/);
    await expect(design.setDesignSessionStatus(s.sessionId, "building")).rejects.toThrow(/no recorded approval/);
    expect((await design.getDesignSession(s.sessionId))!.currentApprovalId).toBeNull();
  });

  it("no passphrase set: approvals are refused until the owner sets one from a terminal", async () => {
    const s = await exploring();
    await fs.rm(path.join(tmp, "data", "owner-approval.json"));
    expect(owner.ownerPassphraseStatus()).toEqual({ set: false, setAt: null });
    await expect(design.approveAsOwner(asOwner(s))).rejects.toMatchObject({ status: 428 });
  });

  it("guessing is locked out: five wrong passphrases lock owner actions, even for the right one", async () => {
    const s = await exploring();
    for (let i = 0; i < 5; i++)
      await expect(design.approveAsOwner({ ...asOwner(s), passphrase: `guess-${i}-xxxxxxxx` })).rejects.toMatchObject({
        status: 401,
      });
    await expect(design.approveAsOwner(asOwner(s))).rejects.toMatchObject({ status: 429 });
    // the lock is kept in the data folder, so restarting the server doesn't clear it
    expect(owner.ownerLockedUntil()).not.toBeNull();
    expect(await status(s.sessionId)).toBe("exploring");
  });
});

describe("an approval is for one version, once", () => {
  it("without a challenge (a forged form), or with one already used (a replay), it is refused", async () => {
    const s = await exploring();
    await expect(design.approveAsOwner({ ...asOwner(s), challenge: undefined })).rejects.toMatchObject({ status: 409 });
    const req = asOwner(s);
    await expect(design.approveAsOwner({ ...req, passphrase: "wrong passphrase!!" })).rejects.toMatchObject({
      status: 401,
    });
    // the same request again, now with the right passphrase: its challenge is spent
    await expect(design.approveAsOwner(req)).rejects.toMatchObject({ status: 409 });
    expect(await status(s.sessionId)).toBe("exploring");
  });

  it("a challenge for one version can't approve another version, digest or session", async () => {
    const s = await exploring();
    const t = await exploring();
    const forV1 = asOwner(s, 0);
    await expect(
      design.approveAsOwner({ ...forV1, mockupId: s.mockups[1].id, digest: s.mockups[1].digest }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(design.approveAsOwner({ ...asOwner(s, 0), digest: s.mockups[1].digest })).rejects.toMatchObject({
      status: 409,
    });
    await expect(design.approveAsOwner({ ...asOwner(s, 0), sessionId: t.sessionId })).rejects.toMatchObject({
      status: 409,
    });
    expect(await status(s.sessionId)).toBe("exploring");
  });

  it("a version of another session can't be approved under this session's name", async () => {
    const s = await exploring();
    const t = await exploring();
    const m = s.mockups[0];
    // a challenge that names session T with a version of S (the challenge route never issues one; the core checks too)
    const { challenge } = owner.issueApprovalChallenge({ sessionId: t.sessionId, mockupId: m.id, digest: m.digest });
    await expect(
      design.approveAsOwner({ mockupId: m.id, sessionId: t.sessionId, digest: m.digest, challenge, passphrase: PASS }),
    ).rejects.toThrow(/another design session/);
    expect(await status(s.sessionId)).toBe("exploring");
  });

  it("an expired challenge is refused", async () => {
    const s = await exploring();
    const m = s.mockups[0];
    const { challenge } = owner.issueApprovalChallenge(
      { sessionId: s.sessionId, mockupId: m.id, digest: m.digest },
      Date.now() - 11 * 60_000,
    );
    await expect(
      design.approveAsOwner({ mockupId: m.id, sessionId: s.sessionId, digest: m.digest, challenge, passphrase: PASS }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("a challenge issued for a digest that isn't the stored one can't approve it", async () => {
    const s = await exploring();
    const m = s.mockups[0];
    const stale = "0".repeat(64);
    const { challenge } = owner.issueApprovalChallenge({ sessionId: s.sessionId, mockupId: m.id, digest: stale });
    await expect(
      design.approveAsOwner({ mockupId: m.id, sessionId: s.sessionId, digest: stale, challenge, passphrase: PASS }),
    ).rejects.toThrow(/reload it before approving/);
    expect(await status(s.sessionId)).toBe("exploring");
  });

  it("a stale approval: once approved, a second approval is refused; after a reset, the old one stops counting", async () => {
    const s = await exploring();
    await design.approveAsOwner(asOwner(s, 0));
    await expect(design.approveAsOwner(asOwner(s, 1))).rejects.toThrow(/session is approved/);
    await design.saveDesignBrief({
      sessionId: s.sessionId,
      title: "Gate",
      milestone: "major_change",
      markdown: "## v2",
      note: "x",
    });
    await expect(design.setDesignSessionStatus(s.sessionId, "building")).rejects.toThrow(/approving again/);
  });

  it("unapproved versions stay blocked: building checks the approved version's content", async () => {
    const s = await exploring();
    await expect(design.setDesignSessionStatus(s.sessionId, "building")).rejects.toThrow(/no recorded approval/);
    await design.approveAsOwner(asOwner(s, 0));
    const { designMockups } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await (
      await db.getDb()
    )
      .update(designMockups)
      .set({ html: "<p>swapped after approval</p>" })
      .where(eq(designMockups.id, s.mockups[0].id));
    await expect(design.setDesignSessionStatus(s.sessionId, "building")).rejects.toThrow(
      /no longer matches the content it was saved with/,
    );
  });
});

describe("the owner sets the passphrase from a terminal", () => {
  it("the CLI's stored form is what the server checks; it refuses short ones and won't replace one silently", async () => {
    const cli = path.resolve(__dirname, "../../../scripts/owner-passphrase.mjs");
    const env = { ...process.env, PIVOT_DATA_DIR: path.join(tmp, "cli") };
    execFileSync(process.execPath, [cli, "--stdin"], { input: "a passphrase from the CLI\n", env });
    const saved = process.env.PIVOT_DATA_DIR;
    process.env.PIVOT_DATA_DIR = env.PIVOT_DATA_DIR;
    try {
      expect(owner.ownerPassphraseStatus().set).toBe(true);
      expect(() => owner.authorizeOwner({ bearer: null, passphrase: "a passphrase from the CLI" })).not.toThrow();
      expect(() => owner.authorizeOwner({ bearer: null, passphrase: "something else entirely" })).toThrow();
    } finally {
      process.env.PIVOT_DATA_DIR = saved;
    }
    expect(() =>
      execFileSync(process.execPath, [cli, "--stdin"], { input: "another one long\n", env, stdio: "pipe" }),
    ).toThrow(/--replace/);
    expect(() =>
      execFileSync(process.execPath, [cli, "--stdin", "--replace"], { input: "short\n", env, stdio: "pipe" }),
    ).toThrow(/at least 12/);
  });
});
