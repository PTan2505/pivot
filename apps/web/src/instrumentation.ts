export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { purgeExpiredTrash } = await import("@pivot/core/resources");
  const { resumePendingCaptures } = await import("@pivot/core/capture");
  const { pruneAssetCache } = await import("@pivot/core/assets");
  try {
    await purgeExpiredTrash();
    await resumePendingCaptures();
    await pruneAssetCache();
  } catch (err) {
    console.error("[pivot] startup tasks failed:", err instanceof Error ? err.message : err);
  }
}
