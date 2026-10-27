// Rough token estimates for Claude. Text: ~4 characters per token.
// Images: Claude downsizes so the long edge is at most 1568px, then costs about width*height/750 tokens.

export const CLAUDE_MAX_IMAGE_EDGE = 1568;

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function scaledImageSize(width: number, height: number, maxEdge = CLAUDE_MAX_IMAGE_EDGE) {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function estimateImageTokens(width: number, height: number): number {
  const s = scaledImageSize(width, height);
  return Math.ceil((s.width * s.height) / 750);
}
