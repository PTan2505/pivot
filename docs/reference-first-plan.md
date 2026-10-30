# PIVOT — Reference First Execution Plan

> Status: Proposed implementation plan for Claude Code  
> Date: 2026-10-29  
> Priority: UI references first. Skills and workflows later.  
> In this repo: the requirements are [`docs/SPEC.md`](SPEC.md), progress is logged in [`docs/reference-first-progress.md`](reference-first-progress.md).

## 0. Mission

Reduce PIVOT's immediate scope to one dependable daily workflow:

**Discover UI → Save reference → Organize → Find → Reuse.**

The current requirements document (`SPEC.md`, PIVOT Requirements v0.2) defines 13 resource types and broader capabilities. **Do not interpret this plan as permission to delete existing code, data, or features.** Freeze nonessential development, retain compatibility, and concentrate implementation and QA on reference management.

## 1. Instructions for Claude Code

1. Read `SPEC.md` and the repository's `DESIGN.md`, existing implementation, scripts, and tests before making changes. The attached SPEC is requirements, **not proof that features already work**.
2. Inspect the actual repository and create an implementation-status inventory: **Working / Partial / Missing / Broken / Unknown**. Cite relevant file paths and tests in the inventory.
3. Do not rebuild a working feature. Prefer minimal, safe changes.
4. Follow the existing stack and design system. Preserve PIVOT's dark ember/glass visual language and established navigation unless a necessary reference-focused fix requires adjustment.
5. Work in the phase order below. For each phase: audit → identify gaps → implement → test → report.
6. Never delete or migrate away skills, prompts, or other existing resource data merely to simplify the UI. Do not remove existing routes or APIs without explicit approval.
7. If a decision would cause destructive migration, major architectural change, or conflict with SPEC, stop and request approval.
8. Keep a short progress log in `docs/reference-first-progress.md` with completed items, open issues, tests, and next steps.
9. If `SPEC.md` is not present in the repository, ask for its location rather than inventing missing details.

## 2. Scope

### In scope (P0)

- **UI/UX Reference** (`reference`): URL, screenshot, title, description, notes, facets, tags.
- **Sources** (`source`): directory of places to discover references; source-specific search and source attribution where already supported.
- **Collections**: group and revisit saved references.
- **Reference retrieval**: search, filters, visual browsing, detail view, original URL.
- **Chrome extension**: quick-save workflow, once core saving works.

### Deferred / frozen

- Skill packs, skill sync/editing, and skill guide enhancements.
- Workflows, prompts, MCP, snippets, rules, checklists, and other knowledge expansion.
- Projects, AI tagging, advanced duplicate detection, resource-to-resource linking, backup/restore, MCP server.
- New animation/branding polish unrelated to the reference workflow.

**Important:** Existing functionality in deferred areas may remain accessible; do not extend it during this initiative.

## 3. Phase checklist

### Phase 0 — Audit and baseline (first)

- [x] Locate relevant code paths for reference CRUD, screenshots, sources, collections, search, filters, and extension.
- [x] Record which checklist items below are already working; do not assume all are missing.
- [x] Run available baseline checks (typecheck, lint, tests, build) and record results.
- [x] Identify any data-loss or security risks before modifying persistence or screenshot code.
- [x] Produce a concise gap list, ordered by impact on the daily workflow.

**Done when:** There is a grounded implementation inventory and a small, ordered list of changes.

### Phase 1 — Save references

- [x] Save a reference from a URL.
- [x] Capture or preserve source URL, title, and description when available.
- [x] Capture viewport screenshot at 1440×900 and full-page screenshot using existing Playwright behavior.
- [x] Respect SPEC limits: full-page max 12000px; bounded scrolling/expansion; keep viewport image if full-page fails.
- [x] Allow manual screenshot upload or replacement.
- [x] Show saved references as clear visual cards.
- [x] Warn on duplicate URLs; avoid unintended duplicate creation.
- [x] Show actionable error states for blocked pages, screenshot failures, and invalid URLs.

**Done when:** A user can save and reopen several real websites without losing the URL or usable screenshot.

### Phase 2 — Organize references

- [x] Support reference facets: `pageType`, `domain`, `visualStyle`, `uiPattern`.
- [x] Support user-defined tags and editable metadata.
- [x] Create, rename, and use collections to group references.
- [x] Filter by type, facets/tags, and collection where applicable.
- [x] Preserve existing tag behavior and AND-combination semantics from SPEC.
- [x] Keep reference cards legible; do not apply glass styling to screenshot/card surfaces.

**Done when:** 20 references can be grouped and filtered without confusion.

### Phase 3 — Find and reuse

- [x] Search saved references by title, URL, description, and tags as supported by the current data model.
- [x] Open a useful detail view with readable screenshots and metadata.
- [x] Open the original website reliably.
- [x] Combine filters to narrow results.
- [x] Sort by creation date (newest/oldest).
- [x] Verify search empty states, no-match states, and clearing filters.

**Done when:** A previously saved reference can be retrieved quickly by name or category.

### Phase 4 — Sources and browser capture

- [x] Browse saved Sources by category and open a Source's original website.
- [x] Confirm Source uses viewport-only screenshots, per SPEC.
- [x] Verify search across saved Sources and `searchUrl` behavior where implemented.
- [x] Verify attribution/filtering of references via matching Source host (`via`).
- [ ] Verify Chrome extension quick-save and screenshot capture with the local app running.
- [x] Check extension token/authentication flow; do not weaken security to make saving easier.

**Done when:** A user can discover a site from Sources and save a useful reference with minimal friction.

### Phase 5 — Real-use validation

- [ ] Save 20 actual UI references from different sites.
- [ ] Create 3 practical collections (e.g., Landing Pages, Dashboards, Components).
- [ ] Find 5 references using search and filters, without browsing the full library.
- [ ] Try extension-based saving from a normal browsing session.
- [ ] Record friction, bugs, and any repeated manual steps.
- [ ] Fix only high-impact issues that block save → organize → find → reuse.
- [ ] Re-run relevant checks and report remaining issues.

**Done when:** The core reference workflow works end to end and is usable in daily design work.

## 4. Acceptance criteria

These are **usability targets for this focus plan**, not previously established product SLAs:

- Saving a straightforward UI reference should take roughly **30 seconds or less** in a normal session, excluding unusually slow external sites.
- Finding a known reference should take roughly **10 seconds or less** using search/filter.
- At least **20 real references** can be saved, classified, viewed, and reopened.
- Screenshot failure must not silently discard an otherwise valid reference.
- Existing resources and collections remain intact.
- No regression in core local-only security controls, SSRF protection, upload checks, or extension authorization.

## 5. Suggested seven-session schedule (flexible)

| Session | Focus                                | Deliverable                       |
| ------- | ------------------------------------ | --------------------------------- |
| 1       | Audit existing code and freeze scope | Working/partial/missing inventory |
| 2       | URL saving and screenshots           | Reliable reference capture        |
| 3       | Cards and detail page                | Usable visual browsing            |
| 4       | Tags, facets, collections            | Organized references              |
| 5       | Search and filters                   | Fast retrieval                    |
| 6       | Sources and extension                | Convenient discovery and saving   |
| 7       | Test with 20 references              | Verified daily workflow           |

Do not spend a full session on features that already pass acceptance checks. The schedule is a guide, not a fixed deadline.

## 6. Required output after each phase

Report briefly:

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

## 7. Stop rules

Do **not** start Skills or Workflows implementation merely because reference work seems small. Finish real-use validation first. Pause and ask for a product decision when a requirement is ambiguous, a migration may destroy data, or scope expands beyond reference-first.

**Guiding principle: Build less. Collect more.**

## 8. Suggested first prompt for Claude Code

> Read `docs/reference-first-plan.md`, `docs/SPEC.md`, and `DESIGN.md`. Start with Phase 0 only: inspect the repository, identify which reference-focused features already work, run available checks, and write a prioritized gap list. Do not change application code yet. Report findings and propose the smallest Phase 1 implementation steps for approval.
