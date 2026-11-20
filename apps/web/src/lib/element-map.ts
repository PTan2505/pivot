/**
 * The elements of a live, script-free mockup frame, read the same way PIVOT's server reads a render
 * (`MAP_PAGE` in packages/core/src/capture.ts): every element at least 4×4 and visible, in document order, nothing
 * inside an `<svg>` (the svg itself stays), each with a CSS selector that finds exactly it (a unique id, else a
 * `tag.class:nth-of-type(k)` path from `body`). Boxes are in the frame document's own pixels, scroll included, so they
 * don't move when the page scrolls. The server checks every selector a note sends against its own map.
 */

export interface MapElement {
  i: number;
  /** The nearest ancestor in the map, or -1. */
  p: number;
  tag: string;
  id?: string;
  cls?: string[];
  text?: string;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sel: string;
}

const SKIP = new Set(["HEAD", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "TITLE", "BR", "WBR"]);
const MAX_ELEMENTS = 5000;
const MAX_HEIGHT = 12_000;

const short = (v: string | null | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 80) : undefined;
};

/** Reads the elements of `doc` (a same-origin frame's document). */
export function mapDocument(doc: Document): MapElement[] {
  const win = doc.defaultView;
  if (!doc.body || !win) return [];
  const esc = (v: string) => win.CSS.escape(v);
  const maxW = doc.documentElement.clientWidth;
  const maxH = Math.min(MAX_HEIGHT, doc.documentElement.scrollHeight);
  const sx = win.scrollX;
  const sy = win.scrollY;
  const uniqueId = (e: Element) => {
    if (!e.id) return false;
    try {
      return doc.querySelectorAll(`#${esc(e.id)}`).length === 1;
    } catch {
      return false;
    }
  };
  const sels = new Map<Element, string>();
  const selector = (e: Element): string => {
    const known = sels.get(e);
    if (known) return known;
    let sel: string;
    if (e === doc.body) sel = "body";
    else if (uniqueId(e)) sel = `#${esc(e.id)}`;
    else {
      let step = e.tagName.toLowerCase();
      const cls = [...e.classList].filter((c) => /^-?[A-Za-z_][\w-]*$/.test(c)).slice(0, 2);
      step += cls.map((c) => `.${esc(c)}`).join("");
      const parent = e.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === e.tagName);
        if (same.length > 1) step += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      sel = parent && parent !== doc.documentElement ? `${selector(parent)} > ${step}` : step;
    }
    sels.set(e, sel);
    return sel;
  };
  const raw: (Omit<MapElement, "i" | "p"> & { parent: number; depth: number })[] = [];
  const walk = (e: Element, parent: number, depth: number) => {
    for (const c of e.children) {
      if (SKIP.has(c.tagName)) continue;
      const r = c.getBoundingClientRect();
      const x = Math.max(0, r.left + sx);
      const y = Math.max(0, r.top + sy);
      const w = Math.min(maxW, r.right + sx) - x;
      const h = Math.min(maxH, r.bottom + sy) - y;
      const shown = w >= 4 && h >= 4 && win.getComputedStyle(c).visibility !== "hidden";
      let me = parent;
      if (shown) {
        me = raw.length;
        const own = short(
          [...c.childNodes]
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent)
            .join(" "),
        );
        const label = short(
          c.getAttribute("aria-label") ||
            c.getAttribute("alt") ||
            c.getAttribute("placeholder") ||
            c.getAttribute("title"),
        );
        const cls = [...c.classList].slice(0, 3).map((k) => k.slice(0, 60));
        raw.push({
          parent,
          depth,
          tag: c.tagName.toLowerCase(),
          ...(c.id ? { id: c.id.slice(0, 80) } : {}),
          ...(cls.length ? { cls } : {}),
          ...(own ? { text: own } : {}),
          ...(label ? { label } : {}),
          x: Math.round(x),
          y: Math.round(y),
          w: Math.round(w),
          h: Math.round(h),
          sel: selector(c),
        });
      }
      if (c.tagName.toLowerCase() !== "svg") walk(c, me, shown ? depth + 1 : depth);
    }
  };
  walk(doc.body, -1, 0);
  // keep the shallowest elements of a very large page, in document order, parents renumbered
  let keep = raw.map((_, i) => i);
  if (raw.length > MAX_ELEMENTS)
    keep = keep
      .sort((a, b) => raw[a].depth - raw[b].depth || a - b)
      .slice(0, MAX_ELEMENTS)
      .sort((a, b) => a - b);
  const renumber = new Map(keep.map((old, i) => [old, i]));
  return keep.map((old, i) => {
    const { parent, ...e } = raw[old];
    delete (e as { depth?: number }).depth;
    return { i, p: parent >= 0 ? (renumber.get(parent) ?? -1) : -1, ...e };
  });
}

/** The deepest element at a point: the smallest box holding it (a later one wins a tie, being nested deeper). */
export function hitAt(els: MapElement[], x: number, y: number) {
  let best = -1;
  let area = Infinity;
  for (const e of els)
    if (x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h && e.w * e.h <= area) {
      area = e.w * e.h;
      best = e.i;
    }
  return best;
}

/**
 * What PIVOT's full-screen frame shows: the version's HTML as a script-free page PIVOT's own page can read. A CSP comes
 * first and blocks every request (only inline styles and `data:` images and fonts load); a meta refresh is dropped, so
 * nothing navigates the frame by itself; the doctype keeps it in standards mode, as the server renders it.
 */
export function frameDocument(html: string) {
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri 'none'";
  const body = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "");
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}">${body.replace(/^\s*<!doctype[^>]*>/i, "")}`;
}
