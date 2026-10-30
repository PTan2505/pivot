export interface PageInfo {
  url: string;
  title: string;
  description: string;
  selection: string;
}

/** Runs inside the page, so it sees logged-in content and the live DOM. Must stay self-contained. */
function readPage(): PageInfo {
  const meta = (...names: string[]) => {
    for (const n of names) {
      const v = document.querySelector<HTMLMetaElement>(`meta[property="${n}"], meta[name="${n}"]`)?.content?.trim();
      if (v) return v;
    }
    return "";
  };
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  return {
    url: canonical && new URL(canonical).host === location.host ? canonical : location.href,
    title: meta("og:title", "twitter:title") || document.title,
    description: meta("og:description", "twitter:description", "description"),
    selection: String(window.getSelection() ?? "").trim(),
  };
}

export async function getPageInfo(tab: chrome.tabs.Tab): Promise<PageInfo> {
  const fallback = { url: tab.url ?? "", title: tab.title ?? "", description: "", selection: "" };
  if (!tab.id || !/^https?:/.test(tab.url ?? "")) return fallback;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    return { ...fallback, ...(res?.result as PageInfo) };
  } catch {
    // Some pages (Chrome Web Store, PDFs…) refuse script injection.
    return fallback;
  }
}

/** Screenshot of exactly what is visible in the tab (needs the activeTab grant). */
export async function captureTab(windowId: number): Promise<Blob | null> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 90 });
    return await (await fetch(dataUrl)).blob();
  } catch {
    return null;
  }
}

export function isSavable(url: string | undefined) {
  return !!url && /^https?:\/\//.test(url);
}

/** A page of the PIVOT app itself: saving it would only add an entry pointing back at the library. */
export function isPivotPage(url: string | undefined, serverUrl: string) {
  try {
    return new URL(url ?? "").origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

/** A site's front page (no path, no query): saving it most likely means saving the site itself. */
export function isHomePage(url: string) {
  try {
    const u = new URL(url);
    return u.pathname === "/" && !u.search;
  } catch {
    return false;
  }
}
