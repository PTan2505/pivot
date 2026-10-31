export interface PageInfo {
  url: string;
  /** What the address bar shows; differs from `url` when the page names a canonical link. */
  address?: string;
  title: string;
  description: string;
  selection: string;
  /** Signs that the tab shows something private, read from the live page. */
  privacy?: PrivacySignals;
}

/** A box on the visible tab, in CSS pixels from its top-left corner. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Why it is suggested: "filled field", "email", "amount". */
  label?: string;
}

export interface PrivacySignals {
  passwordField: boolean;
  /** Places that may hold personal data, suggested as masks. */
  suggestions: Box[];
  viewport: { width: number; height: number };
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
  // Privacy: a visible password field, and boxes worth masking (filled fields, emails, amounts) on screen.
  const visible = (r: DOMRect) => r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
  const suggestions: { x: number; y: number; width: number; height: number; label: string }[] = [];
  const add = (r: DOMRect, label: string) => {
    if (visible(r) && suggestions.length < 40) {
      suggestions.push({ x: r.left, y: r.top, width: r.width, height: r.height, label });
    }
  };
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (["hidden", "submit", "button", "checkbox", "radio", "range", "color", "file", "image", "reset"].includes(type))
      continue;
    if (el.value) add(el.getBoundingClientRect(), "filled field");
  }
  const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
  const AMOUNT = /(?:[$€£¥₫]\s?\d[\d.,]*|\d[\d.,]*\s?(?:USD|EUR|VND|đ))/;
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && suggestions.length < 40; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const match = EMAIL.test(text) ? "email" : AMOUNT.test(text) ? "amount" : null;
    if (!match) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    add(range.getBoundingClientRect(), match);
  }
  const passwordField = [...document.querySelectorAll("input[type=password]")].some((el) =>
    visible(el.getBoundingClientRect()),
  );
  return {
    url: canonical && !underneath ? canonical : location.href,
    address: location.href,
    privacy: { passwordField, suggestions, viewport: { width: innerWidth, height: innerHeight } },
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
