import { api, ApiError } from "./api";
import { pendingStore } from "./pending-store";
import { newPendingItem, syncPending, type PendingItem, type SendResult, type SyncSummary } from "./queue";
import { redact, type Mask } from "./redact";

async function send(item: PendingItem): Promise<SendResult> {
  try {
    const res = await api.clip(
      { ...item.data, clientRequestId: item.id },
      { screenshot: item.screenshot, image: item.image, imageName: item.imageName },
    );
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, status: err instanceof ApiError ? err.status : 0, message: errorText(err) };
  }
}

async function features(): Promise<string[] | null> {
  try {
    return (await api.capabilities()).features;
  } catch (err) {
    if (err instanceof ApiError && err.status !== 0) return [];
    return null;
  }
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/** Updates the toolbar badge with the number of saves still on this computer. */
export async function refreshBadge() {
  const count = await pendingStore.count().catch(() => 0);
  await chrome.action.setBadgeBackgroundColor?.({ color: "#ff6a13" }).catch(() => {});
  await chrome.action.setBadgeText({ text: count ? String(count) : "" }).catch(() => {});
  return count;
}

let running: Promise<SyncSummary> | null = null;

/** Sends what is due (or everything with `force`). Runs one at a time per extension page. */
export async function syncNow(options: { only?: string[]; force?: boolean } = {}) {
  while (running) await running.catch(() => {});
  running = syncPending({ store: pendingStore, send, features }, options);
  try {
    return await running;
  } finally {
    running = null;
    await refreshBadge();
  }
}

export type QueuedSave =
  | { synced: true; path: string; title: string; existing?: boolean }
  | { synced: false; item: PendingItem; reason: "offline" | "auth" | "attention" | "update" | "retry" | "approval" };

/**
 * Saves through the queue: written on this computer first ("Saved locally"), then sent at once. Only a confirmed
 * answer from PIVOT counts as synced; anything else stays queued and is retried later.
 */
export async function queueSave(input: Parameters<typeof newPendingItem>[0]): Promise<QueuedSave> {
  const item = newPendingItem(input);
  await pendingStore.put(item);
  if (item.status === "needs_approval") {
    await refreshBadge();
    return { synced: false, item, reason: "approval" };
  }
  let result: { path: string; title?: string; existing?: boolean } | null = null;
  const summary = await syncPending(
    { store: pendingStore, send, features, onSynced: (_, res) => void (result = res) },
    { only: [item.id], force: true },
  );
  await refreshBadge();
  if (result) {
    const r = result as { path: string; title?: string; existing?: boolean };
    return { synced: true, path: r.path, title: r.title || item.title, existing: r.existing };
  }
  const left = (await pendingStore.list()).find((i) => i.id === item.id) ?? item;
  const reason = summary.auth
    ? "auth"
    : summary.offline
      ? "offline"
      : summary.unsupported
        ? "update"
        : left.status === "needs_attention"
          ? "attention"
          : "retry";
  return { synced: false, item: left, reason };
}

export const SAVED_LOCALLY_TEXT: Record<Exclude<QueuedSave, { synced: true }>["reason"], string> = {
  offline: "PIVOT isn’t running. It’s kept on this computer and sent when PIVOT is back.",
  auth: "The API token was rejected. It’s kept on this computer; fix the token and it will be sent.",
  update: "PIVOT needs an update to save this. It’s kept on this computer until then.",
  retry: "PIVOT couldn’t take it right now. It’s kept on this computer and will be retried.",
  attention: "PIVOT refused it. It’s kept on this computer; open the popup to retry or discard it.",
  approval:
    "This page looks private, so nothing was uploaded. It’s kept on this computer: open the popup to review the screenshot and approve it.",
};

/**
 * Your approval of a held save: the screenshot is uploaded with the masks painted in, or left out. Then it is sent
 * like any other save.
 */
export async function approvePending(
  id: string,
  { masks, attachScreenshot }: { masks: Mask[]; attachScreenshot: boolean },
) {
  const item = (await pendingStore.list()).find((i) => i.id === id);
  if (!item || item.status !== "needs_approval") return null;
  const screenshot =
    attachScreenshot && item.screenshot
      ? await redact(item.screenshot, masks, item.privacy?.viewportWidth ?? 0)
      : undefined;
  await pendingStore.put({
    ...item,
    screenshot,
    status: "pending",
    privacy: undefined,
    nextAttemptAt: Date.now(),
    // the server can't see a private page, so it doesn't capture it either
    data: { ...item.data, serverCapture: false },
  });
  return syncNow({ only: [id], force: true });
}
