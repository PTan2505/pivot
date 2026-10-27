import * as cheerio from "cheerio";
import { normalizeUrl, safeFetch } from "./net-guard";

export interface UrlMetadata {
  url: string;
  title: string;
  description: string;
  siteName: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
}

export async function fetchUrlMetadata(input: string): Promise<UrlMetadata> {
  const url = normalizeUrl(input);
  const { url: finalUrl, response, body } = await safeFetch(url, {
    accept: "text/html,application/xhtml+xml",
    maxBytes: 2 * 1024 * 1024,
  });
  const fallback: UrlMetadata = {
    url: finalUrl,
    title: new URL(finalUrl).hostname.replace(/^www\./, ""),
    description: "",
    siteName: null,
    imageUrl: null,
    faviconUrl: null,
  };
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) return fallback;

  const $ = cheerio.load(body.toString("utf8"));
  const meta = (...names: string[]) => {
    for (const n of names) {
      const v = $(`meta[property="${n}"], meta[name="${n}"]`).attr("content")?.trim();
      if (v) return v;
    }
    return null;
  };
  const abs = (v: string | null | undefined) => {
    if (!v) return null;
    try {
      return new URL(v, finalUrl).toString();
    } catch {
      return null;
    }
  };

  return {
    url: finalUrl,
    title: meta("og:title", "twitter:title") || $("title").first().text().trim() || fallback.title,
    description: meta("og:description", "twitter:description", "description") ?? "",
    siteName: meta("og:site_name"),
    imageUrl: abs(meta("og:image", "og:image:url", "twitter:image")),
    faviconUrl: abs($('link[rel~="icon"]').first().attr("href") ?? "/favicon.ico"),
  };
}
