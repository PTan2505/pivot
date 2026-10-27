import { emptyTrash } from "@stan-bag/core/resources";
import { json, route } from "@/lib/server/http";

export const POST = route(async () => json({ deleted: await emptyTrash() }));
