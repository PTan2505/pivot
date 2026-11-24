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
- **Personal or company:** company designs are marked with the organisation; Share, Export and copied context carry the name, kind and owner only; a backup keeps everything.
- **Later, not now:** the extension's "select an element and save it", whole-project snapshots, version history.

## Design

### Data: the type `my_design` (no migration)

- In `RESOURCE_TYPES` and `TYPE_DEFS` (label "My design", icon `gem`, facets pageType, uiPattern, visualStyle, technology, export folder `my-designs`), its own `SECTIONS` entry "My designs" (`/?type=my_design` until Phase 3 gives it a page), and in `AGENT_TYPES`: never made, retyped or code-edited by hand.
- `meta.myDesign` (`MyDesignMeta` in `packages/core/src/types.ts`): `kind`, `ownership`, `organisation`, `files` (path, role `component`/`demo`/`style`/`support`, language, code), `dependencies` (name and exact version), `install`, `usage`, `tokens`, `source` (project, folder, original paths, session ids, mockup id), `assets` (path, asset id, sha256, size), `codeSha256`, `scan`, `savedAt`, `codeSavedAt`.
- Files in the blob store: `design-asset` (a non-code file with the path it goes to), `design-shot` (desktop or mobile screenshot), `design-video`.
- Limits: 80 files, 1 MB per file, 4 MB of code; 60 files, 12 screenshots, 3 videos, 25 MB each, 100 MB per design.
- Always refused: `.env*`, keys and certificates, `node_modules`, `.git`, package-manager credentials, paths outside the folder, and code holding a credential.
- Shared with the component store: `packages/core/src/code-files.ts` (relative paths, secret patterns, the code hash, the line scan).

### Preview (Phase 3)

React designs use the existing local build (`preview-build.ts`). Non-React designs (three.js, GSAP, plain HTML) use a `demo` `index.html` bundled by the same esbuild step, inlined into one HTML file of at most 5 MB and served from the preview origin. When it can't build, the page shows the screenshots and video and says why.

### MCP tools (Phase 2)

- `save_my_design { id?, name, kind, ownership, organisation?, root, files: [{ path, role }], assets?, screenshots?, video?, dependencies?, install?, usage, tokens?, sourceProject?, sessionId?, mockupId?, facets?, notes?, replaceCode? }`: the MCP server reads the files from disk under `root`, so the code is the original's bytes, never retyped.
- `get_my_design { id | name, writeTo? }`: the files, usage, tokens, dependencies, install steps and screenshot list; with `writeTo` it writes the files and assets byte for byte at their relative paths.
- `search_references` finds `my_design`; an `organisation` filter is added.

### Skill rules (Phase 2)

- Saving, only when asked: find every file the design needs, read exact dependency versions, write the usage notes, screenshot desktop and phone (and record a video when it moves), call `save_my_design`, list what was saved.
- Reusing: at gate 1 search My designs first ("Yours"); on a pick, `get_my_design` with `writeTo`; install the stored versions; change only import paths and token names; compare with the stored shots (and `motion-qa.mjs` for motion) and report differences.
- Company code is copied only into projects of the same organisation; elsewhere it is a visual reference.

### UI (Phase 3)

A My designs grid (cover, name, kind, Personal or Company · Org badge, filters, search) and a design page (preview stage, Preview / Code / Usage / Assets tabs, source project and session link, Download as zip). DESIGN.md updated.

## Phases

| Phase | Name            | Branch                 | Status                                   |
| ----- | --------------- | ---------------------- | ---------------------------------------- |
| 1     | Core and API    | `feat/my-designs`      | Done (PR #166)                           |
| 2     | MCP and skill   | `feat/my-designs-mcp`  | Done, not committed                      |
| 3     | UI and preview  | `feat/my-designs-page` | To do                                    |
| 4     | Release + saves | release PR             | To do, when the owner asks for a release |

Phase 4's first saves, one per session in its project folder: the ODIN 3D logo hero, the portfolio grid-scan, the ODIN layer timeline, the Pulse pricing scroll story, `story.html` A/B/C, the merchant-portal theme.

## Progress

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
