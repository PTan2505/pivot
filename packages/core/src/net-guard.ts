import dns from "node:dns/promises";
import net from "node:net";

export class UnsafeUrlError extends Error {}

export function normalizeUrl(input: string): string {
  let raw = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  const url = new URL(raw);
  url.hash = "";
  return url.toString();
}

/** Comparable form used for duplicate detection: no protocol, no www, no trailing slash. */
export function urlKey(input: string): string {
  try {
    const u = new URL(normalizeUrl(input));
    const host = u.hostname.replace(/^www\./, "");
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${host}${pathname}${u.search}`.toLowerCase();
  } catch {
    return input.trim().toLowerCase();
  }
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) {
    const mapped = v6.slice(7);
    if (net.isIPv4(mapped)) return isPrivateIPv4(mapped);
  }
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80") ||
    v6.startsWith("ff")
  );
}

/** Throws unless the URL is http(s) and every address it resolves to is public. */
export async function assertPublicUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs are supported.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [host]
    : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new UnsafeUrlError(`Could not resolve ${host}.`);
  if (addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError("URLs that point to private or local network addresses are blocked.");
  }
  return url;
}

const MAX_REDIRECTS = 5;

/** fetch() that re-validates every redirect hop and caps the body size. */
export async function safeFetch(
  input: string,
  { timeoutMs = 10_000, maxBytes = 5 * 1024 * 1024, accept = "*/*" } = {},
): Promise<{ url: string; response: Response; body: Buffer }> {
  let current = input;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      },
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      current = new URL(response.headers.get("location")!, current).toString();
      continue;
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    return { url: current, response, body: Buffer.concat(chunks) };
  }
  throw new UnsafeUrlError("Too many redirects.");
}
