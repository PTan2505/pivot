# Incident 2026-11-10: test runs started the real PIVOT

Two agent test runs started PIVOT against the owner's real configuration. This records what happened, what was checked
(read-only), what can't be known, and the guardrails added. No data was modified by the investigation: every database
query ran in a `READ ONLY` transaction, R2 was only listed, and no app code (migrations, startup tasks) was run.

## What happened

|                          | Incident 1                                                                                                                      | Incident 2                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| When (local, +07)        | 18:40:43 – about 18:40:55                                                                                                       | 20:27:53 – about 20:29                                                                                                   |
| How                      | The browser pane's `preview_start` started the shared checkout's `pivot` launch config on port 4321 instead of a scratch config | A test passed `"--scratch <dir>"` as one argument, so `scripts/start.mjs` ignored it and ran in normal mode on port 4321 |
| Configuration            | The shared checkout's `.env`: Neon `DATABASE_URL`, R2 keys, data folder `~/.pivot`                                              | A worktree with no `.env`: local PGlite in `~/.pivot/db`, local file storage                                             |
| Code that ran at startup | `migrate()`, `purgeExpiredTrash`, `resumePendingCaptures`, `pruneAssetCache`                                                    | The same, against the new empty PGlite                                                                                   |

## Evidence (read-only)

| Question                                        | Evidence                                                                                                                                                    | Conclusion                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Were rows written in Neon during either window? | `resources`, `design_sessions` updated in 11:35–11:50Z and 13:25–13:35Z: 0; `capture_attempts` touching either window: 0                                    | No row writes seen                                                                                                                              |
| Could the trash purge have deleted anything?    | Trash is empty; the oldest resource was created 2026-10-26T16:40Z; the 30-day cutoff at the incident was 2026-10-11                                         | No resource could have been old enough; nothing was purged                                                                                      |
| Were captures resumed (R2 writes)?              | 0 resources pending capture; last capture attempt 2026-11-02                                                                                                | Nothing to resume                                                                                                                               |
| Did R2 change?                                  | 344 objects; none modified in either window (newest 2026-11-09T06:26Z); all 129 asset rows still have their object                                          | No writes; no asset object missing                                                                                                              |
| Were migrations applied?                        | All 11 migrations are recorded. 0009 and 0010 committed after the last data write (2026-11-02 15:47Z, by transaction order); Neon has commit timestamps off | Applied, but **when can't be determined** from the database: this incident or the owner's own run of the branch (its build is dated 2026-11-09) |
| What did 0010 change?                           | 0 rows in `design_mockups`; 0 sessions matched its `approval_reset_at` update                                                                               | Schema only (new columns); no data rows changed                                                                                                 |
| Local asset cache pruned?                       | `~/.pivot/cache/assets` last modified 2026-11-09 13:12; deleting a file updates it                                                                          | Nothing deleted                                                                                                                                 |
| `~/.pivot/db`                                   | Created by incident 2 (empty PGlite, 39 MB)                                                                                                                 | Kept; deleting it is the owner's decision                                                                                                       |

**Not verifiable here:** the exact time migration 0010 was applied (Neon's console keeps operation and query history for
its retention window), and R2 deletions of objects that had no asset row (the bucket has no access log here).

## Guardrails

- `node scripts/start.mjs --scratch <dir>`: no `.env`, `DATABASE_URL` and `R2_*` cleared, refuses `~/.pivot`,
  `~/.stan-bag`, the repository and port 4321; unknown arguments are refused before anything starts.
- `scripts/qa/scratch-guard.mjs`: QA scripts refuse a server that isn't a marked scratch instance.
- `.claude/launch.json` has a `pivot-scratch` config; agents use it, never `pivot`.
- Under the test runner, `packages/core` refuses the real data folder, `~/.claude`, and any non-loopback database or
  R2 endpoint (`config.ts`, tested in `test-guard.test.ts`), even when `$HOME` is faked.
