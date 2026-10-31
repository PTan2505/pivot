import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Mask } from "../lib/redact";
import { Button, cx } from "../ui";

/**
 * Masks over a screenshot before it is uploaded. Suggested boxes (filled fields, emails, amounts) start on and can be
 * switched off; drag on the picture to add a box, or press "Add a box" and move it with the arrow keys (Shift+arrows
 * resize, Delete removes). The boxes are painted into the pixels on upload; the preview shows exactly that.
 */
export function RedactEditor({
  image,
  width,
  masks,
  onChange,
}: {
  image: Blob;
  /** The screenshot's width in the page's CSS pixels: the unit the masks use. */
  width: number;
  masks: Mask[];
  onChange: (masks: Mask[]) => void;
}) {
  const url = useMemo(() => URL.createObjectURL(image), [image]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const frame = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(368);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const scale = shown / (width || shown);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setShown(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const update = (id: string, patch: Partial<Mask>) =>
    onChange(masks.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const remove = (id: string) => onChange(masks.filter((m) => m.id !== id));
  const add = (box: Omit<Mask, "id" | "on" | "origin">) =>
    onChange([...masks, { ...box, id: `d${Date.now()}`, on: true, origin: "drawn", label: "your box" }]);

  return (
    <div className="space-y-2">
      <div
        ref={frame}
        className="relative cursor-crosshair touch-none overflow-hidden rounded-[12px] bg-surface select-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.mask) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = point(e);
          setDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y });
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, ...((p) => ({ x2: p.x, y2: p.y }))(point(e)) })}
        onPointerUp={() => {
          if (drag) {
            const box = {
              x: Math.min(drag.x, drag.x2),
              y: Math.min(drag.y, drag.y2),
              width: Math.abs(drag.x2 - drag.x),
              height: Math.abs(drag.y2 - drag.y),
            };
            if (box.width > 4 && box.height > 4) add(box);
          }
          setDrag(null);
        }}
      >
        <img
          src={url}
          alt="The screenshot to upload, with the masks drawn over it"
          className="block w-full"
          draggable={false}
        />
        {masks
          .filter((m) => m.on)
          .map((m) => (
            <button
              key={m.id}
              type="button"
              data-mask
              aria-label={`Mask: ${m.label ?? "box"}. Arrow keys move it, Shift+arrows resize, Delete removes`}
              className="absolute bg-black outline-2 outline-offset-1 outline-transparent focus-visible:outline-accent-text"
              style={{ left: m.x * scale, top: m.y * scale, width: m.width * scale, height: m.height * scale }}
              onKeyDown={(e) => {
                const step = e.altKey ? 1 : 8;
                const keys: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                if (e.key === "Delete" || e.key === "Backspace") {
                  e.preventDefault();
                  if (m.origin === "drawn") remove(m.id);
                  else update(m.id, { on: false });
                  return;
                }
                const d = keys[e.key];
                if (!d) return;
                e.preventDefault();
                if (e.shiftKey) {
                  update(m.id, { width: Math.max(8, m.width + d[0]), height: Math.max(8, m.height + d[1]) });
                } else update(m.id, { x: m.x + d[0], y: m.y + d[1] });
              }}
            />
          ))}
        {drag && (
          <span
            className="pointer-events-none absolute border-2 border-accent-text bg-black/60"
            style={{
              left: Math.min(drag.x, drag.x2) * scale,
              top: Math.min(drag.y, drag.y2) * scale,
              width: Math.abs(drag.x2 - drag.x) * scale,
              height: Math.abs(drag.y2 - drag.y) * scale,
            }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Button
          type="button"
          variant="outline"
          className="h-7 px-2.5 text-xs"
          onClick={() => add({ x: width / 2 - 80, y: 40, width: 160, height: 40 })}
        >
          <Plus /> Add a box
        </Button>
        <span className="text-ink-muted">or drag on the picture.</span>
      </div>
      {masks.length > 0 && (
        <ul className="space-y-1" aria-label="Masks">
          {masks.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-xs">
              <label className={cx("flex flex-1 cursor-pointer items-center gap-2", !m.on && "text-ink-muted")}>
                <input
                  type="checkbox"
                  checked={m.on}
                  onChange={(e) => update(m.id, { on: e.target.checked })}
                  className="accent-[var(--accent-fill)]"
                />
                {m.origin === "suggested" ? `Suggested: ${m.label}` : "Your box"}
              </label>
              {m.origin === "drawn" && (
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  aria-label="Remove this box"
                  className="grid size-6 cursor-pointer place-items-center rounded-full text-ink-muted hover:text-ink"
                >
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
