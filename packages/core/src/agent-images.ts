import sharp from "sharp";

/**
 * Screenshots prepared for an agent (MCP `get_reference_images`). The app does this, not the MCP server, so the MCP
 * server stays a plain HTTP client with no native image library.
 */

/** Claude scales anything with a longer edge down to this, so larger images only cost upload time. */
export const MAX_EDGE = 1568;
/** Full pages are read in slices this wide: legible, and about 2,000 tokens a slice. */
const SLICE_WIDTH = 960;

export interface AgentImage {
  data: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

export interface AgentSlices {
  slices: (AgentImage & { fromY: number; toY: number })[];
  /** How many slices the whole page makes, and its size in page pixels. */
  total: number;
  pageWidth: number;
  pageHeight: number;
}

const jpeg = (img: ReturnType<typeof sharp>) =>
  img.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });

/** A screenshot shrunk to fit the edge Claude reads at. */
export async function fitForAgent(data: Buffer): Promise<AgentImage> {
  const { data: out, info } = await jpeg(
    sharp(data, { animated: false, limitInputPixels: false }).resize(MAX_EDGE, MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    }),
  );
  return { data: out, mimeType: "image/jpeg", width: info.width, height: info.height };
}

/**
 * A full-page shot read top to bottom: scaled to 960px wide and cut into 1568px-tall slices. Returns `count` slices
 * from `from`; `fromY`/`toY` say which part of the page (in page pixels) each one shows.
 */
export async function sliceForAgent(data: Buffer, from: number, count: number): Promise<AgentSlices> {
  const meta = await sharp(data, { limitInputPixels: false }).metadata();
  const pageWidth = meta.width ?? 0;
  const pageHeight = meta.height ?? 0;
  const scale = Math.min(1, SLICE_WIDTH / pageWidth);
  const scaled = await sharp(data, { limitInputPixels: false })
    .resize(Math.round(pageWidth * scale))
    .toBuffer({ resolveWithObject: true });
  const { width, height } = scaled.info;
  const total = Math.max(1, Math.ceil(height / MAX_EDGE));
  const slices: AgentSlices["slices"] = [];
  for (let i = from; i < Math.min(total, from + count); i++) {
    const top = i * MAX_EDGE;
    const h = Math.min(MAX_EDGE, height - top);
    const { data: out, info } = await jpeg(sharp(scaled.data).extract({ left: 0, top, width, height: h }));
    slices.push({
      data: out,
      mimeType: "image/jpeg",
      width: info.width,
      height: info.height,
      fromY: Math.round(top / scale),
      toY: Math.round((top + h) / scale),
    });
  }
  return { slices, total, pageWidth, pageHeight };
}
