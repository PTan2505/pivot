# Contributing to PIVOT

Thanks for helping. PIVOT is small and opinionated, so for anything bigger than a fix, open an issue first and describe what you want to change and why. That saves you building something that won't be merged.

## Scope

PIVOT does one job: a library of UI references, and design sessions with Claude Code built on it. Changes to references, sources, collections, search, capture, the extension, the MCP server and the design skills are welcome. The older resource types (prompts, snippets, rules, checklists, skills, MCP configs, export and share) are hidden and kept working, but not extended.

## Set up

You need Node.js 22+ and Chrome for the extension. pnpm comes from Corepack.

```bash
git clone https://github.com/PTan2505/pivot.git && cd pivot
corepack enable
pnpm install
```

- **Run your own PIVOT:** `npm start` (port 4321, data in `~/.pivot`) or `npm run dev` (Next.js dev server).
- **Run a throwaway PIVOT** for tests, demos and QA: `node scripts/start.mjs --scratch /tmp/pivot-scratch`. It serves on port 4400, never reads `.env`, keeps its own data and Claude skill folders, and refuses `~/.pivot` and port 4321. Scripts that write to a PIVOT check for it first (`scripts/qa/scratch-guard.mjs`).
- **Try the plugin from your checkout:** `claude plugin marketplace add "$PWD"`, then `claude plugin install pivot@pivot`. Edits to `plugin/` apply at the next Claude Code session.

## Make a change

1. **Branch from `dev`:** `feat/…`, `fix/…`, `docs/…`, `chore/…` or `refactor/…`, with a short lowercase slug. One task per branch.
2. **Follow the conventions:**
   - Library logic lives in `packages/core`. Route handlers in `apps/web/src/app/api` stay thin and wrap their work in `route()` (`apps/web/src/lib/server/http.ts`).
   - The API answers only localhost, and writes need the same origin or the API token (`apps/web/src/proxy.ts`). Keep that true for new routes.
   - Files go through the blob store (`packages/core/src/storage.ts`), never read or written by path.
   - UI follows [DESIGN.md](DESIGN.md): design-system tokens, pill controls, one primary action per screen, dark only. Check text contrast (at least 4.5:1).
   - `apps/web` runs Next.js 16 with Cache Components: read the docs bundled in `apps/web/node_modules/next/dist/docs/` before using an unfamiliar API.
   - Write code, UI copy, docs and commit messages in English.
3. **Keep the spec current.** [docs/SPEC.md](docs/SPEC.md) says what PIVOT does. A change that adds or alters behaviour updates it in the same pull request: a row in the §1 table, or the section for that area. Visual changes also update DESIGN.md. Refactors, tooling and tests that change no behaviour need no spec edit; say so in the pull request.
4. **Regenerate what is committed:**
   - after editing `packages/core/src/db/schema.ts`: `pnpm db:generate`, and commit the migration;
   - after changing the MCP server or `packages/mcp-tools`: `pnpm mcp:build`. It rewrites `plugin/server/server.js`, and a test fails when that file is stale.
   - after changing anything in `plugin/`: raise `version` in `plugin/.claude-plugin/plugin.json` (patch for fixes, minor for new skills, tools or options). `claude plugin update` compares versions, so without a new one installed copies keep the old files.
5. **Check:** `pnpm check` runs the format check, lint, typecheck and tests. Tests use PGlite in a temporary folder and never touch your real PIVOT. For plugin changes, also run `pnpm plugin:validate`.
6. **Open a pull request into `dev`.** Say what changed, why, and how you checked it. Note anything you couldn't verify.

The repository's Git hooks (lefthook, installed by `pnpm install`) format and lint staged files, block commits on `main` and `dev` and staged secrets, and run the checks before a push. Please don't bypass them.

## Secrets

Never commit `.env` (database URL, R2 keys) or the extension's `*.pem` signing key; both are ignored by Git.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
