# PIVOT — Design system

Source of truth for the app (`apps/web`) and the extension (`apps/extension`). Tokens live as CSS variables in
[`apps/web/src/app/globals.css`](apps/web/src/app/globals.css) and are exposed to Tailwind as `bg-surface`, `text-ink-subtle`, `outline-accent-text`…
The browsable version with component previews: [PIVOT Design System](https://claude.ai/artifact/6NEyzcYbPGtnjScMY33Lfd) (private).

Direction: **Savee** (from [Refero Styles](https://styles.refero.design/style/c6d8490d-e3f2-45c8-aebf-fe5f11daf116)) — mockup option 3.

PIVOT is a personal library of UI references, assets, prompts and Claude Code skills. The interface is a black canvas: saved screenshots carry the color, the chrome stays out of the way. One electric-indigo button per screen marks the action that matters.

## Content fundamentals

- Write in English, sentence case, from the user's side: "Add", "Copy context", "Export", "Move to trash". Never "Submit" or "OK".
- Buttons name the action; toasts confirm it in past tense: "Copy context" → "Context copied · ~1.9k tokens".
- Name things the way the user saved them. A resource's title is what the site calls itself ("Linear — Issues board"); the meta line is `host · tag` ("linear.app · Dashboard").
- Errors say what happened and what to do: "PIVOT isn't running. Start it with `npm start`."
- Counts are plain numbers in `ink-subtle` ("References 24"), never badges.
- No emoji anywhere in the UI.

## Color

- Paint the page `canvas`. Put thumbnails, note cards, the search field and inactive pills on `surface`. Use `surface-raised` for hover, for chips that sit on a surface, and for popovers.
- Hierarchy comes from surface steps (`canvas` → `surface` → `surface-raised`), not borders or shadows. Use `divider` only inside dialogs and tables.
- Text: `ink` for titles, `ink-secondary` for labels that recede, `ink-muted` for helper text and icons, `ink-subtle` for metadata. All four read on `canvas`, `surface` and `surface-raised` in both themes.
- `accent` is for one filled primary button per screen, with `on-accent` text. Do not use it for links, icons, hover states, badges or decoration.
- Links, the focus ring and the selected-card outline use `accent-text`.
- The active pill is `inverse` with `on-inverse` text. Every other pill is `surface` with `ink-secondary` text.
- `danger`, `success` and `warning` always come with a word or an icon. `success` and `danger` have the same lightness, so color alone never tells them apart.
- Dark is the primary theme. Light keeps the same structure: `canvas` is white and `surface` a light grey, so pills and thumbnail frames stay visible against the page.

## Typography

- One family, Geist (`--font-sans`), for everything; Geist Mono (`--font-mono`) for prompt and code previews, keyboard hints and counts. Both load from Google Fonts.
- One `display` title per library view (72px, weight 500, tracking -0.045em, line-height 0.96). It is the only large type on the screen.
- Card titles are `title`, meta lines `meta` in `ink-subtle`, pills and buttons `label`.
- The note card shows its content as a `title-lg` quote, not as a code block.
- Keep weights at 400 and 500. No bold (600+) anywhere.
- Body text is 15px (set on `body`), labels and meta 14px. Never go below 12px. (Raised one step on 2026-10-28: 14 → 15 body, 13 → 14 labels and meta, 15 → 16 titles.)
- The root size stays at the browser's 16px. Never set `font-size` on `html`: every rem-based size (control heights, spacing, `text-xs`/`text-sm`) is measured from it, and a 14px root once shrank the whole app by 12.5%.

## Layout

- No sidebar. A top bar holds the logo, the section nav (Library · Knowledge · Sources · Skills), the search field (up to 560px) and the account pills; the primary `Add` button sits at its right end.
- Under it: the `display` page title with a `meta` count line, then a wrapping row of tag pills that filter the list.
- The grid is `repeat(auto-fill, minmax(360px, 1fr))` with `space-10` between rows and `space-6` between columns. Thumbnails are 16:10.
- Page side gutter is `space-10` on desktop and 16px on phones. Sections are separated by `space-16` of empty canvas.
- Radius is binary: `radius-pill` for every control, `radius-card` for every container. `radius-sm` is only for keyboard hints and inline code.

## States

- Hover: a `surface` element becomes `surface-raised`. Thumbnails do not scale or lift.
- Focus: a 2px `accent-text` outline with 3px offset, on every interactive element.
- Selected (bulk selection): the thumbnail gets the same 2px `accent-text` outline; a floating selection bar on `surface-raised` with `shadow-overlay` shows the actions.
- Loading: a `surface` block with a slow opacity pulse; capturing screenshots also shows "Capturing…" in `ink-muted`.
- Disabled: 40% opacity and no pointer cursor.

## Motion

- 150ms ease-out for hover and pill changes; 200ms for dialogs (fade + 8px rise). Nothing loops except the loading pulse.
- With `prefers-reduced-motion`, all transitions are instant.

## Iconography

- Lucide stroke icons at 16px, stroke 2, colored `ink-muted` (or the label color inside a button). Icons sit beside a word; icon-only buttons carry an `aria-label`.
- The PIVOT mark is the archive glyph in `canvas` on an `ink` disc. There is no other logo; set the name in Geist 500.

## Components

Each entry says what the component is for, what the caller provides and where it lives in the code (paths under `apps/web/src/` unless written out).

### Button — `apps/web/src/components/ui/button.tsx`

Pill-shaped button in three roles.

- `default` (indigo `accent` fill, `on-accent` label): the **one** primary action on a screen — Add, Save, Export.
- `secondary` (`surface` fill, `ink-secondary` label, hover `surface-raised`): everything else. `outline` renders the same; there are no outline-only buttons.
- `ghost`: secondary actions inside a raised container (selection bar, menus).
- `destructive` (`surface` fill, `danger` label): always with an explicit verb or icon ("Delete forever").
- Sizes: `lg` 40px in the top bar, `default` 36px, `sm` 32px, `xs` 24px; `icon*` variants are round.
- The caller provides a verb as the label and, optionally, a leading 16px Lucide icon. Icon-only buttons need `aria-label`.

### Pill (section nav, tag filter, tags) — `components/app-shell.tsx` (`SectionNav`), `components/tag-pills.tsx`, `components/tags-editor.tsx`

One shape, two states.

- Inactive: `surface` fill, `ink-secondary` label; hover `surface-raised`.
- Active: `inverse` fill, `on-inverse` label. Exactly one active section in the nav; the tag row may have several.
- Heights: 36px section nav, tag filter and chips, 28px editable tags, 24px tags inside a card. Section nav labels are 15px.
- **Section nav** (`components/section-nav.tsx`, Radix NavigationMenu): transparent when idle (hover or open: `surface`), so the top bar stays quiet. Sections with a panel (Library, Knowledge, Sources) end in a 14px chevron at 60% opacity that turns over (200ms) while the panel is open; phones (no hover) hide it so the nav fits.
- **Type panel**, opened by hovering Library, Knowledge or Sources, or by pressing ↓ on them (Sources lists its seven categories instead of types, each with its own Lucide icon: lightbulb, app-window, swatch-book, blocks, orbit, type, shapes):
  - A `surface-raised` panel, 20px radius, `shadow-overlay`, 8px padding, two columns up to 600px wide (one column on phones).
  - Each option is a 12px-radius row: a 40px `surface` icon tile, the plural name in 15px `ink` with its count in `mono` on the right, and the type's one-line blurb in 14px `ink-muted`. Hover or focus fills it with `surface`; the current type stays filled.
  - Clicking the section name itself goes to its landing page; there is no "All" option.
- **Panel motion**, modelled on lovable.dev:
  - Opening scales from 0.96 and fades in (180ms); closing reverses (140ms).
  - Moving to another section glides the panel under it and resizes it to the new content (270ms, `cubic-bezier(.45,0,.25,1)`).
  - The new content slides 32px in from the side the pointer came from, unblurring from 2px, while the old one slides out the other way.
  - Reduced motion makes all of this instant.
- Section nav labels are 15px with 16px side padding (12px on phones, so all four fit at 375px); the row wraps on anything narrower.
- **Tag filter row**:
  - "All" first (active when no tag is chosen), then the chosen tags (inverse, with a remove ×), then up to 12 tags by how many listed items carry them, each with its count.
  - "+N more" opens a searchable popover grouped by tag kind.
  - The row hides when nothing on screen has tags.
- A "From <source>" chip (inverse pill with a clear button) sits in the filter row while the list is narrowed to one source.
- An optional count follows the label at 70% opacity, `tabular-nums`.
- Rows wrap onto new lines; never scroll a pill row horizontally.

### Search field — `components/app-shell.tsx` (`SearchField`)

The top-bar search, which also opens the ⌘K palette.

- 44px tall, `radius-pill`, `surface` fill, no border, up to 560px wide, centred in the top bar (its own row below 1024px).
- Leading search icon and placeholder in `ink-muted`; typed text `ink`; trailing `⌘K` button in `ink-subtle` (`mono`).
- On library pages typing filters the grid (debounced 200ms, kept in the `?q=` URL param); elsewhere Enter jumps to `/?q=…`. `/` focuses it from anywhere.
- Focus: 2px `accent-text` outline, 3px offset.

### Resource card — `components/resource-card.tsx` (`ResourceCard`)

A visual resource (reference, library, image, icon, animation, palette): the screenshot does the talking.

- A 16:10 frame, `radius-card`, `surface` behind the image (`object-fit: cover; object-position: top`). No border, no shadow, no hover lift.
- Under it, 12px apart: title (`title`, `ink`, one line) and meta `host · first tag` (`meta`, `ink-subtle`).
- Hover reveals round `surface-raised` action buttons (open source, copy) in the frame's top-right and the select checkbox top-left.
- Selected: 2px `accent-text` outline with 3px offset on the frame; the checkbox turns `inverse`.
- Capturing: a pulsing frame with "Capturing…" in `ink-muted`. Failed capture: an image-off icon in `ink-subtle`.
- **References scroll** (`ScrollShot`), like a screen recording:
  - The frame shows the full-page screenshot's scroll preview, resting on the top of the page, instead of the cropped thumbnail.
  - On hover or keyboard focus it scrolls linearly to the bottom at about one frame-height per second (1.5–30s, from the image's aspect ratio), and glides back in 500ms ease-out on leave.
  - The frame is a size container, so the travel is `translateY(calc(-100% + 100cqh))`.
  - Pages shorter than the frame don't move. With reduced motion the card stays still.
- The caller provides the resource DTO, `selected`, `selecting` and `onToggle`, and may replace the meta line.

### Note card — `components/resource-card.tsx` (`ResourceCard`, text types)

A text resource (prompt, skill, snippet, rule, checklist, MCP config), shaped like a resource card so both share one grid.

- Same 16:10 `surface` frame, padded 24px; hover `surface-raised`.
- Prompts, rules, checklists and skills show an excerpt as a `title-lg` quote in `ink` (frontmatter and markdown syntax stripped; skills show their description). Snippets and MCP JSON show the first lines in `mono`, `ink-muted`.
- A type chip at the bottom-left: `surface-raised`, `radius-pill`, `ink-secondary`.
- Under the frame: title, then `Type · purpose` in `ink-subtle`. Skills show their invocation instead (`/name`, plus `· plugin` for plugin skills).

### List row — `components/resource-card.tsx` (`ResourceRow`)

The list-view alternative to cards.

- 64px row, `radius-card`, transparent; hover and selected `surface`, selected adds the `accent-text` outline.
- 64×40 thumbnail (`radius` 8px), title + meta, date in `mono`, actions and a round checkbox on hover.

### Selection bar — `components/selection-bar.tsx`

Appears at the bottom centre while resources are selected.

- `surface-raised`, radius 28px, `shadow-overlay`; wraps on narrow screens.
- Count in `mono` / `ink-subtle`, then `ghost` actions: Copy context, Export, Collection, Remove (in a collection), Trash; in Trash: Restore and Delete forever (`danger`, confirmed in a dialog).

### Top bar — `components/app-shell.tsx` (`TopBar`)

- Logo (archive glyph in `canvas` on an `ink` disc + "PIVOT" in Geist 500), the section nav, search field, then Collections menu, Trash and Settings round buttons (`inverse` when on that page), theme toggle, and the split `Add` button (the screen's primary action).
- On phones the Collections button is icon-only so the action row fits; the search field drops to its own row.
- No sidebar anywhere. Sections are in the top bar; a section's types are in the Type select.

### Breadcrumbs — `components/breadcrumbs.tsx`

- A row of 14px `ink-subtle` links separated by 14px chevrons; the last crumb (the current page) is `ink-secondary` and not a link. It truncates rather than wraps a long title.
- Shown only when there are two or more steps: above the page title on a type page (Section › Type) and in a collection (Collections › Name), and beside the back button on a resource page (Section › Type › Title).

### Page header — `components/library-view.tsx`

- `display` title (72px, clamps down to 44px on narrow screens), a `meta`-sized count line in `ink-muted` ("24 saved · 6 this week"), and optional actions aligned right (collections: Copy context, Export, Delete).
- Then the tag filter row, then a row with the Type select (when the section has more than one type) and the "From …" chip on the left, sort select and grid/list toggle on the right.
- The title is the section name, or the type's plural when one is chosen.
- A section's landing page (no type chosen) shows a folder shelf above the grid: one glass folder per type, the type's items as sheets (cover thumbnails when they have one), with 40px before the grid.
- Grid: `repeat(auto-fill, minmax(min(100%, 360px), 1fr))`, 40px between rows, 24px between columns.

### Skill pack group — `components/skill-pack-groups.tsx`

The Skills page groups cards by pack (a GitHub repo, a Claude Code plugin, or an author) instead of one long grid.

- Header: a chevron toggle and the pack name in `title-lg` (22px, `ink`), then `author · kind · N skills` in `ink-subtle`. Website and Repository links on the right are small `surface` pills (32px, 13px label).
- The pack description follows in `ink-muted` at a 3xl measure.
- Under the header sits the normal card grid or list. Groups are 64px apart; the header is 24px above its cards.
- Collapsing a group hides its cards; the toggle carries `aria-expanded`/`aria-controls`.

### Folder shelf — `components/folder-shelf.tsx` (`FolderShelf`), `components/ui/glass-folder-cards.tsx`

The top of the Skills and Sources pages shows a row of glass folders as a visual index above the grouped sections. Skills get one folder per pack, with a paper sheet per skill. Sources get one folder per category, with each source's screenshot as its sheet (a paper sheet until the screenshot exists).

- Each folder (300px wide) has generated liquid art on its back panel, picked from the folder id so it always keeps its look. At most four sheets are visible. A frosted front panel carries the name and `N skills` / `N sources` in `mono`. The folder follows its list in place (a screenshot arriving swaps the sheet), so it never replays its entrance.
- Shelf folders open on hover (`openOn="hover"`): hovering, or focusing with the keyboard, opens the folder and fans its sheets out in place of the old lean. Leaving closes it. Choosing a sheet opens that resource.
- Clicking the folder itself goes to its page: a type folder to `/?type=…`, a source category to `/?type=source&category=…`. A skill pack, which has no page, scrolls to its section. On touch screens a tap goes straight there.
- The `···` key only appears when a folder has extra actions (skill packs: Open repository, Open website). The component's default `click` mode (click to open and close, hover leans) is unchanged for other uses.
- Tone follows the theme: smoked glass in dark mode, milk glass in light mode. Folders assemble on first view, staggered 90ms each. Reduced motion turns every transition off.
- **Deliberate exception:** the folder is drawn as an object, so it keeps its own soft shadow, glass rim and the component's system font. The no-shadow and no-border rules still apply to cards.

### Sources page — `components/source-groups.tsx` (`SourceToolbar`, `SourceGroups`, `SourceInfo`), `components/bookmark-import-dialog.tsx`

- **Toolbar** (`surface` panel, top of the Sources tab): a 40px search field and an "Import bookmarks" secondary pill. With a query typed, one row per category appears: the category label in `ink-subtle`, then a `surface-raised` pill per searchable source. Each pill is a link to that site's results, and it inverts on hover.
- **Groups**: one section per category in a fixed order (Inspiration → Assets, then Uncategorized). Each section has a `title-lg` heading plus the hint and count in `ink-subtle`, then a grid of normal resource cards (300px minimum column). The card meta line reads `host · N saved · searchable`.
- **Source info** (detail aside): a `surface` panel. The top row "Saved from this source · N →" links to the filtered library. Below it is a small search form when the search URL has `{q}`, otherwise a hint.
- **Import dialog** (max 3xl), in two steps:
  1. A file picker drawn as a `surface` drop panel.
  2. A review list: Suggested/All pill tabs, a filter field, and one row per bookmark with a checkbox, title, mono URL and folder path, a Source/Reference select and a category select.
  - Already-saved rows are dimmed to 50% and locked.
  - The footer holds the screenshot checkbox and the single primary "Import N" button.

### Skill guide — `components/skill-guide.tsx` (`SkillGuide`, `PackField`)

The "How to use" block on a skill's detail page, between the skill bar and the content.

- A `surface` panel with `radius-card`. Header: the title, the invocation as a `mono` chip that copies on click, then Source and Edit guide as ghost pills.
- Usage renders as Markdown. Examples are `mono` rows on `surface-raised`, and each row copies its prompt.
- Edit mode swaps these for an Invocation input, a Usage textarea and an Examples textarea (one per line).
- `PackField` in the aside is a Select listing "Detected · <pack>" first, then every pack.
- Plugin skills replace the skill bar with a "Plugin skill · read-only" note, and their content shows as a preview only.

### Dialogs, popovers, menus — `components/ui/dialog.tsx`, `alert-dialog.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `select.tsx`, `command.tsx`

- `surface-raised` (`--popover`) background, `radius-card`, `shadow-overlay`, a 5% ink ring. Dialog footers are separated by a `divider` line.
- Inputs inside are filled pills; the ⌘K palette input is a 40px `surface` pill.

### Form fields — `components/ui/input.tsx`, `textarea.tsx`

- Single-line inputs: 36px `surface` pills, no border, hover/focus `surface-raised`, focus outline `accent-text`.
- Textareas and the content editor: `radius-card`, same fill. Labels above fields in `xs` / `ink-subtle`.

## Tokens

### Color

| Token            | Dark      | Light     | Usage                                                                                                               |
| ---------------- | --------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `canvas`         | `#050505` | `#ffffff` | Page background behind everything. Sections are separated by empty canvas, never by lines.                          |
| `surface`        | `#151515` | `#f2f2f2` | Thumbnail frames, note cards, search field, inactive pills and buttons.                                             |
| `surface-raised` | `#1e1e1e` | `#e6e6e6` | Hover state of surface, chips that sit on a surface, inputs inside cards, popovers.                                 |
| `divider`        | `#2f2f2f` | `#dcdcdc` | Rare structural lines: dialog footers, table rows. Not for cards or section breaks.                                 |
| `ink`            | `#fdfdfd` | `#0a0a0a` | Headings, card titles, primary text on canvas, surface and surface-raised.                                          |
| `ink-secondary`  | `#d4d4d4` | `#2e2e2e` | Inactive pill labels, button labels on surface, body copy that should recede a step.                                |
| `ink-muted`      | `#a3a3a3` | `#545454` | Helper text, placeholders, icons on canvas, surface and surface-raised.                                             |
| `ink-subtle`     | `#8a8a8a` | `#636363` | Metadata: hosts, counts, timestamps, shortcut hints. Reads 4.8:1 or better on canvas, surface and surface-raised.   |
| `inverse`        | `#fdfdfd` | `#0a0a0a` | Fill of the active pill (current section or chosen tag).                                                            |
| `on-inverse`     | `#050505` | `#ffffff` | Label on an inverse fill.                                                                                           |
| `accent`         | `#1500ff` | `#1500ff` | Electric indigo. Fill of the single primary action per screen (Add, Save, Export). Never text, icons or decoration. |
| `on-accent`      | `#ffffff` | `#ffffff` | Label on an accent fill (8.5:1).                                                                                    |
| `accent-text`    | `#8b84ff` | `#1500ff` | Links, the focus ring and the selected-card outline, on canvas, surface and surface-raised.                         |
| `danger`         | `#ff7a7a` | `#c21f1f` | Destructive labels and error text (Delete forever, failed capture). Always paired with a word or icon.              |
| `success`        | `#4cc38a` | `#17703d` | Saved / in sync states. Same lightness as danger, so always pair with a word or icon.                               |
| `warning`        | `#f5b33f` | `#8a5600` | Duplicate URL and unsaved-skill notices, with an icon.                                                              |

`shadow-overlay` is the only shadow (dialogs, popovers, selection bar).

### Type

Families: `--font-sans` Geist, `--font-mono` Geist Mono (loaded with `next/font`).

| Style      | Size / line-height · weight  | Usage                                                |
| ---------- | ---------------------------- | ---------------------------------------------------- |
| `display`  | 72px / 0.96 · 500 · -0.045em | The page title of a library view. One per screen.    |
| `title-lg` | 22px / 1.2 · 500 · -0.02em   | The quote inside a note card; dialog titles.         |
| `title`    | 16px / 1.4 · 500             | Card titles, list row titles.                        |
| `body`     | 15px / 1.5 · 400             | Notes, descriptions, form fields, markdown previews. |
| `label`    | 14px / 1.2 · 500             | Pills, buttons, tabs (13px in `sm` controls).        |
| `meta`     | 14px / 1.4 · 400             | Host and tag line under a card title, in ink-subtle. |
| `mono`     | 12–13px / 1.6 · 400          | Prompt and code previews, keyboard hints, counts.    |

### Spacing & radius

Spacing: `space-1` 4px · `space-2` 8px · `space-3` 12px · `space-4` 16px · `space-6` 24px · `space-10` 40px · `space-16` 64px

Radius: `radius-sm` 6px · `radius-card` 14px · `radius-pill` 9999px

## Implementation notes

- shadcn/ui variables (`--background`, `--card`, `--primary`…) are mapped onto these tokens in `globals.css`; prefer the design-system names in new code.
- Buttons (`components/ui/button.tsx`): `default` = the single indigo primary action, `secondary` = surface pill, `ghost`, `destructive`. All pills.
- Inputs are filled `surface` pills; textareas use `radius-card`. Focus is a 2px `accent-text` outline with 3px offset everywhere.
- Contrast: every text token is ≥ 4.5:1 on `canvas`, `surface` and `surface-raised` in both themes (checked when the palette was chosen).
