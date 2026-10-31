# Design track: proposal (Phase 5a)

Part A of [PIVOT_DECISIONS.md](PIVOT_DECISIONS.md) leaves these open (A8): the MCP write-tool names and schemas, the session and approval schema, how mockups are rendered, and how much QA is automated. This file proposes them.

**Status:** adopted on 2026-11-01. The owner asked for every phase to be built without stopping for review, so it was built as written here (Phase 5b). Anything below can still be changed; the amendments table in `PIVOT_DECISIONS.md` records changes.

## 1. Data

Additive migration `0007`; nothing existing changes.

| Table                  | Holds                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design_sessions`      | One piece of design work: title, target project (the folder or repo name the agent sees), surface ("pricing page"), status `exploring` → `approved` → `building` → `done` (or `abandoned`).                                                 |
| `design_snapshots`     | The brief as Markdown at a milestone: `initial` (first complete brief), `approved`, `major_change` (with a note). Reference ids, and a sha256 so a repeat returns the same snapshot.                                                        |
| `design_decisions`     | History: `approval` (direction, summary, details), `change` (the user changed an approved decision), `deviation` (QA found the build departs). The approval history is the list of `approval` rows.                                         |
| `resource_suggestions` | An agent's suggestion for a reference: a `facet` ({kind, name}, matched to existing names), a `collection` ({id, name} or a new name), a `title` or a `description` ({text}). `pending` until accepted or rejected; reason and source kept. |

Session status rules: the first `initial` brief creates the session (`exploring`); an `approval` decision sets `approved`; a `major_change` brief sets it back to `exploring`, so the next build needs a new approval; the user sets `building`, `done` or `abandoned` in the app.

## 2. MCP tools

Token-gated (the API token, as the extension uses; `PIVOT_TOKEN` or `<data dir>/api-token`), registered next to the four read tools. A read-only connection answers `read_only` and saves nothing.

| Tool                     | Input                                                                                                                                 | Effect                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `save_design_brief`      | `milestone`, `title`, `markdown`, optional `sessionId` (required after `initial`), `targetProject`, `surface`, `referenceIds`, `note` | Stores the snapshot; `initial` without a session opens one. Same Markdown at the same milestone returns the same snapshot (idempotent).                                |
| `record_design_decision` | `sessionId`, `kind` (`approval`, `change`, `deviation`), `summary`, `direction`, `details`                                            | Appends to the history; `approval` marks the session approved. The description tells the agent to record an approval only after the user approved in the conversation. |
| `get_design_session`     | `sessionId`, or nothing (with an optional `targetProject`) to list                                                                    | Read: the briefs and decisions, the latest brief in full.                                                                                                              |
| `suggest_metadata`       | reference `id`, `suggestions[]` of `{kind, value, reason}`                                                                            | Pending suggestions in the Inbox; repeats and facets the reference already has are skipped.                                                                            |
| `annotate_reference`     | reference `id`, `note`                                                                                                                | Appends `agent (date): note` to the notes; the user's text is never edited.                                                                                            |
| `save_reference`         | `url`, optional `type`, `title`, `notes`, `facets`, `collections`                                                                     | Through `/api/clip`: duplicates skipped, background capture, lands in the Inbox. Only when the user asks.                                                              |

App endpoints behind them: `POST /api/design/briefs`, `GET /api/design/sessions`, `GET|PATCH /api/design/sessions/[id]`, `POST /api/design/sessions/[id]/decisions`, `GET|POST /api/resources/[id]/suggestions`, `GET /api/suggestions`, `POST /api/suggestions/decide`, `POST /api/resources/[id]/annotate`. `GET /api/capabilities` adds `design` and `suggestions` (API version 4).

## 3. How the skill uses them (A2)

| Step                    | Call                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1–4 Understand → choose | read tools only; `get_design_session` to continue earlier work                                                                 |
| 5 Brief                 | —                                                                                                                              |
| 6 Design session        | `save_design_brief` `initial` (opens the session)                                                                              |
| 7 Mockups               | — (see §4)                                                                                                                     |
| 8 Approval              | after an explicit yes: `record_design_decision` `approval`, then `save_design_brief` `approved`; a user change later: `change` |
| 9 Build                 | a change in structure or direction: `save_design_brief` `major_change`, then back to step 8                                    |
| 10 QA                   | each deviation: `record_design_decision` `deviation`                                                                           |
| any time                | `suggest_metadata`, `annotate_reference` (optional); `save_reference` only on request                                          |

If a write fails, the skill says so in one line and never writes the brief into the target repository instead.

## 4. Mockups

Unchanged from Step 3: temporary HTML in a scratch folder or the host's artifact tool, never in the target project's routes, components or styles, never committed. Mockup files are **not** copied into PIVOT; the brief snapshot can name their paths. Storing mockup images in a session is left for later, if it proves useful.

## 5. QA

No automation is added. The skill checks the build in a browser at desktop and phone widths against the approved direction, reports deviations to the user and records them (`deviation`). Automated visual comparison belongs with Phase 6's visual diff (#58).

## 6. AI suggestions in the app (#13, #19, #30, #34)

The agent is the AI: it looks at a reference through MCP and calls `suggest_metadata`. The app stores the suggestions and never applies them on its own.

- Facet names are matched to existing ones in any case, so "dark" becomes the existing "Dark". A new name is marked "(new)".
- Pending suggestion text (descriptions, facet names, titles) is searchable, so "glowing grid" finds a reference before anyone accepts the description. Rejected text stops matching.
- The Inbox shows suggestions with Accept and Reject, one by one or several at once; the detail page shows that reference's. Accepting applies it the way the user would: adds the facet, adds to the collection (creating a suggested new collection only then), or sets the title or description.

## 7. Still open

- **"Workflow Config" (#1).** It isn't defined anywhere. Possible meanings: the skill's defaults (how many references and mockups, where mockups go); per-project settings (design system path, breakpoints to check); turning the skill on or off per project. Nothing is built for it; the owner should say which, if any.
- Whether a session should keep mockup screenshots (§4).
- An MCP prompt or slash command for the skill. Today the skill triggers on its description; no command syntax was decided.
