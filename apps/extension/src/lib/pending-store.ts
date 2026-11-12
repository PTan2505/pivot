import type { PendingItem, PendingStore } from "./queue";

/** IndexedDB, not chrome.storage: it keeps screenshots as Blobs and survives the service worker being stopped. */
const DB_NAME = "pivot-extension";
const STORE = "pending";

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The local save was aborted."));
  });
}

export const pendingStore: PendingStore & { count(): Promise<number> } = {
  list: () => run("readonly", (s) => s.getAll() as IDBRequest<PendingItem[]>),
  put: async (item) => void (await run("readwrite", (s) => s.put(item))),
  remove: async (id) => void (await run("readwrite", (s) => s.delete(id))),
  count: () => run("readonly", (s) => s.count()),
};

/** A warning when the browser's storage for the extension is nearly full, else null. */
export async function storageWarning(): Promise<string | null> {
  const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {};
  if (!quota || usage / quota < 0.8) return null;
  return `The extension's storage is ${Math.round((usage / quota) * 100)}% full. Start PIVOT so waiting saves can be sent.`;
}
