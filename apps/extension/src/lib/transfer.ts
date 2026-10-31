import { pendingStore } from "./pending-store";
import type { PendingItem } from "./queue";

const blobToBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

const base64ToBlob = (s: string, type: string) =>
  new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))], { type });

export interface TransferFile {
  format: "pivot-pending";
  version: 1;
  exportedAt: string;
  /** Only the server address: never the token. */
  settings: { serverUrl?: string };
  items: (Omit<PendingItem, "screenshot" | "image"> & {
    screenshot?: { type: string; data: string };
    image?: { type: string; data: string };
  })[];
}

/**
 * The saves still waiting on this computer, as one file to carry to another computer (or keep before reinstalling).
 * Screenshots go with them; the API token does not. A save waiting for privacy approval still waits after the move.
 */
export async function exportPending(serverUrl?: string): Promise<Blob> {
  const items = await pendingStore.list();
  const file: TransferFile = {
    format: "pivot-pending",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { serverUrl },
    items: await Promise.all(
      items.map(async ({ screenshot, image, ...rest }) => ({
        ...rest,
        ...(screenshot ? { screenshot: { type: screenshot.type, data: await blobToBase64(screenshot) } } : {}),
        ...(image ? { image: { type: image.type, data: await blobToBase64(image) } } : {}),
      })),
    ),
  };
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

/** Reads a transfer file without changing anything: how many saves, how many already here. */
export async function readTransfer(text: string) {
  const file = JSON.parse(text) as TransferFile;
  if (file.format !== "pivot-pending" || !Array.isArray(file.items))
    throw new Error("This isn't a PIVOT waiting-saves file.");
  const here = new Set((await pendingStore.list()).map((i) => i.id));
  return { file, total: file.items.length, alreadyHere: file.items.filter((i) => here.has(i.id)).length };
}

/** Adds the file's saves to this computer's queue. Ones already here are skipped, so importing twice is harmless. */
export async function importPending(file: TransferFile) {
  const here = new Set((await pendingStore.list()).map((i) => i.id));
  let added = 0;
  for (const { screenshot, image, ...rest } of file.items) {
    if (here.has(rest.id)) continue;
    await pendingStore.put({
      ...rest,
      ...(screenshot ? { screenshot: base64ToBlob(screenshot.data, screenshot.type) } : {}),
      ...(image ? { image: base64ToBlob(image.data, image.type) } : {}),
      nextAttemptAt: Date.now(),
    });
    added++;
  }
  return added;
}
