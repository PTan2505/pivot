/**
 * A saved URL as a link that opens: only http and https, and a bare host such as "attio.com" gets `https://`. Null when
 * there is nothing to open (empty, or another scheme like `javascript:`).
 */
export function openableUrl(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  for (const candidate of [v, `https://${v}`]) {
    try {
      const url = new URL(candidate);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) return url.toString();
    } catch {
      // not a URL as written; try it as a bare host
    }
  }
  return null;
}
