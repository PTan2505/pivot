import { skillStatuses } from "@stan-bag/core/skills";
import { json, route } from "@/lib/server/http";

export const GET = route(async () => json(await skillStatuses()));
