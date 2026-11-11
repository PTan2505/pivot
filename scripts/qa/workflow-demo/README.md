# Workflow demo (dev-only)

An end-to-end run of the `pivot-design` workflow on a synthetic project, **Kettle & Leaf**, a fictional tea
subscription landing page. It goes from requirements, through references (gate 1), mockups, the interactive preview
and approval (gate 2), to implementation and QA, and covers the failure paths along the way. It drives:

- the real MCP tools (`packages/mcp-tools`), over the MCP server's `HttpSource`;
- the real preview (`pivot-design/scripts/preview.mjs`);
- the real watcher (`wait-for-decision.mjs`);
- motion QA (`motion-qa.mjs`);
- axe-core.

**TEST-ONLY:** both gates belong to the owner. The run sets the scratch instance's owner passphrase itself, with the CLI (`scripts/owner-passphrase.mjs --stdin`); it never touches your real one. Here, gate 1 is a fixture (the references the "owner" picked). Gate 2
is clicked in PIVOT's own session page by the test, the way the owner would. The report labels both. A passing run
proves the mechanics; it doesn't prove that a real owner approved anything.

## What is here

| Folder            | What                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brief.md`        | The requirements and Motion block                                                                                                                                                                                           |
| `references/`     | Three synthetic reference pages, captured and uploaded as references                                                                                                                                                        |
| `mockups/`        | Three directions. 1 and 2 are static. 3 is interactive: menu drawer, billing switch, tabs and entrance motion, with a reduced-motion fallback. They share `shared.css`, `logo.svg` and `live.js`, which the inliner inlines |
| `broken/`         | A mockup that reaches outside its folder, which must be refused                                                                                                                                                             |
| `target/`         | The target project before the work: tokens, conventions, a placeholder page                                                                                                                                                 |
| `implementation/` | What the implementing agent wrote into the target after version 3 was approved                                                                                                                                              |
| `workflow.e2e.ts` | The run                                                                                                                                                                                                                     |

## Run it

It needs a **scratch** PIVOT. Before writing anything, the run checks (`scripts/qa/scratch-guard.mjs`):

- `PIVOT_E2E_SCRATCH=1`;
- not port 4321, and not your data folder;
- the scratch marker in `PIVOT_DATA_DIR`;
- that the server really uses that folder.

It stops otherwise.

1. Start a scratch PIVOT. It never reads `.env` (no Neon, no R2), refuses your data folder and port 4321, and leaves a
   marker the run checks:

   ```bash
   node scripts/start.mjs --scratch /tmp/pivot-demo-data
   ```

2. Run the demo from `packages/mcp-tools`:

   ```bash
   PIVOT_URL=http://127.0.0.1:4400 PIVOT_DATA_DIR=/tmp/pivot-demo-data PIVOT_E2E_SCRATCH=1 E2E_OUT=/tmp/pivot-demo-out npx vitest run --config ../../scripts/qa/workflow-demo/vitest.config.mjs
   ```

`E2E_OUT` receives:

- `report.md`, one line per stage;
- screenshots of the preview, PIVOT's session page, and the build next to the approved mockup;
- the motion QA reports (`motion-qa/`, `motion-qa-broken/`).

To try the preview window yourself after a run, use the session id from `report.md`:

```bash
node .claude/skills/pivot-design/scripts/preview.mjs <sessionId> --url http://127.0.0.1:4400
```
