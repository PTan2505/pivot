import { listSuggestions } from "@pivot/core/suggestions";
import { json, route } from "@/lib/server/http";

/** Suggestions across the library (the Inbox), newest first. `?status=` pending (default), accepted or rejected. */
export const GET = route(async (req: Request) => {
  const status = new URL(req.url).searchParams.get("status");
  return json({
    suggestions: await listSuggestions({
      status: status === "accepted" || status === "rejected" ? status : "pending",
    }),
  });
});
