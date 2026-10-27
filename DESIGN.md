# Stan Bag — Design system

Source of truth for the app (`apps/web`) and the extension (`apps/extension`). Tokens live as CSS variables in
[`apps/web/src/app/globals.css`](apps/web/src/app/globals.css) and are exposed to Tailwind as `bg-surface`, `text-ink-subtle`, `outline-accent-text`…
The browsable version with component previews: [Stan Bag Design System](https://claude.ai/artifact/6NEyzcYbPGtnjScMY33Lfd) (private).

Direction: **Savee** (from [Refero Styles](https://styles.refero.design/style/c6d8490d-e3f2-45c8-aebf-fe5f11daf116)) — mockup option 3.

Stan Bag is a personal library of UI references, assets, prompts and Claude Code skills. The interface is a black canvas: saved screenshots carry the color, the chrome stays out of the way. One electric-indigo button per screen marks the action that matters.

## Content fundamentals

- Write in English, sentence case, from the user's side: "Add", "Copy context", "Export", "Move to trash". Never "Submit" or "OK".
- Buttons name the action; toasts confirm it in past tense: "Copy context" → "Context copied · ~1.9k tokens".
- Name things the way the user saved them. A resource's title is what the site calls itself ("Linear — Issues board"); the meta line is `host · tag` ("linear.app · Dashboard").
- Errors say what happened and what to do: "Stan Bag isn't running. Start it with `npm start`."
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
- This is an app, so body text is 14px, smaller than Savee's marketing pages. Never go below 12px.

## Layout

- No sidebar. A top bar holds the logo, the search field (centered, up to 560px) and the account pills; the primary `Add` button sits at its right end.
- Under it: the `display` page title with a `meta` count line, then a wrapping row of type pills (All, References, UI Libraries, … MCP).
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
- The Stan Bag mark is the archive glyph in `canvas` on an `ink` disc. There is no other logo; set the name in Geist 500.

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

### Pill (type tabs, filters, tags) — `components/library-view.tsx` (`TypeTabs`), `components/filter-bar.tsx`, `components/tags-editor.tsx`

One shape, two states.

- Inactive: `surface` fill, `ink-secondary` label; hover `surface-raised`.
- Active: `inverse` fill, `on-inverse` label. Exactly one active pill in the type-tab row; filters may have several.
- Heights: 36px type tabs, 30px filters, 28px editable tags, 24px tags inside a card.
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
- The caller provides the resource DTO, `selected`, `selecting` and `onToggle`.

### Note card — `components/resource-card.tsx` (`ResourceCard`, text types)

A text resource (prompt, skill, snippet, rule, checklist, MCP config), shaped like a resource card so both share one grid.

- Same 16:10 `surface` frame, padded 24px; hover `surface-raised`.
- Prompts, rules, checklists and skills show an excerpt as a `title-lg` quote in `ink` (frontmatter and markdown syntax stripped; skills show their description). Snippets and MCP JSON show the first lines in `mono`, `ink-muted`.
- A type chip at the bottom-left: `surface-raised`, `radius-pill`, `ink-secondary`.
- Under the frame: title, then `Type · purpose` (or *When to use* for skills) in `ink-subtle`.

### List row — `components/resource-card.tsx` (`ResourceRow`)

The list-view alternative to cards.

- 64px row, `radius-card`, transparent; hover and selected `surface`, selected adds the `accent-text` outline.
- 64×40 thumbnail (`radius` 8px), title + meta, date in `mono`, actions and a round checkbox on hover.

### Selection bar — `components/selection-bar.tsx`

Appears at the bottom centre while resources are selected.

- `surface-raised`, radius 28px, `shadow-overlay`; wraps on narrow screens.
- Count in `mono` / `ink-subtle`, then `ghost` actions: Copy context, Export, Collection, Remove (in a collection), Trash; in Trash: Restore and Delete forever (`danger`, confirmed in a dialog).

### Top bar — `components/app-shell.tsx` (`TopBar`)

- Logo (archive glyph in `canvas` on an `ink` disc + "Stan Bag" in Geist 500), search field, then Collections menu, Trash and Settings round buttons (`inverse` when on that page), theme toggle, and the split `Add` button (the screen's primary action).
- No sidebar anywhere; navigation between types happens through the type pills under the page title.

### Page header — `components/library-view.tsx`

- `display` title (72px, clamps down to 44px on narrow screens), a `meta`-sized count line in `ink-muted` ("24 saved · 6 this week"), and optional actions aligned right (collections: Copy context, Export, Delete).
- Then the type pills, then facet filter pills with sort select and grid/list toggle on the right.
- Grid: `repeat(auto-fill, minmax(min(100%, 360px), 1fr))`, 40px between rows, 24px between columns.

### Dialogs, popovers, menus — `components/ui/dialog.tsx`, `alert-dialog.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `select.tsx`, `command.tsx`

- `surface-raised` (`--popover`) background, `radius-card`, `shadow-overlay`, a 5% ink ring. Dialog footers are separated by a `divider` line.
- Inputs inside are filled pills; the ⌘K palette input is a 40px `surface` pill.

### Form fields — `components/ui/input.tsx`, `textarea.tsx`

- Single-line inputs: 36px `surface` pills, no border, hover/focus `surface-raised`, focus outline `accent-text`.
- Textareas and the content editor: `radius-card`, same fill. Labels above fields in `xs` / `ink-subtle`.

## Tokens

### Color

| Token | Dark | Light | Usage |
|---|---|---|---|
| `canvas` | `#050505` | `#ffffff` | Page background behind everything. Sections are separated by empty canvas, never by lines. |
| `surface` | `#151515` | `#f2f2f2` | Thumbnail frames, note cards, search field, inactive pills and buttons. |
| `surface-raised` | `#1e1e1e` | `#e6e6e6` | Hover state of surface, chips that sit on a surface, inputs inside cards, popovers. |
| `divider` | `#2f2f2f` | `#dcdcdc` | Rare structural lines: dialog footers, table rows. Not for cards or section breaks. |
| `ink` | `#fdfdfd` | `#0a0a0a` | Headings, card titles, primary text on canvas, surface and surface-raised. |
| `ink-secondary` | `#d4d4d4` | `#2e2e2e` | Inactive pill labels, button labels on surface, body copy that should recede a step. |
| `ink-muted` | `#a3a3a3` | `#545454` | Helper text, placeholders, icons on canvas, surface and surface-raised. |
| `ink-subtle` | `#8a8a8a` | `#636363` | Metadata: hosts, counts, timestamps, shortcut hints. Reads 4.8:1 or better on canvas, surface and surface-raised. |
| `inverse` | `#fdfdfd` | `#0a0a0a` | Fill of the active pill (current type tab or filter). |
| `on-inverse` | `#050505` | `#ffffff` | Label on an inverse fill. |
| `accent` | `#1500ff` | `#1500ff` | Electric indigo. Fill of the single primary action per screen (Add, Save, Export). Never text, icons or decoration. |
| `on-accent` | `#ffffff` | `#ffffff` | Label on an accent fill (8.5:1). |
| `accent-text` | `#8b84ff` | `#1500ff` | Links, the focus ring and the selected-card outline, on canvas, surface and surface-raised. |
| `danger` | `#ff7a7a` | `#c21f1f` | Destructive labels and error text (Delete forever, failed capture). Always paired with a word or icon. |
| `success` | `#4cc38a` | `#17703d` | Saved / in sync states. Same lightness as danger, so always pair with a word or icon. |
| `warning` | `#f5b33f` | `#8a5600` | Duplicate URL and unsaved-skill notices, with an icon. |

`shadow-overlay` is the only shadow (dialogs, popovers, selection bar).

### Type

Families: `--font-sans` Geist, `--font-mono` Geist Mono (loaded with `next/font`).

| Style | Size / line-height · weight | Usage |
|---|---|---|
| `display` | 72px / 0.96 · 500 · -0.045em | The page title of a library view. One per screen. |
| `title-lg` | 22px / 1.2 · 500 · -0.02em | The quote inside a note card; dialog titles. |
| `title` | 15px / 1.4 · 500 | Card titles, list row titles. |
| `body` | 14px / 1.5 · 400 | Notes, descriptions, form fields. |
| `label` | 13px / 1.2 · 500 | Pills, buttons, tabs. |
| `meta` | 13px / 1.4 · 400 | Host and tag line under a card title, in ink-subtle. |
| `mono` | 12px / 1.6 · 400 | Prompt and code previews, keyboard hints, counts. |

### Spacing & radius

Spacing: `space-1` 4px · `space-2` 8px · `space-3` 12px · `space-4` 16px · `space-6` 24px · `space-10` 40px · `space-16` 64px

Radius: `radius-sm` 6px · `radius-card` 14px · `radius-pill` 9999px

## Implementation notes

- shadcn/ui variables (`--background`, `--card`, `--primary`…) are mapped onto these tokens in `globals.css`; prefer the design-system names in new code.
- Buttons (`components/ui/button.tsx`): `default` = the single indigo primary action, `secondary` = surface pill, `ghost`, `destructive`. All pills.
- Inputs are filled `surface` pills; textareas use `radius-card`. Focus is a 2px `accent-text` outline with 3px offset everywhere.
- Contrast: every text token is ≥ 4.5:1 on `canvas`, `surface` and `surface-raised` in both themes (checked when the palette was chosen).
