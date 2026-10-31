import { getConfig, type ClipData } from "./lib/api";
import { pendingStore } from "./lib/pending-store";
import { queueSave, refreshBadge, SAVED_LOCALLY_TEXT, syncNow } from "./lib/sync";
import { knownSourceFor } from "@pivot/core/source-match";
import { captureTab, getPageInfo, isHomePage, isPivotPage, isSavable } from "./lib/page";

const MENU = {
  page: "pivot-page",
  link: "pivot-link",
  image: "pivot-image",
  snippet: "pivot-selection-snippet",
  prompt: "pivot-selection-prompt",
} as const;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.page, title: "Save page to PIVOT", contexts: ["page"] });
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
    await notify("Saved locally", SAVED_LOCALLY_TEXT[result.reason]);
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
  const data: ClipData = {
    kind: "page",
    url: info.url,
    type: source ? "source" : "reference",
    title: info.title,
    description: source ? undefined : info.description,
    serverCapture: !(source && shot),
    ifExists: "skip",
  };
  return { data, title: info.title || info.url, screenshot: shot ?? undefined };
}

async function saveImage(srcUrl: string, pageUrl: string): Promise<Prepared> {
  const data: ClipData = { kind: "image", url: pageUrl, imageUrl: srcUrl.startsWith("data:") ? undefined : srcUrl };
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
    case MENU.link:
      return run("Link", async () => ({
        data: { kind: "page", url: info.linkUrl!, serverCapture: true, ifExists: "skip" },
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
          },
          title: text.split("\n")[0].slice(0, 60),
        };
      });
  }
});

/** The popup asks for a background sync after it queues something, so the alarm keeps going after it closes. */
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "pivot:queue-changed") void scheduleSync();
});

void pendingStore.count().then(() => scheduleSync());

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "quick-save" || !tab) return;
  await run("Page", () => savePage(tab));
});
