import { detachAsset } from "@pivot/core/assets";
import { json, route } from "@/lib/server/http";

type Params = { params: Promise<{ id: string; assetId: string }> };

export const DELETE = route(async (_req: Request, { params }: Params) => {
  const { id, assetId } = await params;
  await detachAsset(id, assetId);
  return json({ ok: true });
});
