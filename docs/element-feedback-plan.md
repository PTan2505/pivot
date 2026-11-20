# Element feedback: select a mockup's element, not only a spot

Approved by the owner on 2026-11-20, following [mockup-feedback-plan.md](mockup-feedback-plan.md) (Phases 1–4, released in pivot-studio 0.3.0). Each phase is its own branch from `dev` and its own pull request, updates [SPEC.md](SPEC.md) in the same change, and is logged in the progress section below.

## The owner's decisions (2026-11-20)

| Question                         | Decision                                                                                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How PIVOT finds the element      | **From the render.** While it renders a version (scripts off, network locked), PIVOT also reads each element's box and selector. Hover outlines the element on the page image; a click selects it. The mockup frame's sandbox stays as it is. |
| Tools                            | **Select + Pin**, like Figma: Select (cursor, key V) picks an element, Pin (key P) drops a pin on any spot. Both go into the same draft, numbered in one sequence, and are listed together.                                                   |
| What Claude receives per element | A CSS selector path, tag, id and classes, its text, its box, a trimmed HTML snippet of the element, and a crop with the element outlined and numbered.                                                                                        |
| Design exploration               | One direction (it extends the approved "Pins on the page"), through `pivot:redesign`, approved before any UI code.                                                                                                                            |

## Phases

5. **Element map and element pins** (`feat/feedback-elements-api`):
   - `renderHtml` also returns an **element map** of the page at that width: for each rendered element inside the cut page (not `head`, `script`, `style`, nor anything under 4×4px), its index, parent index, tag, id, up to 3 classes, the first 80 characters of its own text, its box, and a unique CSS selector path. At most 5,000 elements (the deepest are dropped first). Kept in the blob store next to the picture, by digest and width.
   - `GET /api/design/mockups/[id]/elements?width=` returns it: a read with side effects, like the render route (the proxy's same rule).
   - A pin may carry **`element: { selector }`**. PIVOT checks the selector against that version's map at the pin's width and stores the element's tag, id, classes, text and box from its own map (never from the page), and a trimmed `outerHTML` snippet (2,000 characters, long attributes and `data:` URIs shortened). Pins stay in the `pins` JSON column: **no migration**.
   - The pin crop route outlines the element and draws the number at its corner.
   - MCP: `get_design_session` names each element pin (`2. button#cta "Sign up" at (47, 8, 61×21): "…note…"`); `get_feedback_images` adds the selector and the HTML snippet to each crop. The watcher counts element pins.
   - The capability `design.feedback.elements`. Tests: the map (selectors resolve to one element, scripts never run, limits), the stored element, the crops, the route guard, the MCP text.
   - pivot-studio **0.4.0** (a new feature after the released 0.3.0); plugin **0.5.0** (MCP output).
6. **Select tool in the full-screen view** (`feat/feedback-select-tool`, through `pivot:redesign`, one mockup approved before any code):
   - the pin layer gets a tool switch: **Select** (default, V) and **Pin** (P);
   - Select: hover outlines the deepest element under the cursor with a small label (`button#cta · 61×21`); a click selects it, numbers it and opens its note; the parent can be chosen instead (keyboard and a breadcrumb in the note);
   - keyboard: an equivalent of "Add pin at centre" for elements, and moving the selection to the parent or a child;
   - the drawer's list, the session page's History and the earlier-feedback list show the element (`button#cta`) beside its note;
   - phones keep text feedback only, as today.
7. **The skill uses the element** (`feat/feedback-elements-skill`): `feedback.md` §2 reads the selector and the HTML snippet to find the exact component in the mockup (and, while building, in the project's code), and says which element it changed, item by item.

## Progress

### Phase 5: element map and element pins (2026-11-20)

- **Audit:** pins are spots on PIVOT's own render (`renderHtml`, scripts off, network locked); the mockup frame is sandboxed, so the page can't see its elements. Tried first: Playwright's `evaluate` reads the rendered DOM while the page's own scripts stay off (a script in the page did not run).
- **Gaps:** no element data with a render; pins can't say which element they mean; the agent gets only a spot and a crop.
- **Implemented:**
  - `renderHtml(..., { elements: true })` returns the element map (`RenderedElement`), measured on the same layout and cut; `elementsHtml` returns trimmed HTML by selector. Both run as in-page scripts, like the other capture helpers.
  - `mockupElements` keeps the map next to the render (`design-renders/<digest>-<width>.elements.json`) and makes the render again when an older one has no map; `GET /api/design/mockups/[id]/elements` (a side-effect read in the request guard).
  - `addFeedback` takes `element: { selector }` on a pin and stores the element from PIVOT's own map, with its HTML; the pin crop outlines the element.
  - MCP `get_design_session` and `get_feedback_images` name the element and give its HTML; the watcher counts element pins; capability `design.feedback.elements`.
  - pivot-studio 0.4.0, plugin 0.5.0. No migration (`pnpm db:generate`: no schema changes).
- **Tested:** core `design-feedback.test.ts` (the map: selectors each find one element, scripts never run, svg insides, hidden and tiny elements left out, duplicated ids, same-tag siblings, the stored map and a re-render without one; element pins from the map, the moved point, trimmed HTML, a selector not in the map refused, the outlined crop; the trimming of large maps), the request guard, MCP `feedback-tools.test.ts` and the watcher test; over HTTP on a scratch PIVOT.
