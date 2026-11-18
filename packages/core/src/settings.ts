import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { appSettings } from "./db/schema";
import {
  DEFAULT_CAPTURE_SETTINGS,
  DEFAULT_UI_SETTINGS,
  DIRECT_PROVIDER_IDS,
  type UiSettings,
  type DirectProviderId,
  type CaptureOptions,
  type CaptureSettings,
  type CaptureTheme,
  type ResponsiveViewport,
} from "./types";

const THEMES: readonly CaptureTheme[] = ["light", "dark", "both"];

/** Per-capture options from a request: the settings' keys plus the on-request extras. */
export function cleanCaptureOptions(input: unknown): CaptureOptions {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: CaptureOptions = cleanCaptureSettings(v);
  if (Array.isArray(v.viewports)) {
    out.viewports = [...new Set(v.viewports.filter((x): x is ResponsiveViewport => x === "tablet" || x === "mobile"))];
  }
  if (v.motion === true) out.motion = true;
  return out;
}

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

/** Keeps only known keys with valid values. */
export function cleanUiSettings(input: unknown): Partial<UiSettings> {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Partial<UiSettings> = {};
  if (typeof v.showOtherTypes === "boolean") out.showOtherTypes = v.showOtherTypes;
  return out;
}

/** App-wide display settings, such as whether the types outside design are shown. */
export async function getUiSettings(): Promise<UiSettings> {
  const db = await getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "ui")).limit(1);
  return { ...DEFAULT_UI_SETTINGS, ...cleanUiSettings(row?.value) };
}

export async function setUiSettings(patch: unknown): Promise<UiSettings> {
  const next = { ...(await getUiSettings()), ...cleanUiSettings(patch) };
  const db = await getDb();
  await db
    .insert(appSettings)
    .values({ key: "ui", value: { ...next } })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { ...next }, updatedAt: new Date() } });
  return next;
}

/** Hybrid search: which direct providers are switched off. All of them are on unless you turn one off. */
export interface SearchSettings {
  disabled: DirectProviderId[];
}

function cleanSearchSettings(input: unknown): SearchSettings {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const disabled = Array.isArray(v.disabled)
    ? [
        ...new Set(
          v.disabled.filter((x): x is DirectProviderId => (DIRECT_PROVIDER_IDS as readonly unknown[]).includes(x)),
        ),
      ]
    : [];
  return { disabled };
}

export async function getSearchSettings(): Promise<SearchSettings> {
  const db = await getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "search")).limit(1);
  return cleanSearchSettings(row?.value);
}

/** Turns one provider on or off. */
export async function setProviderEnabled(id: DirectProviderId, enabled: boolean): Promise<SearchSettings> {
  const current = await getSearchSettings();
  const next = cleanSearchSettings({
    disabled: enabled ? current.disabled.filter((d) => d !== id) : [...current.disabled, id],
  });
  const db = await getDb();
  await db
    .insert(appSettings)
    .values({ key: "search", value: { ...next } })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { ...next }, updatedAt: new Date() } });
  return next;
}
