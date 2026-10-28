import { NextResponse, type NextRequest } from "next/server";
import { isValidApiToken } from "@pivot/core/api-token";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostname(hostHeader: string | null) {
  if (!hostHeader) return "";
  return hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
}

/**
 * The API has no login, so it only answers requests addressed to this machine (blocks DNS rebinding),
 * and writes must come from the app's own pages or carry the extension's API token (blocks other sites).
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  if (!LOCAL_HOSTS.has(hostname(host))) {
    return NextResponse.json({ error: "Forbidden host" }, { status: 403 });
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    const sameOrigin = origin ? new URL(origin).host === host : site === "same-origin" || site === null;
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!sameOrigin && !isValidApiToken(bearer)) {
      return NextResponse.json(
        {
          error: origin?.startsWith("chrome-extension://")
            ? "Invalid API token — copy it again from PIVOT › Settings."
            : "Cross-origin request blocked",
        },
        { status: 403 },
      );
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
