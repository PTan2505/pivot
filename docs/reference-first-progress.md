# Reference first — progress log

Tracks [reference-first-plan.md](reference-first-plan.md). The checklist lives in the plan; tick an item there only once it is verified in the running app or by a test. Each phase gets an entry below in the plan's §6 format, newest first.

## Status

| Phase | Name                        | Status      |
| ----- | --------------------------- | ----------- |
| 0     | Audit and baseline          | Done        |
| 1     | Save references             | Done        |
| 2     | Organize references         | Done        |
| 3     | Find and reuse              | Not started |
| 4     | Sources and browser capture | Not started |
| 5     | Real-use validation         | Not started |

## Open issues

Ordered by impact on save → organize → find → reuse. IDs are used in later entries. "Verified" means seen in the running app or reproduced; the rest is from reading the code.

| ID  | Phase | Issue                                                                                                                                                                                                                                                                                                                                                                                                 | Evidence                                                                      |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| G1  | 1     | **Fixed in Phase 1.** **Description is lost when Save is pressed before the page details load.** The dialog sends `description: ""`, and the route only fills it with `??=`, so `""` sticks. Verified: linear.app saved with an empty description although its metadata has one.                                                                                                                      | `add-url-dialog.tsx:95,106`; `api/from-url/route.ts:45-54`                    |
| G2  | 1     | **Fixed in Phase 1.** **Bot walls and blocked pages are saved as successful captures.** `page.goto` does not fail on 403/5xx or challenge pages, so the "blocked" page becomes the screenshot with status `done`. Verified in the real library: Land-book and Lapa Ninja source cards show "Sorry, you have been blocked" / "Performing security verification".                                       | `capture.ts:169-209`                                                          |
| G3  | 1     | **Fixed in Phase 1.** **A capture can stay "pending" forever and stall the queue.** No per-capture timeout (one frozen page blocks the single serial worker); `new URL(row.sourceUrl)` sits outside the `try`, and an empty `sourceUrl` returns without updating status. Stuck rows re-queue on every start.                                                                                          | `capture.ts:223-262, 273-284, 294-298`                                        |
| G4  | 1     | **Fixed in Phase 1.** **Retake detaches the old screenshots before the new ones are saved.** If saving fails (e.g. R2 error) the old shots disappear from the resource. Must be fixed before other capture changes.                                                                                                                                                                                   | `capture.ts:233-241`                                                          |
| G5  | 1     | **Fixed in Phase 1.** **A manually uploaded or chosen cover never shows on a reference card** that has a full-page shot: the card always scrolls `fullShot`. Replacing a screenshot is also two steps (upload, then Set as cover); an upload can become the cover even if it isn't an image.                                                                                                          | `resource-card.tsx:228, 242-245`; `api/resources/[id]/assets/route.ts:25`     |
| G6  | 1     | **Fixed in Phase 1.** **Invalid URL gives no message**: Save is just disabled (verified with "not a url"); in bulk adds invalid lines are only counted as "N skipped". No toast when a capture fails.                                                                                                                                                                                                 | `add-url-dialog.tsx:37-42`; `api/from-url/route.ts:36-37`                     |
| G7  | 1, 4  | **Fixed in Phase 1.** **Duplicates are only warned about in the Add dialog and the extension popup.** Quick-save (⌥⇧D), context menus, `/api/clip` and `POST /api/resources` never check; a single-URL save warns but doesn't block. `urlKey` doesn't drop `utm_*` params.                                                                                                                            | `background.ts:57-69`; `api/clip/route.ts`; `net-guard.ts:15-24`              |
| G8  | 3     | **No "oldest first" sort.** Sort is `updated` / `created` (newest) / `title`, with fixed directions. Required by the plan.                                                                                                                                                                                                                                                                            | `resources.ts:183-190`; `library-view.tsx:232-241`                            |
| G9  | 3     | **No one-click "Clear filters"**, and the "No matches" state has no action. An empty type or category page shows "Nothing here yet" (with the paste hint) because `filtered` ignores type and category.                                                                                                                                                                                               | `library-view.tsx:198, 286-303`                                               |
| G10 | 4     | **"Saved from this source · N" disagrees with the list it opens.** Attribution counts every type, but `/?via=` lands in the Library section, which lists visual types only. Known-source aliases are ignored; two sources on one host resolve unpredictably (no ORDER BY).                                                                                                                            | `resources.ts:404-425`; `library-view.tsx:146`                                |
| G11 | 4     | **Extension saves are lost when the app isn't running** (notification only, no queue or retry). A wrong or rotated token is only found at Save, and the popup then swaps to the Connect screen, losing typed notes and tags.                                                                                                                                                                          | `apps/extension/src/lib/api.ts:36-38`; `background.ts:46-55`; `popup.tsx:182` |
| G12 | 3     | **Detail page "Open" can be a broken relative link** after editing the Source URL: it uses the local draft, not the normalized URL from the server.                                                                                                                                                                                                                                                   | `resource-detail.tsx:105-106, 576-581`                                        |
| G13 | 3     | **No zoom or lightbox for screenshots.** The full-page shot is only scrollable at fit width in a 75vh box, or as the raw file in a new tab.                                                                                                                                                                                                                                                           | `asset-gallery.tsx:114-119`; `asset-preview.tsx:78-86`                        |
| G14 | 2     | **Mostly fixed in Phase 2** (create from the popover, sidebar text, stale name; collections as a library filter and editing the description are left). **Collections friction:** the Add-to-collection popover can't create a collection and says "create one in the sidebar" (there is no sidebar); the breadcrumb keeps the old name after a rename; collections can't be used as a library filter. | `selection-bar.tsx:31`; `collections/[id]/page.tsx:22,38`                     |
| G15 | 4     | **Known-source description dropped** when a Source is saved through Add URL or the extension (`description ?? ""`). Popup offers and announces a full-page capture for Sources, which never happens (behaviour is correct, wording isn't). No "Source" type suggestion for known hosts.                                                                                                               | `from-url/route.ts:49,54`; `clip/route.ts:54`; `popup.tsx:224-226, 426-441`   |
| G16 | 2     | **Fixed in Phase 2.** **Facets can only be filtered through the mixed pill row**; pills don't show their kind (tooltip only).                                                                                                                                                                                                                                                                         | `tag-pills.tsx:70-82`                                                         |
| G17 | 2     | **Fixed in Phase 2.** Small translucent blurred controls sit on card screenshots on hover (select box, action buttons), against DESIGN.md's "nothing translucent on saved work". Low.                                                                                                                                                                                                                 | `resource-card.tsx:63, 76`                                                    |
| G18 | 0     | `pnpm format:check` fails: 6 files in the repo were never formatted, and `.claude/worktrees/` (another session's checkout) isn't in `.prettierignore` (34 files).                                                                                                                                                                                                                                     | `apps/web/src/lib/utils.ts`, `packages/core/src/metadata.ts` and 4 more       |

### Security and data-loss risks

| ID  | Severity | Risk                                                                                                                                                                                                                                                                                                                                              | Evidence                                       |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| S1  | High     | **Fixed in Phase 1.** **SSRF guard bypass with IPv6 forms.** Reproduced: `assertPublicUrl` allows `http://[::ffff:127.0.0.1]:4321/`, `http://[::ffff:a9fe:a9fe]/` (the cloud-metadata address) and `http://[fe90::1]/`; it only recognises the dotted `::ffff:` form and the `fe80` prefix. The test passes the dotted string, so it misses this. | `net-guard.ts:44-47`; `pure.test.ts:33`        |
| S2  | Medium   | **Redirects bypass the capture route guard.** Playwright calls a route handler only for the first URL of a redirect chain, so a public URL that redirects to a private host can be screenshotted. Service workers and WebSockets aren't blocked either.                                                                                           | `capture.ts:172-182`                           |
| S3  | Medium   | **Fixed in Phase 1.** Data loss on retake (G4); a cover the user sets during a capture is overwritten by the capture's stale read; an OG-image fallback cover sticks after a successful retake.                                                                                                                                                   | `capture.ts:225, 233-247, 257`                 |
| S4  | Low      | DNS rebinding: the guard resolves DNS, then fetch / Chromium resolve again.                                                                                                                                                                                                                                                                       | `net-guard.ts:59-90`                           |
| S5  | Low      | `GET /api/settings/token` needs no token, so any local process or extension with localhost access can read it; the token only protects against websites.                                                                                                                                                                                          | `api/settings/token/route.ts:4-6`              |
| S6  | Low      | `sourceUrl` can store any string (including `javascript:`) because `cleanUrl` falls back to the raw input; cards `window.open` it. Needs same-origin or token access to write.                                                                                                                                                                    | `resources.ts:271-278`; `resource-card.tsx:93` |
| S7  | Low      | Uploads: type is checked by extension only (served with `nosniff` and a sandbox CSP); the 200 MB limit runs after buffering; `safeFetch` truncates oversized downloads silently.                                                                                                                                                                  | `assets.ts:16-61, 133`; `net-guard.ts:111-114` |

## Log

### 2026-10-30 — Phase 2: Organize references

- **Status:** Done.
- **Existing functionality reused:** facets as typed tags with suggestions, the tags editor on the detail page / Add dialog / extension, autosave on the detail page, AND tag filtering, collections (create, rename, delete, add, remove), the collection page with its own filters.
- **Files changed:**
  - `components/selection-bar.tsx`: the Add-to-collection popover finds or creates a collection ("Create “name”" adds the selection to it); the wrong "create one in the sidebar" text is gone (G14).
  - `app/collections/[id]/page.tsx`: renaming refreshes the collection's own query, so the breadcrumb follows (G14).
  - `components/tag-pills.tsx`: visible filter pills are grouped under their kind (Tags, Page type, Domain, Style, Pattern); a chosen facet shows its kind (G16).
  - `components/resource-card.tsx`: the hover select box and action buttons are solid surface-raised, no translucency or blur (G17).
  - Tests: `library.test.ts` — rename, collection + tag filter combined, remove, delete keeps the resources.
  - Docs: SPEC §1 #12 and §7 (tag pill row); DESIGN.md (pills, resource card, selection bar).
- **Checks run and results:** `pnpm typecheck`, `pnpm lint` pass; `pnpm test` 39/39. Changed files pass Prettier.
- **Manual verification** (scratch app, 20 references seeded with page type, domain, style, pattern and tags, no captures):
  - Filter row shows groups Tags · Page type · Domain · Style · Pattern, then "+7 more".
  - Pricing + Minimal → 4 cards (the four pricing pages tagged Minimal); the URL keeps both tags.
  - Selected 3 cards → Collection → typed "Dashboards" → Create row → collection created with 3 items.
  - Renamed it to "Dashboards & apps" on its page → breadcrumb and the Collections menu show the new name.
  - Inside the collection, the filter row lists only its tags.
  - Card hover controls: solid `rgb(34, 24, 18)`, `backdrop-filter: none`.
  - Edited a title on the detail page, reloaded → kept.
- **Remaining issues:** collections are not a filter in the main library (the collection page has its own filters); a collection's description can't be edited in the UI; G8–G13, G15, G18 and S2, S4 for later phases.
- **Next step:** Phase 3 — find and reuse (oldest-first sort, clear filters, detail view, Open link).

### 2026-10-29 — Phase 1: Save references

- **Status:** Done.
- **Existing functionality reused:** the Add from URL dialog and `/api/from-url`, the Playwright capture queue, `saveAsset` / `attachAsset` / `deleteOrphanAssets`, the asset upload route, the extension's `/api/clip`.
- **Files changed:**
  - `packages/core/src/net-guard.ts`: IPv6 checked byte by byte (S1).
  - `packages/core/src/capture.ts`: 120 s cap per capture; block, bot-check and error pages fail with a reason; new shots are linked before old ones are unlinked; the cover is re-read after the capture; the OG fallback stands in as a screenshot so a later capture replaces it; `replaceScreenshot` (G2–G5, S3).
  - `packages/core/src/resources.ts`, `apps/web/src/app/api/from-url/route.ts`, `api/clip/route.ts`: an empty description is filled from the page, or from the known source (G1, G15).
  - `apps/web/src/app/api/resources/[id]/assets/route.ts`, `lib/api.ts`, `components/asset-gallery.tsx`: **Replace screenshot** (also for Sources) and **Upload one** next to Retry; only an image upload can become the cover (G5).
  - `components/add-url-dialog.tsx`: says why Save is unavailable (G6). `components/global-layer.tsx`: toast when a capture this tab watched fails (G6). `components/ui/sonner.tsx`: toasts always dark, description in ink-muted (it was dark grey on glass when the OS was in light mode).
  - `api/clip/route.ts`, `apps/extension/src/background.ts`, `lib/api.ts`: quick-save and "save link" return the saved reference instead of a duplicate and notify "Already in PIVOT" (G7).
  - Tests: `pure.test.ts` (IPv6 forms), `capture.test.ts` (block, bot-check, 404, timeout), new `capture-flow.test.ts` (retake keeps old shots when blocked, swaps them when it works, Replace screenshot, no-URL fails), `sources.test.ts` (blank description on a known source).
  - Docs: SPEC §1 #7 and #17, §3, §4; DESIGN.md (screenshot gallery, Add from URL, toasts).
- **Checks run and results:** `pnpm typecheck`, `pnpm lint`, `pnpm ext:build` pass; `pnpm test` 38/38 (8 files). Changed files pass Prettier (G18 unchanged).
- **Manual verification** (scratch app, empty PGlite, no R2):
  - "not a url" → "That doesn’t look like a link…"; a link plus one word → "1 entry isn’t a link and will be skipped".
  - linear.app saved 0.1 s after pasting → description filled from the page, capture done.
  - land-book.com → capture failed "The site blocked the screenshot (HTTP 403)…", OG image used as the cover, error toast with Open; with the OS in light mode the toast description is #b8a596.
  - Replace screenshot on linear.app → one screenshot (the upload), full-page shot gone, card shows the upload.
  - `/api/clip` with `ifExists: "skip"` for an existing URL → returns the saved reference, no new row.
- **Remaining issues:** S2 (redirects in capture), S4 (DNS rebinding), and the rest of G8–G18 for later phases. Bulk adds still read each page one by one with a spinner only. The extension changes were checked by build and API only, not in Chrome (Phase 4).
- **Next step:** Phase 2 — organize references (facets, tags, collections, filters).

### 2026-10-29 — Phase 0: Audit and baseline

- **Status:** Done.
- **Existing functionality reused:** everything; no application code changed.
- **Files changed:** this log; ticks in the plan's checklist for items verified below.
- **Checks run and results:**
  - `pnpm typecheck`, `pnpm lint`: pass.
  - `pnpm test`: 33/33 pass (7 files; the capture tests ran, Chromium is installed).
  - `pnpm ext:build`, `next build`: pass.
  - `pnpm format:check`: fails, see G18 (no file changed by recent work).
- **Manual verification** (scratch app on port 4400, empty PGlite, no R2):
  - Saved `https://linear.app` from the Add dialog: title from the page, viewport shot 1440×900 and full-page shot 1440×9960, card scrolls the full page, detail "Open" goes to `https://linear.app/`. Description empty (G1).
  - Same URL again: "Already saved as …" warning shown.
  - `not a url`: Save disabled, no message (G6).
  - `https://this-host-does-not-exist.invalid/`: resource kept, card shows the image-off placeholder, detail shows "Screenshot failed: Could not resolve …" with Retry.
  - SSRF guard probed directly (S1).
  - Code audit of every checklist item by three read-only agents (save/capture, organize/find, sources/extension).
- **Inventory** (W = working, P = partial, M = missing):

  | Phase | Item                                         | State | Notes                                                                         |
  | ----- | -------------------------------------------- | ----- | ----------------------------------------------------------------------------- |
  | 1     | Save from URL (dialog, paste, bulk, ext.)    | W     | `api/from-url/route.ts`, `add-url-dialog.tsx`, `global-layer.tsx:42-56`       |
  | 1     | Title / description / URL                    | P     | G1                                                                            |
  | 1     | Viewport 1440×900 + full page                | W     | `capture.ts:11, 169-209`; tests `capture.test.ts`, `capture-scroll.test.ts`   |
  | 1     | Limits (12000px, 60 steps, 8 clicks, 45s)    | W     | `capture.ts:13-19`; viewport kept if full page fails; no per-job timeout (G3) |
  | 1     | Manual upload / replace                      | P     | upload, paste, drop and Set as cover exist; G5                                |
  | 1     | Visual cards                                 | W     | `resource-card.tsx:219-273`                                                   |
  | 1     | Duplicate warning                            | P     | G7                                                                            |
  | 1     | Error states                                 | P     | unreachable host OK; G2, G3, G6                                               |
  | 2     | Facets pageType/domain/visualStyle/uiPattern | W     | typed tags (`types.ts:21-103`), editable on detail, Add dialog, extension     |
  | 2     | Tags + editable metadata                     | W     | autosave on the detail page (`resource-detail.tsx:86-151`)                    |
  | 2     | Collections                                  | P     | create, rename, delete, add, remove work; G14                                 |
  | 2     | Filters, AND tags                            | W     | `resources.ts:116-201`; test `library.test.ts:65-68`                          |
  | 2     | No glass on cards                            | P     | G17                                                                           |
  | 3     | Search                                       | W     | title, description, notes, content, URL, tag names; `library.test.ts:69-75`   |
  | 3     | Detail view                                  | P     | gallery, metadata, Open original; G13                                         |
  | 3     | Open original                                | P     | G12                                                                           |
  | 3     | Combined filters                             | W     | one SQL `where`; category filtered in the browser                             |
  | 3     | Sort newest / oldest                         | P     | newest yes, oldest M (G8)                                                     |
  | 3     | Empty / no-match / clear                     | P     | G9                                                                            |
  | 4     | Sources by category, open site               | W     | verified in the app (PR #15)                                                  |
  | 4     | Source viewport only                         | W     | `capture.ts:232`; test `capture-scroll.test.ts:84-88`                         |
  | 4     | Search saved Sources, `searchUrl`            | W     | verified in the app (PR #15)                                                  |
  | 4     | `via` attribution                            | P     | G10                                                                           |
  | 4     | Extension quick save                         | P     | popup, ⌥⇧D, context menus work in code; G7, G11, G15; not run this phase      |
  | 4     | Extension token / auth                       | W     | Bearer header only, localhost-only proxy, no CORS; S5                         |

- **Remaining issues:** G1–G18, S1–S7 above.
- **Next step — proposed Phase 1, smallest steps first (needs approval):**
  1. S1: make `isPrivateAddress` handle every IPv4-mapped / compatible IPv6 form and the full `fe80::/10`, with tests for the hex forms.
  2. G4 + S3: in `captureOne`, save and attach the new screenshots before detaching the old ones; re-read the cover choice after the capture.
  3. G3: a per-capture time limit and `try` around the whole job, so a bad URL or a frozen page ends as `failed`, never `pending`.
  4. G1: let the server fill an empty description from the page metadata (treat `""` like missing).
  5. G2: mark a capture whose main response is 4xx/5xx, or that lands on a known challenge page, as failed with a clear reason (keep the resource and any screenshot, so nothing is lost).
  6. G6: say why Save is disabled ("That doesn't look like a link") and toast when a capture fails.
  7. G5: let a user-chosen cover win on reference cards, and add a single "Replace screenshot" action.
  8. G7: duplicate check in quick-save and `/api/clip` (warn in the notification, don't block).
  - S2 (redirect guard) needs a design choice (block cross-host redirects in capture or re-check each hop) and goes with step 3 or its own task.
