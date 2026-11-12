import type { Box } from "./page";

export interface Mask extends Box {
  id: string;
  on: boolean;
  /** "suggested" from the page, "drawn" by you. */
  origin: "suggested" | "drawn";
}

export function masksFrom(suggestions: Box[] = []): Mask[] {
  return suggestions.map((b, i) => ({ ...b, id: `s${i}`, on: true, origin: "suggested" }));
}

/**
 * Paints the masks as solid black boxes into the screenshot's pixels, so the hidden parts never leave this computer.
 * Boxes are in the page's CSS pixels; the screenshot can be larger (device pixel ratio), so they are scaled.
 */
export async function redact(image: Blob, masks: Mask[], viewportWidth: number): Promise<Blob> {
  const active = masks.filter((m) => m.on);
  if (!active.length) return image;
  const bitmap = await createImageBitmap(image);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const scale = bitmap.width / (viewportWidth || bitmap.width);
  ctx.fillStyle = "#000";
  // a few pixels of margin, so antialiased edges of the text don't show
  for (const m of active)
    ctx.fillRect((m.x - 2) * scale, (m.y - 2) * scale, (m.width + 4) * scale, (m.height + 4) * scale);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
}
