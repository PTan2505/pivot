import fs from "node:fs/promises";
import path from "node:path";
import { getAsset, readAssetBytes } from "./assets";
import { expandHome, paths } from "./config";
import { getResource } from "./resources";
import { TAG_KIND_LABELS, TYPE_DEFS } from "./types";

export class ShareError extends Error {}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A read-only package of chosen references to hand to someone: a folder with an index.html gallery, the Latest
 * screenshots and a share.json. Notes, annotations and pages saved as private are left out unless asked for; nothing
 * else of the library (other items, settings, the token) is in it. There is no public link: PIVOT only answers this
 * machine, so the folder is what you share, and once copied it can't be taken back.
 */
export async function createSharePackage(
  ids: string[],
  {
    targetDir,
    title = "Shared references",
    includeNotes = false,
    includePrivate = false,
  }: { targetDir?: string; title?: string; includeNotes?: boolean; includePrivate?: boolean } = {},
) {
  if (!ids.length) throw new ShareError("Choose at least one reference.");
  const raw = (targetDir ?? paths.exports()).trim();
  if (!raw.startsWith("~") && !path.isAbsolute(raw)) throw new ShareError("Choose an absolute folder path.");
  const root = path.join(
    path.resolve(expandHome(raw)),
    `pivot-share-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  await fs.mkdir(path.join(root, "images"), { recursive: true });
  const items: Record<string, unknown>[] = [];
  const left: { id: string; title: string; why: string }[] = [];
  for (const id of ids) {
    const r = await getResource(id);
    if (!r || r.deletedAt) continue;
    if (r.meta.privatePage === true && !includePrivate) {
      left.push({ id, title: r.title, why: "saved from a private page" });
      continue;
    }
    const images: string[] = [];
    for (const a of r.assets.filter(
      (x) => x.role === "screenshot" || x.role === "screenshot-full" || x.role === "state",
    )) {
      const row = await getAsset(a.id);
      const bytes = row && (await readAssetBytes(row));
      if (!row || !bytes) continue;
      const name = `${items.length + 1}-${a.role}${path.extname(row.storagePath) || ".webp"}`;
      await fs.writeFile(path.join(root, "images", name), bytes);
      images.push(`images/${name}`);
    }
    items.push({
      title: r.title,
      type: TYPE_DEFS[r.type]?.label ?? r.type,
      url: r.sourceUrl,
      description: r.description,
      facets: r.tags.filter((t) => t.kind !== "tag").map((t) => `${TAG_KIND_LABELS[t.kind]}: ${t.name}`),
      ...(includeNotes ? { notes: r.notes, annotations: r.annotations ?? [] } : {}),
      images,
    });
  }
  if (!items.length) throw new ShareError("Nothing to share: every chosen item was left out.");
  await fs.writeFile(
    path.join(root, "share.json"),
    JSON.stringify({ format: "pivot-share", version: 1, title, createdAt: new Date().toISOString(), items }, null, 2),
  );
  const cards = items
    .map((it) => {
      const i = it as {
        title: string;
        type: string;
        url: string | null;
        description: string;
        facets: string[];
        images: string[];
        notes?: string;
      };
      return `<article><h2>${esc(i.title)}</h2><p class="meta">${esc(i.type)}${i.url ? ` · <a href="${esc(i.url)}" rel="noreferrer">${esc(i.url)}</a>` : ""}</p>${
        i.description ? `<p>${esc(i.description)}</p>` : ""
      }${i.facets.length ? `<p class="meta">${esc(i.facets.join(" · "))}</p>` : ""}${i.notes ? `<p>${esc(i.notes)}</p>` : ""}${i.images
        .map((src) => `<img src="${esc(src)}" alt="Screenshot of ${esc(i.title)}" loading="lazy">`)
        .join("")}</article>`;
    })
    .join("\n");
  await fs.writeFile(
    path.join(root, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;padding:24px 16px;background:#0c0806;color:#fbf3ea;font:16px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:auto}h1{font-weight:500}article{background:#18110d;border-radius:14px;padding:16px;margin:0 0 24px}h2{margin:0 0 4px;font-weight:500}.meta{color:#bcae9f;font-size:14px}a{color:#ff8c42}img{display:block;width:100%;margin-top:12px;border-radius:10px}</style>
<main><h1>${esc(title)}</h1><p class="meta">${items.length} reference${items.length > 1 ? "s" : ""} from PIVOT, ${new Date().toLocaleDateString("en")}. Screenshots of other people's work: for reference, not reuse.</p>
${cards}</main></html>`,
  );
  return { path: root, shared: items.length, left };
}
