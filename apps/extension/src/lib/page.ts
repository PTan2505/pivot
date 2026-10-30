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
  // The canonical link drops tracking parameters, but only when it names the page on screen: a shot opened as a modal
  // (Dribbble, Behance) changes the address bar while the canonical still names the page underneath.
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const samePage = (a: string, b: string) => {
    const [x, y] = [new URL(a), new URL(b)];
    return x.host === y.host && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "");
  };
  // In that case the page's meta tags still describe the page underneath too: take the live title, and leave the
  // description to the server, which reads it from the modal's own URL.
  const underneath = !!canonical && !samePage(canonical, location.href);
  return {
    url: canonical && !underneath ? canonical : location.href,
    title: underneath ? document.title : meta("og:title", "twitter:title") || document.title,
    description: underneath ? "" : meta("og:description", "twitter:description", "description"),
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

/** A site's front page (no path, no query): saving it most likely means saving the site itself. */
export function isHomePage(url: string) {
  try {
    const u = new URL(url);
    return u.pathname === "/" && !u.search;
  } catch {
    return false;
  }
}
