# My designs: save a design you like, and rebuild it exactly later

Approved by the owner on 2026-11-24. SPEC: decision #41 and §22.

## Why

The owner wants to keep the UI/UX designs they like, made by them or by Claude, so that a later session can rebuild one **exactly**: no describing it again, no guessing. Examples: the ODIN 3D logo hero, the portfolio's grid-scan background, the Pulse pricing scroll story, `pulse/design/story.html`, the merchant-portal theme.

An exact rebuild needs three things kept together:

1. **The real code:** the files, the CSS and tokens it relies on, its assets (SVG, fonts, models, images) and its dependencies at exact versions.
2. **Usage notes:** where it mounts, what DOM and CSS context it needs, what to change when it moves to another project.
3. **What the original looks like:** screenshots, and a short video when it moves, to check the rebuild against.

## The owner's decisions

- **A new "My designs" section**, separate from 21st components. Its code reuses the component store's parts.
- **Saved only when the owner asks** in a session ("lưu cái 3D logo này vào PIVOT").
- **One owner** (updated 2026-11-25, the owner: "Tôi muốn bỏ phân biêt personal và company đi, vì tất cả đều là của tôi design mà?"): no personal or company distinction; every design is reused in any project; Share, Export and copied context carry its facts, usage and screenshots, never the code; a backup keeps everything. (Until then: company designs named their organisation and left PIVOT as their name only.)
- **Later, not now:** the extension's "select an element and save it", whole-project snapshots, version history.

## Design

### Data: the type `my_design` (no migration)

- In `RESOURCE_TYPES` and `TYPE_DEFS` (label "My design", icon `gem`, facets pageType, uiPattern, visualStyle, technology, export folder `my-designs`), its own `SECTIONS` entry "My designs" (`/?type=my_design` until Phase 3 gives it a page), and in `AGENT_TYPES`: never made, retyped or code-edited by hand.
- `meta.myDesign` (`MyDesignMeta` in `packages/core/src/types.ts`): `kind`, `files` (path, role `component`/`demo`/`style`/`support`, language, code), `dependencies` (name and exact version), `install`, `usage`, `tokens`, `source` (project, folder, original paths, session ids, mockup id), `assets` (path, asset id, sha256, size), `codeSha256`, `scan`, `savedAt`, `codeSavedAt`.
- Files in the blob store: `design-asset` (a non-code file with the path it goes to), `design-shot` (desktop or mobile screenshot), `design-video`.
- Limits: 80 files, 1 MB per file, 4 MB of code; 60 files, 12 screenshots, 3 videos, 25 MB each, 100 MB per design.
- Always refused: `.env*`, keys and certificates, `node_modules`, `.git`, package-manager credentials, paths outside the folder, and code holding a credential.
- Shared with the component store: `packages/core/src/code-files.ts` (relative paths, secret patterns, the code hash, the line scan).

### Preview (Phase 3)

React designs use the existing local build (`preview-build.ts`). Non-React designs (three.js, GSAP, plain HTML) use a `demo` `index.html` bundled by the same esbuild step, inlined into one HTML file of at most 5 MB and served from the preview origin. When it can't build, the page shows the screenshots and video and says why.

### MCP tools (Phase 2)

- `save_my_design { id?, name, kind, root, files: [{ path, role }], assets?, screenshots?, video?, dependencies?, install?, usage, tokens?, sourceProject?, sessionId?, mockupId?, facets?, notes?, replaceCode? }`: the MCP server reads the files from disk under `root`, so the code is the original's bytes, never retyped.
- `get_my_design { id | name, writeTo? }`: the files, usage, tokens, dependencies, install steps and screenshot list; with `writeTo` it writes the files and assets byte for byte at their relative paths.
- `search_references` finds `my_design` (its `organisation` filter was removed on 2026-11-25 with the ownership distinction).

### Skill rules (Phase 2)

- Saving, only when asked: find every file the design needs, read exact dependency versions, write the usage notes, screenshot desktop and phone (and record a video when it moves), call `save_my_design`, list what was saved.
- Reusing: at gate 1 search My designs first ("Yours"); on a pick, `get_my_design` with `writeTo`; install the stored versions; change only import paths and token names; compare with the stored shots (and `motion-qa.mjs` for motion) and report differences.
- A saved design is rebuilt in any project (updated 2026-11-25).

### UI (Phase 3)

No new layout (the owner, 2026-11-25: "không cần design mới, hãy lưu các design như các lưu các ref và component"): the Library's grid and card (cover, name, kind, its facets; the Personal or Company · Org chip was removed on 2026-11-25; its search and facet filters) and the component page (Preview / Code stage, Install, then Usage with the tokens; other files under Code; source project and session links in the side panel; Download zip in the header). DESIGN.md updated.

## Phases

| Phase | Name            | Branch                 | Status                                   |
| ----- | --------------- | ---------------------- | ---------------------------------------- |
| 1     | Core and API    | `feat/my-designs`      | Done (PR #166)                           |
| 2     | MCP and skill   | `feat/my-designs-mcp`  | Done (PR #167)                           |
| 3     | UI and preview  | `feat/my-designs-page` | Done, not committed                      |
| 4     | Release + saves | release PR             | To do, when the owner asks for a release |

Phase 4's first saves, one per session in its project folder: the ODIN 3D logo hero, the portfolio grid-scan, the ODIN layer timeline, the Pulse pricing scroll story, `story.html` A/B/C, the merchant-portal theme.

## Progress

### Phase 3 — the page and its preview (2026-11-25)

- Status: Done, not committed.
- Decision: the owner asked for no new design ("không cần design mới, hãy lưu các design như các lưu các ref và component"), so the `pivot:redesign` session opened for this phase (`a0150b6e`) stopped at its reference list; nothing was mocked up, and the page reuses the component page part for part.
- Existing functionality reused: the component page (its stage, live preview frame, code viewer, copy button and flag rows, moved unchanged into `code-stage.tsx` and shared), the visual types' card and side panel, `useResource`'s polling, the preview build (`prepare`, `runNpmInstall`, `bundlePage`, Tailwind), the preview store and origin (`setComponentPreview`, `findPreviewAsset`, `preview-server.ts`, its CSP), `readAssetBytes`, `listResourceAssets`, the Markdown renderer.
- Files changed:
  - core: `preview-build.ts` (`runBuild` shared by both kinds, `startMyDesignPreviewBuild`, `bundleHtmlPage`), new `preview-plan.ts` (`myDesignPreviewPlan`, no Node imports), `component-preview.ts` (`previewHolder`; a saved design's preview stored and served like a component's), `my-designs.ts` (`myDesignArchive`, `myDesignNotes`, `archiveName`), new `zip.ts`, `types.ts` (`PreviewState`, `MyDesignMeta.preview`);
  - web: new routes `POST /api/my-designs/[id]/preview` and `GET /api/my-designs/[id]/zip`; new `components/code-stage.tsx` and `components/my-design-detail.tsx`; `component-detail.tsx` (imports the shared parts), `resource-detail.tsx` (the design's identity row, main column, facts and Download zip), `resource-card.tsx` (meta line and owner chip), `lib/api.ts` (follows a design's build);
  - tests: new `packages/core/test/my-design-preview.test.ts`; SPEC §1 #39, §3 and §22; DESIGN.md "My design page".
- Checks run and results: `my-design-preview.test.ts` 7/7 (an HTML demo bundled with its module scripts, CSS imports, npm package, classic script, shader block, `<img>` and `url()` as data URLs, network stylesheet left, import map dropped; no install without dependencies; a React design with its own React version and Tailwind; a network script fails clearly; a Vue design is refused; the preview survives a re-save and a new file and isn't served once trashed; the zip read back entry by entry with CRCs and by `unzip -t`; the archive's files byte for byte, its notes and screenshot); the component preview tests unchanged and passing; `pnpm check` exit 0 (cli 18, core 291, extension 12, mcp-tools 367).
- Manual verification (scratch PIVOT from this branch, `/tmp/pivot-mydesigns-p3`, port 4400; the Phase 2 and component-store e2e runs as fixtures): the My designs grid shows the design's card with "3D · pivot-e2e-orbit" and its Company chip; its page shows the saved screenshots, Build preview installed three 0.170.0 from registry.npmjs.org and the three.js demo ran live in the sandboxed frame with no console errors; Rebuild went Building… → ready in about 2 s with no reload; the Code tab's URL state, file tabs and other files; Install, Usage and tokens; the side panel's facts; Download zip (`unzip -t` clean, files at their paths, `_pivot/USAGE.md`, screenshots and video); no horizontal scroll at 375 px; the component page (E2E Badge) unchanged.
- Remaining issues: a design that fetches files at run time (a model loaded by URL, `fetch` of JSON) can't load them in the preview (no network): its screenshots and video stay the reference. Transitive npm dependencies float (`--no-package-lock`); the design's own versions are exact. No owner filter (Personal / Company) on the grid: the API has `organisation`, the page uses the facet filters only, as references do.
- Next step: Phase 4 (release and the first saves), when the owner asks.

### Phase 2 — MCP tools and the skill (2026-11-24)

- Status: Done, not committed.
- Existing functionality reused: Phase 1's routes and core (`saveMyDesign`, `addMyDesignAsset`, `findMyDesign`, the 409 on different code), the shared path rules and refused files (`relativePath`, `refusedFileReason` in `code-files.ts`), the component store's tool shapes (`save_component` / `get_saved_component`: the scan lines, the 300,000-character code cap, the `structuredContent` with everything), `searchResources` and its route, `get_reference_images`' paging, `GET /api/assets/[id]` for the bytes, the HTTP source's capability check, the scratch guard and the component store's stdio e2e.
- Files changed:
  - new `packages/mcp-tools/src/my-design-files.ts` (the disk side: real paths, the escape and link checks, exact UTF-8, media reading, the all-or-nothing `writeInside`);
  - `packages/mcp-tools/src/write-tools.ts` (`save_my_design`, `get_my_design`; `save_reference` names it), `source.ts` (`findMyDesign`, `assetData`, `saveMyDesign`, `addMyDesignAsset`), `tools.ts` (`search_references` `organisation` and "Yours", `get_reference` pointer, `get_reference_images` `which: "shots"`, labels of the design roles);
  - `apps/mcp/src/http-source.ts` (the routes, multipart upload, `requireFeature("my-designs")`), `apps/mcp/src/server.ts` (instructions);
  - core: `capabilities.ts` (`my-designs`), `types.ts` (`SearchRequest.organisation`, `SearchHit.myDesign`), `search.ts`, `resources.ts` (the `organisation` filter on `meta.myDesign.organisation`); `apps/web/src/app/api/resources/route.ts` (`organisation`);
  - `plugin/skills/design/SKILL.md` (tool rows, §2 step 0 "Yours" first, §4 source column, §9 rebuild steps, the new "Save a design to My designs" section, the rule), `plugin/skills/redesign/SKILL.md` (§2, §5, rules); `plugin/server/server.js` rebuilt;
  - tests: new `packages/mcp-tools/test/my-design-tools.test.ts`; `packages/core/test/my-designs.test.ts` (search); `write-tools.test.ts` and `skills.test.ts` (the tool list, 22 tools, `shots`);
  - new `scripts/qa/my-designs/` (the e2e, its README and config); SPEC §10 and §22.
- Decision taken here: `my-designs` is checked by the tools that need it, not added to the required list (`required-app-features.json`), like `design.feedback`: an app from before My designs keeps working for everything else, and `save_my_design`, `get_my_design` and an `organisation` search answer `app_outdated` naming `my-designs` with the update steps. Adding it to the required list would have blocked every tool on such an app.
- Checks run and results: `my-design-tools.test.ts` 12/12 (reading from root, CRLF and non-ASCII kept; `..`, absolute, a link out, a link to `.env`, `.env`, `node_modules`, a key file, a missing file, a non-UTF-8 file, all refused before any save; relative root and company work without organisation refused; the 409 message and `replaceCode`; read-only and older-app refusals; `writeTo` sha256-equal and idempotent; no overwrite of a file that differs; no write through a linked folder; an asset whose sha256 changed; the `organisation` filter and "Yours"; `get_reference` and `which: "shots"`; `save_reference` can't make one); `my-designs.test.ts` 11/11 with the new database search test; `pnpm check` exit 0 (cli 18, core 284, extension 12, mcp-tools 367); `pnpm plugin:validate` passed.
- Manual verification: the scratch e2e (`scripts/qa/my-designs/`) on a scratch PIVOT built from this branch (`node scripts/start.mjs --scratch /tmp/pivot-mydesigns-e2e`, port 4400, guard passed), over the real MCP server on stdio: a three.js fixture with a tokens CSS (CRLF), a demo page and an SVG, screenshots and a video taken by Playwright; 6/6 steps: refusals before any save, saved with sha256-equal files, the 409, `writeTo` with sha256 equal for all four files, no overwrite, found by organisation (any case) and not by another, its shots shown. No 21st retrieval was spent.
- Remaining issues: the design page and its preview are Phase 3; until then a design opens on the generic detail page. The skill steps were checked by reading and by the tool tests, not by a full Claude session saving and reusing a real design (Phase 4's first saves will).
- Next step: Phase 3.

### Phase 1 — Core and API (2026-11-24)

- Status: Done, not committed.
- Existing functionality reused: the component store's file model and scan (moved into `code-files.ts`, 21st behaviour unchanged), `saveAsset`'s sha256 dedupe, `attachAsset`/`detachAsset`, `withoutServerOwnedMeta`, `route()` and the error mapping, the backup and restore.
- Files changed:
  - new `packages/core/src/code-files.ts`, `packages/core/src/my-designs.ts`;
  - `packages/core/src/components.ts` (uses the shared module), `types.ts` (type, section, kinds, meta, asset roles, `AGENT_TYPES`), `resources.ts` (hand-made, retyped and code-edited designs refused), `skills.ts` (`myDesign` is server-owned meta), `share.ts` and `context.ts` (company work leaves as its name only; personal work as its usage and screenshots, never the code), `backup.ts` (a restore carries a design's asset ids over);
  - new routes `POST /api/my-designs`, `GET /api/my-designs/lookup`, `POST /api/my-designs/[id]/assets`; `lib/server/http.ts` maps `MyDesignError` to 400 and `MyDesignConflictError` to 409;
  - `type-icon.tsx`, `section-nav.tsx`, `asset-gallery.tsx` (icon and labels only);
  - new `packages/core/test/my-designs.test.ts`; `test/ui-settings.test.ts` (the new section and agent-only type).
  - `packages/mcp-tools/test/tools.test.ts` (the new section), `plugin/server/server.js` rebuilt (`pnpm mcp:build`: the bundle holds the type list);
  - versions: pivot-studio 0.6.0 (npm has 0.5.0; a new feature, minor), plugin 0.7.0 (the rebuilt server; `main` has 0.6.0).
- Checks run and results: `pnpm check` (see the PR); `my-designs.test.ts` 10/10.
- Manual verification: none yet; the UI is Phase 3.
- Remaining issues: the design page is Phase 3; until then the top bar's My designs links to the Library filtered to the type (`/?type=my_design`) and a design opens on the generic detail page.
- Next step: Phase 2.
