import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { appSettings } from "./db/schema";
import { DEFAULT_CAPTURE_SETTINGS, type CaptureSettings, type CaptureTheme } from "./types";

const THEMES: readonly CaptureTheme[] = ["light", "dark", "both"];

/** Keeps only known keys with valid values, so a bad stored row or request can't break captures. */
export function cleanCaptureSettings(input: unknown): Partial<CaptureSettings> {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Partial<CaptureSettings> = {};
  if (typeof v.expandContent === "boolean") out.expandContent = v.expandContent;
  if (typeof v.theme === "string" && (THEMES as readonly string[]).includes(v.theme)) {
    out.theme = v.theme as CaptureTheme;
  }
  return out;
}

/** The global capture defaults; each capture can override them. */
export async function getCaptureSettings(): Promise<CaptureSettings> {
  const db = await getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "capture")).limit(1);
  return { ...DEFAULT_CAPTURE_SETTINGS, ...cleanCaptureSettings(row?.value) };
}

export async function setCaptureSettings(patch: unknown): Promise<CaptureSettings> {
  const next = { ...(await getCaptureSettings()), ...cleanCaptureSettings(patch) };
  const db = await getDb();
  await db
    .insert(appSettings)
    .values({ key: "capture", value: { ...next } })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { ...next }, updatedAt: new Date() } });
  return next;
}
