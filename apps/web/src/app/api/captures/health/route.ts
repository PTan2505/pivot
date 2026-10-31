import { captureHealth } from "@pivot/core/compare";
import { json, route } from "@/lib/server/http";

/** Sites failing again and again this week, and references whose newest capture looks worse than an earlier one. */
export const GET = route(async () => json(await captureHealth()));
