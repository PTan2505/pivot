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

### Phase 11: the skill reads live notes (2026-11-20)

- **Implemented:** `feedback.md` §2: a live note is found by its crop and HTML (its selector may exist only after a script ran) and its state is the one to change; every note is read at its own width (the full-screen Desktop is the user's window width) and height. SPEC §15.
- **Tested:** `skills.test.ts` checks the guidance; `pnpm plugin:validate`. The behaviour is skill guidance, exercised in the next real session with live notes.
