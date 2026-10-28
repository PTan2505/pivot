import { sourceStats } from "@stan-bag/core/resources";
import { json, route } from "@/lib/server/http";

/** How many saved resources came from each source. */
export const GET = route(async () => json(await sourceStats()));
