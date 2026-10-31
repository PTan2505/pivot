import type { ClipData } from "./api";
import type { Box } from "./page";

/**
 * The offline queue ("Pending Sync"): every save is written here first and leaves only once PIVOT has confirmed it.
 * This file is the storage-free logic, so it can be tested; `pending-store.ts` keeps the items in IndexedDB.
 */

/**
 * `pending`: will be sent automatically. `needs_attention`: PIVOT refused it; it waits for you to retry or discard.
 * `needs_approval`: the page looks private; nothing is sent until you review the screenshot (and its masks).
 */
export type PendingStatus = "pending" | "needs_attention" | "needs_approval";

export interface PendingItem {
  /** Also sent as `clientRequestId`, so a save whose answer got lost is never stored twice. */
  id: string;
  createdAt: number;
  /** "Page", "Link", "Image"…: for messages. */
  label: string;
  title: string;
  data: ClipData;
  screenshot?: Blob;
  image?: Blob;
  imageName?: string;
  status: PendingStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  /** For `needs_approval`: why the page looks private, the masks suggested, and the page width they refer to. */
  privacy?: { reasons: string[]; suggestions: Box[]; viewportWidth: number };
}

export interface PendingStore {
  list(): Promise<PendingItem[]>;
  put(item: PendingItem): Promise<void>;
  remove(id: string): Promise<void>;
}

export type SendResult =
  | { ok: true; id: string; path: string; title?: string; existing?: boolean }
  | { ok: false; status: number; message: string };

/** What to do after a failed send. */
export type FailureAction = "offline" | "auth" | "retry" | "attention";

export function failureAction(status: number): FailureAction {
  if (status === 0) return "offline";
  if (status === 403) return "auth";
  if (status === 408 || status === 409 || status === 429 || status >= 500) return "retry";
  return "attention";
}

const RETRY_STEPS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000];

/** Waits longer after each failed try, up to 30 minutes; it never gives up on its own. */
export function retryDelayMs(attempts: number) {
  return RETRY_STEPS_MS[Math.min(attempts, RETRY_STEPS_MS.length - 1)];
}

/** Server features a queued save needs; a server without them keeps it waiting instead of dropping options. */
export function requiredFeatures(item: Pick<PendingItem, "data">): string[] {
  return ["clip", "clip.client-request-id", ...(item.data.expandContent ? ["clip.expand-content"] : [])];
}

export interface SyncDeps {
  store: PendingStore;
  send(item: PendingItem): Promise<SendResult>;
  /** The server's features, or null when it can't be reached. */
  features(): Promise<string[] | null>;
  now?(): number;
  onSynced?(item: PendingItem, result: Extract<SendResult, { ok: true }>): void | Promise<void>;
}

export interface SyncSummary {
  synced: number;
  /** Still pending (offline, retrying later, or waiting for a server update). */
  waiting: number;
  attention: number;
  /** Waiting for your approval before upload. */
  approval: number;
  offline: boolean;
  auth: boolean;
  /** Items waiting because the server lacks a feature they need. */
  unsupported: number;
}

/**
 * Sends what is due. `only` limits it to some items and `force` ignores their retry time (a save just made, or "Sync
 * now"). Items leave the store only after the server confirms them.
 */
export async function syncPending(
  deps: SyncDeps,
  { only, force = false }: { only?: string[]; force?: boolean } = {},
): Promise<SyncSummary> {
  const now = deps.now ?? Date.now;
  const summary: SyncSummary = {
    synced: 0,
    waiting: 0,
    attention: 0,
    approval: 0,
    offline: false,
    auth: false,
    unsupported: 0,
  };
  const items = (await deps.store.list()).sort((a, b) => a.createdAt - b.createdAt);
  if (!items.length) return summary;
  const features = await deps.features();
  let stop = features === null;
  summary.offline = features === null;

  for (const item of items) {
    const picked = !only || only.includes(item.id);
    // never sent, not even by "Sync now": approving it makes it pending first
    if (item.status === "needs_approval") {
      summary.approval++;
      continue;
    }
    // a refused save goes again only when you ask for it (Retry); a pending one when its time has come
    const due = force || (item.status === "pending" && item.nextAttemptAt <= now());
    if (item.status === "needs_attention" && !(force && picked)) {
      summary.attention++;
      continue;
    }
    if (stop || !due || !picked) {
      summary.waiting++;
      continue;
    }
    const missing = requiredFeatures(item).filter((f) => !features!.includes(f));
    if (missing.length) {
      await deps.store.put({
        ...item,
        lastError: `PIVOT needs an update to save this (missing ${missing.join(", ")}).`,
      });
      summary.unsupported++;
      summary.waiting++;
      continue;
    }
    const result = await deps.send(item);
    if (result.ok) {
      await deps.store.remove(item.id);
      summary.synced++;
      await deps.onSynced?.(item, result);
      continue;
    }
    const action = failureAction(result.status);
    if (action === "attention") {
      await deps.store.put({ ...item, status: "needs_attention", lastError: result.message });
      summary.attention++;
      continue;
    }
    if (action === "retry") {
      const attempts = item.attempts + 1;
      await deps.store.put({
        ...item,
        status: "pending",
        attempts,
        nextAttemptAt: now() + retryDelayMs(attempts - 1),
        lastError: result.message,
      });
      summary.waiting++;
      continue;
    }
    // offline or a rejected token: nothing else will get through either, so stop here
    await deps.store.put({ ...item, status: "pending", lastError: result.message });
    summary.waiting++;
    summary.offline ||= action === "offline";
    summary.auth ||= action === "auth";
    stop = true;
  }
  return summary;
}

export function newPendingItem(
  input: Pick<PendingItem, "label" | "title" | "data" | "screenshot" | "image" | "imageName" | "privacy">,
  now = Date.now(),
): PendingItem {
  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now,
    status: input.privacy ? "needs_approval" : "pending",
    attempts: 0,
    nextAttemptAt: now,
  };
}
