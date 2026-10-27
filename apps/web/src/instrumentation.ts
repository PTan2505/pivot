export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { purgeExpiredTrash } = await import("@stan-bag/core/resources");
  const { resumePendingCaptures } = await import("@stan-bag/core/capture");
  try {
    await purgeExpiredTrash();
    await resumePendingCaptures();
  } catch (err) {
    console.error("[stan-bag] startup tasks failed:", err instanceof Error ? err.message : err);
  }
}
