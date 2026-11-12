/**
 * A capture session: while it is on, every save also goes into its collections (the popup still lets you change that
 * per save). Kept in session storage, so it ends when Chrome closes; nothing carries on hidden.
 */
export interface CaptureSession {
  collectionIds: string[];
  names: string[];
  startedAt: number;
}

const KEY = "captureSession";

export async function getCaptureSession(): Promise<CaptureSession | null> {
  const v = (await chrome.storage.session.get(KEY))[KEY] as CaptureSession | undefined;
  return v?.collectionIds?.length ? v : null;
}

export async function startCaptureSession(collectionIds: string[], names: string[]) {
  await chrome.storage.session.set({ [KEY]: { collectionIds, names, startedAt: Date.now() } satisfies CaptureSession });
}

export async function endCaptureSession() {
  await chrome.storage.session.remove(KEY);
}
