import { z } from "zod";
import { approveInChat, CHAT_APPROVAL_LIMITS, DesignError, getDesignSession } from "@pivot/core/design";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

const input = z.object({
  userWords: z.string().min(1).max(CHAT_APPROVAL_LIMITS.words),
  mockupId: z.string().max(100).optional(),
  mockupDigest: z
    .string()
    .regex(/^[0-9a-f]{12,64}$/i)
    .optional(),
  note: z.string().max(CHAT_APPROVAL_LIMITS.note).optional(),
});

/**
 * Records the user's approval given in the chat (source "chat"), with their words, bound to the version's digest. It
 * counts like an approval made in PIVOT; PIVOT can't check the words are the user's (the owner's choice, 2026-11-15).
 * 404 for an unknown session; a refused approval (not exploring, a stale digest, no words…) is a 409 with the reason.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const parsed = input.parse(await body(req));
  if (!(await getDesignSession(id))) throw new HttpError(404, "Design session not found.");
  try {
    return json(await approveInChat({ sessionId: id, ...parsed }), { status: 201 });
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(409, err.message);
    throw err;
  }
});
