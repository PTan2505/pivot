# Decisions — progress log

Tracks [decisions-plan.md](decisions-plan.md). Newest first.

## Status

| Phase | Name                               | Status                       |
| ----- | ---------------------------------- | ---------------------------- |
| 0     | Plan and docs                      | Done                         |
| S     | Align `pivot-design` with Part A   | Done                         |
| 1     | Reliable capture (server)          | Done                         |
| 2     | Extension that survives offline    | Done                         |
| 3     | Popup and library                  | Done                         |
| 4     | Sections, links, private pages     | Done                         |
| 5     | Design track: sessions, MCP writes | Done                         |
| 6     | Later + Optional                   | Done, with gaps listed below |

### Phase 6.4 — Optional: look elsewhere, capture sessions

- Status: Done for #6/#7 (link-out) and #36. Not built: Trusted Websites (#52), an Advanced settings group (#50).
- Existing functionality reused: `KNOWN_SOURCES` and their verified `searchUrl` templates, the saved Sources list, the popup's collection pills and `chrome.storage.session`.
- Files changed: core `known-sources.ts` (`externalSearchLinks`), test in `sources.test.ts`; web `external-search.tsx`, `library-view.tsx`; extension `lib/capture-session.ts`, `background.ts`, `popup.tsx`, `popup/parts.tsx` (Library | Elsewhere), `lib/api.ts`; SPEC §18; DESIGN.md.
- Checks run and results: core sources tests 4/4 (links for a query, saved sources first, none for an empty query, category filter); extension tests; typecheck, lint, `next build`, full suite in the hooks.
- Manual verification: headless Chromium with the built extension against the scratch app — a capture session on "Heroes" put two saves on different pages into it, the collection came preselected on the second popup, the session sits in session storage (ends with the browser); Library › Elsewhere for "pricing table" listed Dribbble, Behance, Awwwards, Landbook, Lapa Ninja, One Page Love, Siteinspire and Pinterest.

## What is still open after all phases

- **Not built:** extension-side tab recording for signed-in motion (#20; needs the `tabCapture` and `offscreen` permissions and can't be driven headless), Trusted Websites (#52), an Advanced settings group (#50), public revocable share links (#41; needs an architecture decision), "Workflow Config" (#1; undefined).
- **Partly:** #4 (Motion metadata exists as assets, not as a reference kind), #49 (errors explain cause and next step; there is no collapsed technical-details view), #63 and #65 (QA and consistent states are practised per phase, not finished work items).
- **Verification limits:** extension flows were driven in headless Chromium with a stubbed active tab or a test-only build with `<all_urls>` standing in for the `activeTab` grant; real-Chrome quick save (⌥⇧D), context menus and the alarm-driven sync weren't clicked through by hand.

### Hybrid Search H1–H4 — Free catalogs, scope switch, MCP and skill (2026-11-02)

- **Status:** Done, except one check: the headless `pivot-design` E2E with a thin library hasn't been run (it costs a paid Claude Code run).
- **Existing functionality reused:**
  - `parseQuery` (plus a new `toJsRegex`), `searchResources` unchanged, `externalSearchLinks` and `KNOWN_SOURCES`;
  - `safeFetch` (SSRF guard), the blob store, `app_settings`;
  - `/api/clip` for Save (`ifExists: "skip"`, Inbox, server capture);
  - `findByUrl`'s `urlKey` for "already in your library";
  - the `PivotSource` / `HttpSource` pattern.
- **Files changed:**
  - **core:** `external-search.ts` (new), `types.ts`, `query.ts`, `settings.ts`, `capabilities.ts`; tests `external-search.test.ts` with recorded fixtures in `test/fixtures/catalogs/`;
  - **web routes:** `api/search/external`, `api/search/providers` (and `/refresh`), `api/clip` (`origin`);
  - **web components:** `external-search.tsx` (rewritten), `library-view.tsx`, `command-palette.tsx`, `settings/page.tsx`, `resource-detail.tsx`, `lib/api.ts`, `hooks/use-library-params.ts`;
  - **MCP:** `external-tools.ts` (new) and `source.ts` in `packages/mcp-tools`, `http-source.ts` and `server.ts` in `apps/mcp`, test `external-tools.test.ts`;
  - **skill and docs:** `.claude/skills/pivot-design/SKILL.md`; SPEC §1, §6, §10, §18; DESIGN.md (Hybrid search); the plan files.
- **Checks run and results:**
  - Tests: core 104 of 104 (10 new); MCP 15 of 15 (3 new); extension 12 of 12.
  - Typecheck and lint clean; Prettier clean on the changed files.
  - The new core tests cover:
    - the cost guard (every provider free, keyless, HTTPS on its own host);
    - one sync, then local search with **zero** network calls and **no** database writes;
    - page links from the sitemap or catalog;
    - React Bits variants merged, and acronyms kept ("ASCII Text");
    - a day-old catalog resynced, a failed sync answered with the last good copy (also after a restart), no copy → `unavailable`;
    - catalogs that aren't JSON, carry code, or have only unsafe names are refused;
    - markup stripped;
    - "already in your library";
    - a switched-off provider skipped without a request;
    - refresh at most once a minute;
    - link-outs are never verified and include paid sources, never the direct providers;
    - query validation.
- **Manual verification** (scratch app on port 4400, live catalogs):
  - **Catalogs:** synced Magic UI 78, React Bits 218 and shadcn/ui 65; confirmed pages 78/78, 217/218 and 64/65; the stored catalogs hold only id, title, description, url, linkVerified and categories.
  - **Library page:** `animated list` under All shows the library empty state and then Magic UI and React Bits "Animated List".
  - **Save:** **Save to library** created one reference (Inbox, captured, `meta.externalOrigin` with provider, id, MIT, timestamps); the card turned "In your library"; the detail page shows "Found via Magic UI (MIT) search".
  - **Scopes:**
    - External hides the library list, the count and the shelf.
    - Library with no match offers "Search outside your library", which switches to External (`bento grid` → Bento Grid, Magic Bento).
  - **⌘K:** the scope switch, plus "Magic UI · Direct · MIT" and "React Bits · Direct · MIT + Commons Clause" groups for `marquee`.
  - **Settings › Search:**
    - switching React Bits off made it `disabled` in results; switching it back on restored it;
    - Refresh catalog re-downloaded Magic UI and showed a toast;
    - the checkboxes have accessible names.
  - **API:** an empty query and a 121-character query are refused with 400.
  - **Phone (375 px):** no horizontal overflow.
- **Remaining issues:**
  - The `pivot-design` headless E2E on a thin library (H3 acceptance) hasn't been run.
  - React Bits `EvilEye` and shadcn `form` have no confirmed page.
  - Whether the Magic UI free registry ever lists Pro items is still unverified.
  - SiteInspire stays link-out until its licence is verified.
  - #42 "Possibly related" is still missing.
- **Next step:** the owner's review; then the skill E2E if wanted.

### Hybrid Search H0 and H0.5 — Decisions, docs and Magic UI proof of concept (2026-11-01)

- **Status:** Done (docs and an isolated proof of concept). Nothing in the app is built; H1 waits for owner approval.
- **Existing functionality reused:**
  - `parseQuery` (`packages/core/src/query.ts`), read-only, by the proof of concept;
  - the link-out builder and `KNOWN_SOURCES` (unchanged).
- **Files changed:**
  - `docs/hybrid-search-plan.md` (new; the plan of record, replacing the two review drafts outside the repo);
  - `docs/PIVOT_DECISIONS.md` §8: six new rows, and the 2026-10-31 link-out-only row marked superseded but kept;
  - `docs/SPEC.md`:
    - §1 row 23, §6 and §13: updated;
    - §4: Elsewhere stays link-out;
    - §11: paid providers out of scope;
    - §18: current link-out behaviour, plus the approved, not-built Hybrid Search;
  - `docs/decisions-plan.md`:
    - #6, #7 and #42 re-opened;
    - C6 marked superseded;
    - new Hybrid Search phase list H0–H4.
- **Checks run and results:**
  - Prettier on the changed docs.
  - Proof of concept: `node poc.mjs` in a scratch folder outside the repo; all assertions passed:
    - live sync: 78 components;
    - local search for `marquee`, `border beam` and `animated list`, each with the right component first and 0 network calls;
    - docs URLs: 78 of 78 answered 200, after one override;
    - malformed registries refused;
    - 500, HTML and 404 fell back to the last good catalog;
    - a hang timed out at 1.5 s; DNS failure handled;
    - no cached catalog → `unavailable`.
- **Manual verification:** read the registry, an item endpoint (it contains code, so it is never fetched) and the licence.
- **Remaining issues:**
  - Whether the free registry lists Pro items is unverified.
  - Docs URLs need a sync-time check and an override map.
  - SiteInspire's licence is still unverified (link-out only).
- **Next step:** H1, after the owner approves it.

### Follow-up — Smooth full-page motion video (A6 feedback, 2026-11-01)

- Status: Done
- Why: testing A6, the owner found the motion video choppy and stopping before the end of the page, and asked for scroll videos like Refero's. Cause: the walk scrolled in 225px wheel steps every 250 ms, blocked on PNG keyframe shots mid-scroll, and stopped after 12 s, while `recordVideo` sampled whatever the screen showed.
- Existing functionality reused: Playwright's bundled ffmpeg (the one `recordVideo` used), the scroll scripts (`UNLOCK_INNER_SCROLL`, `EAGER_IMAGES`, `IMAGES_ON_SCREEN`, `NO_SMOOTH_SCROLL`), the full-page height cap, the asset roles and the `motionLikely` hint.
- Files changed: core `capture.ts` (`recordScroll` replaces `walkWithKeyframes` and `recordVideo`: every frame a CDP JPEG screenshot at its own scroll position, piped into ffmpeg VP9 at 30 fps; 1 s rest, eased glide at 900 px/s, 1 s rest; follows a page that grows; keyframes picked from the same frames; `durationMs` in the video's meta), `capture-flow.test.ts`; SPEC §12, the plan's Phase 6 line.
- Checks run and results: the motion test now checks the two rests (≥ 2 s) and that the last keyframe is at the page bottom. Real pages: linear.app/pricing → 8.4 s video in 13.5 s, scrolled to 5083px, 8 keyframes; stripe.com → 14.9 s video in 26 s, scrolled to the 12000px cap. Frame-to-frame shift measured on the decoded Linear video: 0 for the first second, ramp 2 → 30px, a steady 30px per frame (900 px/s) with no dropped or repeated frame, ramp down 28 → 0, then a second at rest.
- E2E in Chrome (scratch app, linear.app/pricing): Add → Save → Retake ▾ → Record motion gave an 8.4 s 1440×900 video with 0 dropped frames, ending on the footer, and 8 keyframes; a second recording replaced the first (still 1 video, 8 keyframes, 11 files). It also found a bug, fixed on `fix/motion-no-hover`: the pointer rested mid-screen, so table rows lit up and tooltips popped as they passed under it. The recording now never moves the pointer onto the page; a test page that turns red under a pointer checks every keyframe.
- Remaining issues: time-based animations run while each frame is shot (about 30 ms per frame), so they play at roughly real speed but a frame that waits for images shows them jump ahead. Signed-in pages still need the extension-side recording (#20).

### Phase 6.3 — Backup, restore, share package, device transfer

- Status: Done (except public share links, which need an architecture decision: the API only answers this machine).
- Existing functionality reused: the exports folder and Finder reveal, `saveAsset` (sha256 reuse), `urlKey` for "same URL", the offline queue's IndexedDB store.
- Files changed: core `backup.ts` (backup, preview, restore with keep / merge / new), `share.ts`; routes `api/backup`, `api/backup/preview`, `api/backup/restore`, `api/share`, `api/clip` (`privatePage`); web `backup-section.tsx` in Settings, `selection-bar.tsx` (Share package); extension `lib/transfer.ts`, `options.tsx` (Waiting saves), `privatePage` set on saves from pages flagged private; SPEC §11, §17; DESIGN.md.
- Checks run and results: core `backup.test.ts` 4/4 (a purged reference restored with facets, collection, screenshot and cover, annotation and link, the rest kept; a second restore adds nothing; merge fills only the emptied description and keeps the user's new title; "import as new" twice makes one copy; a tampered file name, a non-backup folder and a relative path refused; the share package leaves out notes and the private page and escapes HTML). Extension tests; typecheck, lint, full suite in the hooks.
- Manual verification: scratch app — Settings › Back up the library: 22 references, 29 files, 36 links, 1 annotation, 1 design session (3.7 MB); Preview of that folder: 22 already here; Restore with Keep: kept 22, nothing added. Share package of Linear and Notion pricing: `index.html` with both, four images. Two headless Chromium profiles with the built extension: profile A exported two waiting saves (one held for privacy approval); the file holds the screenshots and not the token; profile B imported 2, then 0 on the second import, with the approval hold kept.
- Remaining issues: no public share link; restoring into a library with the same ids but different content keeps yours unless you choose merge or new per item (the UI sets one choice for all conflicts).
- Next step: Optional items.

### Phase 6.2 — Annotations, interaction states, asset extraction

- Status: Done
- Existing functionality reused: `/api/clip` (a state is a clip with `attachTo`), the offline queue and privacy hold, `safeFetch` (SSRF guard) for picked images, `saveAsset`/`attachAsset`, the assets route's sandboxed CSP for SVG, `get_reference` in MCP.
- Files changed: core `annotations.ts`, `extract.ts`, `resources.ts` (annotations in a resource's details), `types.ts`, schema + migration `0008` (adds `asset_annotations`); routes `api/resources/[id]/annotations`, `api/annotations/[id]`, `api/resources/[id]/extract`, `api/clip` (`attachTo`, `state`); web `annotation-layer.tsx`, `asset-gallery.tsx` (Notes mode); MCP `get_reference` (annotations, section context); extension `lib/discover.ts`, `lib/api.ts`, `popup/parts.tsx` (`AddState`, `AssetPicker`), `popup.tsx`; SPEC §16, DESIGN.md.
- Checks run and results: core `annotations-extract.test.ts` 2/2 (notes on the reference's own screenshot only, boxes kept inside the image, out-of-range refused, partial edits keep the rest, the pixels unchanged; picked image and SVG saved with their source, a non-image and a non-SVG reported, font names and gradients in meta, more than 20 files refused); MCP and extension suites; typecheck, lint, full suite in the hooks.
- Manual verification: scratch app — on Notion pricing, Notes mode: dragged a box, typed a note, moved it 3% with the arrow keys; stored as a region at x 0.06 with its size and note, and MCP `get_reference` lists "Two tiers side by side, price first (region at 6%, 52% of viewport)". A real bug found and fixed on the way: the edit schema inherited the create defaults, so editing a note reset the box's size. Headless Chromium with the extension on a local test site: the page saved once, then "Add this view as a state" → "Open menu" added a `state` image to that same reference (still one reference for the URL); "Pick assets" saved the SVG icon and the gradient, and reported the logo as blocked because it sits on 127.0.0.1 (the SSRF guard; public images are covered by the unit test).
- Remaining issues: annotations live on the detail page only (not in the full-size viewer); asset discovery reads only on-screen images and same-origin stylesheets for font sources.
- Next step: Phase 6.3 (export, backup, import, share package, device transfer).

### Phase 6.1 — Capture variants, comparison, versions, requests, health

- Status: Done
- Existing functionality reused: `screenshotUrl` (now takes a viewport, a mobile mode and a motion mode), the scroll walk and stitching (now sized from the page's viewport), `capture_attempts` (a `deferred` status), asset roles and `saveAsset` dedupe, `createResource`/`createLink` for design versions.
- Files changed: core `capture.ts` (extras before the status is final, motion walk with keyframes, real mobile/tablet contexts, deferred requests, `motionLikely`), new `compare.ts` (pixel diff, design versions, capture health), `settings.ts` (`cleanCaptureOptions`), `types.ts`, `context.ts` (exports keep to Latest, states and attachments); routes `api/resources/[id]/capture` (viewports, motion, defer), `api/resources/[id]/compare` (+ `/image`), `api/resources/[id]/versions`, `api/captures/health`, `api/captures/[id]` (+ `/run`); web `asset-gallery.tsx` (labels, Retake menu, compare panel, Record motion hint), `app/captures/page.tsx` (requests, Worth a look); MCP role labels; SPEC §12, DESIGN.md.
- Checks run and results: capture tests 24/24, including 4 new ones (tablet 820 and mobile 390 in one reference and replaced per size; motion video webm + keyframes; a deferred request untouched by time and restarts until run, then done; Original vs Latest diff over 50% on the colour-swapping test page, a new design version sharing the Latest assets and linked `newer_version_of`, the old one keeping its Original; three blocked captures reported as a failing site). A real race found and fixed: the resource turned "done" before the extras were saved.
- Manual verification: scratch app, the real linear.app/pricing retaken with tablet, mobile and motion: tablet 820×1180 (+ 820×6854 full), mobile 390×844 (+ 390×7605 full), a 13.7 s 1440×900 webm that plays in the detail page, 7 keyframes; the gallery labels them "Viewport · mobile · dark" and "Motion".
- Remaining issues: extension-side tab recording (signed-in motion, #20) isn't built. The diff compares from the top at one width, so a page that grew at the top shifts everything below.
- Next step: Phase 6.2 (annotations, states, asset extraction).

### Phase 5 — Design track: sessions and MCP writes (5a proposal, 5b build)

- Status: Done. 5a is [design-track-proposal.md](design-track-proposal.md); the owner asked for every phase without stopping for review, so it was built as proposed. "Workflow Config" (#1) stays open because nothing defines it.
- Existing functionality reused: the read tools and `runTool` in `packages/mcp-tools`, `HttpSource` (now also writes, with the API token), `/api/clip` for `save_reference` (duplicates, background capture, Inbox), `findByUrl`, the Inbox from Phase 3, the Markdown renderer for briefs, `updateResource`/`addToCollection`/`createCollection` to apply accepted suggestions.
- Files changed: core `design.ts`, `suggestions.ts`, `resources.ts` (pending suggestion text is searchable; `suggestions` count), `types.ts`, `capabilities.ts` (API 4), schema + migration `0007` (adds `design_sessions`, `design_snapshots`, `design_decisions`, `resource_suggestions`); routes `api/design/*`, `api/resources/[id]/suggestions`, `api/resources/[id]/annotate`, `api/suggestions`, `api/suggestions/decide`; web `app/design` pages, `components/design-session.tsx`, `components/suggestions.tsx`, Inbox and detail page, top-bar link; MCP `packages/mcp-tools/src/write-tools.ts`, `source.ts` (`PivotWriter`), `apps/mcp/src/http-source.ts`, `server.ts` (12 tools, read-only hints), README; `.claude/skills/pivot-design/SKILL.md` (uses the tools at each step, says when a save fails); SPEC §10, §11, §15; DESIGN.md; MCP plan Step 5.
- Checks run and results: core `design.test.ts` 3/3 (session opened only by the first brief, same brief twice is one snapshot, approval → approved, major change → exploring; suggestions matched to existing facet names, skipped when already present or repeated, searchable while pending, applied only when accepted, rejected text no longer found; agent notes appended); MCP `write-tools.test.ts` 6/6 plus the read tests (read-only connection refuses, input validation, collection names resolved); typecheck, lint, `next build` (it caught a `params` access outside `<Suspense>` on `/design/[id]`, fixed), full suite in the hooks.
- Manual verification:
  - Full headless `pivot-design` run against the scratch app, with the MCP pointed at it and three real pricing references (Linear, Notion, Supabase) captured by the Phase 1 pipeline. Turn 1 ($1.19, 176 s): read the design system, searched, inspected 3 references, `save_design_brief` initial, 3 mockups in its scratch folder, stopped for the pick; project `git status` clean. Turn 2 after "Approved: direction 1" ($1.72, 90 s): `record_design_decision` approval, `save_design_brief` approved, built `pricing.html` + `styles/pricing.css`, checked 1280 and 375 px, said plainly that the Yearly view wasn't checked in a browser (its script needed a permission the headless run didn't have), recorded no deviations; the target repo has only those two code files.
  - The session shows in the app as Approved with the first brief, the approval and the approved brief. Three suggestions sent through the API: the text was searchable at once, the Inbox listed them, Accept on "Style: Dark" added the facet.
- Remaining issues: the agent never called `suggest_metadata` on its own in the run (it's optional in the skill). Mockup images aren't stored. "Workflow Config" undefined.
- Next step: Phase 6.

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
