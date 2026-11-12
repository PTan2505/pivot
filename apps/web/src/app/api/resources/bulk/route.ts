import { z } from "zod";
import {
  addToCollection,
  purgeResources,
  removeFromCollection,
  restoreResources,
  setReviewStatus,
  trashResources,
} from "@pivot/core/resources";
import { body, json, route } from "@/lib/server/http";

const schema = z.object({
  action: z.enum(["trash", "restore", "purge", "addToCollection", "removeFromCollection", "reviewed", "needsReview"]),
  ids: z.array(z.string()).min(1).max(1000),
  collectionId: z.string().optional(),
});

export const POST = route(async (req: Request) => {
  const { action, ids, collectionId } = schema.parse(await body(req));
  if (action === "trash") await trashResources(ids);
  if (action === "restore") await restoreResources(ids);
  if (action === "purge") await purgeResources(ids);
  if (action === "addToCollection") await addToCollection(z.string().parse(collectionId), ids);
  if (action === "removeFromCollection") await removeFromCollection(z.string().parse(collectionId), ids);
  if (action === "reviewed") await setReviewStatus(ids, null);
  if (action === "needsReview") await setReviewStatus(ids, "needs_review");
  return json({ ok: true });
});
