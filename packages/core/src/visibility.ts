import { safeFetch } from "./net-guard";

/** Paths and hosts of sign-in pages a logged-out visitor gets sent to. */
const SIGN_IN_PATH = /\/(log-?in|sign-?in|signin|auth|sso|session|account\/login|users\/sign_in|oauth)(\/|$|\?)/i;
const SIGN_IN_HOST =
  /^(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|auth0\.com|.*\.auth0\.com|appleid\.apple\.com|github\.com\/login)/i;
const PASSWORD_FIELD = /<input[^>]+type=["']?password/i;

export interface Visibility {
  /** True when a visitor without your cookies can't see the page. Null when it couldn't be checked. */
  private: boolean | null;
  reason: string;
}

/**
 * Asks for the page the way a stranger would (no cookies, no session) to guess whether it is private. Only a guess:
 * a public page can still show you private data, and some sites answer bots differently.
 */
export async function checkVisibility(url: string): Promise<Visibility> {
  let result: Awaited<ReturnType<typeof safeFetch>>;
  try {
    result = await safeFetch(url, { timeoutMs: 6_000, maxBytes: 512 * 1024, accept: "text/html" });
  } catch {
    return { private: null, reason: "PIVOT couldn't reach the page to check." };
  }
  const { response, body } = result;
  const final = new URL(result.url);
  if (response.status === 401 || response.status === 403) {
    return { private: true, reason: `Without your login the page answers HTTP ${response.status}.` };
  }
  if (new URL(url).host !== final.host && SIGN_IN_HOST.test(`${final.host}${final.pathname}`)) {
    return { private: true, reason: `Without your login the page sends visitors to ${final.host}.` };
  }
  if (SIGN_IN_PATH.test(final.pathname) && !SIGN_IN_PATH.test(new URL(url).pathname)) {
    return { private: true, reason: "Without your login the page redirects to a sign-in page." };
  }
  if (response.ok && PASSWORD_FIELD.test(body.toString("utf8"))) {
    return { private: true, reason: "Without your login the page shows a sign-in form." };
  }
  return { private: false, reason: "A visitor without your login gets the page too." };
}

/** Address patterns that usually mean an app's signed-in area. Weak on its own; used with other signals. */
export function looksLikeAppUrl(url: string) {
  try {
    const u = new URL(url);
    return (
      /^(app|dashboard|admin|console|portal|my)\./i.test(u.hostname) ||
      /^\/(app|dashboard|admin|settings|account|billing|inbox|workspace|org|projects?)(\/|$)/i.test(u.pathname)
    );
  } catch {
    return false;
  }
}
