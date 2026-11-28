export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { purgeExpiredTrash } = await import("@pivot/core/resources");
  const { resumePendingCaptures } = await import("@pivot/core/capture");
  const { pruneAssetCache } = await import("@pivot/core/assets");
  const { apiToken } = await import("@pivot/core/api-token");
  const { resumePreviewBuilds } = await import("@pivot/core/preview-build");
  // the preview origin: component previews run third-party code, so they never run on PIVOT's own origin
  const { startPreviewServer } = await import("@pivot/core/preview-server");
  startPreviewServer();
  try {
    // the MCP server and the extension read it from the data folder; create it now, not when Settings is first opened
    apiToken();
    await purgeExpiredTrash();
    await resumePendingCaptures();
    // previews that were building when PIVOT stopped: a cloud build is waited for again, a local one restarts. Not
    // awaited: starting a cloud build calls GitHub, and the app shouldn't wait for that before it serves.
    void resumePreviewBuilds().catch((err) =>
      console.error("[pivot] resuming preview builds failed:", err instanceof Error ? err.message : err),
    );
    await pruneAssetCache();
  } catch (err) {
    console.error("[pivot] startup tasks failed:", err instanceof Error ? err.message : err);
  }
}
