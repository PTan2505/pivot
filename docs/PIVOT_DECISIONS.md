# PIVOT — Consolidated Product Decisions: Skill, MCP, Design Workflow & Chrome Extension

> **Status:** Review baseline approved for the Chrome Extension (65/65); prior Skill/Workflow discussions restored for review. **Not an implementation plan.**
>
> **For Claude Code:** Read **Part A** (Skill/MCP/Design Flow) and **Part B** (Chrome Extension) together. Identify contradictions or missing capabilities in the actual repository. Do not implement or write generated design documents to the target project without the user's direction.

---

# Part A — PIVOT Skill, MCP & Design Workflow (previously omitted)

> **Scope correction:** The original 65-topic document focuses on Chrome Extension decisions. This section restores the previously discussed `pivot-design` Skill and Claude Code workflow. It is a **decision/specification baseline**, not an implementation plan. Where details were not explicitly agreed, they are marked **Open / verify** rather than invented.

## A1. Product role and boundaries

PIVOT is a personal UI reference and design-workflow knowledge base, not merely a screenshot extension. Its components serve different roles:

| Component                 | Responsibility                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome Extension          | Capture and organize references, screenshots, sections, interaction states and motion evidence.                                                     |
| PIVOT Web App             | Library, Facets, Collections, search, Reference Details, review, Design Sessions and decisions.                                                     |
| PIVOT MCP                 | Make PIVOT reference/context data accessible to Claude Code; store workflow artifacts in PIVOT when supported.                                      |
| `pivot-design` Skill      | Guide Claude Code through reference-based design, user review, explicit approval, implementation and QA.                                            |
| Target project repository | Holds implementation source code and its required project files; **not** generated PIVOT design briefs, design decisions or workflow documentation. |

**Non-negotiable:** Claude Code must not silently create generated design briefs, decisions, session notes or workflow documents inside the target project's repository. Those artifacts belong in PIVOT via MCP. Source code changes to the target project are allowed only when the user requests implementation.

## A2. End-to-end `pivot-design` workflow

1. **Receive requirements.** Understand the page, component, interaction, brand constraints, responsive expectations and user goal. Ask only essential clarifications.
2. **Discover references.** Search PIVOT Library through MCP using requirements, Facets and visual signals; use relevant screenshots and details rather than titles alone. External Source Directory discovery can complement this, but external results are not saved automatically.
3. **Select 2–4 references.** Explain why each is relevant, what to **Take** and what to **Leave**. Do not copy an entire site or assume permission to reuse assets.
4. **Create a Design Brief.** Synthesize requirements, selected references, intended structure, style, interaction, constraints and `Take / Leave` choices. Store the brief **in PIVOT**, not the target repository.
5. **Start a Design Session.** Create a session **after the first completed brief**, not for every small UI fix. Associate selected references and the brief with the session.
6. **Explore 2–3 mockups/alternatives.** Present meaningful visual or structural alternatives grounded in the references and brief. Do not treat mockups as approved implementation.
7. **Explicit user approval gate.** User chooses or requests changes. Record the approved direction and decision in PIVOT. **No implementation before explicit approval.**
8. **Implement approved design.** Claude Code may edit implementation files in the target repository after approval. Keep implementation aligned with approved brief and project conventions.
9. **QA and review.** Validate resulting UI, interactions and responsive behavior against the approved direction; surface deviations for review rather than silently rewriting the design decision.

### Workflow map

```text
User requirements
    |
    v
Search PIVOT via MCP ----> Optional external discovery
    |
    v
Inspect screenshots + select 2–4 references
    |
    v
Design Brief (Take / Leave) ---> Save snapshot in PIVOT
    |
    v
Create Design Session after first completed brief
    |
    v
2–3 mockup alternatives
    |
    v
Explicit user approval? --- No ---> Revise brief/mockups, repeat review
    |
   Yes
    |
    v
Record approved decision in PIVOT
    |
    v
Implement target-project source code
    |
    v
QA against approved direction; record material changes in PIVOT
```

## A3. Design Brief and snapshots

- Brief is a **reference-based design artifact**, not a free-form prompt detached from evidence.
- Include the requirements, selected 2–4 references, why they fit, **Take / Leave** decisions, design direction, important constraints, and open questions if any.
- Store Markdown **snapshots in PIVOT** at: **initial completed brief**, **approved brief**, and **major-change milestones**. Do not create a snapshot on every minor edit.
- If a major change invalidates approval, return to the approval gate rather than assuming earlier approval covers it.
- Do not export or copy these documents into the target repository by default. Explicit exports are separate user actions.

## A4. Design Sessions, decisions and scope

- A **Design Session** begins after the first completed Design Brief. It is not the same as a Capture Session.
- Keep minimal session/decision tracking at first: brief references, chosen direction, approval state and major changes.
- Tiny UI fixes should not automatically create full sessions.
- Preserve approval history and major-change snapshots in PIVOT. Exact session schemas and approval UI are **Open / verify against existing codebase**.
- The user can change decisions before implementation; changes after approval should be visible and reviewed when material.

## A5. PIVOT MCP contract and gaps

Previously identified initial MCP read tools:

- `list_facets`
- `search_references`
- `get_reference`
- `get_reference_images`

These allow Claude Code to discover and inspect references. **They do not, by themselves, prove the existence of write tools** for creating Design Brief snapshots, Design Sessions or decisions. Before implementation, verify current MCP capabilities. If write tools are missing, mark this as a product/API gap; do not silently write artifacts into the target repository as a workaround.

MCP is the default retrieval channel for Claude Code. Portable exports (Markdown/JSON/backup) are explicit user actions, not a substitute for routine MCP access.

## A6. How Extension and Skill connect

```text
Chrome Extension captures reference
    -> PIVOT Library (screenshot + context + Facets/Collections)
    -> MCP search and image retrieval
    -> pivot-design reference selection
    -> Design Brief / mockups / explicit approval
    -> Claude Code implementation + QA
```

- A captured **section** (Hero, Pricing, Navbar, Animation) can be its own Reference with a relationship to its source page.
- Original/Latest screenshots, responsive variants, theme captures, interaction states and motion keyframes are evidence/states attached to a Reference, not automatically separate References.
- A genuinely changed website design may be saved as a **new linked Design Version Reference** after user confirmation; it must not overwrite historical design evidence.
- AI-generated Facet suggestions and search signals are not user-approved Facets until confirmed.
- Claude Code should use available clean screenshots and annotations as design evidence; private/redacted material must respect privacy boundaries.

## A7. Search and Source Directory decisions relevant to Skill

- Unified Search: **All / Library / External**; external results are ephemeral until explicitly saved.
- External inspiration sources discussed include Refero, Dribbble, 21st.dev and React Bits, subject to access and feasibility. Do not assume every site offers a stable public API or unrestricted scraping.
- Collections are user-curated groups; Facets are filtering properties; a Reference may belong to multiple Collections.
- The Skill should prefer confirmed metadata and actual reference screenshots over AI-inferred labels when explaining design choices.

## A8. Review gates and non-goals

**Must hold:**

- No implementation before explicit approval of design direction.
- No generated PIVOT workflow documents in target project repository.
- No automatic external-reference save or wholesale asset extraction.
- No assumption that an initial read-only MCP can persist briefs/decisions.
- No fake responsive/theme states or fabricated evidence.

**Not yet decided in enough detail:** precise Skill command syntax, MCP write tool names and schemas, approval-state database schema, how mockups are rendered, and the exact QA automation. Claude Code should inspect existing project state and flag gaps before proposing implementation. This document does **not** authorize inventing those details.

## A9. Suggested user review checklist

- [ ] Does the `pivot-design` flow match the intended design process?
- [ ] Are 2–4 references and 2–3 mockups still the desired defaults?
- [ ] Is the approval gate strict enough?
- [ ] Are Design Brief snapshots and decisions stored only in PIVOT?
- [ ] Is the separation between Capture Session and Design Session clear?
- [ ] Do MCP capabilities need extension to save workflow artifacts?
- [ ] Are any Skill stages unnecessary or missing?

---

# Part B — PIVOT Chrome Extension (65 approved review topics)

# PIVOT Chrome Extension — Final Decision Specification

> **Status:** Approved review baseline (65/65 topics).  
> **Purpose:** Editable handoff for Claude Code. This document records product/UX decisions, **not** an implementation plan.  
> **Language:** Vietnamese. English terms are retained where they identify UI concepts or technical contracts.  
> **Important:** Decisions 1–55 were reviewed individually. Decisions 56–65 were approved as the assistant's recommended defaults; their detail is intentionally lighter. Do not invent additional requirements to fill gaps.

## 0. Instructions for Claude Code

1. Treat this as the approved **decision baseline**, not authorization to implement immediately. First read it, compare against the current PIVOT codebase, identify gaps and contradictions, and propose a scoped plan **only when the user asks**.
2. Do not rebuild working functionality unnecessarily. Reuse the existing Chrome Extension, Playwright capture pipeline, API, PIVOT MCP, and data model where feasible.
3. Distinguish **Core / Later / Optional** priority recommendations in §2 from approval status: all 65 product directions are approved, but not all must ship together. Priorities below are editorial recommendations for user review, not a separately approved release roadmap.
4. **Never write design briefs, design decisions, workflow docs, or other generated documentation into the target company's project repository.** Store them in PIVOT through MCP. Editing implementation files in a target project is a separate permitted activity when requested.
5. Protect private data: no transfer of cookies, sessions, credentials or tokens to server capture; private screenshot upload needs explicit approval; redact sensitive pixels before upload. Do not quietly weaken these requirements to make capture work.
6. Preserve data and history: Originals, Design Versions, annotations, and Pending Sync must not be silently discarded; handle retries idempotently and reconcile uncertain server results.
7. If a requirement conflicts with browser permissions, service-worker lifecycle, website behavior, or an existing architecture, report the limitation and propose a safe alternative rather than pretending it works.
8. The user may amend any decision before implementation. Prefer asking about **actual contradictions/blockers**, not re-opening the 65-option questionnaire.

## 1. Product context and existing architecture

PIVOT is a personal UI-reference and design-workflow knowledge base, supporting a Chrome Extension, a Web App, Claude Code via PIVOT MCP, and a `pivot-design` Skill. The central workflow is collecting reference evidence, finding relevant references, creating a design brief, exploring mockups, and obtaining explicit approval before implementation.

Known current architecture / functionality (verify against repository before coding):

- Monorepo with `apps/web`, `packages/core`, `apps/mcp`, `packages/mcp-tools`; Neon/PGlite persistence and R2/local screenshot storage.
- PIVOT MCP initially read-oriented: `list_facets`, `search_references`, `get_reference`, `get_reference_images`; local API at `127.0.0.1:4321` in the reviewed environment.
- Chrome Extension popup shortcut `⌥⇧S`, Quick Save `⌥⇧D`, context-menu actions; current tab screenshot and metadata capture, including signed-in tab state.
- Existing capture flow includes a type picker, type-specific Facets, optional details, URL/type duplicate warnings, a connection Token and ping endpoint.
- Supported content types include Reference, Source, UI Library, Image & Video, Animation, Font & Palette, Icon & SVG, Prompt, Snippet, Coding Rule, Checklist, MCP Config.
- Existing server Playwright flow uses isolated browser context, URL/SSRF safeguards, viewport-first capture, bounded scrolling/lazy-load, stitched full-page screenshot, partial-result preservation and a server timeout. **Existing auto-click of Load More must not be assumed to remain enabled:** decision #12 makes this opt-in.
- API endpoints known at review time: `POST /api/clip`, `GET /api/lookup`, `POST /api/ping`, `GET|POST /api/settings/token`.

These are **review-time observations**, not guarantees about current code. Verify them in the repo.

## 2. Suggested priority grouping — editable

This grouping is a **proposed way to stage work**, not a replacement for the decisions below.

| Priority     | Recommended focus                                                                                                                                                                                                                                  | Notes                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Core**     | Reliable Quick Save, Capture Now, section capture, library organization, duplicate warnings, screenshot integrity, local Pending Sync, privacy approval/redaction, quality/error states, safe cancellation, minimal permissions, API compatibility | Must not sacrifice safety to make the UX faster.       |
| **Core**     | Unified Library search, Facets/Collections, Review Inbox, clear Capture Queue/Recent Activity, current-tab capture, metadata provenance, accessible UI                                                                                             | Keep popup compact.                                    |
| **Later**    | Motion recording, motion-aware keyframes, responsive variants, multi-state capture, visual annotations, capture comparison, richer relationships and design-version suggestions                                                                    | Opt-in and bounded; some may be technically difficult. |
| **Later**    | Portable backup/import, share snapshots, rich AI enrichment, selective asset extraction, Activity Timeline in Web App, controlled Deferred Capture                                                                                                 | Maintain explicit confirmation and data boundaries.    |
| **Optional** | Trusted Websites, Capture Sessions, extensive collection suggestions, advanced diagnostics, advanced settings, external inspiration-source search integrations                                                                                     | Only add when the core workflow warrants them.         |

## 3. Approved decisions — topics 1–55

### A. PIVOT workflow and information architecture (1–7)

1. **MVP scope.** Reference Capture/Organization, Source Directory 2.0, Unified Search, Reference-based Design Brief, Workflow Config/optional Skill integration, Mockup Approval Gate, minimal Design Sessions/Decisions.
2. **Design Session creation.** Create a Design Session automatically **after the first completed brief**, not for tiny fixes.
3. **Design Brief snapshots.** Save Markdown snapshots **inside PIVOT only** at initial, approved, and major-change milestones. Do not save them into the target project repo.
4. **Reference structure.** One base record with optional Website / Component / Motion metadata; one Library and search surface.
5. **Collections vs Facets.** Collections are user-curated groups; Facets are filter properties. A Reference can belong to multiple Collections.
6. **Source Directory 2.0.** Directly search external inspiration sources (e.g., Refero, Dribbble, 21st.dev, React Bits) **subject to actual feasibility and access**.
7. **Unified Search.** One search bar with `All / Library / External`; external results remain ephemeral until explicitly saved.

### B. Capture entry, screenshots and organization (8–19)

8. **Section references.** A webpage Hero, Pricing, Navbar or Animation section can be an independent Reference.
9. **Capture modes.** Auto Capture by default; optional `Crop Screenshot` and `Select Element` directly on website; no forced mode-selection step.
10. **Duplicate detection.** Show 2–3 existing References from same URL with thumbnails and `View All`; offer `Open Existing` or `Save New`; never auto-merge. Quick Save `⌥⇧D` skips duplicates.
11. **Theme.** Light / Dark / Both, with a switch in Reference Detail only when a real screenshot for that state exists. Never simulate a missing theme using CSS filters.
12. **Expand Content.** Optional `Expand content` **off by default**. Continue bounded lazy-load/scroll but do not auto-click `Load More` unless opted in.
13. **AI Facet suggestions.** After Save, suggest Facets without blocking; user confirms; prefer existing Facets rather than introducing synonyms.
14. **Quick Save review.** Save immediately with `Needs review` status; Inbox is a filter, not a Collection; this status does not block Library search or Claude Code retrieval.
15. **Extension quick edit.** Compact edit of title, notes, Facets, Collections and a success message; full management belongs in Web App; editing not forced after Save.
16. **Capture failure/retry.** Bounded smart retry for transient errors; honor HTTP `429 Retry-After`; no automatic retry on `401/403`, bot challenge or unsafe URLs. Manual Retry available. Keep previous screenshots until replacements are stored. Partial success is retained. Capture status is independent from Inbox `Needs review`.
17. **Capture Queue.** Extension compact `Queued / Capturing / Completed / Failed` view and Web App Capture Queue. Server jobs may continue after popup closes; no fabricated percentage progress.
18. **Screenshot versions.** `Original` = first successful; `Latest` = most recent successful; Original shown by default. Theme variants only for real captures; avoid storing identical physical duplicates.
19. **Collection suggestions.** Show 2–3 recent/frequent Collections immediately, then optional AI suggestions after Save. User confirms; no automatic creation/assignment; allow multiple or none.

### C. Motion, responsive, private capture and quality (20–26)

20. **Motion capture — Suggest & Record.** Detect likely animation and suggest `Capture Motion`; only after confirmation should server Playwright record video. Users may explicitly request server recording without detection. Extension manual recording supports authenticated states and complex hover/click. Never record all references automatically. Server video follows viewport during scroll; do not promise automatic replay of complex interactions. Server browser is separate from the signed-in Chrome tab.
21. **Scroll animation, sticky and canvas.** Keep full-page screenshot/stitching, use motion-aware screenshots and keyframes when useful or requested, alongside video. A stitched image cannot always faithfully represent scroll-driven effects.
22. **Section context.** Store screenshot plus structured source context: URL, section type, position, dimensions, viewport, selector as a **non-stable hint**, relationship to source; no full DOM/CSS by default. Optional linked motion evidence.
23. **Responsive capture.** Primary viewport first; Desktop / Tablet / Mobile screenshots only on request, **inside the same Reference**. Avoid multiplying all combinations of theme × version × viewport × motion. Real extension tab state differs from server-rendered viewport; do not fake mobile by scaling desktop.
24. **Authenticated/private pages.** Prefer actual signed-in Chrome tab. Server Playwright can add screenshots/responsive/motion only when independently accessible. **Never transfer cookies, session, localStorage or passwords to server.** Never replace a valid screenshot with a login wall. Explicitly confirm before uploading private screenshots. URL-based private detection is imperfect.
25. **Privacy and redaction.** Smart suggestions plus manual masks; user adjusts and confirms. Apply opaque **pixel-level** redaction before upload (not CSS blur/overlay). Do not retain unredacted originals on server by default. Protect OCR/metadata, video and keyframes too. Public Quick Save stays fast. AI detection may miss sensitive data.
26. **Quality checks.** Separate `Capture Status` (Completed/Partial/Failed), `Capture Quality` (Looks good/Needs review/Unavailable), and Inbox `Needs review`. Flag likely blank images, missing fonts/images, login/challenge pages, bad stitching, etc. Do not block Quick Save or replace a good screenshot with a suspicious/bad one. Detection is fallible.

### D. Reference relationships, evidence and review (27–36)

27. **Relationships.** Flat Library + smart links: `Same Source Page`, `Part Of`, `Related To`, `Variant Of`. Auto-link only when confidently same source page; same domain alone is insufficient. Speculative links require confirmation. Viewport, theme, Original/Latest and motion keyframes are assets/states, not separate References. A section may be saved before its parent.
28. **Website changes → new Design Version.** Detect meaningful changes and suggest creating a **NEW Reference** linked as `Newer Version Of`, never silently overwrite the historical Reference. Preview then explicit `Save as New Version`. Distinguish **Capture Version** (Original/Latest inside one Reference) from **Design Version** (new linked Reference). Avoid new versions for dynamic/minor changes. No blanket background monitoring; no private-page background checking; no automatic new Reference creation.
29. **Annotations.** Text Notes plus screenshot-anchored visual pins/regions as separate structured layers; Claude Code can read annotations and clean images. Do not burn annotations into screenshot pixels. **Redaction is different:** it must alter pixels before upload.
30. **Layered metadata.** (1) Captured Facts, (2) AI Search Signals such as visual description/layout/style, (3) Confirmed Facets and Notes. AI signals may be searchable but are not official Facets until approved; never overwrite confirmed metadata. Search can explain matches. Do not index sensitive redacted/private data. Analyze new Design Versions separately.
31. **Provenance.** Distinguish `Captured From` (actual URL), `Published By` (platform publisher/account, not necessarily designer), `Original Source` (verified if known). Preserve captured URL alongside canonical. Do not guess authorship or imply license from attribution.
32. **Asset extraction.** Screenshot/context by default. Discover images, SVG, font metadata and gradients, but extract only selected assets. No bulk downloads, private-data extraction or site cloning. Font binaries not downloaded by default. Distinguish metadata from binary and keep attribution/permissions. Link assets to Reference.
33. **Interaction states.** One Reference with multiple state screenshots (Default/Hover/Expanded/Error/etc.) and state-specific annotations. Capture from live tab on request; no automatic dangerous clicks. States are distinct from motion, theme, viewport, and capture/design versions.
34. **Naming.** Structured default `[Section] — [Source]` (e.g., `Hero — Orbit`); original page title retained as metadata. AI may suggest names after Save but cannot silently rename or override manual title. Versions and states are structured separately.
35. **Review Inbox.** Unified Inbox for suggestions with Accept/Edit/Skip and multi-select approval. Review does not block Quick Save/MCP. AI signals remain searchable but not confirmed Facets until accepted. Asset extraction approval explicit.
36. **Capture Sessions.** Recent Collection suggestions by default; optional user-enabled Capture Session with default Collection for subsequent captures, per-capture override, visible active state and no hidden continuation. This is **not** a Design Session.

### E. Data safety, portability, sharing and extension usability (37–50)

37. **Offline Queue.** Local Capture Queue + safe automatic sync. Clearly distinguish `Saved locally` and `Synced`. Idempotent retry prevents duplicates after uncertain network outcomes. Never auto-upload unapproved private/unredacted content; preserve Collection choice from capture time; no automatic recapture of the site during sync; warn on storage limits; no silent loss.
38. **Storage and retention.** Protect Originals, Design Versions, annotations, referenced assets and Pending Sync. Auto-clean only safe temporary/cache files; propose cleanup of saved data and require confirmation. Keep Original + Latest rather than every intermediate screenshot.
39. **Export.** Purpose-based: AI Context Markdown/JSON, selective Share Package, and full Portable Backup with manifest/relationships/stable IDs/versioning. Exclude credentials and control private assets. MCP remains Claude Code's default retrieval path; export is explicit, never silently copied into target project repo.
40. **Import/restore.** Preview before applying; default `Keep Current`; options `Skip`, `Import as New`, `Selective Merge`. Protect Originals/relationships; idempotent retries; no silent overwrite of confirmed metadata; reject unsafe archive contents.
41. **Sharing.** Private by default, controlled read-only **Share Snapshots** with explicitly chosen scope. Exclude private content, notes and annotations by default. Expiring/revocable links; no team roles for now. Share Package fallback if no public endpoint. Revocation cannot undo downloads.
42. **Extension search.** `Capture` / `Library` views; quick search and Recently Saved; contextual groups `Saved from this page`, `Saved from this website`, `Possibly related` with clear distinction. No automatic website overlay or private-content AI transmission; no external search in popup; deeper management in Web App; Pending Sync visibly labeled.
43. **Notifications.** Adaptive feedback for direct actions; badge/center for background tasks; action-required prompts for errors/private approval; batch grouping; no private details in OS notifications; `Saved locally` ≠ `Synced`. Report success only after confirmation.
44. **Shortcuts/context menu.** Keep `⌥⇧S` Capture popup and `⌥⇧D` Quick Save. Context menu adapts to Page/Image/Link/Selected Text; Capture Section on request; search PIVOT Library first. Chrome shortcut settings via `chrome://extensions/shortcuts`. Preserve privacy and duplicate safeguards.
45. **Onboarding/connection.** Guided setup with safe detection of default localhost API; guide Token entry and validate via API. Distinguish server offline, invalid authentication and version mismatch. Never read Token from arbitrary filesystem via Extension or leak credentials. Allow custom API URL; preserve Pending Sync offline. No new auth system by default.
46. **Updates/API compatibility.** Capability negotiation rather than version number alone. Compatible features continue; unsupported captures remain Pending Sync awaiting compatible Server. No silent downgrade, infinite retry or automatic server updates. Preserve local data and privacy.
47. **Performance budget.** Adaptive Capture Budget and progressive results: viewport first, bounded full-page second, motion/responsive only opt-in. Balanced default; Extended by request; limit concurrency. Preserve partials/Originals; no silent quality downgrade; no automatic Expand Content.
48. **Accessibility.** Keyboard and screen-reader access to popup, queue and review. Section Capture alternatives: Visual Select / Section List / Manual Crop. Keyboard alternatives for redaction/annotations, respect reduced motion, avoid shortcut proliferation. Arbitrary websites may limit full keyboard support.
49. **Error diagnostics.** Explain known cause, preserved results and next action; technical details collapsed and sanitized. No automatic upload of diagnostics or sensitive Tokens/cookies/URLs/content. Do not auto-retry bot challenges/unsupported capabilities; don't invent a root cause.
50. **Settings.** Group `Capture / Privacy / Notifications / Connection / Advanced`; safe defaults, Advanced collapsed, distinguish Global Default from Per-Capture Override. Cannot disable essential private approval/data protection. AI cannot change settings automatically.

### F. Device, permissions, lifecycle, history and cancellation (51–55)

51. **Device migration.** Server-backed Library for Synced References. Pending Captures transfer only via explicit Export/Import Device Transfer Package with preview. Restore non-sensitive Settings selectively. Never transfer Token/cookies/session. Preserve privacy approval and duplicate protection. Warn about Pending Sync before device changes where possible; **do not assume Extension can block uninstall** or recover data deleted before export.
52. **Permissions.** Least Privilege + Just-in-time Permissions: current-tab access initiated by user, optional broader host permission only when actually needed, scoped/revocable Trusted Websites optional. No blanket background browsing, no repeated prompts after denial, honest fallbacks for restricted Chrome pages. **Chrome Permission never replaces Private Upload Approval.** Do not promise access to a tab/DOM without the required browser permissions.
53. **Lifecycle/recovery.** Task-aware: Server Capture continues independently of popup if Server is running; Pending Sync persists and reconciles; tab-bound selection/recording ends or stops safely when tab closes; Motion Recording never auto-restarts after Chrome restart or jumps to another tab. Do not assume Manifest V3 service worker stays alive. Preserve partial results/private approvals and use idempotent reconciliation before retry.
54. **Activity Log.** Lightweight Activity Timeline + on-demand technical details. Capture/Sync/Recovery milestones; attempts grouped by Reference. Extension shows short Recent Activity; Web App full timeline; Reference Detail linked history. Not browsing history; privacy-safe metadata; limited retention; cleanup must not delete Originals/Pending Sync. A **30-day default was proposed as an example, not separately fixed**.
55. **Cancel / Undo / Discard.** `Cancel` stops remaining work and preserves valid partials; `Undo` reverses recent safely reversible changes; `Discard` explicitly removes selected data with confirmation where appropriate. Reconcile server state before reporting cancellation or undo of sync. Protect Originals/Pending Sync. Do not promise that uploads/downloads can be retroactively undone.

## 4. Approved recommended defaults — topics 56–65

> The user approved the recommended options for all remaining topics together. The following records the scope actually discussed; detailed edge cases and thresholds were **not** separately specified.

56. **Controlled Deferred Capture + Bounded Readiness.** `Capture Now` default. `Wait Until Ready` is bounded and does not automatically expand content/click Load More. `Capture Later` is an explicit **request**, not a captured screenshot; it is not silently executed just because Server reconnects. No recurring schedules by default. No session/cookie transfer. Record `Request Created At` separately from `Screenshot Captured At`; future website state may differ. Pending Sync of already-captured approved data remains distinct and can resume safely.
57. **Capture Consistency & Reproducibility — Capture Context Snapshot.** Save known context (viewport, capture time, theme, capture method and identifiable conditions) to explain differences. Do not claim pixel-perfect reproducibility across personalized/dynamic pages.
58. **Capture Comparison — Visual Diff + Context.** Support comparison of Original/Latest and linked Design Versions with visual differences plus contextual metadata. Distinguish meaningful design changes from dynamic content where possible; avoid overclaiming certainty.
59. **Capture Reliability — Health Signals + Selective Alerts.** Detect repeated failures and quality regressions, surface actionable alerts only when relevant; avoid notification spam. Specific thresholds are not yet defined.
60. **Extension UI Complexity — Progressive Disclosure.** Keep popup lightweight; show advanced controls only when needed. Deeper management belongs in Web App.
61. **Extension Performance — Lightweight by Default.** Avoid continuous DOM monitoring or heavy background work; activate capture-related behavior on user action and within resource budgets.
62. **Extension Security — Secure Defaults + Explicit Trust Boundaries.** Separate website/tab, Extension/local queue, API/Server and storage boundaries; enforce permissions, validation and privacy rules already decided. Do not infer additional security architecture without review.
63. **Testing & QA — Risk-based QA + Real Website Validation.** Prioritize realistic public/private page capture, permission denial, offline recovery, duplicate avoidance, redaction, partial failures, motion lifecycle and data preservation. This is a QA direction, not a detailed test plan.
64. **Feature Prioritization — Core Workflow First + Advanced Features Phased.** Prioritize Quick Save, Capture and Library; phase advanced capabilities rather than shipping everything at once. See editable §2.
65. **Final UX Consistency — Unified States & Actions.** Keep terminology and behavior consistent across Save, Sync, Capture, Review, Cancel, Retry, Undo and Discard. Do not conflate independently meaningful statuses.

## 5. Canonical distinctions (do not collapse)

| Concept            | Meaning                                             | Must not be confused with                |
| ------------------ | --------------------------------------------------- | ---------------------------------------- |
| Reference          | Saved Library item                                  | Capture Attempt, Deferred Request        |
| Capture Attempt    | One execution/try                                   | New Reference by default                 |
| Capture Version    | Original/Latest assets in a Reference               | Design Version                           |
| Design Version     | New linked Reference for meaningful site change     | Latest screenshot                        |
| Interaction State  | Hover/Expanded/Error/etc. within Reference          | New Reference or theme                   |
| Theme/Viewport     | Captured asset variants                             | Fake CSS transformation or new Reference |
| Capture Status     | Queued/Capturing/Completed/Partial/Failed/etc.      | Quality or Inbox review status           |
| Capture Quality    | Looks good/Needs review/Unavailable                 | Capture Status                           |
| Inbox Needs review | Organizational review state                         | Capture failure                          |
| Saved locally      | Durable local data not yet verified on Server       | Synced                                   |
| Synced             | Server has confirmed durable receipt                | Request merely sent                      |
| Pending Sync       | Already captured payload awaiting transfer          | Deferred Capture                         |
| Deferred Capture   | Request to capture in future                        | Screenshot already exists                |
| Chrome Permission  | Technical authority to access a page/API            | Permission to upload private data        |
| Privacy Approval   | Explicit permission to upload private content       | General site access                      |
| Annotation         | Separate visual note layer                          | Pixel redaction                          |
| Cancel             | Stop remaining work                                 | Undo or Discard                          |
| Undo               | Reverse safely reversible change                    | Revoke already shared/uploaded data      |
| Discard            | Explicitly remove chosen data                       | Automatic cancellation                   |
| Capture Session    | Optional grouping/default Collection during capture | Design Session                           |
| Collection         | User-curated grouping                               | Facet/filter                             |
| Captured From      | Actual capture location                             | Original creator/author                  |

## 6. Non-negotiable cross-cutting rules

- **User agency:** Quick Save remains fast, but sensitive upload, motion recording, external sharing, new Design Version, asset extraction and risky operations require the appropriate explicit user action.
- **No fabricated evidence:** Never invent screenshots, themes, responsive states, authorship, metrics, progress percentages or AI-confirmed Facets.
- **Preserve history:** Do not silently overwrite historical Design Versions or protected Originals; keep valid partial captures and reconcile uncertain server outcomes.
- **Privacy by default:** No session/cookie/credential transfer to Server; redact sensitive screenshot pixels before upload; protect video/keyframes/metadata as well.
- **Respect site/browser constraints:** SSRF protections, bot challenges, authentication barriers, restricted browser pages, tab permissions and MV3 lifecycle limits must be respected.
- **Clear states:** Distinguish local from synced, partial from failed, capture quality from review, and requests from actual artifacts.
- **No hidden automation:** No blanket background scanning, unattended recurring capture, automatic dangerous clicks, or automatic private uploads.
- **Claude Code evidence workflow:** Use PIVOT MCP to retrieve references; store design decisions/briefs in PIVOT, not in target project repository; require explicit mockup approval before implementing design changes.

## 7. Items to validate before any implementation plan

These are **validation questions for the existing system**, not requests to re-run product selection:

- Which approved capabilities already exist, partially exist, or are missing in the current repository?
- Which requirements depend on Chrome APIs or MV3 lifecycle constraints, especially motion recording, current-tab access, persistent queues and optional host permissions?
- Which features need Server changes, data migrations or new storage limits? What can reuse current models and endpoints?
- Which features involve privacy-sensitive capture, redaction or third-party source access and need technical/legal feasibility review?
- What retention limit should Activity Log use? The earlier 30-day number was illustrative.
- Which advanced features should be deferred based on actual complexity and value? The Core/Later/Optional grouping is proposed, not a locked milestone schedule.

## 8. User review / amendments

Edit this file directly before giving it to Claude Code. Suggested lightweight change log:

| Date         | Topic #        | Previous decision                                                    | New decision                                                                                                                                                                                                                       | Reason                                               |
| ------------ | -------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| _YYYY-MM-DD_ | _#_            | _..._                                                                | _..._                                                                                                                                                                                                                              | _..._                                                |
| 2026-10-31   | 13, 19, 30, 34 | AI suggestions, provider unspecified                                 | AI runs through Claude Code over MCP (`suggest_metadata`); the app keeps no model API key                                                                                                                                          | Owner's choice; no LLM integration exists in the app |
| 2026-10-31   | 24, 25, 37     | Confirm before uploading private screenshots; detection is imperfect | Guess private pages (password field or sign-in form, server can't open the URL without cookies, app-like URL paths); flagged popup saves get a review and redaction step, flagged quick saves are held locally as "Needs approval" | Owner's choice                                       |
| 2026-10-31   | 6, 7           | Search external sources directly, subject to feasibility             | For now an External tab only opens each source's search URL (`known-sources.ts`); results are not stored                                                                                                                           | No public search APIs; scraping breaks site terms    |
| 2026-10-31   | 41             | Revocable read-only Share Snapshots, Share Package as fallback       | Share Package (a file) first; a public share link needs its own architecture decision                                                                                                                                              | The API answers localhost only (`proxy.ts`)          |
| 2026-10-31   | 10             | Duplicate = same URL                                                 | The warning lists items with the same URL of any type; quick save still skips only the same URL and type                                                                                                                           | Keeps `/api/clip` compatible                         |
| 2026-10-31   | 1–3            | —                                                                    | The design track is in scope now; CLAUDE.md no longer freezes MCP or the design workflow                                                                                                                                           | Owner's choice                                       |
| 2026-10-31   | A2.7, A8       | `pivot-design` built at once when the user said up front to go ahead | No exception: a concrete direction is always approved before implementation. "Just build it" or "skip mockups" only reduces the mockups to one direction, which still waits for approval                                           | Owner's choice; matches A8                           |
| 2026-10-31   | A8, 1–3        | —                                                                    | MCP write-tool names and schemas, the Design Session and approval schema, mockup rendering, QA automation and "Workflow Config" are written up as a proposal (plan Phase 5a) and approved before any code                          | A8 says these are not decided                        |

**Final reminder:** This document is a product decision specification. It is **not** an implementation plan, migration plan, technical design, or authorization to edit code. Claude Code should wait for the user's next instruction regarding planning or implementation.
