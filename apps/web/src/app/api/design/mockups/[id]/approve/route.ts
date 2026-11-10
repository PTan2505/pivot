import { z } from "zod";
import { approveAsOwner, DesignError, getDesignSession } from "@pivot/core/design";
import { OwnerAuthError } from "@pivot/core/owner-approval";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

/**
 * The owner approves this version from the session page. Only the owner can: the request carries no API token (an
 * agent's request is refused), the owner passphrase, and a single-use challenge issued for this session, version and
 * digest (approval-challenge). Records an approval with source "owner", bound to the digest the page showed, the note
 * kept verbatim, and marks the session approved; a waiting agent sees it and starts building. 409 unless exploring, or
 * when the page's copy isn't the stored version.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const input = z
    .object({
      note: z.string().max(5000).optional(),
      digest: z.string().regex(/^[0-9a-f]{64}$/i),
      sessionId: z.string().uuid(),
      challenge: z.string().max(200).optional(),
      passphrase: z.string().max(1000).optional(),
    })
    .parse(await body(req));
  try {
    const approved = await approveAsOwner({ mockupId: id, ...input, bearer: req.headers.get("authorization") });
    if (!approved) throw new HttpError(404, "Mockup not found.");
    return json(await getDesignSession(approved.sessionId), { status: 201 });
  } catch (err) {
    if (err instanceof OwnerAuthError) throw new HttpError(err.status, err.message);
    if (err instanceof DesignError) throw new HttpError(409, err.message);
    throw err;
  }
});
