# Mockups in PIVOT: proposal

**Status:** approved by the owner on 2026-11-03 ("duyệt cả 4, làm luôn"), with one addition: the agent builds as soon as a version is approved in PIVOT, without the owner going back to the chat (§1 step 5). Built as described here, with two changes from the first draft: mockup HTML is stored in the database rather than the blob store (§2), and the agent waits with a background watcher (§1, §6).

**What it changes:** a decision already taken, which needs the owner's explicit approval.

- `design-track-proposal.md` §4 and SPEC §15 say mockup files are **not** copied into PIVOT.
- Today the skill writes about five mockups to a scratch folder and builds a static viewer (`pivot-design/viewer/make-viewer.mjs`). Its "Choose this version" button copies a reply for the chat.

The owner asked for:

- the versions shown in PIVOT itself, as tabs that switch quickly;
- one button to choose a version.

## 1. The flow

1. The agent writes the brief, saves it as `initial` (unchanged), and makes about five mockups.
2. The agent calls **`save_design_mockups`**. PIVOT stores the versions as a **round** of the session and returns the session's link. The agent gives the user the link, then stops at the approval gate, as now.
3. On the session page, the user switches versions (tabs, keys 1–9, ←/→) at desktop, tablet or phone width. Then they press **Approve this version**, optionally adding a note ("keep the table of version 2").
4. PIVOT records an `approval` decision with `source: "owner"`:
   - **direction:** "Version 3: Raised Pro card (round 1)";
   - **details:** the user's note, verbatim.

   The session becomes `approved`.

5. **The agent picks it up by itself.** Right after saving the round, it starts `pivot-design/scripts/wait-for-decision.mjs <sessionId>` as a background task and ends its turn. The script only reads the session (GET, no token) every few seconds and exits as soon as the session leaves `exploring`. In Claude Code a background task that exits wakes the agent, so nothing costs tokens while the user looks.
   - The agent reads the session with `get_design_session` and finds the owner's approval.
   - It takes that record as the approval and doesn't record a second one. The note is the user's instruction for the build; a note that asks for a major change makes the agent ask instead of building.
   - It moves on: `set_design_status building`, then build.
   - Without background tasks (another agent), the user tells the agent in the chat after approving, as in the first draft.
6. **Approving in the chat still works.** Saying "version 3" in the chat records the approval through `record_design_decision`, with `source: "agent"`, as today; the agent then stops the watcher.

**Requesting changes or rejecting stays in the chat.** The agent then saves a new round, and the earlier rounds stay as history.

## 2. Data

An additive migration; nothing existing changes.

| Change                               | Holds                                                                                                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New table `design_mockups`           | `id`; `session_id` (cascade); `snapshot_id` (nullable, the brief it illustrates); `round` (1, 2… per session); `n` (version number in the round); `title`; `html`; `round_digest` (for idempotent saves); `created_at`. Unique on (`session_id`, `round`, `n`). |
| New column `design_decisions.source` | `agent` (default, so existing rows read as before) or `owner` (recorded in PIVOT by the user).                                                                                                                                                                  |

- **Storage:** the HTML is stored in the table, like a brief's Markdown, rather than through the blob store. A mockup is a small text file (2 MB at most once inlined), backups and restores carry it with the rest of the session, and no file can go missing from storage.
- **Backup and restore:** they include the new table, like the other design tables; backups made before it restore as before.

## 3. Serving and safety

Mockup HTML is written by an agent, so PIVOT treats it as untrusted:

- **Route:** `GET /api/design/mockups/[id]` serves the file with a strict CSP:
  - `default-src 'none'` and `sandbox` (no `allow-same-origin`, no scripts);
  - `style-src 'unsafe-inline'`;
  - `img-src 'self' data:` and `font-src 'self' data:`.

  The page shows it in an `<iframe sandbox>`. A mockup can't run scripts, reach other hosts, or touch the app.

- **Self-contained:** CSS is inlined; images are PIVOT asset URLs or `data:` URIs. External fonts, images and scripts don't load, and the tool reports any it had to drop.
- **Limits:** at most 9 versions per round and 2 MB per file. Writes need the API token (MCP) or the app's own page (the approve button), as `proxy.ts` already enforces.

## 4. MCP tool `save_design_mockups`

| Input        | Notes                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `sessionId`  | UUID, required                                                                                      |
| `mockups`    | 1–9 items of `{ path, title }`: `path` is an absolute local HTML file, `title` the direction's name |
| `snapshotId` | optional; defaults to the latest brief                                                              |

**Rules:**

- The session must exist and be `exploring`, which is the gate for both new work and a major change.
- **Inlining happens on the agent's machine** (the stdio server reads the files) before upload:
  - local `<link rel="stylesheet">` and `@import` are inlined;
  - local `<img src>` becomes a `data:` URI;
  - anything remote is removed and listed in the result.
- **Each call is a new round.** Saving the identical set again returns the same round, so the tool is idempotent.
- **Returns:** `{ round, ids, url }`, with `url` = `<PIVOT_URL>/design/<sessionId>?round=<round>`.
- **Read-only connections:** the tool answers `read_only`, and the skill falls back to the local viewer.

`get_design_session` also lists the rounds with their version titles. It shows each approval's `source`, so the agent can tell an owner's click from its own record.

## 5. Session page

- **Mockups section** above the timeline:
  - "Round 2 · 5 versions", with a round switch when there are older rounds;
  - tabs 1–N with titles;
  - Desktop / Tablet / Phone width pills;
  - the sandboxed iframe, about 80vh, scrolling;
  - an "Open alone" link.
- **Approve this version:** an inverse pill, never ember, because the top bar's Add stays the screen's one primary action. It opens a small dialog with an optional note and a confirm, so a stray click never approves.
- **After approval:** the chosen tab carries an "Approved" chip, the stepper moves to Approved, and the approval appears in the timeline as "Approved in PIVOT".
- **Keyboard:** 1–9 and ←/→ switch versions while focus is outside the mockup and the dialog.

## 6. Skill changes

- **`pivot-design` §7:** after making the mockups, call `save_design_mockups`, give the user the PIVOT link, start `scripts/wait-for-decision.mjs` in the background and end the turn. Keep `make-viewer.mjs` only as the fallback when PIVOT can't store them (read-only, app down).
- **§8:** an approval recorded by the owner in PIVOT (`source: "owner"`) is the explicit approval. Read it with `get_design_session`, don't record another, follow its note, and build. A chat message without such a record is judged as today, and stops the watcher.
- **`pivot-redesign` §4:** the same, through `pivot-design`.

## 7. Out of scope

- Comments pinned on a mockup.
- Diffing rounds.
- Mockup thumbnails in the session list.
- Requesting changes from the PIVOT page (stays in the chat).
- Approving from a phone outside this machine (the API answers localhost only).

## 8. Decisions (approved 2026-11-03)

1. **Approve in PIVOT** with `source: "owner"`: yes, and the agent builds from it without a chat message.
2. **Static mockups only:** yes. Scripts and remote images and fonts are removed and listed.
3. **Earlier rounds** stay as history; the page opens on the latest and a round switch shows the others.
4. **"Mockups are not copied into PIVOT"** (`design-track-proposal.md` §4, SPEC §15) is replaced by this.
