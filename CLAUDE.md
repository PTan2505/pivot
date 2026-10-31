# PIVOT — notes for Claude

Personal UI/UX resource library: pnpm monorepo with `apps/web` (Next.js 16 app + API), `apps/extension` (Chrome MV3) and `packages/core` (schema, migrations, library logic). Decisions: [docs/SPEC.md](docs/SPEC.md). Visual rules: [DESIGN.md](DESIGN.md). Talk to the user in Vietnamese; code, UI copy and commits in English.

## Current focus: approved decisions

The reference-first plan ([docs/reference-first-plan.md](docs/reference-first-plan.md)) is done. Work now follows [docs/decisions-plan.md](docs/decisions-plan.md), which implements the approved decisions in [docs/PIVOT_DECISIONS.md](docs/PIVOT_DECISIONS.md): Part A (the `pivot-design` skill, MCP and the design workflow) and Part B (capture, the extension and the library).

- In scope: references, sources, collections, search and filters, capture, the extension, MCP and the `pivot-design` skill. Skill packs, prompts, snippets, rules and checklists are frozen: keep them working, don't extend them.
- Go phase by phase: audit → gaps → implement → test → report. Tick a decision as it is verified, not when it's written.
- Log each phase in [docs/decisions-progress.md](docs/decisions-progress.md) using the plan's report format.
- Design workflow: no implementation before the user explicitly approves a design direction. Design briefs, decisions and session notes go into PIVOT, never into a target project's repo. Write-tool names and schemas wait for the approved proposal (plan Phase 5a).
- Never delete or migrate away existing data, routes or APIs to simplify; stop and ask before destructive migrations, big architectural changes, or anything that conflicts with SPEC.

## Git workflow

- **`main` is production.** It is what gets deployed. Never commit to it directly and never base work on it.
- **`dev` is the integration branch.** Every change reaches `main` only by merging `dev` into `main` (a release PR), when the user asks for a release.
- **One branch per task, always created from an up-to-date `dev`:**
  ```bash
  git fetch origin
  git switch dev && git pull --ff-only
  git switch -c feat/<short-slug>
  ```
  Prefixes: `feat/` new behaviour, `fix/` bug fix, `chore/` tooling, deps, config, `docs/` documentation only, `refactor/` no behaviour change. Slugs are lowercase-kebab and name the task (`feat/r2-storage`, `fix/capture-timeout`).
- Keep a branch to its one task. Unrelated work found along the way gets its own branch (or a note to the user), not a drive-by change.
- Finished work goes back to `dev` through a pull request into `dev` (`gh pr create --base dev`), never by merging locally into `dev` or `main`. Keep the branch after it is merged: don't delete it locally or on origin (merge without `--delete-branch`), so every task branch stays pushed for reference.
- Urgent production fixes only: `hotfix/<slug>` from `main`, PR into `main`, then merge `main` back into `dev` so they don't drift.
- Commit, push and open PRs only when the user asks. Never force-push `main` or `dev`.
- Before committing, check that no secrets are staged: `.env` (Neon URL, R2 keys) and the extension's `*.pem` signing key are gitignored and must stay out of git.

## Keep the spec current

[docs/SPEC.md](docs/SPEC.md) is the source of truth for what PIVOT does. **Every change that adds or alters a feature, behaviour or piece of logic updates the spec in the same branch and PR as the code** — new or changed resource types, API routes, database or storage behaviour, settings, security rules, extension capabilities, and anything removed.

- A decision goes in the §1 table: add a row, or edit the existing row and mark it `(cập nhật YYYY-MM-DD)`. A feature area goes in its section, or in a new numbered section marked `(bổ sung YYYY-MM-DD)`. When something from "Ngoài phạm vi" gets built, remove it from that list.
- Rewrite statements that are no longer true instead of appending a contradiction. Write in Vietnamese, like the rest of the file.
- Visual or UI changes also update [DESIGN.md](DESIGN.md).
- Refactors, tooling, tests and copy fixes that change no behaviour need no spec edit; say so in the PR description.
- A task is not done until SPEC.md still describes what the code does.

## Commands

```bash
npm start              # install if needed, rebuild if code changed, serve on http://127.0.0.1:4321
npm run dev            # Next.js dev server with the same env
pnpm test              # core tests (PGlite in a temp dir; R2 path against s3rver)
pnpm typecheck && pnpm lint
pnpm format            # Prettier, whole repo (pnpm format:check to verify)
pnpm check             # format:check + lint + typecheck + test
pnpm db:generate       # after editing packages/core/src/db/schema.ts — commit the new migration
pnpm ext:build         # build the extension into apps/extension/dist
pnpm mcp:build         # build the stdio MCP server into apps/mcp/dist (setup: apps/mcp/README.md)
pnpm skill:install     # link .claude/skills/pivot-design into ~/.claude/skills
```

Run `pnpm check` (format check, lint, typecheck, tests) before saying a change is done. To try the app without touching the real Neon database or R2 bucket, start it with a scratch environment: `DATABASE_URL= PIVOT_DATA_DIR=<tmp dir> PORT=4400 node scripts/start.mjs` (unset the `R2_*` variables the same way).

## Hooks

See [HOOK.md](HOOK.md). A Claude Code `PostToolUse` hook formats every file you edit with Prettier and runs ESLint `--fix` on `apps/web` sources; when it reports lint errors, fix them before moving on. Git `pre-commit` (lefthook) blocks commits on `main`/`dev` and staged secrets and formats + lints staged files; `pre-push` runs typecheck, lint and tests. Don't bypass them (`LEFTHOOK=0`, `--no-verify`) unless the user asks.

## Conventions

- Library logic belongs in `packages/core`; route handlers in `apps/web/src/app/api` stay thin and wrap work in `route()` from `lib/server/http.ts` (it forces request-time rendering and maps errors to JSON).
- `apps/web` runs Next.js 16 with Cache Components; read the bundled docs in `apps/web/node_modules/next/dist/docs/` before using an unfamiliar API (see `apps/web/AGENTS.md`).
- UI follows [DESIGN.md](DESIGN.md): design-system tokens (`bg-surface`, `text-ink-subtle`, `outline-accent-text`…), pill controls, one ember-orange primary action per screen, dark only, glass (`.glass` / `.glass-strong`) only on chrome and overlays, solid cards with no borders or shadows. Check text contrast (≥ 4.5:1) when adding colours.
- Files go through the blob store (`packages/core/src/storage.ts`): R2 when the `R2_*` keys are set, otherwise the data folder. Never read or write asset files by path directly.
- The API only answers localhost, and writes need the same origin or the extension's API token (`src/proxy.ts`). Keep it that way when adding routes.
