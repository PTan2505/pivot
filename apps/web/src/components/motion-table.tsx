"use client";

import type { AssetDTO } from "@pivot/core/types";
import {
  isInteraction,
  MOTION_TABLE_INTERACTIONS,
  MOTION_TABLE_ITEMS,
  timingText,
  type MotionItem,
  type MotionTrack,
} from "@pivot/core/motion-track";
import { useQuery } from "@tanstack/react-query";
import { assetUrl } from "@/lib/api";

const SOURCE: Record<MotionItem["source"], string> = { exact: "exact", measured: "measured", seen: "seen" };

const triggerText = (t: MotionItem["trigger"]) =>
  t.kind === "hover" || t.kind === "click"
    ? t.on
      ? `${t.kind} on ${t.on.name} →`
      : t.kind
    : t.kind === "load"
      ? "load"
      : t.kind === "always"
        ? "always"
        : t.spread
          ? `scroll@${t.spread[0]}…${t.spread[1]}`
          : t.from !== undefined
            ? `scroll ${t.from}–${t.to}`
            : `scroll@${t.at ?? 0}`;

/**
 * The motion table of a recording ("Record motion"), read-only: the same items Claude reads through MCP, in the same
 * order, with their filmstrips. Folded like the capture history.
 */
export function MotionTable({ assets }: { assets: AssetDTO[] }) {
  const trackAsset = assets.find((a) => a.role === "motion-track" && !a.missing);
  const { data: track } = useQuery({
    queryKey: ["motion-track", trackAsset?.id],
    enabled: !!trackAsset,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(assetUrl(trackAsset!.id));
      const json = (await res.json()) as MotionTrack;
      return json?.version === 1 && Array.isArray(json.items) ? json : null;
    },
  });
  if (!trackAsset || !track) return null;
  const strips = new Map(
    assets
      .filter((a) => a.role === "motion-strip" && !a.missing && typeof a.meta?.item === "string")
      .map((a) => [a.meta!.item as string, a]),
  );
  const scroll = track.items.filter((it) => !isInteraction(it));
  const pointer = track.items.filter(isInteraction);
  return (
    <details className="text-xs text-ink-muted">
      <summary className="w-fit cursor-pointer rounded-full px-2 py-1 hover:text-ink">
        Motion table ({track.itemsTotal})
      </summary>
      <p className="mt-2 px-2 text-[13px]">
        Measured while scrolling at {track.viewport.width}×{track.viewport.height}
        {track.libraries.length ? ` · ${track.libraries.join(", ")}` : ""}. <span className="text-ink">exact</span> is
        declared by the page, <span className="text-ink">measured</span> fitted from frames,{" "}
        <span className="text-ink">seen</span> only in pixels.
      </p>
      <ol className="mt-2 space-y-0.5">
        {scroll.map((it, i) => (
          <MotionRow
            key={it.key}
            item={it}
            strip={strips.get(it.id)}
            note={i === MOTION_TABLE_ITEMS ? "Claude reads the items above; the ones below are only counted." : null}
          />
        ))}
        {pointer.map((it, i) => (
          <MotionRow
            key={it.key}
            item={it}
            strip={strips.get(it.id)}
            note={
              i === 0
                ? "Hover and click: a sample, one element of each kind was tried."
                : i === MOTION_TABLE_INTERACTIONS
                  ? `Claude reads the first ${MOTION_TABLE_INTERACTIONS} of these; the rest are only counted.`
                  : null
            }
          />
        ))}
      </ol>
      {track.items.length < track.itemsTotal && (
        <p className="mt-2 px-2 text-ink-subtle">
          {track.itemsTotal - track.items.length} more items weren&apos;t kept.
        </p>
      )}
      <ul className="mt-2 list-disc space-y-0.5 pl-6 text-ink-subtle">
        {track.limits.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </details>
  );
}

function MotionRow({ item: it, strip, note }: { item: MotionItem; strip?: AssetDTO; note: string | null }) {
  const changes = it.changes
    .map((c) => `${c.property} ${c.values.length === 1 ? `→${c.values[0]}` : c.values.join("→")}`)
    .join("; ");
  const times = Array.isArray(strip?.meta?.times) ? (strip!.meta!.times as number[]) : [];
  return (
    <>
      {note && <li className="px-2 pt-2 pb-1 text-ink-subtle">{note}</li>}
      <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-[10px] bg-surface px-3 py-2">
        <span className="font-mono text-ink-subtle tabular-nums">{it.id}</span>
        <span className="font-mono text-ink-muted tabular-nums">{triggerText(it.trigger)}</span>
        <span className="max-w-full min-w-0 truncate text-ink">
          {it.target.count > 1 ? `${it.target.count}× ` : ""}
          {it.target.name}
        </span>
        <span className="max-w-full min-w-0 truncate font-mono text-ink-subtle">{it.target.selector}</span>
        <span className="ml-auto rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-ink-secondary">
          {SOURCE[it.source]}
          {it.source !== "measured" ? ` · ${it.via}` : ""}
        </span>
        <span className="basis-full text-ink-secondary">{[changes, timingText(it)].filter(Boolean).join(" · ")}</span>
        {strip && (
          <details className="basis-full">
            <summary className="w-fit cursor-pointer rounded-full text-ink-muted hover:text-ink">Filmstrip</summary>
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored asset at its own size */}
            <img
              src={assetUrl(strip.id)}
              alt={`Filmstrip of ${it.id}: frames ${times.length ? `at +${times.join(", +")} ms` : "in order"}`}
              className="mt-2 h-auto max-w-full rounded-[8px]"
              width={strip.width ?? undefined}
              height={strip.height ?? undefined}
              loading="lazy"
            />
          </details>
        )}
      </li>
    </>
  );
}
