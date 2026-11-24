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
| 1     | Core and API    | `feat/my-designs`      | Done, not committed                      |
| 2     | MCP and skill   | `feat/my-designs-mcp`  | To do                                    |
| 3     | UI and preview  | `feat/my-designs-page` | To do                                    |
| 4     | Release + saves | release PR             | To do, when the owner asks for a release |

Phase 4's first saves, one per session in its project folder: the ODIN 3D logo hero, the portfolio grid-scan, the ODIN layer timeline, the Pulse pricing scroll story, `story.html` A/B/C, the merchant-portal theme.

## Progress

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
