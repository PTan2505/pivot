import { getConfig, type ClipData } from "./lib/api";
import type { PendingItem } from "./lib/queue";
import { pendingStore } from "./lib/pending-store";
import { assessPrivacy } from "./lib/privacy";
import { scrollPageTo, sectionPicker, toSectionContext, type PickedSection } from "./lib/section";
import { queueSave, refreshBadge, SAVED_LOCALLY_TEXT, syncNow } from "./lib/sync";
import { knownSourceFor } from "@pivot/core/source-match";
import { captureTab, getPageInfo, isHomePage, isPivotPage, isSavable } from "./lib/page";

const MENU = {
  page: "pivot-page",
  link: "pivot-link",
  image: "pivot-image",
  snippet: "pivot-selection-snippet",
  prompt: "pivot-selection-prompt",
  section: "pivot-section",
} as const;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.page, title: "Save page to PIVOT", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.section, title: "Save a section of this page…", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.link, title: "Save link to PIVOT", contexts: ["link"] });
    chrome.contextMenus.create({ id: MENU.image, title: "Save image to PIVOT", contexts: ["image"] });
    chrome.contextMenus.create({ id: MENU.snippet, title: "Save selection as snippet", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU.prompt, title: "Save selection as prompt", contexts: ["selection"] });
  });
  // First install: open options so the token can be pasted.
  if (reason === "install" && !(await getConfig()).token) chrome.runtime.openOptionsPage();
});

const SYNC_ALARM = "pivot-sync";

/**
 * Where a click on a notification goes. Kept in session storage: the service worker can be stopped between showing a
 * notification and its click.
 */
async function notify(title: string, message: string, openPath?: string) {
  const id = await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/128.png",
    title,
    message,
    priority: 0,
  });
  if (openPath) await chrome.storage.session.set({ [`notify:${id}`]: openPath });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const key = `notify:${id}`;
  const path = (await chrome.storage.session.get(key))[key] as string | undefined;
  chrome.notifications.clear(id);
  if (!path) return;
  const { serverUrl } = await getConfig();
  await chrome.tabs.create({ url: `${serverUrl}${path}` });
  await chrome.storage.session.remove(key);
});

/** Checks the queue every minute while saves are waiting, and stops when it is empty. */
async function scheduleSync() {
  const count = await refreshBadge();
  if (count) await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  else await chrome.alarms.clear(SYNC_ALARM);
}

async function backgroundSync() {
  const summary = await syncNow();
  if (summary.synced) {
    await notify(
      "Synced to PIVOT",
      `${summary.synced} save${summary.synced > 1 ? "s" : ""} made while PIVOT was away ${summary.synced > 1 ? "are" : "is"} in your library.`,
    );
  }
  await scheduleSync();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void backgroundSync();
});
chrome.runtime.onStartup.addListener(() => void backgroundSync());

/** Something to save, prepared without talking to PIVOT. */
interface Prepared {
  data: ClipData;
  title: string;
  screenshot?: Blob;
  image?: Blob;
  imageName?: string;
  /** Set when the page looks private: the save waits for your approval in the popup. */
  privacy?: PendingItem["privacy"];
}

/** Saves through the offline queue; reports success only once PIVOT has confirmed it. */
async function run(label: string, prepare: () => Promise<Prepared>) {
  let prepared: Prepared;
  try {
    prepared = await prepare();
  } catch (err) {
    await notify("Couldn’t save", err instanceof Error ? err.message : String(err));
    return;
  }
  const result = await queueSave({ label, ...prepared });
  if (result.synced) {
    if (result.existing)
      await notify("Already in PIVOT", `${result.title} was saved before. Click to open it.`, result.path);
    else await notify("Saved to PIVOT", `${label}: ${result.title}`, result.path);
  } else {
    // no page content in the message: notifications can show on a locked screen
    await notify(
      result.reason === "approval" ? "Needs your approval" : "Saved locally",
      SAVED_LOCALLY_TEXT[result.reason],
    );
    if (result.reason === "auth") chrome.runtime.openOptionsPage();
  }
  await scheduleSync();
}

async function savePage(tab: chrome.tabs.Tab): Promise<Prepared> {
  if (!isSavable(tab.url)) throw new Error("Only http(s) pages can be saved.");
  if (isPivotPage(tab.url, (await getConfig()).serverUrl))
    throw new Error("This is PIVOT itself, so there’s nothing to save.");
  const [info, shot] = await Promise.all([getPageInfo(tab), captureTab(tab.windowId)]);
  // A known site's home page is saved as a Source, with its curated description; the view is its screenshot.
  const source = isHomePage(info.url) && !!knownSourceFor(info.url);
  const verdict = shot ? await assessPrivacy(info.url, info.privacy) : { flagged: false, reasons: [] };
  const data: ClipData = {
    kind: "page",
    url: info.url,
    type: source ? "source" : "reference",
    title: info.title,
    description: source ? undefined : info.description,
    // the server, without your login, can't see a private page
    serverCapture: !(source && shot) && !verdict.flagged,
    privatePage: verdict.flagged || undefined,
    ifExists: "skip",
    // saved without a form: it waits in the Inbox to be organised
    needsReview: true,
    capturedUrl: info.address && info.address !== info.url ? info.address : undefined,
  };
  return {
    data,
    title: info.title || info.url,
    screenshot: shot ?? undefined,
    privacy: verdict.flagged
      ? {
          reasons: verdict.reasons,
          suggestions: info.privacy?.suggestions ?? [],
          viewportWidth: info.privacy?.viewport.width ?? 0,
        }
      : undefined,
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runInTab<A extends unknown[], R>(tabId: number, func: (...args: A) => R, args: A): Promise<R> {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result as R;
}

/**
 * Chrome allows two captures of the visible tab a second, and the popup has often just taken one: wait and try again
 * instead of failing the save.
 */
async function captureVisible(windowId: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    } catch (err) {
      if (attempt >= 3 || !/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(String(err))) throw err;
      await wait(1100);
    }
  }
}

/** Most screens stitched for one tall section; anything below is left out (and said so in its context). */
const MAX_SECTION_SCREENS = 6;

/**
 * Screenshots one section of the page as you see it (signed-in state included): scrolls to it, captures the visible
 * tab screen by screen when it is taller than the window, crops and stitches. Puts the page back where it was.
 */
async function captureSection(tab: chrome.tabs.Tab, picked: PickedSection) {
  const tabId = tab.id!;
  const { rect, viewport } = picked;
  const before = await runInTab(tabId, () => scrollY, []);
  const screens = Math.min(MAX_SECTION_SCREENS, Math.ceil(rect.height / viewport.height));
  const height = Math.min(rect.height, screens * viewport.height);
  let canvas: OffscreenCanvas | null = null;
  let scale = 1;
  try {
    for (let i = 0; i < screens; i++) {
      const segStart = rect.y + i * viewport.height;
      const segEnd = Math.min(segStart + viewport.height, rect.y + height);
      const at = await runInTab(tabId, scrollPageTo, [segStart]);
      // let lazy images and entrance animations settle; Chrome also allows only two captures a second
      await wait(i === 0 ? 450 : 650);
      const dataUrl = await captureVisible(tab.windowId);
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      if (!canvas) {
        scale = bitmap.width / viewport.width;
        canvas = new OffscreenCanvas(Math.round(rect.width * scale), Math.round(height * scale));
      }
      canvas
        .getContext("2d")!
        .drawImage(
          bitmap,
          rect.x * scale,
          (segStart - at) * scale,
          rect.width * scale,
          (segEnd - segStart) * scale,
          0,
          (segStart - rect.y) * scale,
          rect.width * scale,
          (segEnd - segStart) * scale,
        );
      bitmap.close();
    }
  } finally {
    await runInTab(tabId, scrollPageTo, [before]).catch(() => 0);
  }
  if (!canvas) throw new Error("The section couldn't be captured.");
  return {
    blob: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 }),
    truncated: height < rect.height,
  };
}

/** Saves a picked section as its own reference, through the queue (held for approval when the page looks private). */
async function saveSection(tab: chrome.tabs.Tab, picked: PickedSection) {
  const info = await getPageInfo(tab);
  const { blob, truncated } = await captureSection(tab, picked);
  const verdict = await assessPrivacy(info.url, info.privacy);
  const section = { ...toSectionContext(picked), ...(truncated ? { truncated: true } : {}) };
  return {
    data: {
      kind: "page",
      url: info.url,
      type: "reference",
      section,
      needsReview: true,
      serverCapture: false,
      privatePage: verdict.flagged || undefined,
      capturedUrl: info.address && info.address !== info.url ? info.address : undefined,
    },
    title: `${section.type} — ${new URL(info.url).hostname.replace(/^www\./, "")}`,
    screenshot: blob,
    privacy: verdict.flagged
      ? { reasons: verdict.reasons, suggestions: [], viewportWidth: picked.rect.width }
      : undefined,
  } satisfies Prepared;
}

async function saveImage(srcUrl: string, pageUrl: string): Promise<Prepared> {
  const data: ClipData = {
    kind: "image",
    url: pageUrl,
    imageUrl: srcUrl.startsWith("data:") ? undefined : srcUrl,
    needsReview: true,
  };
  let image: Blob | undefined;
  // Try fetching here first (keeps cookies for logged-in images); the server downloads it otherwise.
  try {
    const res = await fetch(srcUrl);
    if (res.ok) image = await res.blob();
  } catch {}
  if (!image && !data.imageUrl) throw new Error("This image can’t be read.");
  const ext = image?.type.split("/")[1]?.replace("svg+xml", "svg").replace("jpeg", "jpg") ?? "png";
  const name = srcUrl.startsWith("data:")
    ? `image.${ext}`
    : decodeURIComponent(new URL(srcUrl).pathname.split("/").pop() || `image.${ext}`);
  return { data, title: name, image, imageName: /\.\w{2,5}$/.test(name) ? name : `${name}.${ext}` };
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  const pageUrl = info.pageUrl ?? tab.url ?? "";
  switch (info.menuItemId) {
    case MENU.page:
      return run("Page", () => savePage(tab));
    case MENU.section:
      return void startPicker(tab.id!, "select");
    case MENU.link:
      return run("Link", async () => ({
        data: { kind: "page", url: info.linkUrl!, serverCapture: true, ifExists: "skip", needsReview: true },
        title: info.linkUrl!,
      }));
    case MENU.image:
      return run("Image", () => saveImage(info.srcUrl!, pageUrl));
    case MENU.snippet:
    case MENU.prompt:
      return run(info.menuItemId === MENU.snippet ? "Snippet" : "Prompt", async () => {
        // info.selectionText collapses newlines; read the real selection from the page when possible.
        const page = await getPageInfo(tab);
        const text = page.selection || info.selectionText || "";
        return {
          data: {
            kind: "selection",
            url: pageUrl,
            type: info.menuItemId === MENU.snippet ? "snippet" : "prompt",
            text,
            needsReview: true,
          },
          title: text.split("\n")[0].slice(0, 60),
        };
      });
  }
});

async function startPicker(tabId: number, mode: "select" | "crop") {
  await chrome.scripting.executeScript({ target: { tabId }, func: sectionPicker, args: [mode] });
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // The popup asks for a background sync after it queues something, so the alarm keeps going after it closes.
  if (message?.type === "pivot:queue-changed") void scheduleSync();
  // The popup starts the picker, then closes; the page reports back here.
  if (message?.type === "pivot:section-start") void startPicker(message.tabId, message.mode);
  if (message?.type === "pivot:section-picked" && sender.tab) {
    void run("Section", () => saveSection(sender.tab!, message.section));
  }
  // A section picked from the popup's list: the popup stays open and waits for the result.
  if (message?.type === "pivot:section-capture") {
    void (async () => {
      const tab = await chrome.tabs.get(message.tabId);
      try {
        const prepared = await saveSection(tab, message.section);
        const result = await queueSave({ label: "Section", ...prepared });
        await scheduleSync();
        reply({ ok: true, result });
      } catch (err) {
        reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  }
});

void pendingStore.count().then(() => scheduleSync());

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "quick-save" || !tab) return;
  await run("Page", () => savePage(tab));
});
