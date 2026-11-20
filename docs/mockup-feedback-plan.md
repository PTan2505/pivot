# Mockup feedback in PIVOT, and a DESIGN.md for every project

Approved by the owner on 2026-11-20. Each phase is its own branch from `dev` and its own pull request, updates [SPEC.md](SPEC.md) in the same change, and is logged in the progress section below.

## The owner's decisions (2026-11-20)

| Question                                        | Decision                                                                                                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A project without DESIGN.md                     | The skill drafts one from the project's code, shows it, and writes it only on the owner's yes. Never committed for them.                                                                            |
| Feedback that changes the whole project's style | Claude proposes the DESIGN.md change **with the new round** (a diff shown in PIVOT). It is written into the project only when the owner approves a version of that round: one approval covers both. |
| What feedback looks like                        | Text per version (or for the whole round) **plus pins** on the mockup.                                                                                                                              |
| Passphrase for feedback                         | None. Feedback never approves anything; it is accepted only from PIVOT's own page, never with the API token, and marked as the owner's.                                                             |

## Phases

1. **DESIGN.md bootstrap** (`feat/design-md-bootstrap`, skills only): `pivot:design` §0 and `pivot:redesign` §1 draft a DESIGN.md from the code when the project has none, and write it only on the owner's yes ([design-md.md](../plugin/skills/design/design-md.md)).
2. **Feedback API** (`feat/mockup-feedback-api`):
   - a `design_feedback` table: session, round, mockup id and digest, text, pins `{ x, y, width, text }` on the mockup's full-page render at that width, status `open` / `addressed`, source `owner`;
   - `POST /api/design/sessions/[id]/feedback`: PIVOT's own page only, refused with the API token (like owner approvals, without the passphrase);
   - a full-page render of a version at a width (Chromium, JavaScript off, network locked), cached by digest and width;
   - the watcher (`wait-for-decision.mjs`) wakes on new feedback (`{"event":"feedback",…}`).
   - **MCP (names and schemas approved with this plan):** `get_design_session` shows open feedback; a new read tool **`get_feedback_images`** returns crops around each pin; `save_design_mockups` gains optional **`addressesFeedback: [ids]`** and **`designSystemChange: { summary, markdown }`**. An approval also binds the digest of the round's `designSystemChange`, so it can't change after the owner approved.
3. **Feedback UI** (through `pivot:redesign`, with mockups and the owner's approval before any code): a Feedback section in the full-screen drawer with **Send to Claude**; a pin mode that shows the full-page render and places pins with their text; on the session page, feedback in History, rounds naming the feedback they answer, and a proposed DESIGN.md change shown as a diff beside Approve.
4. **Feedback rounds in the skill** (`feat/feedback-rounds`): the watcher reports feedback, Claude reads it and the pin crops, makes a new round with `addressesFeedback`, sorts each item into "this version" or "the project's style", and attaches a `designSystemChange` for the latter. When the owner approves a version of that round, Claude writes exactly the approved DESIGN.md change into the project, then builds.

## Progress

### Phase 1: DESIGN.md bootstrap (2026-11-20)

- **Audit:** both skills read `DESIGN.md` when it exists and say nothing when it doesn't; the "design documents live in PIVOT" rule could be read as forbidding any write into the project.
- **Gaps:** no guidance on drafting a design system from code, on where it goes, or on asking first.
- **Implemented:** `plugin/skills/design/design-md.md` (when, what to gather, the draft's structure, show and ask, write only on yes, never commit, never rewrite an existing one, once per session, not for small fixes); `pivot:design` §0 and the top rule, `pivot:redesign` §1 point to it; SPEC §10 describes it.
- **Tested:** plugin and skill tests; `pnpm plugin:validate`. The behaviour itself is skill guidance: it is exercised in the next real design session on a project without DESIGN.md (not yet run).

### Phase 2: feedback API (2026-11-20)

- **Audit:** mockups, approvals (bound to a version's digest), the owner check (`authorizeOwner` refuses the API token), the capture browser, the agent image helpers, the watcher and the MCP write tools. A sandboxed mockup frame can't report clicks or scroll, so pins need PIVOT's own render of the version.
- **Gaps:** nowhere to store feedback; no render of a version; no way for a round to say what it answers or to propose a DESIGN.md change; the watcher woke only on status changes.
- **Implemented:**
  - Tables `design_feedback` and `design_rounds`, and `design_decisions.design_system_digest` (migration 0013, additive).
  - `packages/core/src/design-feedback.ts`: add, list and get feedback; mark it addressed; render a version (`renderHtml` in `capture.ts`, JavaScript off, every request blocked, cached by digest and width); crop around a pin with its number.
  - Routes: feedback (`POST` refuses the API token), render, one feedback, pin images. The proxy treats the render and pin routes as reads with side effects.
  - `save_design_mockups` takes `addressesFeedback` and `designSystemChange`; an approval stores the round's DESIGN.md digest.
  - `get_design_session` shows feedback and rounds; new read tool `get_feedback_images`.
  - The watcher's `feedback` event; the `design.feedback` capability; backup and restore of rounds and feedback.
  - `pivot-studio` 0.3.0, plugin 0.4.0.
- **Tested:**
  - core `design-feedback.test.ts`: the rules, rounds and binding, the backup round trip, and the render and pin crops with Chromium;
  - the request guard;
  - MCP `feedback-tools.test.ts` and the watcher `wait-for-decision.test.ts`.
- **Not yet:** the page's controls (Phase 3) and the skill's use of all this (Phase 4). Until then feedback is sent only through the API.
