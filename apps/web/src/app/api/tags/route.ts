import { listTags } from "@stan-bag/core/resources";
import { json, route } from "@/lib/server/http";

export const GET = route(async () => json(await listTags()));
