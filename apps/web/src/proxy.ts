import { NextResponse, type NextRequest } from "next/server";
import { isValidApiToken } from "@pivot/core/api-token";
import { guardApiRequest } from "@pivot/core/request-guard";

/**
 * The API has no login, so it only answers requests addressed to this machine (blocks DNS rebinding), writes must
 * come from the app's own pages or carry the API token, and other sites can't open API pages or read the token.
 * The rules live in `@pivot/core/request-guard`.
 */
export function proxy(request: NextRequest) {
  const h = request.headers;
  const verdict = guardApiRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
    host: h.get("host"),
    origin: h.get("origin"),
    fetchSite: h.get("sec-fetch-site"),
    fetchMode: h.get("sec-fetch-mode"),
    hasToken: () => isValidApiToken(h.get("authorization")?.replace(/^Bearer\s+/i, "")),
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 403 });
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
