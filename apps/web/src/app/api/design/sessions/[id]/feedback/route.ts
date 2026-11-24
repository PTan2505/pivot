import { z } from "zod";
import { DesignError, getDesignSession } from "@pivot/core/design";
import { addFeedback, FEEDBACK_LIMITS, listFeedback } from "@pivot/core/design-feedback";
import { OwnerAuthError } from "@pivot/core/owner-approval";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

const input = z.object({
  round: z.number().int().min(1),
  mockupId: z.string().uuid().nullish(),
  text: z.string().max(FEEDBACK_LIMITS.text).optional(),
  width: z.number().int().nullish(),
  /** The frame's viewport height when the pins were made there (default 900). */
  height: z.number().int().nullish(),
  pins: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        text: z.string().max(FEEDBACK_LIMITS.pinText),
        n: z.number().int().min(1).max(999).optional(),
        /**
         * The element the owner selected: PIVOT finds it in its own map of the render and stores the rest. A live note
         * (the interactive preview) sends the element as it saw it; PIVOT cuts it to its limits.
         */
        element: z
          .object({
            selector: z.string().min(1).max(1000),
            tag: z.string().max(40).optional(),
            id: z.string().max(200).optional(),
            classes: z.array(z.string().max(200)).max(20).optional(),
            text: z.string().max(2000).optional(),
            label: z.string().max(2000).optional(),
            box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
            html: z.string().max(20_000).optional(),
          })
          .optional(),
        /** Seen in the interactive preview with the version's scripts running. */
        live: z.boolean().optional(),
        /** A live note's crop (JPEG or PNG, base64) and the part of the page it shows. */
        capture: z
          .object({
            image: z.string().max(600_000),
            region: z.object({ left: z.number(), top: z.number(), width: z.number(), height: z.number() }),
          })
          .optional(),
      }),
    )
    .max(FEEDBACK_LIMITS.pins)
    .optional(),
});

/** The session's feedback, oldest first. */
export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!(await getDesignSession(id))) throw new HttpError(404, "Design session not found.");
  return json({ feedback: await listFeedback(id) });
});

/**
 * The owner sends feedback on a round from PIVOT's page: text, and pins on a version's render at one of the page's
 * widths, each on a spot or on an element (`element.selector`, from the version's element map). A waiting agent answers it with a new round. Refused with the API token (only the owner's page sends it);
 * 409 unless the session is exploring.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const parsed = input.parse(await body(req));
  try {
    const fb = await addFeedback({ sessionId: id, ...parsed, bearer: req.headers.get("authorization") });
    return json(fb, { status: 201 });
  } catch (err) {
    if (err instanceof OwnerAuthError) throw new HttpError(err.status, err.message);
    if (err instanceof DesignError)
      throw new HttpError(/^No design session/.test(err.message) ? 404 : 409, err.message);
    throw err;
  }
});
