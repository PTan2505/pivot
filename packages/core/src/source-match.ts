// Pure helpers for sources: host matching and known-site lookup. Safe in the browser.
import { KNOWN_SOURCES, type KnownSource } from "./known-sources";
import { SOURCE_CATEGORIES } from "./types";

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The most specific of `hosts` that `host` belongs to, so styles.refero.design wins over refero.design. */
export function matchHost(host: string, hosts: Iterable<string>): string | null {
  let best: string | null = null;
  for (const h of hosts) {
    if ((host === h || host.endsWith(`.${h}`)) && (!best || h.length > best.length)) best = h;
  }
  return best;
}

const KNOWN_BY_HOST = new Map(KNOWN_SOURCES.flatMap((s) => [s.host, ...(s.aliases ?? [])].map((h) => [h, s] as const)));

export function knownSourceFor(url: string | null | undefined): KnownSource | null {
  const host = hostOf(url);
  const match = host && matchHost(host, KNOWN_BY_HOST.keys());
  return match ? KNOWN_BY_HOST.get(match)! : null;
}

/** The meta a new source starts with when its site is one we know. */
export function knownSourceMeta(url: string | null | undefined): Record<string, unknown> {
  const k = knownSourceFor(url);
  return k ? { category: k.category, searchUrl: k.searchUrl ?? "", pricing: k.pricing, platforms: k.platforms } : {};
}

export function categoryLabel(value: unknown): string | null {
  return SOURCE_CATEGORIES.find((c) => c.value === value)?.label ?? null;
}
