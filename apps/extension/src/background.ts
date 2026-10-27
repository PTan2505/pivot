import { api, ApiError, getConfig, type ClipData } from "./lib/api";
import { captureTab, getPageInfo, isSavable } from "./lib/page";

const MENU = {
  page: "stan-bag-page",
  link: "stan-bag-link",
  image: "stan-bag-image",
  snippet: "stan-bag-selection-snippet",
  prompt: "stan-bag-selection-prompt",
} as const;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.page, title: "Save page to Stan Bag", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.link, title: "Save link to Stan Bag", contexts: ["link"] });
    chrome.contextMenus.create({ id: MENU.image, title: "Save image to Stan Bag", contexts: ["image"] });
    chrome.contextMenus.create({ id: MENU.snippet, title: "Save selection as snippet", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU.prompt, title: "Save selection as prompt", contexts: ["selection"] });
  });
  // First install: open options so the token can be pasted.
  if (reason === "install" && !(await getConfig()).token) chrome.runtime.openOptionsPage();
});

const openTargets = new Map<string, string>();

async function notify(title: string, message: string, openPath?: string) {
  const id = await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/128.png",
    title,
    message,
    priority: 0,
  });
  if (openPath) openTargets.set(id, openPath);
}

chrome.notifications.onClicked.addListener(async (id) => {
  const path = openTargets.get(id);
  if (!path) return;
  const { serverUrl } = await getConfig();
  await chrome.tabs.create({ url: `${serverUrl}${path}` });
  chrome.notifications.clear(id);
  openTargets.delete(id);
});

async function run(label: string, task: () => Promise<{ path: string; title: string }>) {
  try {
    const { path, title } = await task();
    await notify("Saved to Stan Bag", `${label}: ${title}`, path);
  } catch (err) {
    const message = err instanceof ApiError || err instanceof Error ? err.message : String(err);
    if (err instanceof ApiError && err.status === 403) chrome.runtime.openOptionsPage();
    await notify("Couldn’t save", message);
  }
}

async function savePage(tab: chrome.tabs.Tab) {
  if (!isSavable(tab.url)) throw new Error("Only http(s) pages can be saved.");
  const [info, shot] = await Promise.all([getPageInfo(tab), captureTab(tab.windowId)]);
  const data: ClipData = { kind: "page", url: info.url, title: info.title, description: info.description, serverCapture: true };
  const res = await api.clip(data, { screenshot: shot ?? undefined });
  return { path: res.path, title: info.title || info.url };
}

async function saveImage(srcUrl: string, pageUrl: string) {
  const data: ClipData = { kind: "image", url: pageUrl, imageUrl: srcUrl.startsWith("data:") ? undefined : srcUrl };
  let image: Blob | undefined;
  // Try fetching here first (keeps cookies for logged-in images); the server downloads it otherwise.
  try {
    const res = await fetch(srcUrl);
    if (res.ok) image = await res.blob();
  } catch {}
  if (!image && !data.imageUrl) throw new Error("This image can’t be read.");
  const ext = image?.type.split("/")[1]?.replace("svg+xml", "svg").replace("jpeg", "jpg") ?? "png";
  const name = srcUrl.startsWith("data:") ? `image.${ext}` : decodeURIComponent(new URL(srcUrl).pathname.split("/").pop() || `image.${ext}`);
  const res = await api.clip(data, { image, imageName: /\.\w{2,5}$/.test(name) ? name : `${name}.${ext}` });
  return { path: res.path, title: name };
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  const pageUrl = info.pageUrl ?? tab.url ?? "";
  switch (info.menuItemId) {
    case MENU.page:
      return run("Page", () => savePage(tab));
    case MENU.link:
      return run("Link", async () => {
        const res = await api.clip({ kind: "page", url: info.linkUrl!, serverCapture: true });
        return { path: res.path, title: info.linkUrl! };
      });
    case MENU.image:
      return run("Image", () => saveImage(info.srcUrl!, pageUrl));
    case MENU.snippet:
    case MENU.prompt:
      return run(info.menuItemId === MENU.snippet ? "Snippet" : "Prompt", async () => {
        // info.selectionText collapses newlines; read the real selection from the page when possible.
        const page = await getPageInfo(tab);
        const text = page.selection || info.selectionText || "";
        const res = await api.clip({
          kind: "selection",
          url: pageUrl,
          type: info.menuItemId === MENU.snippet ? "snippet" : "prompt",
          text,
        });
        return { path: res.path, title: text.split("\n")[0].slice(0, 60) };
      });
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "quick-save" || !tab) return;
  await run("Page", () => savePage(tab));
});
