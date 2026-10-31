import { z } from "zod";
import { extractAssets, ExtractError } from "@pivot/core/extract";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

const input = z.object({
  images: z
    .array(z.object({ url: z.string().url() }))
    .max(20)
    .optional(),
  svgs: z
    .array(z.object({ markup: z.string(), name: z.string().max(80).optional() }))
    .max(20)
    .optional(),
  fonts: z
    .array(
      z.object({
        family: z.string().min(1).max(120),
        weight: z.string().max(20).optional(),
        style: z.string().max(20).optional(),
        src: z.string().max(1000).optional(),
      }),
    )
    .max(30)
    .optional(),
  gradients: z.array(z.string().max(1000)).max(30).optional(),
});

/** Saves the assets picked from a page onto this reference (files, font names, gradients). */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  try {
    return json(await extractAssets(id, input.parse(await body(req))));
  } catch (err) {
    if (err instanceof ExtractError) throw new HttpError(400, err.message);
    throw err;
  }
});
