// The entry of builder/build.mjs, the script the builder repo's workflow runs (`node build.mjs`, with PIVOT_JOB_URL set
// from the run's `job` input). The build itself is in builder-runner.ts.
import path from "node:path";
import { runWireJob } from "./builder-runner";

const url = process.env.PIVOT_JOB_URL;
if (!url) {
  console.error("PIVOT_JOB_URL is not set: this script runs from the builder workflow.");
  process.exit(1);
}
runWireJob(url, { workDir: path.resolve("work") }).then(
  (r) => console.log(r.ok ? `Built the preview (${r.bytes} bytes, ${r.ms} ms).` : `The build failed: ${r.error}`),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
