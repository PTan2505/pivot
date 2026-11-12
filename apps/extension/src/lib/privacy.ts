import { api } from "./api";
import type { PrivacySignals } from "./page";

/** Address patterns that usually mean an app's signed-in area; same rule as the server's. */
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

export interface PrivacyVerdict {
  /** True: the tab's screenshot needs your approval (and a look at the masks) before it is uploaded. */
  flagged: boolean;
  reasons: string[];
}

/**
 * Guesses whether the tab shows private content. Signals: a password field on screen, the server getting a sign-in
 * wall or an error without your cookies, and app-like addresses. It is a guess: it can miss private data and flag
 * public pages, so the approval step lets you look for yourself.
 */
export async function assessPrivacy(url: string, signals: PrivacySignals | undefined): Promise<PrivacyVerdict> {
  const reasons: string[] = [];
  if (signals?.passwordField) reasons.push("The page shows a password field.");
  let serverSays: boolean | null = null;
  try {
    const v = await api.visibility(url);
    serverSays = v.private;
    if (v.private) reasons.push(v.reason);
  } catch {
    // PIVOT not running: fall back to what the tab and the address say
  }
  if (serverSays !== false && looksLikeAppUrl(url)) reasons.push("The address looks like an app's signed-in area.");
  return { flagged: reasons.length > 0, reasons };
}
