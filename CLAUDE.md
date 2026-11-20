# PIVOT — notes for Claude

Personal UI/UX resource library: pnpm monorepo with `apps/web` (Next.js 16 app + API), `apps/extension` (Chrome MV3), `apps/cli` (the npm package `pivot-studio`) and `packages/core` (schema, migrations, library logic). Decisions: [docs/SPEC.md](docs/SPEC.md). Visual rules: [DESIGN.md](DESIGN.md). Reply in the language the user writes in. Everything written to the repo (code, docs, UI copy, commits, PRs) is in English.

## Current focus: approved decisions

The reference-first plan ([docs/reference-first-plan.md](docs/reference-first-plan.md)) is done. Work now follows [docs/decisions-plan.md](docs/decisions-plan.md), which implements the approved decisions in [docs/PIVOT_DECISIONS.md](docs/PIVOT_DECISIONS.md): Part A (the `pivot:design` skill, MCP and the design workflow) and Part B (capture, the extension and the library).

- In scope: references, sources, collections, search and filters, capture, the extension, MCP, the Claude Code plugin (`plugin/`) and its `pivot:design` and `pivot:redesign` skills. Skill packs, prompts, snippets, rules and checklists are frozen: keep them working, don't extend them.
- Go phase by phase: audit → gaps → implement → test → report. Tick a decision as it is verified, not when it's written.
- Also approved (2026-11-20): [docs/mockup-feedback-plan.md](docs/mockup-feedback-plan.md), feedback and pins on mockups in PIVOT, and a DESIGN.md drafted for projects that have none. Its phases are logged in that file.
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

## Decide the npm release in every PR

Merging into `main` publishes the npm package `pivot-studio` when `apps/cli/package.json` holds a version npm doesn't have yet ([docs/SPEC.md](docs/SPEC.md) §20). CI checks the mechanical part on every PR into `dev` or `main`: it fails when the PR changes files that go into the package (`apps/cli/release-check.mjs`) while the version is already on npm. What CI can't decide is yours, before opening the PR:

- **How big the bump is**, when the package changes: patch for fixes, minor for new features or options, major for a breaking change. A version an earlier PR raised and not yet released covers this PR, unless it needs a bigger step (a feature after a pending patch: patch → minor). To see where things stand: `git diff --name-only origin/dev...HEAD | node apps/cli/release-check.mjs` and `npm view pivot-studio version`.
- **The verdict, in one line of the PR description**, and told to the user: `npm: publishes 0.1.2 (fixes the capture timeout)`, `npm: covered by the pending 0.1.2` or `npm: no release (docs only)`.
- The `no-npm-release` label only when the user decides a package change shouldn't be released.

Changes to `plugin/` follow the same idea with the plugin's own version in `plugin/.claude-plugin/plugin.json`, which `claude plugin update` compares (CONTRIBUTING.md, step 4).

## Keep the spec current

[docs/SPEC.md](docs/SPEC.md) is the source of truth for what PIVOT does. **Every change that adds or alters a feature, behaviour or piece of logic updates the spec in the same branch and PR as the code** — new or changed resource types, API routes, database or storage behaviour, settings, security rules, extension capabilities, and anything removed.

- A decision goes in the §1 table: add a row, or edit the existing row and mark it `(updated YYYY-MM-DD)`. A feature area goes in its section, or in a new numbered section marked `(added YYYY-MM-DD)`. When something from "Out of MVP scope" gets built, remove it from that list.
- Rewrite statements that are no longer true instead of appending a contradiction. Write in English, like every document in the repo.
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
pnpm mcp:build         # build the MCP server into apps/mcp/dist and plugin/server/server.js; commit the latter (a test
                       # fails when it is stale). Setup: README "Design with Claude Code", apps/mcp/README.md
pnpm plugin:validate   # Claude Code's validator on plugin/ and .claude-plugin/marketplace.json
pnpm cli:build         # pack the app into apps/cli/dist for the npm package pivot-studio (see apps/cli/README.md)
```

Run `pnpm check` (format check, lint, typecheck, tests) before saying a change is done. To try the app without touching the real Neon database, R2 bucket or data folder, start a scratch PIVOT: `node scripts/start.mjs --scratch <tmp dir>` (port 4400; it never reads `.env`, keeps its own data and Claude skill folders, refuses `~/.pivot` and port 4321), or the `pivot-scratch` launch configuration. Tests, demos and QA scripts never start or write to the real PIVOT: anything that writes to a PIVOT checks it first with `scripts/qa/scratch-guard.mjs`. Never start the `pivot` launch configuration for testing.

## Hooks

See [HOOK.md](HOOK.md). A Claude Code `PostToolUse` hook formats every file you edit with Prettier and runs ESLint `--fix` on `apps/web` sources; when it reports lint errors, fix them before moving on. Git `pre-commit` (lefthook) blocks commits on `main`/`dev` and staged secrets and formats + lints staged files; `pre-push` runs typecheck, lint and tests. Don't bypass them (`LEFTHOOK=0`, `--no-verify`) unless the user asks.

## Conventions

- Library logic belongs in `packages/core`; route handlers in `apps/web/src/app/api` stay thin and wrap work in `route()` from `lib/server/http.ts` (it forces request-time rendering and maps errors to JSON).
- `apps/web` runs Next.js 16 with Cache Components; read the bundled docs in `apps/web/node_modules/next/dist/docs/` before using an unfamiliar API (see `apps/web/AGENTS.md`).
- UI follows [DESIGN.md](DESIGN.md): design-system tokens (`bg-surface`, `text-ink-subtle`, `outline-accent-text`…), pill controls, one ember-orange primary action per screen, dark only, glass (`.glass` / `.glass-strong`) only on chrome and overlays, solid cards with no borders or shadows. Check text contrast (≥ 4.5:1) when adding colours.
- Files go through the blob store (`packages/core/src/storage.ts`): R2 when the `R2_*` keys are set, otherwise the data folder. Never read or write asset files by path directly.
- The API only answers localhost, and writes need the same origin or the extension's API token (`src/proxy.ts`). Keep it that way when adding routes.
