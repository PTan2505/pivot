import { getUiSettings, setUiSettings } from "@pivot/core/settings";
import { body, json, route } from "@/lib/server/http";

/** App-wide display settings: `{ showOtherTypes }`. The app, the extension and MCP read it. */
export const GET = route(async () => json(await getUiSettings()));

export const PATCH = route(async (req: Request) => json(await setUiSettings(await body(req))));
