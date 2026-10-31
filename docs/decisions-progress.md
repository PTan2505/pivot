# Decisions — progress log

Tracks [decisions-plan.md](decisions-plan.md). Newest first.

## Status

| Phase | Name                               | Status      |
| ----- | ---------------------------------- | ----------- |
| 0     | Plan and docs                      | Done        |
| S     | Align `pivot-design` with Part A   | Done        |
| 1     | Reliable capture (server)          | Done        |
| 2     | Extension that survives offline    | Not started |
| 3     | Popup and library                  | Not started |
| 4     | Sections, links, private pages     | Not started |
| 5     | Design track: sessions, MCP writes | Not started |
| 6     | Later                              | Not started |

### Phase 1 — Reliable capture (server)

- Status: Done
- Existing functionality reused: the Playwright pipeline in `capture.ts` (SSRF guard, scroll walk, stitched full page, block-page detection, Open Graph fallback), `saveAsset`'s sha256 dedupe, `attachAsset`'s role upsert, the detail page's status bar and Retry button.
- Files changed: `packages/core/src/capture.ts` (attempts, retry, quality, theme, cancel, Original/Latest), new `settings.ts`, `db/schema.ts` + migration `0003` (adds `capture_attempts`, `app_settings`, `resources.capture_quality`, `assets.meta`; nothing removed), `types.ts`, `assets.ts`, `resources.ts`, `context.ts`; routes `api/resources/[id]/capture` (POST options, GET history, DELETE cancel), `api/captures`, `api/settings/capture`, `api/clip` (`expandContent`); `asset-gallery.tsx` (Cancel, notes, Retake options, theme labels, Original first, capture history), Settings → Capture; the extension popup's "Expand content"; MCP role labels; SPEC #7 and new §12.
- Checks run and results: core capture tests 20/20 (new: Original kept and in-between shots deleted; history order; a sign-in wall doesn't replace a good shot and is flagged when there's nothing to keep; 503 retried; 429 waits for Retry-After; a blocked page isn't retried; cancelling a running capture; settings and per-capture override; Load More only with `expandContent`). `pnpm typecheck`, `pnpm lint`, full `pnpm test` in the pre-push hook.
- Manual verification: scratch app on port 4400 (PGlite, no R2). Saved example.com, retook it with "Both themes": Latest dark plus light variant, both labelled; the identical second dark shot was not stored twice; history shows two completed runs; the Retake options menu opens and lists the four options; Settings → Capture shows Dark and Expand content off.
- Remaining issues: the Capture Queue page and the extension's queue view are Phase 3 (#17); Undo/Discard are Phase 3 (#55). Quality detection is heuristic and can be wrong (by design it never blocks a save).
- Next step: Phase 2.

### Phase S — Align `pivot-design` with Part A

- Status: Done
- Existing functionality reused: the skill from PR #34, the Ledgerly scratch target and the stream-json summary script from the first end-to-end test.
- Files changed: `.claude/skills/pivot-design/SKILL.md` (flow understand → search → inspect → choose → brief → design session → mockups → approval → build → QA; no "go ahead" exception; major changes go back to approval; QA reports deviations; design documents only in PIVOT, and the skill says when it can't save them; confirmed metadata beats suggestions), `docs/SPEC.md` §10, `docs/search-mcp-progress.md`, `docs/SEARCH_MCP_IMPLEMENTATION_PLAN.md`.
- Checks run and results: `pnpm check` (see the PR); two fresh headless Claude Code sessions on clean copies of the Ledgerly baseline, with the app running and the `pivot` MCP connected.
  - "Use the pivot-design skill. Just build it: design the pricing page": 26 tool calls, 7 images, $0.99, 119 s. Read the design system and content, used the Pricing pages collection, attributed Notion, Supabase and Linear (Stripe looked at and left out), wrote **one** mockup to its scratch folder, printed the brief with the Take / Leave table, said the brief isn't saved in PIVOT because the MCP only reads, and ended with "Reply approved and I'll build it". `git status` clean.
  - "Raise the contrast of the footer links": 7 tool calls, $0.36, 27 s. Didn't use the library or write a brief. Found the footer has no links, measured its text at 6.48:1, and asked which change was meant. No file changed.
- Manual verification: read both transcripts.
- Remaining issues: the design session and decision steps can't save anything until Phase 5b adds write tools. A real React/Next target is still untested.
- Next step: Phase 1.

### Phase 0 — Plan and docs

- Status: Done
- Existing functionality reused: Part A was compared with `.claude/skills/pivot-design/SKILL.md` in PR #34; the audits of the extension (`apps/extension`), the server (`packages/core`, `apps/web/src/app/api`) and the web app, and the open issues in [reference-first-progress.md](reference-first-progress.md) (G11: saves are lost while the app is down).
- Files changed: `docs/PIVOT_DECISIONS.md` (the consolidated baseline, Part A + Part B, copied in with the owner's amendments added to its §8 table), `docs/decisions-plan.md`, this log, `CLAUDE.md` (current focus).
- Checks run and results: docs only; Prettier on the changed files.
- Manual verification: none needed.
- Remaining issues: the conflicts C1–C11 in the plan's §2 are open until their phases land. The Activity Log retention period is still undecided (decision #54 gave 30 days only as an example).
- Next step: Phase S (align the skill with Part A on PR #34), then Phase 1.
