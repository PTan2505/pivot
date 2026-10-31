# Decisions — implementation plan

Brings PIVOT in line with the approved decisions in [PIVOT_DECISIONS.md](PIVOT_DECISIONS.md): Part A (the `pivot-design` skill, MCP and the design workflow) and Part B (the 65 Chrome extension decisions). Progress is logged in [decisions-progress.md](decisions-progress.md).

Choices the owner made when this plan was written (2026-10-31):

- The plan covers the design track too: Design Sessions, briefs stored in PIVOT, MCP write tools.
- Private pages: PIVOT guesses, and holds a flagged capture for approval before upload.
- AI runs through Claude Code over MCP. The app keeps no model API key.
- No "just build it" exception: a concrete design direction is always approved before implementation. "Just build it" or "skip mockups" only reduces the mockups to one direction, which still waits for approval.
- The skill changes for Part A go into PR #34 (`feat/pivot-design-skill`) before it is merged.

Rules for every phase:

- Migrations only add tables or columns. No existing data, route or API is removed.
- Each PR updates [SPEC.md](SPEC.md) (and [DESIGN.md](../DESIGN.md) for UI changes) in the same branch.
- `pnpm check` passes before a phase is called done. A decision is ticked only when it is verified in the running app or by a test.

## 1. Where the code stands (audit, 2026-10-31)

| Area           | Exists                                                                                                                      | Partial                                                                                                   | Missing                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Server capture | Viewport then stitched full page; SSRF guard on every hop; 120 s cap; Open Graph fallback; pending captures resume on start | Partial results (a retake still drops the old full page when no new one is made)                          | Automatic retry, `Retry-After`, Original/Latest, a Partial status, capture quality, light/dark choice, capture context, video              |
| Extension      | ⌥⇧S popup, ⌥⇧D quick save, context menus, type picker, facet autocomplete, token ping, offline vs bad-token screens         | Duplicate warning (one title only), collection picker (one, a `<select>`), screenshot review (popup only) | Offline queue, idempotency, version check, quick edit after save, Library tab, recent activity, section/crop capture, redaction, recording |
| Library (web)  | Grid, facets, via-source, collections, trash, AI-context export, Retry on the detail page                                   | No collection filter on the main library; adding to several collections is one at a time                  | Needs-review inbox, Capture Queue page, links between items, provenance, activity log, backup/import, sharing                              |
| MCP / design   | Four read-only tools, `pivot-design` skill                                                                                  | —                                                                                                         | Write tools, Design Sessions, stored briefs, agent suggestions                                                                             |

## 2. Conflicts with the current code or docs

Each is resolved in the phase shown; the decision document's amendments table records them.

| #   | Conflict                                                                                                                                   | Resolution                                                                                                       | Phase |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----- |
| C1  | **Load More (#12):** `CLICK_LOAD_MORE` runs on every full-page capture. SPEC #7 describes it as always on.                                 | Off by default; an `expandContent` option turns it on. Scrolling and lazy-load stay.                             | 1     |
| C2  | **Retake (#18):** `captureOne` and `replaceScreenshot` detach and delete the old shots. SPEC #7 says a retake replaces them.               | Keep the first successful capture as Original and the newest as Latest.                                          | 1     |
| C3  | **Theme (#11):** the server always emulates `colorScheme: "dark"` and doesn't record it.                                                   | Record the scheme; Light / Dark / Both on request; no simulated theme.                                           | 1     |
| C4  | **Quick save uploads the tab screenshot at once (#24, #37).**                                                                              | Guess private pages and hold flagged captures locally for approval.                                              | 4     |
| C5  | **Share links (#41) vs a localhost-only API** (`proxy.ts`, which CLAUDE.md says to keep).                                                  | Build the Share Package (a file) only. A public link needs its own architecture decision.                        | 6     |
| C6  | **External source search (#6, #7):** Refero, Dribbble and the like have no public search API, and scraping breaks their terms.             | An External tab that opens the `searchUrl` templates in `known-sources.ts`; nothing is stored.                   | Opt.  |
| C7  | **CLAUDE.md froze MCP and workflows; SPEC §11 lists backup/restore, resource links and AI tagging as out of scope.**                       | CLAUDE.md updated in Phase 0. SPEC §11 is edited as each item is built.                                          | 0+    |
| C8  | **Security (#62):** `proxy.ts` treats a write with neither `Origin` nor `Sec-Fetch-Site` as same-origin, so it needs no token.             | Require the token for non-browser writes, after checking what relies on the current behaviour.                   | 2     |
| C9  | **Duplicates (#10):** the server only skips a duplicate with the same URL **and** type.                                                    | Warn on the same URL whatever the type; quick save keeps skipping on URL + type, so the API doesn't change.      | 3     |
| C10 | **Approval gate (A2.7, A8):** `pivot-design` builds at once when the user says up front to go ahead.                                       | Remove the exception; "just build it" only reduces the mockups to one direction, which still waits for approval. | S     |
| C11 | **Names before approval (A8):** an earlier draft of this plan named MCP write tools and session tables, but A8 says those are not decided. | Phase 5a writes a proposal; nothing is built until it is approved.                                               | 5a    |

## 3. Part A — skill, MCP and design workflow

Compared with `.claude/skills/pivot-design/SKILL.md` as it stands in PR #34.

| Part A                                                                                                                | Today                                                                                    | Phase | Done |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----- | ---- |
| A1. Roles: generated briefs, decisions and session notes never go into the target repo                                | Partial: the brief is only shown to the user and mockups go to a scratch folder; no rule | S     | [x]  |
| A2. Nine steps: requirements → discover → select 2–4 → brief → session → 2–3 mockups → approval gate → implement → QA | Partial: seven steps, no session, no recorded decision, QA folded into Build             | S, 5b | [ ]  |
| A2.7, A8. No implementation before explicit approval                                                                  | Conflict: the "go ahead" exception (C10)                                                 | S     | [x]  |
| A3. Brief snapshots in PIVOT at initial, approved and major-change milestones; a major change goes back to the gate   | Missing                                                                                  | S, 5b | [ ]  |
| A4. Session after the first completed brief; tiny fixes create none                                                   | Partial: the small-fix exception exists; sessions don't                                  | 5b    | [ ]  |
| A5. MCP read tools exist; with no write tools, say so and never fall back to the target repo                          | Partial: four read tools; no rule about the missing writes                               | S, 5b | [ ]  |
| A6. Extension → Library → MCP → skill; states and versions are evidence on one Reference                              | Partial: covered by Part B Phases 1, 4 and 6                                             | 1–6   | [ ]  |
| A7. Prefer confirmed metadata and real screenshots over AI labels; external results are never saved automatically     | Partial: no AI labels yet; saved Sources are only named                                  | 5b    | [ ]  |
| A8. Not decided: skill command syntax, write-tool names and schemas, approval schema, mockup rendering, QA automation | Open                                                                                     | 5a    | [ ]  |
| A9. Review checklist (2–4 references and 2–3 mockups as defaults, a strict gate, Capture Session ≠ Design Session)    | The skill already uses 2–4 and 2–3                                                       | S, 5a | [ ]  |

## 4. Part B — decisions by phase

Status is today's code: **Exists**, **Partial**, **Missing** or **Conflict**. "Done" is ticked only once verified.

| #   | Decision                            | Today    | Phase     | Done |
| --- | ----------------------------------- | -------- | --------- | ---- |
| 1   | MVP scope                           | Partial  | 1–5       | [ ]  |
| 2   | Design Session after first brief    | Missing  | 5         | [ ]  |
| 3   | Brief snapshots inside PIVOT        | Missing  | 5         | [ ]  |
| 4   | One record + optional metadata      | Partial  | 4, 6      | [ ]  |
| 5   | Collections vs facets               | Partial  | 3         | [ ]  |
| 6   | Source Directory 2.0                | Partial  | Optional  | [ ]  |
| 7   | Unified search All/Library/External | Partial  | 3, Opt.   | [ ]  |
| 8   | Section references                  | Missing  | 4         | [ ]  |
| 9   | Auto / Crop / Select capture        | Partial  | 4         | [ ]  |
| 10  | Duplicates with thumbnails          | Partial  | 3         | [ ]  |
| 11  | Theme Light/Dark/Both               | Conflict | 1         | [x]  |
| 12  | Expand content opt-in               | Conflict | 1         | [x]  |
| 13  | Facet suggestions (agent)           | Missing  | 5         | [ ]  |
| 14  | Quick save → Needs review           | Missing  | 3         | [ ]  |
| 15  | Quick edit in the extension         | Missing  | 3         | [ ]  |
| 16  | Failure and bounded retry           | Partial  | 1         | [x]  |
| 17  | Capture Queue                       | Partial  | 1, 3      | [ ]  |
| 18  | Original / Latest                   | Conflict | 1         | [x]  |
| 19  | Collection suggestions              | Missing  | 3, 5      | [ ]  |
| 20  | Motion: suggest and record          | Missing  | 6         | [ ]  |
| 21  | Scroll animation, keyframes         | Partial  | 6         | [ ]  |
| 22  | Section context                     | Missing  | 4         | [ ]  |
| 23  | Responsive capture                  | Missing  | 6         | [ ]  |
| 24  | Signed-in pages                     | Partial  | 4         | [ ]  |
| 25  | Redaction                           | Missing  | 4         | [ ]  |
| 26  | Status vs quality vs review         | Partial  | 1         | [x]  |
| 27  | Relationships                       | Missing  | 4         | [ ]  |
| 28  | Design Versions                     | Missing  | 6         | [ ]  |
| 29  | Annotations                         | Partial  | 6         | [ ]  |
| 30  | Layered metadata                    | Partial  | 5         | [ ]  |
| 31  | Provenance                          | Partial  | 3         | [ ]  |
| 32  | Selective asset extraction          | Missing  | 6         | [ ]  |
| 33  | Interaction states                  | Missing  | 6         | [ ]  |
| 34  | Naming `[Section] — [Source]`       | Partial  | 4, 5      | [ ]  |
| 35  | Review Inbox                        | Missing  | 3, 5      | [ ]  |
| 36  | Capture Sessions                    | Missing  | Optional  | [ ]  |
| 37  | Offline queue                       | Missing  | 2         | [x]  |
| 38  | Storage and retention               | Partial  | 1         | [ ]  |
| 39  | Export                              | Partial  | 6         | [ ]  |
| 40  | Import / restore                    | Missing  | 6         | [ ]  |
| 41  | Sharing                             | Missing  | 6         | [ ]  |
| 42  | Extension search                    | Missing  | 3         | [ ]  |
| 43  | Notifications                       | Partial  | 2         | [x]  |
| 44  | Shortcuts and context menu          | Exists   | 4         | [ ]  |
| 45  | Onboarding and connection           | Partial  | 2         | [x]  |
| 46  | API compatibility                   | Missing  | 2         | [x]  |
| 47  | Performance budget                  | Partial  | 1         | [x]  |
| 48  | Accessibility                       | Partial  | 3, 4      | [ ]  |
| 49  | Error diagnostics                   | Partial  | 1, 2      | [ ]  |
| 50  | Settings groups                     | Partial  | 3, Opt.   | [ ]  |
| 51  | Device migration                    | Missing  | 6         | [ ]  |
| 52  | Least-privilege permissions         | Partial  | 2, 4      | [ ]  |
| 53  | Lifecycle and recovery              | Partial  | 1, 2      | [ ]  |
| 54  | Activity log                        | Missing  | 1, 3      | [ ]  |
| 55  | Cancel / Undo / Discard             | Partial  | 1, 3      | [ ]  |
| 56  | Deferred capture                    | Missing  | 6         | [ ]  |
| 57  | Capture context snapshot            | Missing  | 1         | [x]  |
| 58  | Capture comparison                  | Missing  | 6         | [ ]  |
| 59  | Health signals                      | Missing  | 6         | [ ]  |
| 60  | Progressive disclosure              | Partial  | 3         | [ ]  |
| 61  | Lightweight extension               | Exists   | all       | [ ]  |
| 62  | Secure defaults                     | Partial  | 2         | [x]  |
| 63  | Risk-based QA                       | Partial  | all       | [ ]  |
| 64  | Core first, advanced phased         | —        | this plan | [x]  |
| 65  | Unified states and actions          | Partial  | all       | [ ]  |

## 5. Phases

### Phase 0 — Plan and docs

- [x] Audit the extension, server and web app against the decisions (§1, §4).
- [x] Record the conflicts (§2) and the owner's choices.
- [x] Update CLAUDE.md's current focus.
- [x] Fold in Part A: the baseline is now the consolidated [PIVOT_DECISIONS.md](PIVOT_DECISIONS.md) with the amendments kept; Part A table (§3), conflicts C10 and C11, Phase S, Phase 5 split into 5a and 5b.

### Phase S — Align `pivot-design` with Part A (commits on PR #34)

- [x] Nine steps: Understand → Search → Inspect → Choose (2–4) → Brief → Design Session → Mockups (2–3) → Approval gate → Build → QA. The session and "record the approved decision" steps say: save to PIVOT once it has write tools; until then tell the user it isn't saved, and never write it into the target repo.
- [x] Remove the "go ahead" exception at the top of the skill and in §6. "Just build it" or "skip mockups" means one direction, still waiting for approval.
- [x] A major change after approval (structure or direction) goes back to the gate; small changes inside the approved direction don't.
- [x] QA as its own step: check the result against the approved direction at desktop and phone widths and in the states that matter; report deviations instead of quietly changing the decision.
- [x] Keep the small-fix exception, with no session (A4).
- [x] SPEC §10, `search-mcp-progress.md` (an "Approval gate (strict)" row, **Not tested** until run) and Step 3 of `SEARCH_MCP_IMPLEMENTATION_PLAN.md`.
- [x] Verify headless on a copy of the Ledgerly target: "just build it, design the pricing page" ends with one direction and a question, `git status` clean; a small fix ("raise the contrast of the footer links") skips the library and the brief.

### Phase 1 — Reliable capture (server)

New table `capture_attempts` (additive): id, resource_id, method (`server` | `extension`), requested_at, started_at, finished_at, status (`queued` | `capturing` | `completed` | `partial` | `failed` | `cancelled`), quality (`looks_good` | `needs_review` | `unavailable`), quality_reasons, error, context (viewport, colorScheme, finalUrl, expandContent, capturedAt), viewport_asset_id, full_asset_id.

- Original is the first successful attempt and Latest the newest. `resource_assets` keeps pointing at Latest, so cards, MCP and export don't change.
- Orphan cleanup (`deleteOrphanAssets`) skips assets an Original attempt still references.
- Existing items get a `legacy` attempt built from their current shots.

Tasks:

- [x] `expandContent` option, off by default: a global default in Settings, a per-capture override in the popup and the Retake menu (#12, #47).
- [x] Bounded retry: up to 2 retries for timeouts, network errors and 502/503/504; honour `Retry-After` on 429 up to 10 minutes; never for 401/403, bot challenges or unsafe URLs (#16).
- [x] A retake that makes no new full page keeps the old one.
- [x] Capture quality: near-blank images (`sharp` stats), login walls, bad stitching. A suspicious shot never replaces a good Latest (#26).
- [x] Record `colorScheme`; Light / Dark / Both on request; the detail page shows a theme switch only when both exist (#11).
- [x] The queue lives in `capture_attempts`; Cancel for queued and running attempts (#17, #55).

Files: `packages/core/src/capture.ts`, `db/schema.ts` (+ `pnpm db:generate`), `assets.ts`, `apps/web/src/app/api/resources/[id]/capture/route.ts`, `components/asset-gallery.tsx`.

### Phase 2 — Extension that survives being offline

- [x] `/api/clip` takes `clientRequestId`, stored in `resources.client_request_id` (unique, nullable); a repeat returns the existing item (#37).
- [x] Pending Sync queue in the extension's IndexedDB (payload and image). `Saved locally` becomes `Synced` only on a 2xx. Sync when the popup opens, on browser start and on `chrome.alarms`, with backoff. Never recapture the site; warn near the storage limit.
- [x] `GET /api/capabilities` returns `{ apiVersion, features[] }`. The extension tells server off, bad token and unsupported feature apart; unsupported items stay queued (#45, #46).
- [x] Notification targets in `chrome.storage.session`; "Saved" only after the server confirms (#43).
- [x] Require the token for non-browser writes (C8).
- [x] Vitest for the extension's queue logic, wired into `pnpm test`.

Files: `apps/extension/src/background.ts`, `lib/api.ts`, new `lib/queue.ts`, `public/manifest.json`, `apps/web/src/app/api/clip/route.ts`, `apps/web/src/proxy.ts`.

### Phase 3 — Popup and library

- [ ] `/api/lookup` returns 2–3 items with thumbnails and a total; the popup offers Open Existing, Save New and View All (`/?url=`) (#10).
- [ ] Quick edit after save: title, notes, facets, collections; never forced (#15).
- [ ] Several collections per save, 2–3 recent or frequent ones shown first; `/api/clip` takes `collectionIds[]` and still accepts `collectionId`; a `?collection=` library filter (#5, #19).
- [ ] `resources.review_status`; quick save sets `needs_review`; the Inbox is a library filter with Accept, Edit, Skip and multi-select; review never hides an item from search or MCP (#14, #35).
- [ ] Capture Queue page and Recent Activity from `capture_attempts`, with Retry and Cancel; no invented progress (#17, #54).
- [ ] Popup `Capture` / `Library` tabs: quick search, recently saved, "Saved from this page", "Saved from this website", Pending Sync labels (#42).
- [ ] Provenance: `capturedUrl` beside the canonical URL and the final URL after redirects; an optional `publishedBy` the user fills in (#31).
- [ ] Accessibility fixes from the audit: tablist arrow keys, selected state in the type picker, the dangling `label htmlFor`, live regions for the duplicate and success messages (#48).

Files: `apps/extension/src/popup/popup.tsx`, `apps/web/src/app/api/lookup/route.ts`, `hooks/use-library-params.ts`, `components/library-view.tsx`, `packages/core/src/resources.ts`, `search.ts`.

### Phase 4 — Sections, links, private pages

- [ ] `resource_links(from_id, to_id, kind, confirmed, created_at)`: `same_source_page`, `part_of`, `related_to`, `variant_of`, `newer_version_of`. Auto-link only on the same normalised URL; other links wait for confirmation (#27).
- [ ] Section capture injected on request (activeTab + scripting): Select Element, Manual Crop and a keyboard Section List. Crop from `captureVisibleTab` by `devicePixelRatio`; tall sections are scrolled and stitched in the tab, within a budget. Store the rect, viewport, scroll position, a selector hint and the section type; link `part_of` the page when it is saved. Default title `[Section] — [Source]`, page title kept in meta (#8, #9, #22, #34, #48).
- [ ] Private guess: a password field or sign-in form; the server, without cookies, gets 401/403 or a redirect to a sign-in page; URLs like `app.`, `/dashboard`, `/settings`, `/account`. Flagged pages get a review step with redaction in the popup; quick save holds them as "Needs approval" with an action-required notification (#24).
- [ ] Redaction: suggested masks (filled inputs, emails, amounts) plus drawn boxes, keyboard operable; opaque pixels painted on an `OffscreenCanvas` before upload; no unredacted copy kept (#25).

Files: new `apps/extension/src/content/select.ts`, new `lib/redact.ts`, `popup/popup.tsx`, `packages/core/src/db/schema.ts`, new `packages/core/src/links.ts`.

### Phase 5 — Design track: sessions and MCP writes

A8 says the write-tool names and schemas, the approval schema, mockup rendering and QA automation are not decided, so this phase starts with a proposal.

**5a. Proposal for review** (a `docs/` PR, no code)

- [ ] `docs/design-track-proposal.md`:
  - data: sessions, snapshots (initial, approved, major_change), decisions, approval state and its history;
  - MCP write tools: names, inputs, outputs, idempotency. Candidates: `save_design_brief`, `record_design_decision`, `suggest_metadata`, `save_reference`, `annotate_reference`;
  - how the skill calls them at each A2 step;
  - what "Workflow Config" (#1) could mean, as questions for the owner;
  - where mockups are rendered and whether their images are kept in the session;
  - how much QA is automated.
- [ ] The owner approves or amends it before 5b starts.

**5b. Build the approved proposal.** Expected scope:

- [ ] Additive migrations for sessions, snapshots and decisions.
- [ ] Token-gated MCP write tools: `http-source.ts` sends the Bearer token, and C8 in `proxy.ts` is fixed.
- [ ] Agent suggestions through Claude Code (#13, #19, #30, #34): searchable but not official facets until accepted; confirmed data is never overwritten.
- [ ] The skill saves the first-brief snapshot (which creates the session), the approved snapshot and major-change snapshots; records the decision at the gate; prefers confirmed metadata and real screenshots over AI labels (A7); when a write fails, it says so and never writes into the target repo.
- [ ] Web: a Design Sessions page (list, snapshot timeline, approval history); agent suggestions in the Inbox.

Files: `packages/mcp-tools/src/tools.ts`, `apps/mcp/src/http-source.ts`, new routes in `apps/web/src/app/api`, `.claude/skills/pivot-design/SKILL.md`, Step 5 of [SEARCH_MCP_IMPLEMENTATION_PLAN.md](SEARCH_MCP_IMPLEMENTATION_PLAN.md).

### Phase 6 — Later (one PR each, when wanted)

- [ ] Motion: server video with Playwright `recordVideo` on request, plus keyframes; extension tab recording through `tabCapture` or an offscreen document; never restarted automatically (#20, #21).
- [ ] Responsive: Desktop / Tablet / Mobile server shots on request, in the same reference (#23).
- [ ] Interaction states (#33) and pin or region annotations (#29).
- [ ] Design Versions and visual diff (#28, #58).
- [ ] Export / import / backup and device transfer, reusing `exportBundle` in `context.ts` (#39, #40, #51).
- [ ] Share Package as a file (#41).
- [ ] Selective asset extraction (#32), deferred capture (#56), health alerts (#59).

### Optional

- [ ] Trusted Websites (#52), Capture Sessions (#36), the External link-out tab (#6, #7), an Advanced settings group (#50).

## 6. Verification for each phase

- `pnpm check`, with new core tests for capture, clip and links, Vitest for the extension queue, and MCP write-tool tests (token required, no overwrite of confirmed data).
- A scratch app: `DATABASE_URL= PIVOT_DATA_DIR=<tmp> PORT=4400 node scripts/start.mjs` with the `R2_*` variables unset.
- Real pages (#63): a public page; a signed-in page (review and redaction appear); the server stopped mid-save (`Saved locally` → `Synced`, no duplicate); a duplicate save; a bot-blocked page (no automatic retry); a retake (Original kept); Load More off and on.
- Extension: `pnpm ext:build`, load unpacked, drive it with Playwright `launchPersistentContext` where possible and log manual checks otherwise.
- Phase S: the two headless runs above.
- Phase 5b: rerun the full headless `pivot-design` test (brief → mockups → approval → build → QA); the initial and approved snapshots and the decision are in PIVOT, the target project's `git status` shows only code, and mockups aren't committed.

## 7. Order

Phase 0 → **S** (on PR #34, then the owner merges it) → 1 → 2 → 3 → 4 → 5a → 5b → 6.

- 5a is docs only and can be written alongside Phases 1–2, so the owner has time to review it.
- Each phase brings its own migration; they land one at a time to avoid clashes in `schema.ts`.

Report each phase in the progress log in this format:

```md
### Phase N — <name>

- Status: Done / Partial / Blocked
- Existing functionality reused:
- Files changed:
- Checks run and results:
- Manual verification:
- Remaining issues:
- Next step:
```
