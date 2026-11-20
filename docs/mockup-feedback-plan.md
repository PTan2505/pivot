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

### Phase 3: feedback UI (2026-11-20)

- **Design:** session `10688691` (Major redesign, path A, the full-screen view as the consistency target).
  - Specialists on the brief: `ui-ux-pro-max` (adopted: pin mode signals, P, layered Esc, keyboard pins, a single editor, the drawer order, the DESIGN.md dialog, text-only on phones) and `animate` (adopted: the decoded fade-in, the pin scale-in, no motion on drag or keys; its inline diff expansion was not used, because `ui-ux-pro-max` owns the structure and chose a dialog).
  - Two directions; the owner approved version 1 "Pins on the page" in PIVOT, with no note.
- **Implemented:**
  - `components/mockup-feedback.tsx`: pin layer, Feedback section, DESIGN.md box and dialog, drafts per version.
  - The quick bar's pin button and the P key in `mockup-stage.tsx`.
  - The approve dialog's DESIGN.md line, the session page's box, and the round header in `design-mockups.tsx`.
  - Feedback rows in History (`design-session.tsx`).
  - The preview window's "Feedback for Claude", posted by its own process (`postFeedback`), with a `feedback` event.
- **Tested:**
  - `preview.test.mjs`: feedback from the preview window, and typing in the box doesn't switch versions.
  - Real input on a scratch PIVOT: P, a click drops a pin with its note focused, Esc in layers, arrow nudges stored, Send, the stored width and coordinates, round 3's DESIGN.md box and dialog, the approve dialog's line, History rows, the round header.
- **Fixed during QA:**
  - a new pin stole focus from its own note;
  - a Markdown list item ("- h1") showed as a removed line;
  - "Sent" stayed shown after switching version.
- **QA audit (`impeccable`, 14/20), fixed and checked with real input:**
  - Enter and Space open a focused pin's note;
  - a click at another width no longer drops the draft's pins;
  - focus goes to the next pin or the pin button after a delete or leaving pin mode;
  - the frame is inert while pinning;
  - pin drags handle cancel;
  - pins keep their numbers through the API (`n`), MCP and History;
  - a failed send doesn't duplicate round text;
  - a render that fails shows a message;
  - the banner sits below a top quick bar, and its live region is the text only;
  - the note stays inside the layer at 700px;
  - the DESIGN.md dialog has one close control.
- **Left as is:** the detector's 13px advisories (13px is the drawer's helper size); the pre-existing axe findings.

### Phase 4: feedback rounds in the skill (2026-11-20)

- **Audit:** `pivot:design` §7 started the watcher and §8 read only approvals; nothing told the agent what to do with the watcher's `feedback` event, how to tell a version change from a style change, or how to write an approved DESIGN.md change. `pivot:redesign` §5 asked for a separate approval for any design-system change. `get_feedback_images` was missing from the skill's tool table.
- **Gaps:** reading feedback and pins, sorting items, the next round (`addressesFeedback`, item-by-item changes), the DESIGN.md change's format, and writing it exactly on approval.
- **Implemented:** `plugin/skills/design/feedback.md` (when feedback arrives, read it with the pin crops, sort each item into this version / the project's style / outside the design, revise the versions it is about, answer every open item, a unified diff against the current DESIGN.md as the `designSystemChange`, and after the approval apply it with `git apply` as the first edit, stopping if it no longer applies, never committing). `pivot:design`: the tool table, the flow line, §7 (the watcher's feedback exit, Send to Claude in the turn's last line), §8 (feedback is a new round; an approval with a DESIGN.md change covers both) and §9 (the change is the first edit). `pivot:redesign` §4 and §5 point to it. SPEC §15.
- **Tested:** `skills.test.ts` checks the new guidance and that both skills reach `feedback.md`; `pnpm plugin:validate`. The diff and `git apply` steps were run on a scratch repository: the diff applies, `--check` refuses it once the lines it touches have changed, and a copy without its final newline is refused as corrupt (hence the rule to keep `design-md.diff` and end the file with a newline). The behaviour is skill guidance: it is exercised in the next real design session that gets feedback from PIVOT (not yet run).
