# PIVOT — Search & MCP implementation plan (adapted to the repository)

> Status: **Audit only — nothing implemented.** Waiting for the owner's review. First written 2026-10-31 before reference-first Phases 4–5 were merged; **revised the same day after they were**, with the real library re-measured (§1) and real queries tried (§3).
> Source brief: `PIVOT_SEARCH_MCP_IMPLEMENTATION_PLAN.md` (owner, 2026-10-30). This document replaces its generic parts with what the code actually does, so the brief's phases 06–11 are mapped onto PIVOT as it is today.
> Audited: `docs/SPEC.md`, `DESIGN.md`, `CLAUDE.md`, `docs/reference-first-plan.md`, `docs/reference-first-progress.md`, `packages/core/src/{resources,db/schema,db/client,context,assets,storage,net-guard,capture,favicons,types}.ts`, `apps/web/src/app/api/**`, `apps/web/src/proxy.ts`, `apps/web/src/lib/api.ts`, `apps/extension/src/**`, the core test suite, and the live library at `127.0.0.1:4321` (read-only `GET`s).

## 0. Verdict in one screen

- **Keyword search (brief phase 07) already exists** and covers most of what the brief asks for. It searches every word across the title, description, notes, content, URL and tag names, combines with type/section, tag (AND), source and collection filters, and sorts by relevance tier, edited, newest, oldest or title. Search empty states, no-match states and clearing filters were added in Phase 3. What it lacks for an agent is **pagination, a total, a stable tiebreaker, filters by tag _name_, and one function both the API and MCP can call.** That is a small refactor, not a new search engine.
- **Real queries show where keyword search actually falls short**, and none of it needs embeddings:
  - **Substring matches inside words:** "sign in" also returns three pages whose text has "design" and "in".
  - **Stop words count as terms**, so "in" matches nearly everything.
  - **Synonyms miss:** "login" finds GitHub's sign-in page through its URL but misses Supabase's, which is tagged Auth.

  Fixes: word-start matching, stop words, and a small synonym map for the facet vocabulary.

- **Semantic search (08) still does not pass its own gate.** The library now holds 25 references (21 with facets) plus 45 sources and 56 skills. That is enough for a first 30-query evaluation set, but the misses above are all lexical. Defer embeddings until the evaluation set shows misses that the fixes above can't cover.
- **MCP (09) and the skill (10) are entirely missing.** No MCP SDK is installed; the SPEC still lists "MCP server" under _Ngoài phạm vi_; `reference-first-plan.md` freezes it.
- **The brief's premise now holds.** Reference-first Phases 0–5 are all merged (PRs up to #30), including the stitched full-page capture. The MCP's `get_reference_images` depends on that capture.
- **Recommended smallest build:**
  1. a `searchResources()` service in `packages/core`, with the lexical fixes above;
  2. `GET /api/resources` gains `limit`, `cursor` and tag-name filters (backwards compatible);
  3. a **stdio MCP server in `apps/mcp`** that calls the running app's HTTP API with the existing API token;
  4. four read-only tools (`search_references`, `get_reference`, `list_facets`, `get_reference_images`);
  5. a skill for the brief → mockups → code flow.

  No migration, no new service. **Estimate: about 7–9 working days from here** (the prerequisites are done), against the brief's 16–28, because 07 is mostly done and 08 is deferred.

## 1. Current architecture

| Concern              | What the repository has                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / framework | TypeScript. pnpm monorepo: `apps/web` (Next.js 16, App Router, Cache Components, TanStack Query, Tailwind v4), `apps/extension` (Chrome MV3, Vite), `packages/core` (library logic, imported as `@pivot/core/*`).                                                                                                                                                                                                                                                                                                                                                             |
| Database             | PostgreSQL through Drizzle. **Neon** when `DATABASE_URL` is set (the owner's setup); otherwise **PGlite** in the data folder, which takes a single-process lock (`db/client.ts` `acquireLocalLock`). Three migrations. Indexes: `resources(type)`, `(deleted_at)`, `(source_url)`, `tags(kind, lower(name))` unique, `resource_tags(tag_id)`. No full-text or trigram index.                                                                                                                                                                                                  |
| Data model           | `resources` is one table for all 13 types (`type`, `title`, `description`, `source_url`, `notes`, `content`, `meta` jsonb, `cover_asset_id`, `capture_status`, `deleted_at`, timestamps). `tags(kind, name)`, where kind is `tag`, `pageType`, `domain`, `visualStyle`, `uiPattern` or `technology` (facets are typed tags). `resource_tags`, `collections` + `collection_items`, `assets` + `resource_assets` (roles `screenshot`, `screenshot-full`, `attachment`), and `skill_packs`. Sources are `resources` of type `source`, with `meta.category` and `meta.searchUrl`. |
| Search               | `listResources()` in `packages/core/src/resources.ts`. Every word (up to 8) must `ILIKE` one of title, description, notes, content, source URL or a tag name. Ordering is a relevance tier (title match 0, description match 1, else 2), then the chosen sort. Hard `limit` 1000. No offset, cursor or total. The UI loads the whole list. SPEC §1 #3 chose `ILIKE` deliberately ("a few hundred resources").                                                                                                                                                                 |
| Filters              | `type` / `types` (navbar section), `tagIds` (AND), `via` (source attribution, recomputed by host on each call), `collectionId`, `trash`, `sort` (`updated`, `created`, `oldest`, `title`). Tag pills, counts and the "+N more" list are computed client-side from the listed items.                                                                                                                                                                                                                                                                                           |
| API                  | Thin route handlers wrapped in `route()`. Relevant here: `GET /api/resources`, `GET /api/resources/[id]` (detail with assets and collections), `GET /api/tags`, `GET /api/collections`, `GET /api/counts`, `GET /api/sources/stats`, `GET /api/assets/[id]?thumb=1&preview=1`, `POST /api/context` (markdown for Claude with **absolute local file paths**), `POST /api/clip`, `POST /api/from-url`, `GET /api/favicon`.                                                                                                                                                      |
| Access control       | **Single user, local only. No accounts or workspaces.** `proxy.ts` rejects any `Host` other than localhost (DNS rebinding). Writes need the same origin or `Authorization: Bearer <token>` (`~/.pivot/api-token`, also used by the extension). `GET`s are open to localhost. The server binds `127.0.0.1`.                                                                                                                                                                                                                                                                    |
| Assets               | The blob store (`storage.ts`): R2 when the `R2_*` keys are set (the owner's setup), otherwise the data folder. Served only through `/api/assets/[id]` with a sandbox CSP and `nosniff`. Thumbnails (webp) and scroll previews (720px wide) are generated. Full-page shots are up to 1440×12000.                                                                                                                                                                                                                                                                               |
| AI-facing code today | `context.ts`: `buildClipboardContext()` and `exportBundle()` turn resources into markdown with images and **token estimates** (`tokens.ts`, `CLAUDE_MAX_IMAGE_EDGE = 1568`). This is the closest existing piece to an MCP "get_reference".                                                                                                                                                                                                                                                                                                                                    |
| Validation           | Zod 4 everywhere (`resourceInput`, route schemas).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tests                | Vitest in `packages/core` only: PGlite in a temp dir, s3rver for R2, Playwright for capture, `fileParallelism: false`. 10 files, 53 tests. No tests for web routes or the extension. CI is not configured; lefthook runs typecheck, lint and tests on pre-push.                                                                                                                                                                                                                                                                                                               |
| Hosting              | The owner's machine only (`npm start` → `127.0.0.1:4321`). No remote deployment in scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Live data (2026-10-31, after Phase 5, read-only)

| Measure                           | Value                                                                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resources                         | 126 live: **25 references**, 45 sources, 56 skills. 11 in trash.                                                                                                                                                                                          |
| Reference metadata                | 21 of 25 tagged with facets; 22 have descriptions; all 25 have a full-page shot (re-captured with the stitched method). Values in use: pageType 6, domain 6, visualStyle 6, uiPattern 9. Most used: Minimal 10, Developer tool 9, Dark 9, Landing page 8. |
| Collections                       | 3: Pricing pages 5, Docs & changelogs 5, Developer tool landings 4.                                                                                                                                                                                       |
| Search latency (Neon, end to end) | 0.15–0.23 s across 5 queries (`pricing`, `dark pricing`, `docs sidebar`, `sign in`, `linear`). One run, not a benchmark.                                                                                                                                  |

**Consequence:** the corpus is small but real and labelled, so an evaluation set can be written now (§6 Step 1). Sources (45, all described, none tagged) and skills (56) are also searchable and should be in the set, because the skill will look for sources as well as references.

## 2. Brief phases mapped onto PIVOT

| Brief phase                    | State in PIVOT                                                                                 | What remains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 06 Search foundation & audit   | **Partial.** This document is the inventory.                                                   | The 30-query evaluation set (data now exists, see §1), a baseline latency on realistic data, and owner sign-off on the contracts in §4–5.                                                                                                                                                                                                                                                                                                                                                               |
| 07 Keyword search & filtering  | **Mostly done** (Phases 2–3).                                                                  | Pagination with a total. A deterministic tiebreaker (`id`). Filters by facet/tag name, since an agent knows "Dashboard", not a tag UUID. A relevance tier for tag matches (title > tag > description > the rest). One shared `searchResources()`. **Not needed:** a full-text index or a separate engine at this scale (SPEC #3); index synchronization, because there is no separate index (search reads the table, so create, update and delete are immediate); ACL scoping, since there is one user. |
| 08 Semantic & hybrid           | **Deferred: the gate is not met.**                                                             | Revisit when the evaluation set shows keyword failures. pgvector exists on Neon and as a PGlite extension, so no new service would be needed if it comes to that.                                                                                                                                                                                                                                                                                                                                       |
| 09 MCP server                  | **Missing.**                                                                                   | Everything in §5. The SPEC and the reference-first plan both need updating first.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 10 AI reference workflow/skill | **Missing.**                                                                                   | A skill for the owner's chosen flow: search and evaluate → brief → 2–3 mockups → code.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 11 Hardening                   | **Partly in place** (SSRF guard, localhost proxy, token, capture redirect guard from Phase 4). | MCP-specific limits, logging without private data, setup and troubleshooting docs, and a latency measurement.                                                                                                                                                                                                                                                                                                                                                                                           |

The brief says "categories". In PIVOT the same idea is spread over five things:

- **types**, grouped into **sections**;
- **facets**, which are typed tags;
- plain **tags**;
- **source categories** (`SOURCE_CATEGORIES`);
- **collections**.

The contracts below name these explicitly instead of inventing a `category` field.

## 3. Search / index strategy and rationale

- **Keep `ILIKE` on PostgreSQL.** With about 100 rows, a full scan is well under the network round trip to Neon. A `tsvector` and GIN index (or `pg_trgm`) only earns its place past a few thousand rows, or when the evaluation set shows stemming or typo failures. Write that threshold into SPEC #3 so the decision is recorded.
- **Extract `searchResources(request)` in `packages/core/src/search.ts`.** It wraps the existing `where` logic of `listResources` and adds `offset`/`limit`, a `count(*)` total, tag-name resolution and the tag tier. `listResources` keeps its signature (the UI and tests use it) and calls the shared builder, so there is exactly one query path. Brief rule 6: business logic stays out of the adapter.
- **Ranking**, when there is a query and `sort=relevance`:
  1. tier 0: title contains the whole query;
  2. tier 1: title contains every word;
  3. tier 2: a tag name matches a word;
  4. tier 3: description matches;
  5. tier 4: the rest (notes, content, URL).

  Ties go to `updated_at desc, id`. The tiers are not exposed as a numeric `score`: they are ordinal and can't be compared with any later semantic score (brief §6). The response sets `ranked: "relevance"` instead.

- **Fix the lexical misses found on real data before anything else** (all in `buildResourceWhere`, no migration):

  | Query       | Today                                                                     | Cause                                                                 | Fix                                                                                                                                           |
  | ----------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
  | `sign in`   | 5 hits: both sign-in pages, plus NobleFinance, Rauno and the Cricket shot | "sign" matches inside "design"; "in" matches inside nearly every word | Match words at a word start (Postgres `~*` with `\m`, escaped), and drop a short stop-word list (`a an the in on of for to and with`)         |
  | `login`     | GitHub only, through its URL                                              | No link between login, sign in and Auth                               | A small synonym map over the facet vocabulary (login ↔ sign in ↔ auth, docs ↔ documentation, pricing ↔ plans), expanded with OR inside a word |
  | `dashboard` | NobleFinance, R2 and Supabase sign-in (its URL has `/dashboard/`)         | URL matches rank like content                                         | Already handled by the tier order below (URL is the last tier)                                                                                |

  `dark pricing`, `docs sidebar`, `pricing table` and `landing dark` already return exactly the right pages, because the facet names are searchable. Keep that behaviour.

- **Pagination:** an opaque `cursor` that base64-encodes `{offset, filtersHash}`. Offset is fine at this size. The hash makes a cursor reused with different filters fail clearly with `invalid_cursor`.

## 4. Search API contract (backwards compatible)

`GET /api/resources` keeps every current parameter and gains:

| Param     | Meaning                                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`   | Already accepted, but unvalidated. Becomes an integer from 1 to 200 (default: unchanged at 1000 for the UI unless `paged=1`).                                                                                           |
| `paged=1` | Opt-in: the response becomes `{ results, total, nextCursor }` instead of a bare array, so the UI is untouched.                                                                                                          |
| `cursor`  | From `nextCursor`.                                                                                                                                                                                                      |
| `facet`   | Repeatable `kind:name` pairs (`facet=pageType:Dashboard&facet=domain:SaaS`), matched case-insensitively. AND semantics, like `tags`. An unknown facet gives an empty result plus `unknownFacets` in the paged response. |
| `sort`    | Adds `relevance`, the default when `q` is set and the `paged=1` caller didn't choose a sort.                                                                                                                            |

Paged response item (compact, for agents; the UI keeps the full `ResourceDTO`):

```ts
interface SearchHit {
  id: string;
  type: ResourceType; // "reference", "source", …
  title: string;
  host: string | null; // "attio.com", never the full tracking URL
  sourceUrl: string | null; // http(s) only (openableUrl rules), query string kept
  description: string; // truncated to 280 chars
  facets: { kind: TagKind; name: string }[]; // facets first, then plain tags, max 8
  collections?: never; // not in search hits; get_reference has them
  hasScreenshot: boolean;
  createdAt: string;
  updatedAt: string;
}
interface SearchPage {
  results: SearchHit[];
  total: number;
  nextCursor: string | null;
  ranked: "relevance" | "updated" | "created" | "oldest" | "title";
  unknownFacets?: string[];
}
```

**Permissions:** identical to today, because a single user is the only identity. The route is localhost-only (`proxy.ts`). The trash is never searched unless `trash=1`. No storage keys, file paths, R2 URLs or capture errors appear in hits.

## 5. MCP design

### 5.1 Transport and process (decided 2026-10-31)

| Option                                                                              | Pros                                                                                                                                                                                                                                                                               | Cons                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. stdio server in `apps/mcp`, calling the running app's HTTP API** (recommended) | The brief's default (local stdio). Same pattern as 21st.dev Magic and the shadcn registry MCP. Reuses route validation, the proxy, the API token, the R2/local asset serving and the capture queue. No second database connection, so no PGlite lock conflict. Adapter stays thin. | Needs the app running. If it isn't, it returns a clear `app_unreachable` error with "start it with `npm start`".                                                                                       |
| B. Streamable HTTP endpoint inside Next.js (`/api/mcp`)                             | No extra process; one URL in `claude mcp add --transport http`.                                                                                                                                                                                                                    | Next 16 route handlers need the SDK's web-standard transport (verify the version). Session handling inside a server that can restart under HMR. The brief says to avoid remote transport until needed. |
| C. stdio server importing `packages/core` directly                                  | Works with the app stopped (on Neon).                                                                                                                                                                                                                                              | Breaks in PGlite mode (single-process lock). Duplicates the capture queue and blob-store setup. Bypasses the proxy, so the token model has to be re-implemented.                                       |

**Decision (owner, 2026-10-31): A for the owner now, built so a remote transport can be added later without rewriting the tools.** The owner may later let other people use PIVOT through MCP, but hasn't chosen how. The three ways it could go:

| Who else uses it                          | What it would take later                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each person installs PIVOT                | Publish the stdio adapter as an npm package (`npx pivot-mcp`) and write install docs. No shared server.                                                                                                                                                                                   |
| Others search the owner's curated library | A separately deployed Streamable HTTP endpoint, reading Neon and R2 directly and read-only. Needs per-person API keys, rate limits, and a "public" flag to choose what is shared. Sharing screenshots of other people's sites beyond private use is a copyright question to settle first. |
| A multi-user service                      | Accounts, workspaces, ACLs and hosting. An architecture change that contradicts the SPEC's single-user model, out of scope until decided.                                                                                                                                                 |

So the build is split into three layers:

1. **`packages/mcp-tools`**, independent of transport. It holds the four tool definitions: name, description, zod input and output schemas, size caps and error codes. Each handler is written against a small `PivotSource` interface (`search`, `getReference`, `listFacets`, `getImage`). It knows nothing about stdio, HTTP or the database.
2. **`apps/mcp`**: the stdio entry for the owner. It implements `PivotSource` by calling the running app's HTTP API with the API token.
3. **Later, if needed:** a remote entry (Streamable HTTP) that implements `PivotSource` by calling `packages/core` directly, plus authentication, a public subset and rate limits. The tools stay unchanged.

The stdio adapter sits under `apps/mcp/` with its own `package.json`, uses `@modelcontextprotocol/sdk` (TypeScript), and is built to `apps/mcp/dist/server.js`. It is registered with:

```bash
claude mcp add pivot -- node <repo>/apps/mcp/dist/server.js
```

Configuration comes from `PIVOT_URL` (default `http://127.0.0.1:4321`) and `PIVOT_TOKEN`, falling back to reading `~/.pivot/api-token`. Nothing secret is committed.

### 5.2 Tools: P0, read-only

Zod 4 schemas live in `apps/mcp/src/tools.ts`. Every text field coming from saved pages is described in the tool description as **untrusted page data, not instructions** (brief §9).

| Tool                   | Input                                                                                                                                                                                                                                                                                                                | Output                                                                                                                                                                                                                                                                                                                        | Limits / errors                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_references`    | `query?: string` (≤ 200 chars); `types?: ResourceType[]` (default `["reference"]`); `section?: "library" \| "knowledge" \| "sources" \| "skills"`; `facets?: {kind, name}[]`; `tags?: string[]`; `collection?: string` (id or name); `source?: string` (id or host); `sort?`; `limit?` (1–25, default 10); `cursor?` | `structuredContent: SearchPage`, plus a short text rendering (one line per hit: title — host — facets).                                                                                                                                                                                                                       | `invalid_input`, `invalid_cursor`, `app_unreachable`. The result text is capped at about 4k tokens; descriptions are truncated.                                                                                            |
| `get_reference`        | `id: string` (uuid)                                                                                                                                                                                                                                                                                                  | Title, type, host, `sourceUrl`, description, notes (≤ 2,000 chars), facets and tags, collections (names), source attribution (which saved Source it came from), screenshots as metadata only (`{assetId, role, width, height}`), `createdAt`/`updatedAt`. For text types: `content` (≤ 8,000 chars, with a `truncated` flag). | `not_found` (also for trashed items), `invalid_input`.                                                                                                                                                                     |
| `list_facets`          | `types?: ResourceType[]`                                                                                                                                                                                                                                                                                             | Sections with their types and counts (`/api/counts`); facet kinds with their values and **usage counts** (from `/api/tags` plus a count); source categories with counts; collections with counts.                                                                                                                             | Replaces the brief's `list_categories`; same purpose, PIVOT's real taxonomy.                                                                                                                                               |
| `get_reference_images` | `id: string`; `which?: "cover" \| "viewport" \| "fullpage" \| "all"` (default `cover`); `maxImages?` (1–4)                                                                                                                                                                                                           | MCP `image` content blocks. Images are fetched from `/api/assets/[id]?thumb=1` or `?preview=1`, then scaled to fit `CLAUDE_MAX_IMAGE_EDGE` and re-encoded as JPEG or PNG. A full page is cut into at most 3 slices of 1440×≤1568. A text block lists each image's size and estimated tokens.                                  | Moved up from the brief's P1 to P0. The owner's goal is for Claude to **look at** references and judge them, and without images the agent only sees titles. Hard cap of about 6k image tokens per call. `no_images` error. |

### 5.3 Later (owner already chose these, 2026-10-30)

| Tool                                                           | When                                   | Notes                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `save_reference(url, type?, facets?, notes?, collection?)`     | P2, after P0 is used for a week        | Uses `POST /api/from-url` with the token and `skipDuplicates`. Idempotent by URL key. Returns `existing: true` instead of creating a duplicate. Capture runs in the app's queue.                                              |
| `annotate_reference(id, notes?, addFacets?, addToCollection?)` | P2                                     | Uses `PATCH /api/resources/[id]` and the collection routes. **Appends** notes (never overwrites what the owner wrote), behind an `"agent:"` prefix.                                                                           |
| `search_sources_on_web(query, sources?)`                       | P2/P3                                  | Expands the saved Sources' `searchUrl` templates and returns links. Fetching or screenshotting results goes through `from-url`, never a raw fetch from the MCP. Respect the "don't bypass bot walls" rule already in SPEC #7. |
| `find_similar_references`                                      | Only after brief phase 08 is justified | —                                                                                                                                                                                                                             |

### 5.4 Skill (brief phase 10)

The skill is `pivot-design`, a markdown skill. Its flow, decided by the owner:

1. **Search:** call `search_references` and `list_facets`, starting from facets that match the task (page type, pattern, style).
2. **Inspect:** call `get_reference_images` on the 3–6 best hits.
3. **Brief:** write the chosen references, with **attribution** (title, host, URL), what to take from each (layout, hierarchy, motion, palette), and what not to copy (brand assets, protected illustrations, verbatim copy).
4. **Mockups:** 2–3 directions as mockups for the owner to pick, in the target project's design system (read its DESIGN.md or tokens first).
5. **Code:** implement the chosen direction only after the pick.

The skill never invents references, assets or metadata that the tools didn't return.

**Location (owner, 2026-10-31): both.** The source of truth is `.claude/skills/pivot-design/SKILL.md` in the repo, versioned with the MCP. It is synced to `~/.claude/skills/pivot-design` so it works in every project. The sync can use PIVOT's existing skill sync, or a `pnpm skill:install` script.

## 6. Implementation checklist (file by file)

Estimates are working days and assume Phase 5's real references exist.

### Step 0 — Prerequisites (owner + 0.5 d)

- [x] Commit, PR and merge Phase 4; live ⌥⇧D check in Chrome (#27, owner's check).
- [x] Phase 5: 20+ real references with facets, 3 collections (#28). **This is the evaluation corpus.** Full pages re-captured with the stitched method (#29, #30).
- [x] Owner decisions: stdio now, with the tools in a transport-independent package (§5.1); the skill lives in the repo and is synced to `~/.claude/skills` (§5.4); P0 read-only first.
- [x] `docs/SPEC.md`: remove "MCP server" from _Ngoài phạm vi_. Add a §1 decision row (MCP: stdio adapter over the local API, read-only P0) and a new section for search pagination and the MCP tools. `docs/reference-first-plan.md`: note the MCP initiative follows Phase 5.

### Step 1 — Shared search service (brief 06–07) (2–3 d) — done in #32

As built: the query reading lives in `packages/core/src/query.ts`. The evaluation set matches results by title (`search-corpus.json` copies the real library's metadata), not by ids, so it runs in CI. Recall@5 / P@5 / MRR went from 0.773 / 0.702 / 0.848 to 0.956 / 0.826 / 0.977, and the test has a floor of 0.95 / 0.82 / 0.97.

- [x] `packages/core/src/search.ts` (new): `searchResources(req: SearchRequest): Promise<SearchPage>`, `encodeCursor`/`decodeCursor`, and `toSearchHit(dto)`, which strips the URL to http(s) using the same rules as `apps/web/src/lib/url.ts`.
- [x] `packages/core/src/resources.ts`:
  - move the `where` construction into `buildResourceWhere(filters)`, used by both `listResources` and `searchResources`;
  - add the `id` tiebreaker to every sort;
  - add the tag tier to `relevance`;
  - add `facetNames` resolution (`kind` + `lower(name)` uses the existing `tags_kind_name_idx`).
- [x] `packages/core/src/types.ts`: `SearchRequest`, `SearchHit`, `SearchPage` (shared by the API, the MCP and tests).
- [x] `apps/web/src/app/api/resources/route.ts`: parse `paged`, `cursor`, `facet` and `sort=relevance` with a zod schema (today parsing is ad hoc); validate `limit`.
- [x] `apps/web/src/lib/api.ts`: no change (the UI keeps the array form).
- [x] Tests, in `packages/core/test/search.test.ts` (new):
  - pages concatenate to the full list with no duplicates;
  - a cursor reused with other filters fails;
  - facet names are matched case-insensitively;
  - an unknown facet is reported;
  - the tag tier ranks above a description match;
  - trash is excluded;
  - `listResources` output is unchanged.
- [x] Word-start matching, stop words and the synonym map (§3), with tests built from the real misses (`sign in`, `login`).
- [x] `packages/core/test/fixtures/search-eval.json` (new; the corpus exists now): at least 30 `{ query, facets?, expectedIds[] }` cases from the owner's real library. The test prints Recall@5 and MRR, and fails if they drop below a baseline recorded in the file.
- [x] `docs/SPEC.md` §8: pagination, `facet`, the relevance tiers, and the threshold for moving to full text.

### Step 2 — MCP adapter (brief 09) (2–3 d)

As built: the tools, image slicing and `PivotSource` live in `packages/mcp-tools` (`tools.ts`, `images.ts`, `source.ts`, tests in `test/`). `apps/mcp` only holds `server.ts` (stdio) and `http-source.ts`. The full page is sent in 960px-wide slices of up to 1568px (about 2,000 tokens each), at most 4 images per call, paged with `fromSlice`. The SDK is pinned to 1.32.1 (zod 4 support). Checked end to end with the SDK's stdio client against the real library: listing, every search option, paging, errors and images. Registering it in Claude Code is the owner's call, because it changes their Claude Code configuration.

- [x] `packages/mcp-tools/` (new): the four tool definitions and handlers against a `PivotSource` interface (§5.1), with no stdio, HTTP or database code.
- [x] `apps/mcp/package.json`, `tsconfig.json`, `src/server.ts` (new):
  - depends on `@modelcontextprotocol/sdk` (pin an exact version and check that it supports **zod 4**, which the repo uses) and `@pivot/core` (types only);
  - `pnpm --filter mcp build` uses `tsc` or `tsup`.
- [x] `apps/mcp/src/client.ts`: a fetch wrapper for `PIVOT_URL`. It sends `Authorization: Bearer` for writes (later), maps `ECONNREFUSED` to `app_unreachable` and 404 to `not_found`, and applies a 10s timeout.
- [x] `apps/mcp/src/tools.ts`: the four P0 tools from §5.2, with input and output schemas, size caps, structured errors (`isError` plus `{code, message}`) and the "untrusted page data" note in each description.
- [x] `apps/mcp/src/images.ts`: fetch the thumbnail or preview, then use sharp to fit 1568px and slice full pages. sharp is already a core dependency.
- [x] Root `package.json`: `mcp:build` script. `pnpm-workspace.yaml` already globs `apps/*`; confirm.
- [x] `apps/web`: probably no change. Optionally add a `GET /api/resources/[id]?compact=1` if `get_reference` would otherwise pull the full detail DTO. Decide during the build.
- [x] Tests, in `apps/mcp/test/tools.test.ts` (new, vitest):
  - use the SDK's in-memory transport against a stubbed `fetch`;
  - check schemas reject bad input;
  - check errors are structured;
  - check output stays under the caps;
  - check `search_references` forwards filters exactly like the web UI's URL.

  Plus one scripted end-to-end run against a scratch app (`DATABASE_URL= PIVOT_DATA_DIR=<tmp>`).

- [ ] Manual check: `claude mcp add pivot …`, then `/mcp` in Claude Code lists 4 tools. Ask "find dashboard references" and confirm it calls `search_references` then `get_reference_images`.
- [x] `apps/mcp/README.md`: setup, the token, troubleshooting (app not running, token rotated), and rollback (`claude mcp remove pivot`).

### Step 3 — Skill (brief 10) (1–2 d)

As built: `.claude/skills/pivot-design/SKILL.md`, linked into `~/.claude/skills` by `pnpm skill:install`. Results are in [search-mcp-progress.md](search-mcp-progress.md).

- [x] `pivot-design/SKILL.md` (location per the owner's decision), with the flow in §5.4, the brief template, the attribution rules and the mockup-before-code rule.
- [x] Try it on 5 realistic prompts: dashboard, onboarding, navigation, form, pricing. Record what it picked and why in `docs/reference-first-progress.md` (or a new `docs/search-mcp-progress.md`).

### Step 4 — Hardening (brief 11) (1–2 d)

- [ ] Latency: p50/p95 of `searchResources` on the real library (Neon) and on PGlite, recorded in the progress log.
- [ ] MCP logs to stderr only (stdout is the protocol), without query text or page data by default; `PIVOT_MCP_DEBUG=1` adds them.
- [ ] Rate limiting: not needed for a local single-user stdio tool. Document why.
- [ ] Security review:
  - no file paths or storage keys in any tool output;
  - `sourceUrl` goes through the http(s)-only filter;
  - images come only through `/api/assets`;
  - trash is excluded.
- [ ] Release checklist: brief §10's definition of done, with the access-control lines rewritten for the single-user model.

### Step 5 — Write tools (P2), only after P0 has been used (2 d)

- [ ] `save_reference` and `annotate_reference` as in §5.3, with tests for idempotency and append-only notes.
- [ ] SPEC update for MCP writes.

## 7. Test strategy and acceptance

| Layer        | How                                                                                   | Acceptance                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Search logic | Vitest on PGlite (existing harness).                                                  | Pagination is complete and stable; facet and tag filters, ranking tiers and trash exclusion behave as specified; `listResources` is unchanged. |
| Relevance    | The `search-eval.json` evaluation set.                                                | Recall@5 and MRR are recorded; a regression fails the test. Phase 08 only if keyword search misses documented cases.                           |
| API          | Route-level tests (new: call the handler with a `Request`).                           | Old callers get the same array; `paged=1` gets the page shape; bad params give 400 JSON.                                                       |
| MCP          | SDK in-memory transport plus stubbed fetch; one end-to-end run against a scratch app. | 4 tools discoverable; invalid input gives structured errors; outputs within caps; results match the UI for the same filters.                   |
| Agent        | 5 realistic prompts through the skill.                                                | Each answer names its references with links, gives a reason for each, and invents nothing.                                                     |
| Performance  | p50/p95 timing script.                                                                | Search p95 < 500 ms on Neon for the real library; MCP search tool < 1 s.                                                                       |

## 8. Risks and open questions

1. **Small corpus.** 25 references is enough to catch regressions, not to tune weights finely. Keep ranking rules simple (tiers, not weights) until the library is a few times larger.
2. **Who else will use the MCP is undecided** (§5.1). The transport-independent tool package keeps every option open. The remote path brings real work (auth, a public subset, hosting, copyright) and should start only once the owner picks it.
3. **Scope and SPEC conflict.** "MCP server" is listed as out of scope in SPEC §10 and frozen in the reference-first plan. CLAUDE.md requires asking before work that conflicts with the SPEC: this document is that ask.
4. **SDK and zod 4.** Confirm that the MCP TypeScript SDK version chosen accepts zod 4 schemas. Otherwise pin zod 3 inside `apps/mcp` only.
5. **Prompt injection.** Descriptions, notes and page text come from websites. Tool descriptions and the skill must treat them as data; the adapter never executes or follows them.
6. **Image token cost.** Full-page shots are 1440×12000. Slicing and caps (§5.2) keep a call at about 6k tokens, but the agent may call repeatedly. The skill should limit inspection to 3–6 references.
7. **App must be running** (option A). It is acceptable for a local tool, but the error has to be clear and immediate.
8. **The skill is a frozen area**, per the reference-first plan. The owner decides the location.
9. **Capture limits carry into the MCP.** `get_reference_images` serves the stitched full pages. Two limits come with them: elements split across a screen boundary can be half revealed, and login-only pages (the R2 dashboard reference) only have the extension's view. The skill should say so instead of guessing.

## 9. Suggested order

1. ~~Merge Phase 4.~~ Done (#27).
2. ~~Phase 5.~~ Done (#28), plus capture fixes (#29, #30).
3. ~~Owner decisions: transport and skill location.~~ Done (§5.1, §5.4).
4. Step 1 (search service + evaluation set).
5. Step 2 (MCP P0).
6. Step 3 (skill).
7. Step 4 (hardening).
8. Step 5 (writes) when needed.

Each step goes on its own branch from `dev` with its own PR, per CLAUDE.md, and updates the SPEC in the same PR.
