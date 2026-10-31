import { API_FEATURES, API_VERSION } from "@pivot/core/capabilities";
import { json, route } from "@/lib/server/http";

/** Lets the extension check what this server can do before it sends a queued save. */
export const GET = route(async () => json({ app: "pivot", apiVersion: API_VERSION, features: API_FEATURES }));
