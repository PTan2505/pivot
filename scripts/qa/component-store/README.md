# Component store e2e (dev-only)

An end-to-end run of the component store ([docs/component-store-plan.md](../../../docs/component-store-plan.md), Phase 6). It does the agent's part over the real MCP server (`plugin/server/server.js` over stdio, as Claude Code runs it), then the owner's part in PIVOT's own page:

1. Both tools are listed, and the component isn't saved yet.
2. `save_component` right after the fetch. The install command's key becomes `$API_KEY_21ST`.
3. Two saves are refused: different code without `replaceCode`, and a command that still holds a token.
4. `save_component` again once built, with the review, the project and the support file.
5. `get_saved_component` by 21st id, page URL and PIVOT id.
6. The page:
   - **Build preview** runs the real npm, from registry.npmjs.org;
   - the live preview renders in its sandboxed frame on the preview origin, with its Tailwind styles;
   - the build folder is removed.
7. The preview origin serves that page with its CSP and no cookie, and refuses everything else.
8. A rejected component:
   - `get_saved_component` warns;
   - the page has no Build preview;
   - the API answers 400.

The component is a fixture written for this run. It contains no 21st code, and the run spends no 21st retrieval. Its 21st id, page and API key are made up. The build needs the network to install `clsx`, `tailwind-merge`, `react` and `react-dom` from registry.npmjs.org.

## Run it

It needs a **scratch** PIVOT. Before writing anything, the run checks four things (`scripts/qa/scratch-guard.mjs`) and stops if one fails:

- `PIVOT_E2E_SCRATCH=1` is set;
- the port isn't 4321;
- the data folder isn't yours, and holds the scratch marker;
- the server really uses that folder.

1. Start a scratch PIVOT. Its previews are served on its port + 1.

   ```bash
   node scripts/start.mjs --scratch /tmp/pivot-components-e2e
   ```

   To try the npm package instead:
   - `pnpm cli:build && cd apps/cli && npm pack`;
   - install the `.tgz` into an empty folder;
   - write `{"scratch":true}` to `<data dir>/pivot-scratch.json`;
   - start it with `HOME=<temp dir> node node_modules/pivot-studio/bin/pivot-studio.mjs start --data-dir <data dir> --port 4430 --no-open`.

2. Run the e2e from `packages/core`:

   ```bash
   PIVOT_URL=http://127.0.0.1:4400 PIVOT_DATA_DIR=/tmp/pivot-components-e2e PIVOT_E2E_SCRATCH=1 E2E_OUT=/tmp/pivot-components-e2e-out npx vitest run --config ../../scripts/qa/component-store/vitest.config.mjs
   ```

`E2E_OUT` receives `report.md` (one line per step) and three screenshots: the page before the build, the live preview, and the rejected component.
