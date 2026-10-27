"use client";

import { extractVariables } from "@stan-bag/core/prompt-vars";
import { TYPE_DEFS, type ResourceDTO } from "@stan-bag/core/types";
import { toast } from "sonner";
import { useUi } from "@/components/ui-store";
import { api } from "@/lib/api";
import { copyText, formatTokens } from "@/lib/clipboard";

/** Text resources copy their content (prompts ask for variables first); visual ones copy a context block. */
export function useCopyResource() {
  const { openPromptCopy } = useUi();
  return async (r: Pick<ResourceDTO, "id" | "type" | "content" | "title">) => {
    if (r.type === "prompt" && extractVariables(r.content).length) {
      openPromptCopy(r.id);
      return;
    }
    if (TYPE_DEFS[r.type].content !== "none" && r.content.trim()) {
      await copyText(r.content, `Copied “${r.title}”`);
      return;
    }
    await copyContext([r.id]);
  };
}

export async function copyContext(ids: string[], includeFullScreenshots = false) {
  try {
    const { markdown, tokens } = await api<{ markdown: string; tokens: { total: number; imageCount: number } }>(
      "/api/context",
      { method: "POST", json: { ids, includeFullScreenshots } },
    );
    await copyText(
      markdown,
      `Context copied · ~${formatTokens(tokens.total)} tokens${tokens.imageCount ? ` incl. ${tokens.imageCount} image${tokens.imageCount > 1 ? "s" : ""}` : ""}`,
    );
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not build context");
  }
}
