import { describe, expect, it } from "vitest";
import {
  failureAction,
  newPendingItem,
  requiredFeatures,
  retryDelayMs,
  syncPending,
  type PendingItem,
  type PendingStore,
  type SendResult,
} from "../src/lib/queue";

const FEATURES = ["clip", "clip.client-request-id", "clip.expand-content"];

function memoryStore(items: PendingItem[] = []): PendingStore & { items: Map<string, PendingItem> } {
  const map = new Map(items.map((i) => [i.id, i]));
  return {
    items: map,
    list: async () => [...map.values()],
    put: async (item) => void map.set(item.id, item),
    remove: async (id) => void map.delete(id),
  };
}

const item = (title: string, at = 0, data: Partial<PendingItem["data"]> = {}) =>
  newPendingItem({ label: "Page", title, data: { kind: "page", url: `https://example.com/${title}`, ...data } }, at);

const ok = (id = "r1"): SendResult => ({ ok: true, id, path: `/r/${id}` });
const fail = (status: number, message = "nope"): SendResult => ({ ok: false, status, message });

describe("failureAction", () => {
  it("sorts failures into offline, auth, retry and attention", () => {
    expect(failureAction(0)).toBe("offline");
    expect(failureAction(403)).toBe("auth");
    for (const s of [408, 409, 429, 500, 503]) expect(failureAction(s)).toBe("retry");
    for (const s of [400, 404, 413]) expect(failureAction(s)).toBe("attention");
  });

  it("waits longer after each try, capped at 30 minutes", () => {
    expect(retryDelayMs(0)).toBe(30_000);
    expect(retryDelayMs(3)).toBe(5 * 60_000);
    expect(retryDelayMs(99)).toBe(30 * 60_000);
  });

  it("asks for the expand-content feature only when the save uses it", () => {
    expect(requiredFeatures(item("a"))).not.toContain("clip.expand-content");
    expect(requiredFeatures(item("b", 0, { expandContent: true }))).toContain("clip.expand-content");
  });
});

describe("syncPending", () => {
  it("removes an item only after the server confirms it, oldest first", async () => {
    const store = memoryStore([item("b", 2), item("a", 1)]);
    const sent: string[] = [];
    const summary = await syncPending({
      store,
      features: async () => FEATURES,
      send: async (i) => (sent.push(i.title), ok()),
    });
    expect(sent).toEqual(["a", "b"]);
    expect(summary).toMatchObject({ synced: 2, waiting: 0 });
    expect(store.items.size).toBe(0);
  });

  it("keeps everything and stops when PIVOT can't be reached", async () => {
    const store = memoryStore([item("a"), item("b")]);
    let sends = 0;
    const summary = await syncPending({ store, features: async () => null, send: async () => (sends++, ok()) });
    expect(sends).toBe(0);
    expect(summary).toMatchObject({ offline: true, waiting: 2, synced: 0 });
    expect(store.items.size).toBe(2);
  });

  it("stops at the first offline answer and keeps the rest untouched", async () => {
    const store = memoryStore([item("a", 1), item("b", 2)]);
    let sends = 0;
    const summary = await syncPending({
      store,
      features: async () => FEATURES,
      send: async () => (sends++, fail(0, "PIVOT isn’t running.")),
    });
    expect(sends).toBe(1);
    expect(summary).toMatchObject({ offline: true, waiting: 2 });
    expect([...store.items.values()].every((i) => i.status === "pending")).toBe(true);
  });

  it("schedules a retry with backoff for a server error, and skips it until then", async () => {
    let now = 1_000;
    const store = memoryStore([item("a", now)]);
    const deps = { store, features: async () => FEATURES, send: async () => fail(503), now: () => now };
    await syncPending(deps);
    const [after] = store.items.values();
    expect(after).toMatchObject({ attempts: 1, nextAttemptAt: 1_000 + 30_000, lastError: "nope" });

    let sends = 0;
    await syncPending({ ...deps, send: async () => (sends++, ok()) });
    expect(sends).toBe(0); // not due yet
    now += 30_000;
    await syncPending({ ...deps, send: async () => (sends++, ok()) });
    expect(sends).toBe(1);
    expect(store.items.size).toBe(0);
  });

  it("parks a refused save for the user instead of retrying it forever", async () => {
    const store = memoryStore([item("a")]);
    await syncPending({ store, features: async () => FEATURES, send: async () => fail(400, "Missing data.") });
    const [after] = store.items.values();
    expect(after).toMatchObject({ status: "needs_attention", lastError: "Missing data." });

    let sends = 0;
    const summary = await syncPending({ store, features: async () => FEATURES, send: async () => (sends++, ok()) });
    expect(sends).toBe(0);
    expect(summary.attention).toBe(1);
    // an explicit retry of that item sends it again
    await syncPending(
      { store, features: async () => FEATURES, send: async () => (sends++, ok()) },
      { only: [after.id], force: true },
    );
    expect(sends).toBe(1);
    expect(store.items.size).toBe(0);
  });

  it("waits for a server update when a needed feature is missing", async () => {
    const store = memoryStore([item("a", 0, { expandContent: true })]);
    let sends = 0;
    const summary = await syncPending({
      store,
      features: async () => ["clip", "clip.client-request-id"],
      send: async () => (sends++, ok()),
    });
    expect(sends).toBe(0);
    expect(summary).toMatchObject({ unsupported: 1, waiting: 1 });
    expect([...store.items.values()][0].lastError).toMatch(/needs an update.*clip.expand-content/);
  });

  it("stops on a rejected token so the user can fix it", async () => {
    const store = memoryStore([item("a", 1), item("b", 2)]);
    let sends = 0;
    const summary = await syncPending({
      store,
      features: async () => FEATURES,
      send: async () => (sends++, fail(403, "Invalid API token")),
    });
    expect(sends).toBe(1);
    expect(summary.auth).toBe(true);
    expect(store.items.size).toBe(2);
  });

  it("sends only the picked item when asked", async () => {
    const a = item("a", 1);
    const store = memoryStore([a, item("b", 2)]);
    const sent: string[] = [];
    await syncPending(
      { store, features: async () => FEATURES, send: async (i) => (sent.push(i.title), ok()) },
      { only: [a.id], force: true },
    );
    expect(sent).toEqual(["a"]);
    expect(store.items.size).toBe(1);
  });

  it("never sends a save that waits for privacy approval, even when forced", async () => {
    const held = newPendingItem({
      label: "Page",
      title: "private",
      data: { kind: "page", url: "https://app.example.com/billing" },
      privacy: { reasons: ["The page shows a password field."], suggestions: [], viewportWidth: 1280 },
    });
    expect(held.status).toBe("needs_approval");
    const store = memoryStore([held]);
    let sends = 0;
    const summary = await syncPending(
      { store, features: async () => FEATURES, send: async () => (sends++, ok()) },
      { only: [held.id], force: true },
    );
    expect(sends).toBe(0);
    expect(summary.approval).toBe(1);
    // approving it makes it an ordinary pending save
    await store.put({ ...held, status: "pending", privacy: undefined });
    await syncPending({ store, features: async () => FEATURES, send: async () => (sends++, ok()) });
    expect(sends).toBe(1);
  });
});
