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

/** The 16 bytes of an IPv6 address; `ip` must pass `net.isIPv6`. */
function ipv6Bytes(ip: string): number[] {
  let s = ip.toLowerCase().split("%")[0];
  // A trailing dotted IPv4 part (::ffff:127.0.0.1) becomes two hex groups.
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const groups = (part: string | undefined) => (part ? part.split(":") : []);
  const h = groups(head);
  const t = groups(tail);
  const all = s.includes("::") ? [...h, ...Array<string>(8 - h.length - t.length).fill("0"), ...t] : h;
  return all.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

const zeros = (bytes: number[], from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);
const embeddedIPv4 = (bytes: number[], at: number) => bytes.slice(at, at + 4).join(".");

function isPrivateIPv6(ip: string): boolean {
  const b = ipv6Bytes(ip);
  // Forms that carry an IPv4 address: the IPv4 rules decide.
  if (zeros(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIPv4(embeddedIPv4(b, 12)); // ::ffff:0:0/96
  if (zeros(b, 0, 12)) return isPrivateIPv4(embeddedIPv4(b, 12)); // ::/96, also :: and ::1
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(b, 4, 12)) {
    return isPrivateIPv4(embeddedIPv4(b, 12)); // 64:ff9b::/96 (NAT64)
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIPv4(embeddedIPv4(b, 2)); // 2002::/16 (6to4)
  return (
    (b[0] & 0xfe) === 0xfc || // fc00::/7 unique local
    (b[0] === 0xfe && (b[1] & 0x80) === 0x80) || // fe80::/10 link-local, fec0::/10 site-local
    b[0] === 0xff // ff00::/8 multicast
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip.split("%")[0])) return isPrivateIPv6(ip);
  // Not an IP address at all: refuse rather than guess.
  return true;
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
