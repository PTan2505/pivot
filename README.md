# Stan Bag

Personal UI/UX resource library that runs on your machine: save websites (with automatic screenshots), images, icons, animations, palettes, prompts, Claude Code skills, snippets, rules, checklists and MCP configs — then copy or export them as context for Claude Code.

Requirements: [docs/SPEC.md](docs/SPEC.md) (decisions) · [docs/requirements-v0.1.md](docs/requirements-v0.1.md) (original brief) · Design: [DESIGN.md](DESIGN.md).

## Run

```bash
npm start
```

Installs dependencies and Playwright's Chromium if missing, rebuilds when the code changed, serves on <http://127.0.0.1:4321> and opens the browser. `npm run dev` runs the Next.js dev server with the same settings.

## Configuration (`.env` at the repo root)

| Variable                                                                 | Default            |                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                           | _unset_            | Unset → embedded Postgres (PGlite) in `~/.stan-bag/db`, works offline. Set → Neon/any Postgres.                                                       |
| `STAN_BAG_DATA_DIR`                                                      | `~/.stan-bag`      | Database (local mode), files (when R2 is not set), cache, default export folder.                                                                      |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | _unset_            | All four set → screenshots and uploads go to a private Cloudflare R2 bucket instead of this computer. `R2_ENDPOINT` only for EU-jurisdiction buckets. |
| `CLAUDE_SKILLS_DIR`                                                      | `~/.claude/skills` | Global skills that the Skills view syncs with.                                                                                                        |
| `PORT`                                                                   | `4321`             |                                                                                                                                                       |

Files (screenshots, uploads) go to Cloudflare R2 when the R2 keys are set, otherwise to the data folder. The app serves them itself, so the bucket stays private. Each file remembers where it lives, so switching is safe; Settings › Files has **Test storage** and **Move local files to R2**. Files that Copy context hands to Claude Code are downloaded to `~/.stan-bag/cache` and pruned after a week.

## Everyday use

- **⌘K** — search everything, jump anywhere, create; **⌘↵** on a result copies it.
- **⌘V anywhere** — paste one or many URLs to add them; paste an image to save it. Drag files onto the window to upload.
- **Select** cards (hover checkbox, ⇧-click for ranges, ⌘A) → _Copy context_ or _Export_ a bundle (`context.md`, prompts, skills, resized assets) into any folder, with a token estimate.
- **Prompts** support `{{variable}}` and `{{variable|default}}`; copying asks for the values.
- **Skills** sync from `~/.claude/skills` automatically when you open the Skills view. Edits stay in the app until you press _Save to disk_; changes on both sides are flagged as a conflict.
- **Trash** keeps deleted items for 30 days.

## Chrome extension

```bash
pnpm ext:build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick `apps/extension/dist`. Open the extension's options and paste the server URL and API token from Stan Bag › Settings › Browser extension.

- **⌥⇧S** / toolbar button — popup with a screenshot of what you see (works on logged-in pages), title and description read from the page, type, facets, notes, collection. If text is selected, you can save it as a snippet, prompt, rule or checklist instead.
- **⌥⇧D** — quick-save the current tab without the popup.
- **Right-click** a page, link or image → _Save … to Stan Bag_; selected text → _Save selection as snippet / prompt_.

The token is what lets the extension write to the API; regenerate it in Settings if it leaks. After changing extension code, run `pnpm ext:build` (or `pnpm ext:dev` to rebuild on save) and press reload on the extension card.

## Layout

```
apps/web        Next.js app (UI + API routes)
apps/extension  Chrome extension (Manifest V3, Vite + React)
packages/core   Database schema, migrations and all library logic (reusable by a future MCP server)
scripts/start.mjs
```

```bash
pnpm test          # core unit + integration tests (PGlite in a temp folder)
pnpm typecheck
pnpm lint
pnpm db:generate   # after editing packages/core/src/db/schema.ts
```

## Security

The server binds to `127.0.0.1` only. API requests must target localhost (blocks DNS rebinding) and writes must come from the app's own pages (blocks cross-site requests). URL fetching and screenshots refuse private/local network addresses. Uploaded files are served with a sandboxing CSP.
