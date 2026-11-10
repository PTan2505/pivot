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

It needs a **scratch** PIVOT. Never point it at your own: the run refuses port 4321, and requires
`PIVOT_E2E_SCRATCH=1`.

1. Start a scratch PIVOT with its own data folder, no Neon and no R2:

   ```bash
   env DATABASE_URL= R2_ACCOUNT_ID= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= R2_BUCKET= PIVOT_DATA_DIR=/tmp/pivot-demo-data PORT=4400 node scripts/start.mjs
   ```

2. Create its API token, once:

   ```bash
   curl -s -H "Sec-Fetch-Site: same-origin" http://127.0.0.1:4400/api/settings/token >/dev/null
   ```

3. Run the demo from `packages/mcp-tools`:

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
