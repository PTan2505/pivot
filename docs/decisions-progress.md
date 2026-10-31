# Decisions — progress log

Tracks [decisions-plan.md](decisions-plan.md). Newest first.

## Status

| Phase | Name                               | Status      |
| ----- | ---------------------------------- | ----------- |
| 0     | Plan and docs                      | Done        |
| S     | Align `pivot-design` with Part A   | Not started |
| 1     | Reliable capture (server)          | Not started |
| 2     | Extension that survives offline    | Not started |
| 3     | Popup and library                  | Not started |
| 4     | Sections, links, private pages     | Not started |
| 5     | Design track: sessions, MCP writes | Not started |
| 6     | Later                              | Not started |

### Phase 0 — Plan and docs

- Status: Done
- Existing functionality reused: Part A was compared with `.claude/skills/pivot-design/SKILL.md` in PR #34; the audits of the extension (`apps/extension`), the server (`packages/core`, `apps/web/src/app/api`) and the web app, and the open issues in [reference-first-progress.md](reference-first-progress.md) (G11: saves are lost while the app is down).
- Files changed: `docs/PIVOT_DECISIONS.md` (the consolidated baseline, Part A + Part B, copied in with the owner's amendments added to its §8 table), `docs/decisions-plan.md`, this log, `CLAUDE.md` (current focus).
- Checks run and results: docs only; Prettier on the changed files.
- Manual verification: none needed.
- Remaining issues: the conflicts C1–C11 in the plan's §2 are open until their phases land. The Activity Log retention period is still undecided (decision #54 gave 30 days only as an example).
- Next step: Phase S (align the skill with Part A on PR #34), then Phase 1.
