# Hybrid Search (Free-First): plan

Approved by the owner on 2026-11-01. This is the plan of record for Hybrid Search. It replaces the drafts
`pivot-hybrid-search-plan.md` (rev. 1) and `pivot-hybrid-search-plan-v2-free-first.md` (rev. 2 and its amendment 2.1),
which were review copies outside the repository.

Decisions are recorded in [PIVOT_DECISIONS.md](PIVOT_DECISIONS.md) §8. Progress is logged in
[decisions-progress.md](decisions-progress.md). **Status: Phases 0–4 built and verified on 2026-11-02 (see the table in §3).**

## 1. Approved decisions

- **One search, three scopes:** `All`, `Library`, `External`. `All` is the default.
- **Direct Search vs Link-out:**
  - Direct Search shows real results from an integration that is free, authorised and licence-compatible.
  - Every other source is a link-out that opens the source's own search page.
  - The two always look different. A search URL is never presented as a reference.
- **Free-First:** Direct Search uses only providers whose API, MCP, registry or dataset needs no paid plan, no paid API usage and no account upgrade.
  - Paid providers (Mobbin, Refero, Nicely Done, Savee and any other) are link-out only.
  - No paid MCP tools are wired into Claude Code, and there are no paid OAuth connections or paid keys.
  - The policy applies equally to the web app, MCP `search_external` and the `pivot-design` skill.
- **Provider order:**
  1. **Magic UI** (first).
  2. **React Bits**.
  3. **shadcn/ui**.
- **SiteInspire:** Conditional. Link-out only until its licence is verified. **Its screenshots are never hotlinked or displayed until permission is verified.**
- **Licensing correction:** personal or local use does **not** automatically satisfy a provider's non-commercial or other licence terms. Each provider's terms are honoured as written. Attribution and provider-specific licence requirements are kept on every result.
- **21st.dev:**
  - In the web app and PIVOT MCP it is link-out only. PIVOT stores no key for it.
  - In the Claude Code workflow, the owner may install the official 21st MCP with a free key. `pivot-design` may then use its search tools only:
    - never `generate`, which spends paid credits;
    - never code retrieval or install unless the owner asks;
    - cite the component page and mark it "external, not saved".
- **Claude Code web search:** allowed when the user explicitly asks for external inspiration, within the tools and plan limits available to them.
- **Catalog sync:** on first use, then at most once every 24 hours, plus a manual refresh.
- **Saving:** no external reference is ever saved automatically. It is persisted only on an explicit Save.
- **Chrome extension:** unchanged. **Elsewhere** stays link-out only. No Direct Search in the popup.

## 2. Architecture (to build in Phase 1 onwards)

There is no new service and no second search engine.

- **Library:** `searchResources()` (`packages/core/src/search.ts`) is the Library side, unchanged.
- **Provider layer** in `packages/core`:
  - a provider registry built from `KNOWN_SOURCES` plus capability fields (`access`, `auth`, `adapter`, `licenceMode`, `savePolicy`, `attribution`);
  - an `externalSearch()` orchestrator with per-provider timeouts, statuses, sanitising and dedupe against the Library by `urlKey`;
  - an in-memory cache (external results are never written to the database);
  - the link-out builder (`externalSearchLinks`) as the fallback.
- **Adapter kinds:** only **registry / dataset (local index)** in this version.
  - The catalog is synced as above and searched locally with the existing `parseQuery` matcher.
  - **Searching makes no network request.**
- **Routes:**
  - `GET /api/resources?paged=1` (Library, unchanged);
  - new `GET /api/search/external` (Direct results per provider plus link-outs);
  - Save goes through the existing `/api/clip` with provenance.
- **MCP:**
  - `search_references` is unchanged (backward compatible).
  - A new read-only `search_external` tool returns Direct results and link-outs with `verified` flags and per-provider statuses.
- **Cost guard (enforced by tests):**
  - Every direct provider must declare `access: "free"` and `auth: "none"`.
  - PIVOT has no setting, environment variable or UI for provider keys or OAuth.
- **Ranking:**
  - `All` shows grouped results: Library first, then each Direct provider in its own catalog order, then link-outs.
  - There is no cross-provider interleaving.

## 3. Phases

| Phase | Scope                                                                                                                                                                                                | Status                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0     | Decisions and docs (this file, PIVOT_DECISIONS §8, SPEC §4/§6/§13/§18, decisions-plan)                                                                                                               | Done 2026-11-01                                    |
| 0.5   | Isolated proof of concept for Magic UI's registry; no app code                                                                                                                                       | See [decisions-progress.md](decisions-progress.md) |
| 1     | Provider layer, cost guard, `GET /api/search/external`, the web **All / Library / External** switch with link-outs only                                                                              | Done 2026-11-02                                    |
| 2     | Magic UI direct provider (local index), result cards with attribution and licence, Save with provenance, per-provider switch in Settings                                                             | Done 2026-11-02                                    |
| 3     | MCP `search_external`; `pivot-design` changes: library first, gap rule, generic queries only, no paid MCPs, optional 21st MCP rules, explicit-request web search, brief columns Source and Inspected | Done 2026-11-02 (headless skill E2E still to run)  |
| 4     | React Bits (metadata only: MIT + Commons Clause), then shadcn/ui                                                                                                                                     | Done 2026-11-02                                    |
| —     | SiteInspire: only after its licence is verified in writing                                                                                                                                           | Blocked                                            |

**Out of scope**

- Paid providers.
- Paid keys or OAuth.
- Scraping, or bypassing auth, Cloudflare or bot checks.
- Storing provider screenshots or component code.
- Chrome extension changes.
- Cross-provider ranking.
- Background or recurring external searches.

## 4. Acceptance criteria carried into the build phases

- **Phase 1:**
  - Library results are unchanged; the search-eval thresholds hold.
  - A search URL only ever appears as an "opens their site" row.
  - The cost-guard test fails when a direct provider isn't free and keyless.
  - A provider failure is a status row, never a page error.
- **Phase 2:**
  - `marquee`, `border beam` and `animated list` return Magic UI items marked Direct, with the MIT licence and the docs link.
  - Searching makes no network request once the catalog is synced (asserted by a test).
  - Nothing is written until Save; a second Save of the same item is skipped.
  - An unreachable catalog keeps the last good copy, or shows a status row and the link-out.
  - No component code is stored or shown.
- **Phase 3:**
  - `search_references` behaviour is unchanged.
  - `search_external` never lists a paid provider except as a link-out.
  - A `pivot-design` E2E on a thin library cites Magic UI items by name and docs URL, marks what it didn't open as "metadata only", saves nothing, and leaves the target repository clean.

## 5. Licensing and usage rules

| Provider                          | Allowed                                                                                                                         | Not allowed                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Magic UI (MIT)                    | Sync the public registry; show title, description, licence and docs link; Save a reference to the docs page (PIVOT captures it) | Store or serve component code; include items that aren't in the free registry      |
| React Bits (MIT + Commons Clause) | Title, description and link                                                                                                     | Store, serve, sell or redistribute the components                                  |
| shadcn/ui (MIT)                   | Names and docs links                                                                                                            | Store component code                                                               |
| SiteInspire                       | Link-out                                                                                                                        | Hotlinking or displaying screenshots; direct results until the licence is verified |
| Paid and other link-out sources   | Opening their search page                                                                                                       | Calling their API or MCP; scraping; storing their content                          |

## 6. Proof-of-concept findings (Phase 0.5, 2026-11-01)

An isolated Node script outside the repository read `parseQuery` from `packages/core/src/query.ts` (unchanged), synced
`https://magicui.design/r/registry.json` and searched it locally. No app code, schema or dependency changed.

- **Registry:**
  - HTTP 200, about 110 KB, synced in 0.3–0.5 s.
  - 250 items: 78 `registry:ui`, 170 `registry:example`, 1 `registry:style`, 1 `registry:lib`.
  - Fields used: `name`, `title`, `description`, `type`.
  - `registry.json` carries **no code**: every item's `files` list is empty (asserted).
  - The per-item endpoint (`/r/<name>.json`) **does** contain source code, so PIVOT must never fetch it.
- **What to index:** only `registry:ui` (78 components). Examples (`<name>-demo…`) aren't standalone docs pages.
- **Titles:**
  - Two components have no title (`smooth-cursor`, `interactive-hover-button`); the slug, title-cased, is used.
  - Descriptions are clamped to 280 characters and stripped of HTML.
- **Docs URLs:**
  - `https://magicui.design/docs/components/<name>` answered 200 for 77 of 78.
  - `client-tweet-card` is documented on `tweet-card`'s page; with that one override, 78 of 78 answered 200.
  - Phase 2 must re-check URLs for new slugs at sync time (not per search) and keep a small override map.
- **Search** (PIVOT's parser, network disabled during queries, 0 network calls):

  | Query            | Result                                         |
  | ---------------- | ---------------------------------------------- |
  | `marquee`        | Marquee                                        |
  | `border beam`    | Border Beam                                    |
  | `animated list`  | Animated List                                  |
  | `number ticker`  | Number Ticker                                  |
  | `globe`          | Globe                                          |
  | `text animation` | Animated Gradient Text, Animated Shiny Text, … |
  | `button`         | five button components                         |
  | `zzzz qqq`       | nothing                                        |

- **Malformed data:**
  - Refused:
    - missing or non-array `items`;
    - only unsafe slugs (`../etc/passwd`, spaces);
    - only examples;
    - any item that carries code.
  - HTML in a title or description is stripped and the text kept.
- **Unavailable endpoint:**
  - HTTP 500, an HTML "Just a moment…" page and 404 all fell back to the last good catalog (status `stale`, 78 kept).
  - A hanging server timed out at 1.5 s.
  - A DNS failure gave `ENOTFOUND`.
  - With no cached catalog, the status was `unavailable`, not a crash.
- **Licence:** MIT (`magicuidesign/magicui` LICENSE.md). PIVOT shows metadata and links only, labelled "Magic UI · MIT", and stores no code.
  - Whether the free registry ever lists paid (Pro) items is **unverified**. Phase 2 should check before release.
- **Privacy:**
  - Queries never leave the machine.
  - The only outbound request is the catalog sync (at most once per 24 h, or on manual refresh), which sends no user data.
  - Saving a result captures the public docs page, as any saved URL does.

## 7. Build notes (Phases 1–4, 2026-11-02)

- **Core:** `packages/core/src/external-search.ts`.
  - Providers: Magic UI, React Bits and shadcn/ui, each declared `access: "free"` and `auth: "none"`.
  - Catalog sync uses `safeFetch` on fixed URLs: on first use, after 24 h, or on refresh (at most once a minute). The last good copy is kept in the blob store at `catalogs/<id>.json`.
  - Search is local, with `parseQuery` and the new `toJsRegex`.
  - Results that are already in the library are marked.
  - Link-outs come from `externalSearchLinks`.
  - Settings: `getSearchSettings` and `setProviderEnabled` (`app_settings` key `search`).
- **API:**
  - `GET /api/search/external`;
  - `GET|PATCH /api/search/providers`;
  - `POST /api/search/providers/refresh`;
  - `/api/clip` takes `origin`, stored as `meta.externalOrigin`;
  - the `search.external` capability.
- **Web:**
  - `ScopeSwitch` and `ExternalResults` (`components/external-search.tsx`);
  - the library view (`?scope=`; the type shelf is hidden while searching);
  - ⌘K: scope switch and direct groups;
  - Settings › Search;
  - "Found via" on the detail page.
- **MCP:** `search_external` (`packages/mcp-tools/src/external-tools.ts`), `PivotSource.externalSearch`, `HttpSource`, and `openWorldHint` in `apps/mcp/src/server.ts`.
- **Skill:** `pivot-design` steps 2, 3 and 5, and its rules.
- **Live catalogs on 2026-11-02:**

  | Provider   | Components | Pages confirmed                                    |
  | ---------- | ---------- | -------------------------------------------------- |
  | Magic UI   | 78         | 78                                                 |
  | React Bits | 218        | 217 (`EvilEye` links to the catalog)               |
  | shadcn/ui  | 65         | 64 (`form` uses the docs URL pattern, unconfirmed) |
