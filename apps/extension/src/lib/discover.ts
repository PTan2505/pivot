export interface Discovered {
  images: { url: string; width: number; height: number; alt: string }[];
  svgs: { markup: string; name: string; width: number; height: number }[];
  fonts: { family: string; weight: string; style: string; src?: string }[];
  gradients: string[];
}

/**
 * Runs inside the page (self-contained): what could be picked out of it. Visible images (as served, by URL), inline
 * SVG icons, the web fonts in use (names and where they're served from; never the files) and CSS gradients. Nothing
 * is downloaded here; you choose what to keep.
 */
export function discoverAssets(): Discovered {
  const onScreen = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > -innerHeight && r.top < innerHeight * 3;
  };
  const images = new Map<string, { url: string; width: number; height: number; alt: string }>();
  for (const img of document.images) {
    const url = img.currentSrc || img.src;
    if (!/^https?:/.test(url) || img.naturalWidth < 48 || !onScreen(img) || images.size >= 40) continue;
    images.set(url, { url, width: img.naturalWidth, height: img.naturalHeight, alt: img.alt.slice(0, 80) });
  }
  const gradients = new Set<string>();
  let looked = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (looked++ > 1500) break;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 2000 || !onScreen(el)) continue;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === "none") continue;
    if (bg.includes("gradient(") && gradients.size < 20) gradients.add(bg);
    const m = bg.match(/url\(["']?(https?:[^"')]+)["']?\)/);
    if (m && images.size < 40 && !images.has(m[1])) {
      images.set(m[1], { url: m[1], width: Math.round(r.width), height: Math.round(r.height), alt: "background" });
    }
  }
  const svgs: Discovered["svgs"] = [];
  for (const svg of document.querySelectorAll("svg")) {
    const r = svg.getBoundingClientRect();
    if (r.width < 12 || r.height < 12 || !onScreen(svg) || svgs.length >= 30) continue;
    const markup = svg.outerHTML;
    if (markup.length > 100_000) continue;
    const name =
      svg.getAttribute("aria-label") ||
      svg.querySelector("title")?.textContent ||
      svg.id ||
      svg.getAttribute("class")?.split(/\s+/)[0] ||
      `icon-${svgs.length + 1}`;
    if (svgs.some((s) => s.markup === markup)) continue;
    svgs.push({ markup, name: name.trim().slice(0, 60), width: Math.round(r.width), height: Math.round(r.height) });
  }
  // where each family is served from, when the stylesheet is readable (cross-origin ones aren't)
  const sources = new Map<string, string>();
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      const src = rule.style.getPropertyValue("src").match(/url\(["']?([^"')]+)/)?.[1];
      if (family && src && !sources.has(family)) sources.set(family, new URL(src, sheet.href ?? location.href).href);
    }
  }
  const fonts = new Map<string, Discovered["fonts"][number]>();
  for (const f of document.fonts) {
    if (f.status !== "loaded" || fonts.size >= 20) continue;
    const family = f.family.replace(/["']/g, "").trim();
    const key = `${family}|${f.weight}|${f.style}`;
    if (!fonts.has(key)) fonts.set(key, { family, weight: f.weight, style: f.style, src: sources.get(family) });
  }
  return { images: [...images.values()], svgs, fonts: [...fonts.values()], gradients: [...gradients] };
}
