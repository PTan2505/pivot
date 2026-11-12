"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { AnnotationDTO, AssetDTO } from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, assetUrl, useInvalidate } from "@/lib/api";
import { cn } from "@/lib/utils";

type Box = Pick<AnnotationDTO, "x" | "y" | "width" | "height">;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Notes on places in a screenshot: drag for a box, click for a pin, then write the note in the list. Positions are
 * fractions of the image, so they stay put at any size. A layer over the picture: its pixels never change.
 * Keyboard: "Add a box", then arrow keys move the focused marker (Shift+arrows resize, Delete removes).
 */
export function AnnotationLayer({
  resourceId,
  asset,
  annotations,
}: {
  resourceId: string;
  asset: AssetDTO;
  annotations: AnnotationDTO[];
}) {
  const invalidate = useInvalidate();
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  // positions being moved with the keyboard, saved when the key is released
  const [moving, setMoving] = useState<Record<string, Box>>({});
  const mine = annotations.filter((a) => a.assetId === asset.id);

  const point = (e: React.PointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const call = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      invalidate(resourceId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the note");
    }
  };
  const add = (box: Box, kind: "pin" | "region") =>
    call(() =>
      api(`/api/resources/${resourceId}/annotations`, {
        method: "POST",
        json: { assetId: asset.id, kind, ...box, note: "" },
      }),
    );
  const save = (id: string, patch: Partial<AnnotationDTO>) =>
    call(() => api(`/api/annotations/${id}`, { method: "PATCH", json: patch }));
  const remove = (id: string) => call(() => api(`/api/annotations/${id}`, { method: "DELETE" }));

  return (
    <div className="space-y-3">
      <div
        ref={frame}
        className="relative cursor-crosshair touch-none overflow-hidden rounded-[14px] bg-surface select-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.marker) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = point(e);
          setDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y });
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, ...((p) => ({ x2: p.x, y2: p.y }))(point(e)) })}
        onPointerUp={() => {
          if (!drag) return;
          const box = {
            x: Math.min(drag.x, drag.x2),
            y: Math.min(drag.y, drag.y2),
            width: Math.abs(drag.x2 - drag.x),
            height: Math.abs(drag.y2 - drag.y),
          };
          setDrag(null);
          if (box.width > 0.01 && box.height > 0.01) void add(box, "region");
          else void add({ x: drag.x, y: drag.y, width: 0, height: 0 }, "pin");
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(asset.id)} alt="" className="block w-full" draggable={false} />
        {mine.map((a, i) => {
          const b = moving[a.id] ?? a;
          return (
            <button
              key={a.id}
              type="button"
              data-marker
              aria-label={`Note ${i + 1}: ${a.note || "no text yet"}. Arrow keys move it, Shift+arrows resize, Delete removes`}
              className={cn(
                "absolute grid place-items-center outline-2 outline-offset-1 outline-transparent focus-visible:outline-accent-text",
                a.kind === "pin"
                  ? "size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary font-mono text-[11px] text-primary-foreground"
                  : "rounded-[4px] border-2 border-primary bg-primary/10",
              )}
              style={{
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                ...(a.kind === "region" ? { width: `${b.width * 100}%`, height: `${b.height * 100}%` } : {}),
              }}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  void remove(a.id);
                  return;
                }
                const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
                if (!d) return;
                e.preventDefault();
                const step = 0.01;
                const next = e.shiftKey
                  ? { ...b, width: clamp(b.width + d[0] * step), height: clamp(b.height + d[1] * step) }
                  : { ...b, x: clamp(b.x + d[0] * step), y: clamp(b.y + d[1] * step) };
                setMoving((m) => ({ ...m, [a.id]: next }));
              }}
              onKeyUp={() => {
                const next = moving[a.id];
                if (next) void save(a.id, next);
              }}
            >
              {a.kind === "pin" ? (
                i + 1
              ) : (
                <span className="absolute -top-2.5 -left-2.5 grid size-5 place-items-center rounded-full bg-primary font-mono text-[11px] text-primary-foreground">
                  {i + 1}
                </span>
              )}
            </button>
          );
        })}
        {drag && (
          <span
            className="pointer-events-none absolute rounded-[4px] border-2 border-primary bg-primary/10"
            style={{
              left: `${Math.min(drag.x, drag.x2) * 100}%`,
              top: `${Math.min(drag.y, drag.y2) * 100}%`,
              width: `${Math.abs(drag.x2 - drag.x) * 100}%`,
              height: `${Math.abs(drag.y2 - drag.y) * 100}%`,
            }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <Button
          size="xs"
          variant="secondary"
          onClick={() => add({ x: 0.4, y: 0.1, width: 0.2, height: 0.1 }, "region")}
        >
          <Plus /> Add a box
        </Button>
        Drag on the picture for a box, click for a pin. Notes stay a layer; the picture isn’t changed.
      </div>
      {mine.length > 0 && (
        <ol className="space-y-1.5" aria-label="Notes on this screenshot">
          {mine.map((a, i) => (
            <li key={a.id} className="flex items-center gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-raised font-mono text-[11px]">
                {i + 1}
              </span>
              <Input
                defaultValue={a.note}
                placeholder={a.author === "agent" ? "Agent note" : "What to look at here…"}
                aria-label={`Note ${i + 1}`}
                className="h-8 text-xs"
                onBlur={(e) => e.target.value !== a.note && void save(a.id, { note: e.target.value })}
              />
              {a.author === "agent" && <span className="text-[11px] text-ink-subtle">agent</span>}
              <Button size="icon-xs" variant="ghost" aria-label={`Remove note ${i + 1}`} onClick={() => remove(a.id)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
