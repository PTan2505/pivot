"use client";

import type { ResourceType } from "@stan-bag/core/types";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface ExportTarget {
  ids: string[];
  name: string;
}

interface AddUrlState {
  open: boolean;
  urls: string[];
  type?: ResourceType;
}

interface UiStore {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  addUrl: AddUrlState;
  openAddUrl: (urls?: string[], type?: ResourceType) => void;
  closeAddUrl: () => void;
  exportTarget: ExportTarget | null;
  openExport: (target: ExportTarget) => void;
  closeExport: () => void;
  promptResourceId: string | null;
  openPromptCopy: (id: string) => void;
  closePromptCopy: () => void;
}

const Ctx = createContext<UiStore | null>(null);

/** App-wide dialogs that can be opened from the command palette, paste handler or any page. */
export function UiProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addUrl, setAddUrl] = useState<AddUrlState>({ open: false, urls: [] });
  const [exportTarget, setExportTarget] = useState<ExportTarget | null>(null);
  const [promptResourceId, setPromptResourceId] = useState<string | null>(null);

  const openAddUrl = useCallback((urls: string[] = [], type?: ResourceType) => setAddUrl({ open: true, urls, type }), []);
  const closeAddUrl = useCallback(() => setAddUrl({ open: false, urls: [] }), []);

  const value = useMemo<UiStore>(
    () => ({
      paletteOpen,
      setPaletteOpen,
      addUrl,
      openAddUrl,
      closeAddUrl,
      exportTarget,
      openExport: setExportTarget,
      closeExport: () => setExportTarget(null),
      promptResourceId,
      openPromptCopy: setPromptResourceId,
      closePromptCopy: () => setPromptResourceId(null),
    }),
    [paletteOpen, addUrl, openAddUrl, closeAddUrl, exportTarget, promptResourceId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi must be used inside UiProvider");
  return v;
}
