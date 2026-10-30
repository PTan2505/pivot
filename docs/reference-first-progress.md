# Reference first — progress log

Tracks [reference-first-plan.md](reference-first-plan.md). The checklist lives in the plan; tick an item there only once it is verified in the running app or by a test. Each phase gets an entry below in the plan's §6 format, newest first.

## Status

| Phase | Name                        | Status |
| ----- | --------------------------- | ------ |
| 0     | Audit and baseline          | Done   |
| 1     | Save references             | Done   |
| 2     | Organize references         | Done   |
| 3     | Find and reuse              | Done   |
| 4     | Sources and browser capture | Done   |
| 5     | Real-use validation         | Done   |

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
| G8  | 3     | **Fixed in Phase 3.** **No "oldest first" sort.** Sort is `updated` / `created` (newest) / `title`, with fixed directions. Required by the plan.                                                                                                                                                                                                                                                      | `resources.ts:183-190`; `library-view.tsx:232-241`                            |
| G9  | 3     | **Fixed in Phase 3.** **No one-click "Clear filters"**, and the "No matches" state has no action. An empty type or category page shows "Nothing here yet" (with the paste hint) because `filtered` ignores type and category.                                                                                                                                                                         | `library-view.tsx:198, 286-303`                                               |
| G10 | 4     | **Fixed in Phase 4.** **"Saved from this source · N" disagrees with the list it opens.** Attribution counts every type, but `/?via=` lands in the Library section, which lists visual types only. Known-source aliases are ignored; two sources on one host resolve unpredictably (no ORDER BY).                                                                                                      | `resources.ts:404-425`; `library-view.tsx:146`                                |
| G11 | 4     | **Partly fixed in Phase 4** (the token is checked when the popup opens, and a rejected save keeps the form; saves made while the app is down are still lost). **Extension saves are lost when the app isn't running** (notification only, no queue or retry). A wrong or rotated token is only found at Save, and the popup then swaps to the Connect screen, losing typed notes and tags.            | `apps/extension/src/lib/api.ts:36-38`; `background.ts:46-55`; `popup.tsx:182` |
| G12 | 3     | **Fixed in Phase 3.** **Detail page "Open" can be a broken relative link** after editing the Source URL: it uses the local draft, not the normalized URL from the server.                                                                                                                                                                                                                             | `resource-detail.tsx:105-106, 576-581`                                        |
| G13 | 3     | **Fixed in Phase 3.** **No zoom or lightbox for screenshots.** The full-page shot is only scrollable at fit width in a 75vh box, or as the raw file in a new tab.                                                                                                                                                                                                                                     | `asset-gallery.tsx:114-119`; `asset-preview.tsx:78-86`                        |
| G14 | 2     | **Mostly fixed in Phase 2** (create from the popover, sidebar text, stale name; collections as a library filter and editing the description are left). **Collections friction:** the Add-to-collection popover can't create a collection and says "create one in the sidebar" (there is no sidebar); the breadcrumb keeps the old name after a rename; collections can't be used as a library filter. | `selection-bar.tsx:31`; `collections/[id]/page.tsx:22,38`                     |
| G15 | 4     | **Fixed in Phase 4.** **Known-source description dropped** when a Source is saved through Add URL or the extension (`description ?? ""`). Popup offers and announces a full-page capture for Sources, which never happens (behaviour is correct, wording isn't). No "Source" type suggestion for known hosts.                                                                                         | `from-url/route.ts:49,54`; `clip/route.ts:54`; `popup.tsx:224-226, 426-441`   |
| G16 | 2     | **Fixed in Phase 2.** **Facets can only be filtered through the mixed pill row**; pills don't show their kind (tooltip only).                                                                                                                                                                                                                                                                         | `tag-pills.tsx:70-82`                                                         |
| G17 | 2     | **Fixed in Phase 2.** Small translucent blurred controls sit on card screenshots on hover (select box, action buttons), against DESIGN.md's "nothing translucent on saved work". Low.                                                                                                                                                                                                                 | `resource-card.tsx:63, 76`                                                    |
| G18 | 0     | `pnpm format:check` fails: 6 files in the repo were never formatted, and `.claude/worktrees/` (another session's checkout) isn't in `.prettierignore` (34 files).                                                                                                                                                                                                                                     | `apps/web/src/lib/utils.ts`, `packages/core/src/metadata.ts` and 4 more       |
| G19 | 5     | **Generic page titles.** `og:title` often drops the brand: 5 of the 20 Phase 5 saves were titled "Documentation", "Pricing & Fees", "Build software better, together" (GitHub sign-in), "Supabase", "Installing with Vite - Installation". Search still finds them by URL, but cards and MCP results read poorly. Renamed by hand. A fix could append the site name when the title lacks it.          | Phase 5 log                                                                   |
| G20 | 5     | **Cookie and region banners in screenshots** (Stripe pricing, Stripe Docs, Notion, Framer, PostHog, Apple). The banner covers part of the first screen. Auto-dismissing would have to decline non-essential cookies, never accept them.                                                                                                                                                               | Phase 5 contact sheet                                                         |
| G21 | 5     | Tag filters put tag UUIDs in the URL (`?tags=e509…,2360…`), so a filtered view's link isn't readable. Low.                                                                                                                                                                                                                                                                                            | `use-library-params.ts`                                                       |

### Security and data-loss risks

| ID  | Severity | Risk                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                       |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| S1  | High     | **Fixed in Phase 1.** **SSRF guard bypass with IPv6 forms.** Reproduced: `assertPublicUrl` allows `http://[::ffff:127.0.0.1]:4321/`, `http://[::ffff:a9fe:a9fe]/` (the cloud-metadata address) and `http://[fe90::1]/`; it only recognises the dotted `::ffff:` form and the `fe80` prefix. The test passes the dotted string, so it misses this.                                                                | `net-guard.ts:44-47`; `pure.test.ts:33`        |
| S2  | Medium   | **Fixed in Phase 4** (a request the browser alone is redirected into can still reach the private host, but the capture is refused and nothing is saved). **Redirects bypass the capture route guard.** Playwright calls a route handler only for the first URL of a redirect chain, so a public URL that redirects to a private host can be screenshotted. Service workers and WebSockets aren't blocked either. | `capture.ts:172-182`                           |
| S3  | Medium   | **Fixed in Phase 1.** Data loss on retake (G4); a cover the user sets during a capture is overwritten by the capture's stale read; an OG-image fallback cover sticks after a successful retake.                                                                                                                                                                                                                  | `capture.ts:225, 233-247, 257`                 |
| S4  | Low      | DNS rebinding: the guard resolves DNS, then fetch / Chromium resolve again.                                                                                                                                                                                                                                                                                                                                      | `net-guard.ts:59-90`                           |
| S5  | Low      | `GET /api/settings/token` needs no token, so any local process or extension with localhost access can read it; the token only protects against websites.                                                                                                                                                                                                                                                         | `api/settings/token/route.ts:4-6`              |
| S6  | Low      | **Mitigated in Phase 3** (the app only opens http/https links; the server still stores any string). `sourceUrl` can store any string (including `javascript:`) because `cleanUrl` falls back to the raw input; cards `window.open` it. Needs same-origin or token access to write.                                                                                                                               | `resources.ts:271-278`; `resource-card.tsx:93` |
| S7  | Low      | Uploads: type is checked by extension only (served with `nosniff` and a sandbox CSP); the 200 MB limit runs after buffering; `safeFetch` truncates oversized downloads silently.                                                                                                                                                                                                                                 | `assets.ts:16-61, 133`; `net-guard.ts:111-114` |

## Log

### 2026-10-31 — Capture fixes after real use

Not a plan phase: two problems the owner hit while saving references.

- **A shot saved from a Dribbble modal got the search page's full screenshot.** The extension preferred `<link rel="canonical">`, which a modal leaves pointing at the page underneath (the saved URL was `https://dribbble.com/search/filter`). It now uses the address bar's URL unless the canonical names the same page, and in that case takes the live title and leaves the description to the server.
  - Checked live on dribbble.com/search/filter with the "Table Filters" shot open: the canonical stayed `/search/filter`; the page reader returned `https://dribbble.com/shots/15005862-Table-Filters` and the shot's title.
  - File: `apps/extension/src/lib/page.ts`.
- **Full-page screenshots missed content and broke layouts.** Two causes:
  - the page was walked with `scrollBy` jumps;
  - the shot was one screenshot as tall as the page, which stretches `100vh` sections and catches scroll-revealed content still hidden.

  Now the page is walked with mouse-wheel scrolling, and the full page is stitched from 1440×900 screens shot top to bottom, each after its images load and animations settle (0.5 s). Wide fixed bars at the top or bottom appear only in the first screen.
  - New test in `capture-scroll.test.ts`: a 100vh hero, reveal-on-scroll sections and a fixed bar. It failed before the change and passes after.
  - Real pages, compared against their earlier captures: the AirPods page went from mostly blank sections to every section shown. Linear, PostHog, Framer pricing, Raycast and Vercel are the same height with more content rendered. About 20 s per page.
  - File: `packages/core/src/capture.ts`.

- **Known limit:** an element cut by a screen boundary is shot half in one screen and half in the next, so an animation that depends on being mostly visible can show half revealed.

### 2026-10-31 — Phase 5: Real-use validation

- **Status:** Done. The owner rebuilt and reloaded the extension and ran the live checks, which also closes the last Phase 4 item. Results (read from the library afterwards):
  - **⌥⇧D on figma.com/pricing** → reference "Plans & Pricing | Figma", page description kept. The cover is the attached view (3600×2018); the server added only the full page (1440×9231).
  - **Popup on dribbble.com** → nothing extra saved; only the existing Dribbble source matches the URL.
  - **Popup on a PIVOT page** → nothing saved.
- **Existing functionality reused:** Add URL (`/api/from-url` with facets and `skipDuplicates`), the capture queue, facets, collections and bulk add, the tag pill filters, search, the extension popup and quick-save.
- **What was done in the real library** (Neon + R2, through the app at :4321, rebuilt from `dev` first):
  - Moved the owner's 4 extension test saves from 2026-10-30 to the trash (2× "Recent — Design Inspiration" saved as references 30 s apart, 2× the PIVOT app page itself), with the owner's OK.
  - Saved 20 references chosen with the owner, each with page type, domain, style and pattern facets. All 20 captured (viewport + full page) in 255 s through the serial queue, about 13 s each. No bot walls.
  - Renamed 5 generic titles (G19).
  - Created 3 collections: Pricing pages (5), Developer tool landings (4), Docs & changelogs (5).
  - IDs, so the run can be undone:
    - References:
    - `1696819d-add7-4bb2-8db6-d038deb4849c` https://linear.app/
    - `17816718-b2de-4f1a-bfb0-fc6cfd1e8f03` https://vercel.com/
    - `cc1ec132-3a6a-4f5c-9947-037f38f49cbb` https://www.raycast.com/
    - `3a7c490b-5bc1-4150-8645-7eec4a66e809` https://posthog.com/
    - `cedcc989-348d-4a1f-a37d-e6bdf20f40c1` https://resend.com/
    - `a1a5853f-16bb-49b0-89f2-53e6e6d9dcb7` https://cal.com/
    - `0817a2a5-7a55-497e-bd8e-52e1cd8b999f` https://stripe.com/pricing
    - `100fbdf7-e811-4e54-bdd0-2e9c814b7923` https://linear.app/pricing
    - `b75a1c2f-3508-4722-ba74-02cf88a73187` https://www.notion.com/pricing
    - `d0304cd5-6fbd-42bc-8228-480b7c607783` https://www.framer.com/pricing
    - `b7f948b8-6bc5-4bdc-ad90-10a04db28642` https://supabase.com/pricing
    - `8dc4881b-dec4-43c9-80b9-58f125594135` https://docs.stripe.com/
    - `8ef1d88c-0341-472c-a10b-46e88c70ff85` https://tailwindcss.com/docs/installation
    - `fed7b732-9068-4087-81b0-4f3766fab5a7` https://nextjs.org/docs
    - `0a0d9d6e-3fe6-4020-9ef3-e4be75ea2bc0` https://linear.app/changelog
    - `1cc67203-ad9c-442f-9a79-ffbd7c32ce34` https://vercel.com/blog
    - `ab088199-506f-4c43-a24a-3e74dd28f073` https://www.apple.com/airpods-pro/
    - `f380e224-3979-41d3-8f21-08172393108a` https://github.com/login
    - `f424eef5-84e9-4571-8362-b615b417a4b3` https://supabase.com/dashboard/sign-in
    - `b5a1e272-85c7-48ce-8f5b-dfb1f88f3ad4` https://rauno.me/
    - Collections:
    - `3d0b2a47-afea-4ee1-9f80-493f25287d96` Pricing pages
    - `6d651e3d-6be7-4a7b-9519-f3566b7da100` Developer tool landings
    - `7dacd116-85fd-4c38-ac1f-9f297e571dc9` Docs & changelogs
- **Finding 5 references** without browsing (References page, by pills or the top search; each took 1–2 actions, and results showed in about 1 s):
  - Pricing + Dark → Supabase, Framer and Linear pricing.
  - Docs + Sidebar → Tailwind, Stripe and Next.js docs.
  - Auth → GitHub and Supabase sign-in.
  - "stripe pricing" → Stripe pricing.
  - "changelog" → Linear's changelog.
- **Extension in a normal session:**
  - The owner's own session (2026-10-30, the build before Phase 4) saved pages through the popup and quick-save. Captures worked, but it produced the duplicates and self-saves above.
  - Driving the extension from Claude in Chrome isn't possible: key presses reach the page, not the browser, so ⌥⇧D never fired, and `chrome://` pages can't be opened.
- **Friction found and what happened to it:**
  - The popup created a second copy despite its "Already saved" warning. **Fixed:** the button now reads "Save again" when the page is already saved as that type.
  - The extension saved PIVOT's own pages, which then fail to capture. **Fixed:** the popup and quick-save refuse pages on the PIVOT server's origin.
  - A known site's home page was saved as a reference. Already fixed in Phase 4 (Source is preselected); the owner needs to rebuild and reload the extension.
  - Generic titles → G19. Cookie banners in screenshots → G20. UUIDs in filter URLs → G21. All open, none blocks the workflow.
- **Acceptance (plan §4):**
  - A URL is saved at once and its capture finishes in about 13 s, under the 30 s target.
  - Known references are found in 1–2 actions, under the 10 s target.
  - 23 real references are saved, classified, viewable and reopenable.
  - Failed captures keep the reference (Phase 1).
  - Existing resources and collections are intact; the 4 trashed test saves can be restored for 30 days.
  - No security control was weakened.
- **Files changed:** `apps/extension/src/lib/page.ts` (`isPivotPage`), `popup/popup.tsx` (PIVOT-page refusal, "Save again"), `background.ts` (quick-save refuses PIVOT pages); SPEC §4; DESIGN.md (extension popup).
- **Checks run and results:** `pnpm typecheck`, `pnpm lint` pass; `pnpm test` 53/53 (50 s). The built extension was checked in headless Chromium against a scratch app:
  - a PIVOT page shows "This is PIVOT itself…";
  - stripe.com/pricing as Reference reads "Save again";
  - the same URL as UI Library reads "Save".
- **Remaining issues:** G11 (saves while the app is down), G19–G21, G18, S4.
- **Next step:** the search and MCP initiative (`docs/SEARCH_MCP_IMPLEMENTATION_PLAN.md`), which now has a real corpus for its evaluation set.

### 2026-10-30 — Phase 4: Sources and browser capture

- **Status:** Partial. Everything is done except a live press of the quick-save shortcut (⌥⇧D) in a real Chrome window: headless Chromium can't trigger extension shortcuts, so the quick-save path was checked by sending its exact request.
- **Existing functionality reused:** Sources grouped by category with search URLs, host attribution (`sourceAttribution`), the `via` filter and "Saved from this source", the extension popup, quick-save, context menus and `/api/clip`, the capture queue and its SSRF guard.
- **Files changed:**
  - `packages/core/src/capture.ts`: before the browser opens, the server follows the URL's redirects itself, checking each hop. During the capture, every redirect hop the browser makes is checked, and a page or frame heading for a private address ends the capture with nothing saved. Service workers are blocked (S2).
  - `packages/core/src/resources.ts`: attribution is deterministic (two sources on one host: the first saved owns it) and counts a known site's old domains (G10).
  - `components/library-view.tsx`, `lib/api.ts`: `/?via=` lists every type saved from the source, not only the Library section's, so it matches the count. The page is titled with the source's name, and the type shelf is hidden there (G10).
  - `apps/extension/src/popup/popup.tsx`, `lib/api.ts`, `lib/page.ts`, `background.ts`:
    - the token is checked when the popup opens;
    - a rejected save keeps the form and links to the settings (G11);
    - a known site's home page preselects Source, and quick-save saves it as one;
    - the Source capture option shows only when the view isn't attached, and the saved message says what really happens;
    - the page's description is sent only once edited (G15).
  - The popup's tab preview keeps the tab's own aspect ratio (the change set aside earlier; it is part of this browser-capture phase).
  - `app/api/clip/route.ts`: a known source keeps its curated description (G15).
  - Tests:
    - `capture-guard.test.ts` (new): a public page is captured; HTTP, meta and script redirects to a private host are refused without the private page being requested; a browser-only redirect and an image redirect are refused.
    - `sources.test.ts`: an alias host, and a shared host owned by the first source.
    - `capture-flow.test.ts`: the test server counts only the browser's loads, because the capture now asks for redirects with a plain request first.
  - Docs:
    - SPEC: §3 redirect protection; §4 token check, Source through the extension, Source preselection; §6 `via`.
    - DESIGN.md: the popup's type hint, capture option and errors.
- **Checks run and results:** `pnpm typecheck`, `pnpm lint` pass; `pnpm test` 53/53 in 50 s. Two earlier full runs on a heavily loaded machine (17 min) each timed out one different test (`capture.test.ts`, then `favicons.test.ts`); both pass alone and in the clean run. Changed files pass Prettier.
- **Manual verification** (scratch app at :4400; the built extension loaded in headless Chromium):
  - **Popup on dribbble.com/:**
    - The type step shows "This is Dribbble’s home page, so Source is picked", with Source focused.
    - With no view attached, More details offers "Take a screenshot in PIVOT".
    - After Save, the popup reads "PIVOT is taking a screenshot in the background."
    - The server stored a source with Dribbble's curated description and category Inspiration, and the capture finished.
  - **Wrong token when the popup opens:** the Connect screen shows "Invalid API token — copy it again from PIVOT › Settings.", before anything is typed.
  - **Token rotated while the popup was open:** Save shows the error with "Open extension settings", and the typed title is still there.
  - **Quick-save request** (the background's exact payload: view JPEG, `serverCapture`, `ifExists: "skip"`):
    - stripe.com/pricing → created; the cover is the attached view, and the server added only the full page (1440×12000).
    - The same page again → `existing: true`, same id.
    - A wrong token → 403.
  - **Sources and via:**
    - The Sources page groups by category, and cards have Open source.
    - The Dribbble card says "2 saved"; its detail page links Open to `https://dribbble.com/` and shows "Saved from this source 2 →".
    - `/?via=` is titled with the source's name, has badge 2, and lists the reference and the prompt (before, the prompt was missing).
- **Remaining issues:**
  - The live ⌥⇧D press, and attaching a real tab view from the popup, both need a real Chrome window.
  - Saves made while the app is down are still lost (G11).
  - G18 (repo formatting) and S4 (DNS rebinding) are left as they are.
- **Next step:** check the shortcut once in a real Chrome window, then Phase 5 — real-use validation.

### 2026-10-30 — Phase 3: Find and reuse

- **Status:** Done.
- **Existing functionality reused:** search with title-first ranking, AND tag filtering, the `via` source filter, type and section pages, the detail page (gallery, metadata, autosave), filters kept in the URL, the top-bar search following the URL.
- **Files changed:**
  - `packages/core/src/resources.ts`, `app/api/resources/route.ts`, `hooks/use-library-params.ts`, `components/library-view.tsx`: an `oldest` sort; the select reads Recently edited, Newest first, Oldest first, Title A–Z (G8).
  - `components/library-view.tsx`: a Clear filters button while a search, tag or source filter is on; the no-match state names the search, says search and filters apply together, and offers Clear filters; an empty type page says "Nothing in <page> yet" (G9).
  - `lib/url.ts` (new), `components/resource-detail.tsx`, `components/resource-card.tsx`: Open links go through `openableUrl`, which only opens http/https and adds `https://` to a bare host (G12, S6).
  - `components/screenshot-viewer.tsx` (new), `components/asset-gallery.tsx`: View at full size opens the screenshot at its captured width (up to 1440px) in a full-height sheet that scrolls (G13).
  - Tests: `library.test.ts` — newest and oldest sort, and search + facet + type + source combined.
  - Docs: SPEC §8 (new, "Tìm lại và dùng lại"; card is now §9, out of scope §10); DESIGN.md (page head, empty and no-match states, full-size viewer).
- **Checks run and results:** `pnpm typecheck`, `pnpm lint` pass; `library.test.ts` 10/10. Changed files pass Prettier.
- **Manual verification** (scratch app: Attio, Stripe and Linear tagged by page type and domain; Attio captured):
  - Sort lists Recently edited, Newest first, Oldest first, Title A–Z. Oldest first gives Attio, Stripe, Linear (`?sort=oldest`); Newest first gives the reverse.
  - Domain SaaS → Linear, Attio. Adding Landing page → Attio. Adding the search "stripe" → no cards, "Nothing matches “stripe”" with the explanation and Clear filters.
  - Clear filters → all three cards back; tags, search and the top-bar field are cleared; the sort is kept.
  - Detail page: Source URL `linear.app/method` → Open links to `https://linear.app/method`; `javascript:alert(1)` → no Open button.
  - View at full size → sheet titled `attio.com-2026-10-30.webp · 1440×900`; the image is 1406px wide in a 1440px window; Escape closes it.
  - Empty pages: `/?type=icon` → "Nothing in Icons & SVGs yet"; `/?type=source&category=motion` → "Nothing in Motion yet".
- **Remaining issues:** collections are still not a filter in the main library (the collection page has its own); the skill guide's source link (frozen area) doesn't use `openableUrl`; G10, G11, G15, G18 and S2, S4 for Phase 4.
- **Next step:** Phase 4 — Sources and browser capture.

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
