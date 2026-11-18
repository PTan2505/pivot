/**
 * Screenshots as the agent receives them. The app shrinks and slices them (`GET /api/assets/[id]/agent`), so this
 * package needs no image library.
 */
export interface ImagePart {
  data: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

export interface PageSlices {
  slices: (ImagePart & { fromY: number; toY: number })[];
  /** How many slices the whole page makes, and its size in page pixels. */
  total: number;
  pageWidth: number;
  pageHeight: number;
}

/** Roughly how many tokens Claude spends on an image of this size. */
export const imageTokens = (width: number, height: number) => Math.ceil((width * height) / 750);
