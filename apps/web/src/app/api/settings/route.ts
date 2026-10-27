import { databaseMode, dataDir, paths, skillsDir } from "@stan-bag/core/config";
import { storageSummary } from "@stan-bag/core/assets";
import { playwrightStatus } from "@stan-bag/core/capture";
import { storageMode, writeStore } from "@stan-bag/core/storage";
import { json, route } from "@/lib/server/http";

export const GET = route(async (req: Request) => {
  const mode = databaseMode();
  let dbTarget = paths.db();
  if (mode === "neon") {
    try {
      dbTarget = new URL(process.env.DATABASE_URL!).host;
    } catch {
      dbTarget = "DATABASE_URL";
    }
  }
  return json({
    serverUrl: `http://${req.headers.get("host") ?? "127.0.0.1:4321"}`,
    dataDir: dataDir(),
    dbMode: mode,
    dbTarget,
    skillsDir: skillsDir(),
    exportsDir: paths.exports(),
    playwright: await playwrightStatus(),
    storage: { mode: storageMode(), target: writeStore().describe(), files: await storageSummary() },
  });
});
