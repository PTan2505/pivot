import { migrateLocalAssets } from "@pivot/core/assets";
import { json, route } from "@/lib/server/http";

/** Moves every locally stored file into Cloudflare R2 and deletes the local copies. */
export const POST = route(async () => json(await migrateLocalAssets()));
