import { addAnnotation, AnnotationError, listAnnotations } from "@pivot/core/annotations";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  return json({ annotations: await listAnnotations(id) });
});

/** Pins a note to a point or a box on one of this reference's screenshots (fractions of the image, 0–1). */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  try {
    return json(await addAnnotation(id, await body(req)), { status: 201 });
  } catch (err) {
    if (err instanceof AnnotationError) throw new HttpError(400, err.message);
    throw err;
  }
});
