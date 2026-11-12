import { z } from "zod";
import { enqueueCapture } from "@pivot/core/capture";
import { fetchUrlMetadata } from "@pivot/core/metadata";
import { normalizeUrl } from "@pivot/core/net-guard";
import { createResource, findByUrl } from "@pivot/core/resources";
import { knownSourceFor } from "@pivot/core/source-match";
import { RESOURCE_TYPES, TAG_KINDS } from "@pivot/core/types";
import { body, json, route } from "@/lib/server/http";

const schema = z.object({
  type: z.enum(RESOURCE_TYPES).default("reference"),
  items: z
    .array(
      z.object({
        url: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1)
    .max(100),
  tags: z.array(z.object({ kind: z.enum(TAG_KINDS), name: z.string() })).optional(),
  capture: z.boolean().default(true),
  skipDuplicates: z.boolean().default(false),
});

/** Creates one resource per URL. Titles are fetched when not supplied; screenshots run in the background. */
export const POST = route(async (req: Request) => {
  const input = schema.parse(await body(req));
  const created: string[] = [];
  const skipped: { url: string; reason: string }[] = [];
  for (const item of input.items) {
    let url: string;
    try {
      url = normalizeUrl(item.url);
    } catch {
      skipped.push({ url: item.url, reason: "Invalid URL" });
      continue;
    }
    if (input.skipDuplicates && (await findByUrl(url)).length) {
      skipped.push({ url, reason: "Already in the library" });
      continue;
    }
    let title = item.title?.trim();
    let description = item.description?.trim();
    // A known source brings its own description (see createResource); otherwise read the page's.
    const wantsDescription = !description && !(input.type === "source" && knownSourceFor(url));
    if (!title || wantsDescription) {
      // Also when Save was pressed before the dialog finished reading the page.
      const meta = await fetchUrlMetadata(url).catch(() => null);
      title ||= meta?.title || new URL(url).hostname.replace(/^www\./, "");
      if (wantsDescription) description = meta?.description ?? "";
    }
    const r = await createResource({
      type: input.type,
      title,
      description: description ?? "",
      notes: item.notes ?? "",
      sourceUrl: url,
      tags: input.tags,
    });
    created.push(r.id);
    if (input.capture) await enqueueCapture(r.id);
  }
  return json({ created, skipped }, { status: 201 });
});
