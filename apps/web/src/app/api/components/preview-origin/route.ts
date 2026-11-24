import { previewPort } from "@pivot/core/preview-server";
import { json, route } from "@/lib/server/http";

/** The port of the component preview origin (PIVOT's + 1 unless set): the page frames `<its host>:<port>/p/…`. */
export const GET = route(async () => json({ port: previewPort() }));
