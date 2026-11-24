# My designs e2e (dev-only)

An end-to-end run of My designs, Phase 2 ([docs/my-designs-plan.md](../../../docs/my-designs-plan.md)). It does the agent's part over the real MCP server (`plugin/server/server.js` over stdio, as Claude Code runs it):

1. Both tools are listed, and the design isn't saved yet.
2. Two saves are refused before anything is saved: a link to a file outside the project, and an environment file.
3. `save_my_design` reads the three code files from disk and uploads the SVG, the desktop and phone screenshots and the video.
4. Different code without `replaceCode` is refused (409); the same code again doesn't send the SVG again.
5. `get_my_design` with `writeTo` writes the files and the SVG into another folder, and their sha256 equal the originals'.
6. `writeTo` over a folder where `tokens.css` differs writes nothing and lists it.
7. `search_references` finds it with the `organisation` filter (any case), not with another organisation, and marks it "Yours"; `get_reference` points to `get_my_design`; `get_reference_images` with `which: "shots"` shows the desktop and phone screenshots.

The design is a small three.js fixture (a component, a tokens CSS with CRLF line ends, a demo page and an SVG) written for this run into a temporary folder, with a fake `.env` and a link out of the project. The screenshots and the video are taken by Playwright from the demo page. Nothing is installed and nothing leaves the machine.

## Run it

It needs a **scratch** PIVOT. Before writing anything, the run checks four things (`scripts/qa/scratch-guard.mjs`) and stops if one fails:

- `PIVOT_E2E_SCRATCH=1` is set;
- the port isn't 4321;
- the data folder isn't yours, and holds the scratch marker;
- the server really uses that folder.

1. Start a scratch PIVOT and build the MCP server from this checkout (`pnpm mcp:build`):

   ```bash
   node scripts/start.mjs --scratch /tmp/pivot-mydesigns-e2e
   ```

2. Run the e2e from `packages/core`:

   ```bash
   PIVOT_URL=http://127.0.0.1:4400 PIVOT_DATA_DIR=/tmp/pivot-mydesigns-e2e PIVOT_E2E_SCRATCH=1 E2E_OUT=/tmp/pivot-mydesigns-e2e-out npx vitest run --config ../../scripts/qa/my-designs/vitest.config.mjs
   ```

`E2E_OUT` receives `report.md`, one line per step.
