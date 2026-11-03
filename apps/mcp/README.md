# PIVOT MCP server

Lets Claude Code search and look at your PIVOT library while you design and build. It runs over **stdio**: Claude Code starts it, and it reads from the PIVOT app running on your machine through the app's HTTP API. The tools themselves live in [`packages/mcp-tools`](../../packages/mcp-tools) and don't depend on how they're served.

## Read tools

| Tool                   | What it does                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_references`    | Search references (or sources, skills…) by words and facets, inside a collection (by name or id) or from a source (by host or id). Up to 25 results per page, with a cursor for the next page. |
| `get_reference`        | One item's link, description, your notes, facets, collections and which screenshots exist.                                                                                                     |
| `list_facets`          | What the library can be filtered by: types with counts, facet values in use, source categories, collections.                                                                                   |
| `get_reference_images` | The screenshots as images: the cover (first screen) and the full page in 960px-wide slices (about 2,000 tokens each), paged with `fromSlice`, at most 4 images per call.                       |

## Outside the library

| Tool              | What it does                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_external` | Searches the free public component catalogs PIVOT indexes on this computer (Magic UI, React Bits, shadcn/ui) and lists search links for other sites. Read-only. Nothing is saved; the links are places to browse, not references. |

## Write tools (need the API token)

| Tool                     | What it does                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `save_design_brief`      | Saves a design brief in PIVOT at a milestone: `initial` (opens a design session), `approved`, `major_change`. The same brief twice is one snapshot. |
| `record_design_decision` | Records an `approval`, a `change` after approval, or a `deviation` found in QA.                                                                     |
| `save_design_mockups`    | Saves a round of 1–9 static mockups (files are inlined) on the session's page, where the user can approve one with a note. Only while exploring.    |
| `set_design_status`      | Moves a session to `building` (only from approved) or `done` (only from building). The same status twice changes nothing. Never sets the others.    |
| `get_design_session`     | Reads a session's briefs, decisions (with who approved: you in PIVOT, or the agent) and mockup rounds, or lists sessions (read-only).               |
| `suggest_metadata`       | Suggests facets, a collection, a title or a visual description for a reference. They wait in the Inbox until you accept them.                       |
| `annotate_reference`     | Appends a dated "agent" line to a reference's notes; your own text isn't changed.                                                                   |
| `save_reference`         | Saves a page to the library (only when you ask): duplicates skipped, screenshots taken in the background, lands in the Inbox.                       |

Briefs and decisions are kept in PIVOT, never written into the project you are working on. Nothing an agent writes overwrites what you confirmed.

Errors come back as tool results with a code the agent can act on: `not_found`, `invalid_input`, `invalid_cursor`, `no_images`, `app_unreachable`, `read_only`, `unauthorized` (the token is missing or wrong), `conflict` (the item's current state doesn't allow it, e.g. a status out of order).

## Set up

1. Start PIVOT (`npm start` at the repo root, which serves `http://127.0.0.1:4321`). The MCP server only reads through it.
2. Build the server:
   ```bash
   pnpm mcp:build
   ```
3. Register it with Claude Code. For every project on this machine:
   ```bash
   claude mcp add pivot --scope user -- node /absolute/path/to/stan-bag/apps/mcp/dist/server.js
   ```
   Or only inside this repo, from its root:
   ```bash
   claude mcp add pivot --scope project -- node apps/mcp/dist/server.js
   ```
4. In Claude Code, `/mcp` should list `pivot` with 13 tools. Ask something like "find dark pricing pages in PIVOT".

### Configuration

| Variable      | Default                                              | Meaning                                                                          |
| ------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `PIVOT_URL`   | `http://127.0.0.1:4321`                              | Where the PIVOT app is running.                                                  |
| `PIVOT_TOKEN` | contents of `<PIVOT_DATA_DIR or ~/.pivot>/api-token` | The API token (Settings in the app). Reads don't need it; every write tool does. |

Pass them with `claude mcp add … -e PIVOT_URL=http://127.0.0.1:4400 -- node …`. Nothing secret is stored in the repo.

## Troubleshooting

- **`app_unreachable`:** PIVOT isn't running at `PIVOT_URL`. Start it, then retry; the server doesn't need restarting.
- **Tools missing in `/mcp`:** rebuild (`pnpm mcp:build`) and restart Claude Code. The server logs to stderr: run `node apps/mcp/dist/server.js` by hand and it prints `PIVOT MCP ready (13 tools), reading <PIVOT_URL>`.
- **Search results differ from the app:** both use `searchResources` / `listResources` in `packages/core`. Check you're pointing at the same app (`PIVOT_URL`) and that it was rebuilt after the last pull.

## Remove

```bash
claude mcp remove pivot --scope user
```

## Design skills

Two skills in `.claude/skills` tell Claude how to use these tools:

- **`pivot-design`** for new screens. The flow is:
  1. understand;
  2. `list_facets`, search and look;
  3. a brief with attributed references, saved as `initial`;
  4. about 5 mockups, saved to the session in PIVOT;
  5. your explicit approval, in the chat or with **Approve this version** in PIVOT (Claude waits on it in the background and builds right away);
  6. build;
  7. QA.
- **`pivot-redesign`** for existing UI. It sets a path and a risk level (small fix / Minor / Major) that decides the approval step. It also checks the impact on shared code, and compares the result with "before" screenshots.

Both share an optional-specialist policy (`pivot-design/specialists.md`).

Link them into every project with:

```bash
pnpm skill:install
```

The links point at this repo, so editing the skills here updates them everywhere. The full walkthrough is in the root [README](../../README.md#design-with-claude-code).

## Develop

- Tool definitions and their tests: `packages/mcp-tools` (`pnpm --filter @pivot/mcp-tools test`). They're written against the `PivotSource` interface, so a later remote server (Streamable HTTP) can reuse them unchanged; see `docs/SEARCH_MCP_IMPLEMENTATION_PLAN.md`.
- This app only adds the stdio transport (`src/server.ts`) and `HttpSource` (`src/http-source.ts`).
