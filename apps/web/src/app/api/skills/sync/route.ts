import { syncSkills } from "@stan-bag/core/skills";
import { json, route } from "@/lib/server/http";

export const POST = route(async () => json(await syncSkills()));
