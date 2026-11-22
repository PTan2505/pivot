# Live feedback: comment on the page as it is, in the full-screen view and the preview window

Approved by the owner on 2026-11-20, following [element-feedback-plan.md](element-feedback-plan.md) (Phases 5–7, released in pivot-studio 0.4.0 and plugin 0.5.0). Each phase is its own branch from `dev` and its own pull request, updates [SPEC.md](SPEC.md) in the same change, and is logged in the progress section below.

## The owner's decisions (2026-11-20)

| Question                   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full-screen view           | **The live page, without scripts.** Comment mode works on the version itself at its real size, not on a shrunk picture: its own CSS hover states show, and the scroll position is kept. The owner accepted the security change: the frame becomes a copy of the version that shares PIVOT's origin, so PIVOT's page can read it; scripts stay off and a CSP inside it blocks every request (tested: a script in it did not run, no request left it, PIVOT's page got hover, clicks, scroll and the element under the pointer). |
| Interactive preview window | **Live, with scripts.** Select and Pin on the running version, including what its scripts open (menus, tabs, states). The preview captures the element, its HTML and the crop itself, as the owner saw it, and sends them with the note.                                                                                                                                                                                                                                                                                       |
| Design exploration         | One direction through `pivot:redesign`, reusing the approved Select and Pin design (session `29471a8b`), approved before any UI code.                                                                                                                                                                                                                                                                                                                                                                                          |

## Phases

8. **Any width, and notes captured live** (`feat/live-feedback-api`):
   - Renders, element maps and feedback accept any width from 320 to 2560 px, not only 1440 / 834 / 390, each made once per digest and width (the full-screen view's Desktop is the window's own width).
   - A note from the full-screen view names its element by selector, as today; PIVOT checks it in its own map at that width (the frame and the render have the same HTML without scripts, so the same elements).
   - A note captured in the preview window (`live: true`) carries what the preview saw: the element (tag, id, classes, text, box, trimmed HTML, selector), or a spot, and a crop image (JPEG, at most 400 KB). PIVOT stores the crop in the blob store and doesn't re-check the element (scripts may have made it); it never trusts the crop for anything but showing it.
   - MCP: `get_feedback_images` shows a live note's own crop and says it was seen with the version's scripts running; `get_design_session` marks live notes.
   - Versions: pivot-studio 0.5.0, plugin 0.6.0. No migration (notes stay in the pins JSON column; crops in the blob store).
9. **Comment on the live page in the full-screen view** (`feat/live-comment-fullscreen`, through `pivot:redesign`):
   - The full-screen frame becomes the script-free, same-origin copy (`sandbox="allow-same-origin"`, `srcdoc`, a CSP meta tag first: `default-src 'none'`, inline styles, `data:` images and fonts) at all times, so entering comment mode keeps the page and its scroll exactly as they are.
   - Comment mode draws the outline, chip, markers and notes over the frame at its real size; the drawer floats over the page instead of shrinking it. Clicks in comment mode don't follow the mockup's links.
   - Select reads the live elements under the pointer (the same selector rules as the map); the keyboard walk, breadcrumb, names and states stay as approved.
10. **Comment in the interactive preview window** (`feat/live-comment-preview`, same design):

- The preview's drawer gets the comment tools (Select, Pin) and the notes list next to its text feedback; the version keeps running with its scripts.
- The preview process reads the element under the pointer in the version's frame, draws the outline in its own page, captures the crop with Playwright, and sends the notes to PIVOT as the page would (Phase 8's `live` notes). A mockup's own scripts can't send or approve anything.

11. **The skill reads live notes** (`feat/live-feedback-skill`): `feedback.md` §2 says a live note was seen with scripts running, its selector may not exist in the scripts-off HTML, and its crop and HTML show the state to change.

12. **Choose the element with the keyboard** (`feat/keyboard-element-walk`, approved by the owner on 2026-11-22: both places, hover then arrows, a path strip while selecting):
    - Full-screen view: the arrows walk from the element under the pointer (or the one the keys reached), with no click or Tab first; nothing outlined, the first arrow outlines the element in the middle of the view. Enter comments, Esc ends the walk, moving the pointer hands the outline back.
    - A strip under the comment toolbar shows the outlined element's path (up to 3 ancestors, then the element); an ancestor outlines that element.
    - The preview window gets the same walk, path strip and announcements, read in the process's isolated world of the version's frame, so the mockup's scripts don't see it. This closes the two deviations recorded for Phase 10 (no keyboard walk or breadcrumb in the preview; the keyboard only had "Comment at centre").
    - No version change: pivot-studio 0.5.0 and plugin 0.6.0 are not released yet.

## Progress

### Phase 8: any width, and notes captured live (2026-11-20)

- **Audit:** renders, element maps and feedback took only 1440, 834 and 390; a note's crop was always cut from PIVOT's scripts-off render; backups carried no feedback pictures (none existed).
- **Implemented:**
  - widths: any whole number from 320 to 2560 (`RENDER_WIDTH`), for renders, maps and feedback;
  - live notes: `live: true`, the element as the preview saw it (cut to limits), and `capture` (JPEG or PNG, re-encoded as JPEG, by sha256 in the blob store, 400 kB each and 6 MB a send);
  - the pin crop route and MCP show a live note's own crop; `get_design_session` marks live notes;
  - backups carry and restore the crops, checked by sha256; capability `design.feedback.live`;
  - pivot-studio 0.5.0, plugin 0.6.0. No migration.
- **Tested:** core `design-feedback.test.ts` (any width and its limits; a live note with its element cut to limits and its crop; refusals: no picture, not an image, too big, too large a side, an unusable tag; the backup round trip of a crop); MCP `feedback-tools.test.ts`.

### Phase 9: comment on the live page in the full-screen view (2026-11-20)

- **Design:** through `pivot:redesign`, design session `3ae676b1`, version 1 "Comment on the live page", approved by the owner in PIVOT with no note. `ui-ux-pro-max` reviewed the brief (adopted: named modes in the preview, keys only while commenting, freeze inside the page, "Hide panel" hint, widths in notes, crops before overlays, one send). Two spikes, run by subagents in the scratchpad, measured the full-screen frame (overlay error ≤ 0.02 px, client selectors identical to the server's) and the preview window (isolated-world reading, shield).
- **Implemented:**
  - the full-screen frame is a script-free same-origin copy (`sandbox="allow-same-origin"`, `srcdoc` with a doctype and a CSP, no meta refresh, a link guard), kept across comment mode;
  - comment mode draws over the live frame (outline, chip, markers, clipped to the frame; the note away from the drawer), reads elements in the browser (`lib/element-map.ts`, the server's rules), stops the page's presses and clicks inside it, keeps its scroll and size; a "Hide panel" hint for elements under the drawer; notes carry the page's width and viewport height;
  - the server renders and maps at a viewport height (`height`, 200–4000, default 900) and adds a doctype when a page has none; notes keep a height other than 900 (`vh`).
- **Tested:** real-input e2e on a scratch PIVOT (the frame's sandbox and srcdoc, comment mode keeping scroll 200 and width 1440, hover chip, a click making a note without following the link, Pin, drawer rows with widths, Tab to the picker, the keyboard walk to an element under the drawer and Hide panel, leaving keeps the scroll, Send with width and height, no request leaving PIVOT, no console errors).

### Phase 10: comment in the interactive preview window (2026-11-20)

- **Audit:** the preview window had text feedback only ("Feedback for Claude", **Send feedback**), posted by its process; nothing could point at an element or a spot, and states only the version's scripts open (menus, tabs) couldn't be shown to Claude. The spike (approach A) settled how: a shield in the preview's page, the element read in an isolated world of the version's frame through CDP (the frame is in the page's process in the headless shell and out of process in full Chromium), crops taken from the page with the chrome hidden.
- **Implemented** (`plugin/skills/design/scripts/preview.mjs`, preview 1.2.0; design session `3ae676b1`, version 1 "Comment on the live page"):
  - two modes, **Use** and **Comment**: a switch in the quick bar and in the drawer's new Comment section, and ⌥C, caught inside the mockup too by a guard in the frame's isolated world that passes it (and Esc, V, P while commenting) to the preview's page through a binding only that world has;
  - in Comment a shield over the version takes every pointer event, the guard stops the page's own keys, clicks and submits (real input only), and a toolbar says "Commenting · page paused · Esc to use it" with Select (V), Pin (P), "Comment at centre" / "Add pin at centre" and Done; V, P and Esc never while typing;
  - Select outlines the element under the pointer with PIVOT's chip and names (read by the process in its isolated world, one question per animation frame) and a click makes a numbered note; Pin makes a spot note; 28px markers (an element's just outside its top-left corner), a note popover with Delete, a note closed empty dropped; the wheel scrolls the version through the process;
  - each crop is taken when the note is made, from the page, with the drawer, bars, toolbar and overlays hidden, at CSS pixels (a Retina screen's device pixels are scaled back), JPEG under 200 kB and 2,400px a side; crops and elements stay in the process until sent;
  - the drawer's Comment section lists the version's notes (element or "Spot", the width, "made at …" for another width, "live"), keeps the text box and has one **Send to Claude** (inverse) for both, replacing "Send feedback"; the process posts live notes with `width` (and `height`), one piece per width, the text with the first, and prints `{"event":"feedback",…,"notes":N}`; then "Sent · waiting for Claude" and the notes leave the draft;
  - kept: versions, widths, motion, Replay, Compare (Comment is off while comparing), the quick bar's places, Choose this version (the window's one ember action), crash recovery (a new page starts with no notes), and every lock: the `pivotPreview` binding answers only the preview's own main frame of the current page, and reads are refused outside Comment.
  - Differs from the brief: the page isn't paused "inside it" with its hover styles live; following the spike, a shield covers it, so the version's own CSS `:hover` doesn't change while commenting (a menu opened by a click in Use stays open). ⌥C is caught after a `window` capture-phase key listener the mockup registered on load, not before it.
  - pivot-studio: covered by the pending 0.5.0 (the package carries `preview.mjs`); plugin: covered by the pending 0.6.0.
- **Tested:** `packages/mcp-tools/test/preview.test.mjs`, "comment mode in the preview window" (headless shell, the frame in the page's process): the switch, shield, toolbar, V/P/Esc and ⌥C (not while typing); a hover read on a static version (`sandbox=""`, no scripts) and on an interactive one; a menu opened in Use and commented on, with no click, pointerdown or mousedown reaching the mockup, its own field paused and Esc there returning to Use; a hostile mockup (it calls `pivotPreview` for reads, notes, mode and feedback, looks for the key binding, makes up ⌥C, Esc and P, and overrides `elementFromPoint`) changes nothing; the posted payload (text, `width`, `height`, live pins with element, HTML, crop and region; the spot's place after a wheel scroll); notes at two widths sent as two pieces; a page of noise kept under the crop limits. "comment mode on full Chromium" runs the same flow with the frame out of process (skipped where full Chromium isn't installed). A scratch run with a device scale factor of 2 and no emulation (as the window on a Retina Mac) gave crops at CSS size.

### QA of Phases 9–10 (2026-11-20)

- **`impeccable` audit** (through `pivot:specialist`), functional findings fixed and checked with real input on a scratch PIVOT:
  - full-screen: every link click is cancelled (`<area>` and SVG links too) and `#…` links scroll by hand (a srcdoc resolves them against PIVOT's address: following one loaded PIVOT into the frame, found while testing); the focus never stays in the page while commenting; hit-testing and outlines use the live page (a sticky header after scrolling, a menu shown by `:hover`), re-read once motion settles; Hide panel returns the focus to the picker and is its own sub-pill; notes say the view as shown (`Tablet 834`); meta refresh is removed by parsing;
  - preview window: the frame is `inert` while commenting (no keyboard trap; focus moves to the toolbar), errors show in a status line at every width, key hints are 12px.
- **Left as is:** a mockup's own window-level key listener still sees ⌥C first (the out-of-process frame starts before any early hook can reach it); resizing the preview window rebuilds its frame (pre-existing); the preview's Tablet is 768 (pre-existing); the detector's 13px and Geist notes.

### Phase 11: the skill reads live notes (2026-11-20)

- **Implemented:** `feedback.md` §2: a live note is found by its crop and HTML (its selector may exist only after a script ran) and its state is the one to change; every note is read at its own width (the full-screen Desktop is the user's window width) and height. SPEC §15.
- **Tested:** `skills.test.ts` checks the guidance; `pnpm plugin:validate`. The behaviour is skill guidance, exercised in the next real session with live notes.

### Phase 12: choose the element with the keyboard (2026-11-22)

- **Audit:** the full-screen view walked with the arrows only once its picker had keyboard focus (Tab first) and started at the middle of the view, not at the element pointed at; its breadcrumb showed only inside an open note. The preview window had no walk at all (the two deviations recorded in session `3ae676b1`).
- **Gaps:** hover then arrows in both places; a path strip while selecting; Esc and pointer hand-back rules shared by both.
- **Implemented:** `mockup-feedback.tsx` (`walkKey`, a window-level listener for the keys wherever the focus doesn't use them, the pointer hand-back after 4 px, Esc layers, the Select radio moving the focus to the picker quietly, the `Element path` strip); `preview.mjs` (the walk in the isolated world with `globalThis.__pivotWalk`, the `walk` request and `pick: {walked: true}`, `forPage()` capping what reaches the page, the shield as the picker, the strip and its live region).
- **Tested:** `pnpm check` (format, lint, typecheck; tests 17 + 226 + 12 + 334, four new preview tests driving real keys and pointer). Full-screen by hand on a scratch PIVOT (the landing mockups): hover `a.btn`, ↑↑ to `div.hero-copy`, ↓ and →, a path part then Enter made a note on `div.wrap`, Esc ended the walk and kept the mode, a 4 px move handed the outline back, arrows walked with the focus on a drawer button and on an element note's marker, Select clicked with the pointer left no focus ring.
- **Decided along the way:** in the preview the arrows walk even when the focus is on the tool switch (the preview's switches don't use arrows, and turning Comment on puts the focus there); arrows no longer switch versions while commenting with Select (1–9 and the tabs still do). No version change: `PREVIEW_VERSION` 1.2.0, pivot-studio 0.5.0 and plugin 0.6.0 are all unreleased.
