import { getCaptureSettings, setCaptureSettings } from "@pivot/core/settings";
import { body, json, route } from "@/lib/server/http";

/** The capture defaults: `{ expandContent, theme }`. */
export const GET = route(async () => json(await getCaptureSettings()));

export const PATCH = route(async (req: Request) => json(await setCaptureSettings(await body(req))));
