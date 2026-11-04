import { z } from "zod";
import { approveDesignMockup, DesignError, getDesignSession } from "@pivot/core/design";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

/**
 * The owner approves this version from the session page: records an approval with source "owner" (the note kept
 * verbatim), bound to the digest of the copy the page showed, and marks the session approved. A waiting agent sees it
 * and starts building. 409 unless exploring, or when the page's copy isn't the stored version.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const { note, digest } = z
    .object({ note: z.string().max(5000).optional(), digest: z.string().regex(/^[0-9a-f]{12,64}$/i) })
    .parse(await body(req));
  try {
    const approved = await approveDesignMockup(id, note, digest);
    if (!approved) throw new HttpError(404, "Mockup not found.");
    return json(await getDesignSession(approved.sessionId), { status: 201 });
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(409, err.message);
    throw err;
  }
});
