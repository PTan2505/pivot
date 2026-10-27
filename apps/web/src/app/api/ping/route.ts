import { json, route } from "@/lib/server/http";

/** Lets the extension verify its token: the proxy rejects this POST unless the token is valid. */
export const POST = route(async () => json({ ok: true }));
