export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { purgeExpiredTrash } = await import("@pivot/core/resources");
  const { resumePendingCaptures } = await import("@pivot/core/capture");
  const { pruneAssetCache } = await import("@pivot/core/assets");
  const { apiToken } = await import("@pivot/core/api-token");
  // the preview origin: component previews run third-party code, so they never run on PIVOT's own origin
  const { startPreviewServer } = await import("@pivot/core/preview-server");
  startPreviewServer();
  try {
    // the MCP server and the extension read it from the data folder; create it now, not when Settings is first opened
    apiToken();
    await purgeExpiredTrash();
    await resumePendingCaptures();
    await pruneAssetCache();
  } catch (err) {
    console.error("[pivot] startup tasks failed:", err instanceof Error ? err.message : err);
  }
}
