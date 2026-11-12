import { typeCounts } from "@pivot/core/resources";
import { json, route } from "@/lib/server/http";

export const GET = route(async () => json(await typeCounts()));
