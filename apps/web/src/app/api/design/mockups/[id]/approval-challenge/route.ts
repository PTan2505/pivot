import { getDesignSession } from "@pivot/core/design";
import { issueApprovalChallenge, ownerPassphraseStatus } from "@pivot/core/owner-approval";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/**
 * A single-use challenge for approving this version as it is stored now (`?digest=` is the digest the page shows).
 * Grants nothing by itself: the approval also needs the owner passphrase. `ready: false` when no passphrase is set yet.
 */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const digest = new URL(req.url).searchParams.get("digest") ?? "";
  const sessionId = new URL(req.url).searchParams.get("session") ?? "";
  const s = sessionId ? await getDesignSession(sessionId) : null;
  const m = s?.mockups.find((x) => x.id === id);
  if (!m) throw new HttpError(404, "No such version in this session.");
  if (m.digest !== digest.toLowerCase())
    throw new HttpError(409, "The version shown isn't the stored one: reload the page before approving.");
  const status = ownerPassphraseStatus();
  if (!status.set) return json({ ready: false, setup: "pnpm owner:passphrase" });
  return json({ ready: true, ...issueApprovalChallenge({ sessionId, mockupId: id, digest: m.digest }) });
});
