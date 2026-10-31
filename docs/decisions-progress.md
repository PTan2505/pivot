# Decisions — progress log

Tracks [decisions-plan.md](decisions-plan.md). Newest first.

## Status

| Phase | Name                               | Status      |
| ----- | ---------------------------------- | ----------- |
| 0     | Plan and docs                      | Done        |
| S     | Align `pivot-design` with Part A   | Done        |
| 1     | Reliable capture (server)          | Done        |
| 2     | Extension that survives offline    | Done        |
| 3     | Popup and library                  | Done        |
| 4     | Sections, links, private pages     | Done        |
| 5     | Design track: sessions, MCP writes | Not started |
| 6     | Later                              | Not started |

### Phase 4 — Sections, links, private pages

- Status: Done
- Existing functionality reused: the offline queue (held saves are queue items), `queueSave`/`syncNow`, `findByUrl`/`urlKey` for "same page", `safeFetch` (SSRF-guarded, no cookies) for the private check, `getPageInfo`'s injected reader, the Inbox from Phase 3 (sections land there).
- Files changed: core `links.ts`, `visibility.ts`, `types.ts` (link kinds), `capabilities.ts` (API 3: `visibility`, `clip.section`, `links`), schema + migration `0006` (adds `resource_links`); routes `api/resources/[id]/links`, `api/links/[id]`, `api/visibility`, `api/clip` (`section`, auto-link); web `resource-links.tsx`, `resource-detail.tsx` (Links, Section info); extension `lib/section.ts` (picker, list, scrolling), `lib/privacy.ts`, `lib/redact.ts`, `lib/page.ts` (privacy signals, mask suggestions), `lib/queue.ts` (`needs_approval`), `lib/sync.ts` (`approvePending`), `background.ts` (section capture and stitching, capture retry on Chrome's rate limit, private quick saves held, context-menu section), `popup.tsx` (section buttons and list, private review, approval view), new `popup/redact-editor.tsx`; SPEC §14, DESIGN.md.
- Checks run and results: core `links.test.ts` 4/4 (section `part_of` its page, same-page links, nothing by website alone, one row for symmetric links, suggestions confirmed by hand, no self-links, trashed ends hidden; visibility: public page, redirect to sign-in, 403, unreachable, app-like URLs); extension tests 12/12 (a held save is never sent, even forced); typecheck, lint, full suite in the hooks.
- Manual verification: headless Chromium with the built extension and a local test site, against the scratch app:
  - "Pick from a list" listed Hero, Pricing and Footer; Pricing (2000px tall) was saved as "Pricing — 127.0.0.1", in the Inbox, with its rect and a 1280×2000 stitched image.
  - A page with a password field, an email and a filled card field was flagged (password field, app-like address); three masks were suggested; Save stayed disabled until the approval box was ticked; the uploaded image is black under the email; no server capture was queued.
  - "Select a section" + Enter on that page held the section as `needs_approval` (nothing on the server); Review → "Upload with these masks" sent it (one more save on the server, queue empty).
  - Two real bugs found and fixed: the second tab capture within a second was refused by Chrome (now waits and retries), and the waiting panel was collapsed so Review was hidden (it now opens when something needs you).
  - Test-only difference: Playwright can't click the toolbar button, so the run used a copy of the build with `<all_urls>` standing in for the `activeTab` grant a real click gives. The shipped manifest is unchanged.
- Remaining issues: mask suggestions cover filled fields, emails and amounts on screen; names, addresses and anything inside images or canvases are not detected. Fixed headers can repeat inside a stitched section. MCP doesn't expose links or section context yet.
- Next step: Phase 5a.

### Phase 3 — Popup and library

- Status: Done
- Existing functionality reused: `findByUrl`/`urlKey` (same duplicate rule as before), `listResources` filters, the bulk route, `LibraryView` chips (`ViaChip`), the detail page's `Field` rows, the extension's `FacetPicker`, the `capture_attempts` table from Phase 1 for the queue page.
- Files changed: core `resources.ts` (`review_status`, `needsReview`/`url`/`host` filters, `inbox` count, `setReviewStatus`), schema + migration `0005` (adds `resources.review_status`), `types.ts`; routes `api/resources` (filters), `api/resources/bulk` (`reviewed`, `needsReview`), `api/lookup` (3 newest with thumbnails + total), `api/clip` (`needsReview`, `collectionIds`, `capturedUrl`); web `use-library-params.ts`, `lib/api.ts`, `library-view.tsx` (Inbox pill, chips), `selection-bar.tsx` (Mark reviewed), `resource-detail.tsx` (Inbox banner, Captured from, Published by, Original source), new `app/captures/page.tsx`, Settings link; extension `popup.tsx` (Capture/Library tabs, duplicate panel, collection pills, Edit after save, a11y fixes), new `popup/parts.tsx`, `lib/api.ts`, `lib/page.ts` (address bar URL), `background.ts` (quick saves go to the Inbox with provenance); SPEC §13, DESIGN.md (gallery, capture queue, page header, popup).
- Checks run and results: core `review-filters.test.ts` 2/2 (Inbox lists, search still finds, count, mark reviewed, page and website filters); extension tests 11/11; typecheck, lint, full suite in the hooks.
- Manual verification: scratch app — Inbox pill with count 1, Inbox list, detail banner, Mark reviewed removes it, Captured from shown; `/captures` lists runs with Retry. Headless Chromium with the built extension: the duplicate panel shows the earlier save with a loaded thumbnail; the Library tab lists this page, this website and recent saves; ← switches tabs; two collection pills pressed; save, then Edit → new title and one collection removed → the server has the new title, only "Pricing pages", and `capturedUrl` from the address bar.
- Remaining issues: agent suggestions in the Inbox come with Phase 5 (#35). The library has no direct "Saved from <host>" entry point except the popup (the `host` filter is API-only).
- Next step: Phase 4.

### Phase 2 — Extension that survives being offline

- Status: Done
- Existing functionality reused: the extension's `api.clip`, `getPageInfo`/`captureTab`, the popup form and its token ping; `/api/clip` unchanged apart from the request id; the proxy's origin check.
- Files changed: extension `lib/queue.ts` (sync logic, no storage), `lib/pending-store.ts` (IndexedDB), `lib/sync.ts` (wiring, badge, `queueSave`), `background.ts` (every save goes through the queue; alarms; session-stored notification targets), `popup.tsx` (save while offline with cached tags and collections, "Saved locally" screen, waiting-saves panel with Sync now / Retry / Discard, update and storage warnings), `manifest.json` (`alarms`), Vitest setup; core `clip-requests.ts`, `capabilities.ts`, schema + migration `0004` (adds `clip_requests`); routes `api/clip` (`clientRequestId`), `api/capabilities`; `proxy.ts` (token required for writes with neither `Origin` nor `Sec-Fetch-Site`); root `pnpm test` now includes the extension; SPEC §3 and §4.
- Checks run and results: extension queue tests 11/11 (order, offline stop, backoff, refused saves parked and retried only on request, missing server features, rejected token, single-item sync); core clip-request tests 4/4 (repeat answered, repeat waits for a save in progress, gives up with 409, retry after a failed first try); typecheck, lint, full suite in the hooks. One real bug found by the tests and fixed: Retry on a refused save didn't send it.
- Manual verification: scratch app on port 4400. `/api/capabilities` answers; a POST to `/api/ping` without Origin or token → 403, with the token → 200; the same `clientRequestId` sent twice → one resource, second answer `replayed: true`. In headless Chromium with the built extension loaded (popup driven with a stubbed active tab): with PIVOT unreachable the popup still saved, showed "Saved locally", the item and its screenshot were in IndexedDB and the badge showed 1; after pointing it at the running app and reopening the popup the item was sent, the queue emptied, the badge cleared, and `/api/lookup` found the page.
- Remaining issues: quick save, the context menu and the alarm-driven background sync weren't driven in a real browser (Playwright can't press extension shortcuts); they share the tested `queueSave`/`syncNow` code. Device transfer of waiting saves is Phase 6 (#51).
- Next step: Phase 3.

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
