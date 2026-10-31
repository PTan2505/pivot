import { CompareError, createDesignVersion } from "@pivot/core/compare";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/** Saves the Latest capture as a new reference linked "newer version of" this one. */
export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  try {
    const newId = await createDesignVersion(id);
    return json({ id: newId, path: `/r/${newId}` }, { status: 201 });
  } catch (err) {
    if (err instanceof CompareError) throw new HttpError(400, err.message);
    throw err;
  }
});
