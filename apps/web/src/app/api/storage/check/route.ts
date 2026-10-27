import { checkStore } from "@stan-bag/core/storage";
import { json, route } from "@/lib/server/http";

/** Writes, reads and deletes a tiny test file in the active store. */
export const POST = route(async () => json(await checkStore()));
