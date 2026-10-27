import { apiToken, regenerateApiToken } from "@stan-bag/core/api-token";
import { json, route } from "@/lib/server/http";

// GET responses can't be read cross-origin (no CORS headers) and the proxy rejects foreign hosts,
// so only the app's own pages can read the token.
export const GET = route(async () => json({ token: apiToken() }));

/** Rotates the token; the extension must be updated with the new one. */
export const POST = route(async () => json({ token: regenerateApiToken() }));
