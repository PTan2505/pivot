# Hooks — lint & format checks

Two layers keep the code formatted and lint-clean:

| Hook                          | When                                      | Runs                                                                                             | Blocks?                                             |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| **Claude Code** `PostToolUse` | Right after Claude edits or writes a file | Prettier on that file; ESLint `--fix` if it is under `apps/web`                                  | Reports unfixable lint errors back to Claude to fix |
| **Git** `pre-commit`          | `git commit`                              | Branch guard, secrets guard, Prettier + ESLint `--fix` on **staged** files (fixes are re-staged) | Yes — commit stops on a failure                     |
| **Git** `pre-push`            | `git push`                                | `pnpm typecheck`, `pnpm lint`, `pnpm test` in parallel                                           | Yes — push stops on a failure                       |

Formatting: **Prettier** (`.prettierrc.json`, printWidth 120, Tailwind class sorting via `prettier-plugin-tailwindcss`). Linting: the Next.js ESLint config in `apps/web`. Files listed in `.prettierignore` (vendored shadcn components in `apps/web/src/components/ui`, DB migrations, build output, lockfile) are never reformatted.

## Git hooks (lefthook)

Configured in [`lefthook.yml`](lefthook.yml) and installed automatically by `pnpm install` (the root `prepare` script runs `lefthook install`). To install them by hand:

```bash
pnpm exec lefthook install
```

### pre-commit

| Command   | What it does                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branch`  | [`scripts/hooks/check-branch.sh`](scripts/hooks/check-branch.sh) refuses commits on `main` (production) and `dev` (integration). Work on a task branch from `dev` — see [CLAUDE.md](CLAUDE.md). |
| `secrets` | [`scripts/hooks/check-secrets.sh`](scripts/hooks/check-secrets.sh) refuses staged `.env*` files (except `.env.example`) and `*.pem` / `*.crx` (the extension's signing key).                    |
| `format`  | `prettier --write` on staged files with a supported extension; the formatted result is re-staged.                                                                                               |
| `lint`    | `eslint --fix` on staged `apps/web` sources; fixes are re-staged, remaining errors stop the commit.                                                                                             |

### pre-push

Runs the same checks CI would: `pnpm typecheck`, `pnpm lint` and `pnpm test` (core tests, including the R2 path against a local s3rver). About 5 seconds.

### Running or skipping them

```bash
pnpm exec lefthook run pre-commit            # on what is staged now
pnpm exec lefthook run pre-push --force      # without pushing
LEFTHOOK_EXCLUDE=lint git commit -m "…"      # skip one command once
LEFTHOOK=0 git commit -m "…"                 # skip all hooks once (avoid; say why in the commit)
```

## Claude Code hook

Configured in [`.claude/settings.json`](.claude/settings.json) (committed, so every Claude Code session in this repo gets it):

- Event `PostToolUse`, matcher `Edit|Write|MultiEdit`, command `node "$CLAUDE_PROJECT_DIR/scripts/hooks/claude-post-edit.mjs"`.
- [`scripts/hooks/claude-post-edit.mjs`](scripts/hooks/claude-post-edit.mjs) reads the edited path from the hook input, then:
  1. formats it with Prettier if it is a `ts tsx js jsx mjs cjs json css md html yml yaml` file inside the repo and not in `.prettierignore`;
  2. runs `eslint --fix` on it if it is a script under `apps/web`;
  3. if ESLint still reports errors, exits with code 2 and prints them, which Claude Code feeds back to Claude so it fixes them in the same turn.
- Files outside the repo, deleted files and tooling failures never block the edit.

Turn it off for yourself without touching the shared file by adding `"disableAllHooks": true` to `.claude/settings.local.json` (gitignored). A new or edited `.claude/settings.json` is picked up by the next Claude Code session.

## Commands

```bash
pnpm format         # prettier --write . (whole repo)
pnpm format:check   # prettier --check .
pnpm lint           # ESLint (apps/web)
pnpm check          # format:check + lint + typecheck + test
```

The repository was not reformatted in one go when Prettier was added, so `pnpm format:check` lists older files until they are touched (both hooks format files as they change). To format everything at once, run `pnpm format` on its own `chore/format-all` branch so the change is easy to review.

## Troubleshooting

- **Hooks don't run on commit** — `ls .git/hooks` should show `pre-commit` and `pre-push`; if not, run `pnpm exec lefthook install`.
- **`Don't commit directly to 'main'`** — create a task branch: `git switch dev && git pull --ff-only && git switch -c feat/<task>`, then commit there.
- **A file you meant to keep unformatted keeps changing** — add it to `.prettierignore`.
- **ESLint fails on a file Claude just wrote** — the error is in Claude's context already; ask it to fix the reported problem, or fix it by hand.
