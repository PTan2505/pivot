---
name: PIVOT
description: A personal library of UI references, assets, prompts and skills; ember light and frosted glass on a warm black kiln.
colors:
  canvas: "#0c0806"
  surface: "#18110d"
  surface-raised: "#221812"
  divider: "#33251c"
  ink: "#fbf3ea"
  ink-secondary: "#e0d3c7"
  ink-muted: "#b8a596"
  ink-subtle: "#94806f"
  inverse: "#fbf3ea"
  on-inverse: "#0c0806"
  accent-fill: "#ff6a13"
  on-accent: "#0c0806"
  accent-text: "#ff8c42"
  danger: "#ff6b81"
  success: "#5ad19a"
  warning: "#ffc24a"
  ember-core: "#ffb347"
  ember: "#ff6a13"
  ember-deep: "#b8260b"
  glass: "rgb(34 24 18 / 0.65)"
  glass-strong: "rgb(34 24 18 / 0.86)"
  glass-edge: "rgb(255 238 222 / 0.1)"
typography:
  display:
    fontFamily: "Geist, sans-serif"
    fontSize: "72px"
    fontWeight: 500
    lineHeight: 0.96
    letterSpacing: "-0.045em"
  title-lg:
    fontFamily: "Geist, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.2
  meta:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "Geist Mono, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "6px"
  md: "10px"
  card: "14px"
  glass-card: "18px"
  frame: "11px"
  panel: "20px"
  bar: "28px"
  pill: "9999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-6: "24px"
  space-10: "40px"
  space-16: "64px"
components:
  button-primary:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
  button-ghost:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  button-destructive:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
    height: "36px"
  pill-idle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  pill-active:
    backgroundColor: "{colors.inverse}"
    textColor: "{colors.on-inverse}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  nav-pill-idle:
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  search-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "44px"
    width: "560px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "4px 16px"
    height: "36px"
  glass-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.glass-card}"
    padding: "8px 8px 14px"
  card-frame:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.frame}"
  overlay:
    backgroundColor: "{colors.glass-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  selection-bar:
    backgroundColor: "{colors.glass-strong}"
    rounded: "{rounded.bar}"
    padding: "6px 6px 6px 16px"
---

# Design System: PIVOT

Tokens are CSS variables in `apps/web/src/app/globals.css` (`:root`), exposed to Tailwind as `bg-surface`, `text-ink-subtle`, `outline-accent-text`…; the extension (`apps/extension/src/styles.css`) declares the same values. The shadcn/ui variables (`--background`, `--card`, `--primary`…) are mapped onto these tokens; prefer the design-system names in new code. Extended tokens (shadows, motion, breakpoints, component snippets) live in `.impeccable/design.json`.

## Overview

**Creative North Star: "The Kiln"**

The saved work is the light source. The chrome is a dark kiln that screenshots glow out of: a warm black ground with oxblood-brown surface steps, warm white ink, and orange light pooled behind frosted glass at the top of the screen. It refuses the category default of a neutral grey gallery with one blue accent. Saved screenshots keep their true colour because nothing tinted or translucent ever sits on them; where glass meets the work (the record cards), it sits behind the picture, never over it.

The interface is dense and quiet. There is no sidebar; one top bar carries the sections, the search and the single primary action, and everything below it is the work. Hierarchy comes from surface steps, not lines or shadows. Two materials exist: solid surfaces for the work itself and the page around it, and frosted warm glass for the chrome, the things that float over the work (menus, dialogs, toasts, the selection bar), and, by the owner's call, the folders and the record cards that hold the work. The ember lives in the top bar; on a card it is a faint highlight and, on hover, an edge.

PIVOT is dark only, in the app and the extension. There is no light theme and no theme toggle; `color-scheme: dark` is set on the root and the theme provider forces `dark`.

**Key Characteristics:**

- Warm black canvas, surfaces stepped in oxblood brown, warm white ink.
- One ember-orange filled button per screen; everything else is a quiet surface pill.
- Frosted glass on chrome and overlays, plus the folders and record cards (owner exceptions); the screenshot inside a card is never covered.
- Ember light pooled in the top bar and a glowing seam along its lower edge; on cards only a faint highlight and a hover edge, measured so caption text keeps 4.5:1.
- Binary radius: pills for controls, 14px for containers.
- Geist at 400 and 500 only; one display title per view.

## Colors

A warm, near-monochrome brown-black ramp with a single orange voice and three status hues.

### Primary

- **Ember Orange** (accent-fill): the fill of the one primary action per screen (Add / New, Save, Create, Import N), always with **Kiln Black** text (on-accent, 6.95:1). White on this orange is 2.87:1 and is never used.
- **Amber Signal** (accent-text): links, the focus ring, the selected-card outline, the text caret. Reads 7.52:1 or better on every solid surface and 4.92:1 on strong glass over a white screenshot.

### Tertiary (ember light)

- **Ember Core** (ember-core), **Ember** (ember), **Ember Deep** (ember-deep): the three stops of the light in the top bar (amber core, orange body, deep-red falloff). They are light, not paint: used in the top bar's pool and seam, the record card's highlight (ember at 16%) and hover edge, the text selection highlight (ember at 45%) and native controls (`accent-color`). Never as a fill, text or icon colour.

### Neutral

- **Kiln Black** (canvas): the page behind everything; sections are separated by empty canvas, never by lines. Also the label colour on ember and inverse fills.
- **Oxblood Surface** (surface): thumbnail frames, note cards, the search field, inputs, inactive pills and buttons, option-tile backgrounds.
- **Raised Oxblood** (surface-raised): hover state of surface, chips that sit on a surface, inputs inside cards; the tint the glass is made from.
- **Scorched Seam** (divider): rare structural lines (dialog footers, table rows) and the scrollbar thumb. Not for cards or section breaks.
- **Warm White** (ink): headings, card titles, primary text; the only text colour allowed directly on the top bar's light glass. 15.83:1 or better on every solid surface.
- **Ash** (ink-secondary): inactive pill and button labels, the current breadcrumb, copy that recedes a step (11.85:1 or better).
- **Smoke** (ink-muted): helper text, placeholders, icons, page notes beside the title, option blurbs (7.34:1 or better).
- **Cinder** (ink-subtle): metadata (hosts, counts, timestamps, shortcut hints). 4.62:1 at worst, on surface-raised.
- **Inverse / on-inverse**: the active pill (current section, chosen tag, current Trash or Settings page) is Warm White with Kiln Black text.

### Status

- **danger** (6.35:1 or better), **success** (9.13:1 or better), **warning** (10.82:1 or better): destructive labels and errors, saved / in-sync states, duplicate and unsaved notices. Always with a word or an icon; `success` and `danger` are never told apart by colour alone.

### Glass

- **Light glass** (glass, 65%): the top bar only.
- **Strong glass** (glass-strong, 86%): menus, popovers, selects, the section panel, dialogs, the command palette, toasts, the selection bar.
- **Glass edge** (glass-edge): the 1px rim of both.
- **Card glass** (record cards, owner exception, 2026-10-30): the folder's recipe on a tile. See Resource card.

Contrast on glass is measured against the worst backdrop, a white screenshot blurred behind it. On strong glass: ink 10.36:1, ink-secondary 7.76:1, ink-muted 4.80:1, accent-text 4.92:1; ink-subtle would fall to 3.02:1. On light glass only ink holds (4.92:1 over white, 17.20:1 over black).

### Named Rules

**The One Ember Rule.** Exactly one ember-orange filled button per screen, with dark text. Orange never appears as a link, icon, hover state, badge or decoration; links and focus use Amber Signal. The one exception is the brand mark's P (see Brand mark), which is part of the logo, not the interface.

**The Glass Promotion Rule.** Glass raises its faint inks so nothing drops below 4.5:1 over a white screenshot: inside light glass, ink-secondary, ink-muted and ink-subtle all resolve to ink; inside strong glass, ink-subtle resolves to ink-muted. Text sitting directly on the top bar is ink.

**The 4.5 Floor Rule.** Every text token reads at least 4.5:1 on canvas, surface and surface-raised, and on glass in the worst case. Check any new colour against all three surfaces and the glass composite before adding it.

## Typography

**Display Font:** Geist (via `next/font`, `--font-sans`)
**Body Font:** Geist
**Label/Mono Font:** Geist Mono (`--font-mono`) for prompt and code previews, keyboard hints and counts

**Character:** One neutral grotesque carries everything; scale and the single display title do the work, weight barely moves.

### Hierarchy

- **Display** (500, 72px clamping down to 44px via `clamp(44px, 6vw, 72px)`, 0.96, -0.045em): the page title of a library view. One per screen, the only large type.
- **Title-lg** (500, 22px, 1.2, -0.02em): the quote inside a note card, skill-pack headings, dialog titles.
- **Title** (500, 16px, 1.4): card titles, list row titles, empty-state headings.
- **Body** (400, 15px, 1.5): set on `body`; notes, descriptions, form fields, Markdown previews, the search input.
- **Label** (500, 14px): pills, buttons, tabs (13px in `sm` controls). Section-nav labels are 15px.
- **Meta** (400, 14px, 1.4): the host line under a card title (ink-muted on the card's glass) and breadcrumbs (ink-subtle). The count beside the display title is a badge: a 32px surface pill with the number in 14px mono ink-secondary.
- **Mono** (400, 12–13px, 1.6): code and prompt previews, keyboard hints, counts (`tabular-nums`).

The extension popup runs at a 13px body with the same families.

### Named Rules

**The Two Weights Rule.** Weights are 400 and 500 only. No 600+ anywhere.

**The 16px Root Rule.** The root stays at the browser's 16px. Never set `font-size` on `html`: every rem-based size (control heights, spacing, `text-xs`/`text-sm`) is measured from it; body text is raised to 15px on `body` instead. Never go below 12px.

## Layout

- **No sidebar.** A single top bar holds the logo, the section nav (Library · Knowledge · Sources · Skills), the search field (up to 560px, centred) and the action pills, with the primary `Add` at its right end. Between `md` and `lg` it wraps to two rows; below `lg` the search drops to its own row.
- **Pinned bar.** From `md` (48rem) up the top bar is fixed to the top edge across the full width. The app shell measures its height live (a ResizeObserver writes `--topbar-h`, 76px until measured) and `main` is padded by it, so the page itself scrolls and the work passes under the glass. `html` has `overscroll-behavior-y: none` so the bar never rubber-bands. On phones the bar stays in the flow, because its several rows would take too much of the screen.
- **Scroll targets** that jump to a section (skill packs, source categories) use `scroll-margin-top: calc(var(--topbar-h) + 1rem)` from `md`, 32px below it.
- **Page head:** the display title with its count badge, then the tag pill row, then the source chip and, while a search, tag or source filter is on, a ghost **Clear filters** button (× icon) on the left, and Sort (Recently edited, Newest first, Oldest first, Title A–Z) / grid-list toggle on the right (a Type select on the left only in collections and the trash).
- **Empty and no-match states** (centred, 96px of canvas above): an empty type page says "Nothing in <page> yet" with the paste hint; a search or filter with no results says "Nothing matches “<search>”" (or "these filters"), explains that search and filters apply together when both are on, and offers a secondary **Clear filters** pill.
- **Grid:** `repeat(auto-fill, minmax(min(100%, 360px), 1fr))`, 40px between rows, 24px between columns. Thumbnails are 16:10.
- **Gutters and rhythm:** page side gutter 40px on desktop, 16px on phones. Groups are separated by 64px of empty canvas; a group header sits 24px above its cards; the folder shelf sits 40px above the grid.
- Rows of pills wrap onto new lines; a pill row never scrolls horizontally.

## Elevation & Depth

Solid surfaces are flat: depth on the page comes from tonal steps (canvas → surface → surface-raised), never shadows or borders. Depth above the page is glass. Both glass grades blur and saturate what is behind them (`blur(24px) saturate(1.5)`), carry a 1px glass-edge border and a faint inset top sheen; strong glass adds the overlay shadow. Glass lives in the Tailwind components layer so utilities can override it (the top bar's glass drops its side and top borders).

The top bar's glass is a sibling layer behind its content, not the header itself: an element with `backdrop-filter` becomes the backdrop root of its children, and the section menu rendered inside the header would only blur the bar instead of the page.

Modal scrims are black at 50% (dialogs) or 55% (alert dialogs) with a light blur.

### Shadow Vocabulary

- **Overlay** (`0 24px 64px rgb(0 0 0 / 0.6), 0 2px 8px rgb(0 0 0 / 0.35)`): strong glass only (menus, popovers, the section panel, dialogs, the palette, toasts, the selection bar).
- **Glass sheen** (`inset 0 1px 0 rgb(255 248 240 / 0.07)`): the inner top highlight on both glass grades.

### The ember light

The signature: ember light caught in the glass top bar, like orange light through the gaps between dark tiles.

- **Pool:** a radial glow behind the solid search field, layered amber core → orange → deep red. On phones it is kept low and wide to the search row so it never sits under the nav; from `md` it is a tall, narrow pool centred under the field.
- **Seam:** a 2px line of light along the bar's bottom edge (deep red at the ends, amber at the centre), blooming 12px upward into the bar's empty bottom padding, faded out at both ends by a horizontal mask.

### Named Rules

**The Solid Work Rule.** Glass is for chrome and overlays. The saved work itself (screenshots, frames, rows, panels on the page) is solid, with no border and no shadow, so screenshots keep their true colour. Two owner exceptions wrap the work in glass without covering it: the folder shelf and the record card, whose glass sits behind the screenshot.

**The Light Stays Home Rule.** Ember light never sits under page text. It lives in the top bar's pool and seam; any glow bright enough to see drops small grey text below 4.5:1. The record card's highlight is the measured exception: 16% ember on a tint that deepens toward the caption, and caption text stays ≥ 5.1:1 with a white screenshot behind and the highlight at full strength.

## Shapes

The radius is binary: every control is a full pill, every container a gently rounded 14px card (cards, dialogs, popovers, menus, selects, textareas, toasts). Small steps exist only for parts inside those: 6px for keyboard hints and inline code, 8px for list-row thumbnails, 10px for option icon tiles, 12px for option rows. Two floating chrome pieces are rounder: the section panel (20px) and the selection bar (28px). Round (circular) buttons are the icon variants of the pill. Borders appear only as the glass edge and the rare divider.

## Components

Paths are under `apps/web/src/` unless written out.

### Buttons — `components/ui/button.tsx`

Pill-shaped, quiet by default.

- **Primary (`default`):** ember fill, Kiln Black label; hover drops to 90% opacity. The one primary action on the screen.
- **Secondary (`secondary`, `outline`):** surface fill, ink-secondary label; hover and open state surface-raised with ink. There are no outline-only buttons.
- **Ghost:** transparent, ink-secondary; hover surface. For actions inside a glass container (selection bar, menus).
- **Destructive:** surface fill, danger label, always with an explicit verb or icon ("Delete forever").
- **Link:** accent-text, underline on hover.
- **Sizes:** `lg` 40px (top bar), `default` 36px, `sm` 32px with a 13px label, `xs` 24px; `icon*` variants are round at the same heights.
- **Focus:** 2px accent-text outline, 3px offset (on every interactive element). Disabled: 40% opacity, no pointer. Transitions 150ms ease-out.

### Icons

Lucide stroke icons at 16px, coloured ink-muted or the label colour inside a button. Icons sit beside a word; icon-only buttons carry an `aria-label`.

### Brand mark — `components/brand.tsx` (`PivotMark`, `PivotWordmark`), `docs/brand/`

PT is the core, PIVOT the expansion: the mark starts from the first and last letters, which turn about an axis and open out into the word.

- **Letterforms:** 34-unit strokes on a 136-unit cap height, drawn as SVG paths (never set in Geist). The P is two halves turned 180° on each other: the top bar rounds off at its top-right corner, the hook below rounds off at its bottom-right corner and carries the stem. Its counter is as tall as a stroke and open to the left. Stems end in a rounded bottom-right corner.
- **PT monogram** (`PivotMark`, 232 × 170): the T's bar sits in the P's counter and closes the bowl; the T's stem is set left of the bar's centre. It is the app icon, the favicon and the extension's mark.
- **PIVOT wordmark** (`PivotWordmark`, 586 × 136): the same P with a bridge closing the bowl, then I, V, a ring O and the T.
- **Colour:** the P is solid Ember (`--ember`, #ff6a13; 6.9:1 on canvas), everything else Warm White (`currentColor` on ink), in the monogram and the wordmark alike (owner's call, 2026-10-29). The ember O (amber core → ember → ember deep) and the ember seam belong to the app icon and splash or landing use only.
- **In the top bar:** the monogram at 22px high, then the wordmark at 13px high, 10px apart, inside the home link (`aria-label="PIVOT — library"`).
- **App icon** (`docs/brand/pivot-app-icon.svg`, copied to `apps/web/src/app/icon.svg`): the monogram (ember P, Warm White T) on a kiln tile (22% radius, a faint warm top light) with the ember seam along its bottom edge. The extension's toolbar PNGs are rendered from it (`pnpm --filter extension icons`).
- **Tagline** (brand use, not the UI): "Your creative compass" in Geist Mono 500, upper case, 0.62em tracking, Smoke. No ® until the name is registered.

### Top bar — `components/app-shell.tsx` (`TopBar`)

- Logo (PT monogram + wordmark, see Brand mark), section nav, search field, then the Collections menu, round Trash and Settings buttons (inverse when on that page) and the split `Add` button (the screen's primary action).
- Light glass layer behind the content, ember pool and seam (see Elevation & Depth); 16px padding, 40px side padding from `md`.
- On phones the Collections button is icon-only and the primary button reads just "New" (its full name stays in `aria-label`), so the action row fits at 375px; the search field takes its own row.

### Section nav — `components/section-nav.tsx`

- Idle labels are ink on the light glass with no fill (only ink holds 4.5:1 there); hover or open fills surface. The current section is an inverse pill. 36px tall, 15px labels, 16px side padding (12px on phones so all four fit at 375px); the row wraps on anything narrower.
- Sections with a panel (Library, Knowledge, Sources) end in a 14px chevron at 60% opacity that turns over (200ms) while open; phones hide it.
- **Panel:** opened by hovering Library, Knowledge or Sources, or pressing ↓ on them. Strong glass, 20px radius, 8px padding, two columns up to 600px wide (one column on phones). Each option is a 12px-radius row: a 40px surface icon tile, the plural name in 15px ink with its count in mono on the right, and a one-line blurb in 14px ink-muted. Hover or focus fills it with surface; the current option stays filled. Sources lists its seven categories (lightbulb, app-window, swatch-book, blocks, orbit, type, shapes icons). Clicking the section name goes to its landing page; there is no "All" option.
- **Motion** (modelled on lovable.dev): opening scales from 0.96 with a 4px drop and fades in (180ms); closing reverses (140ms, ease-in). Moving to another section glides the panel under it and resizes it to the new content (270ms, `cubic-bezier(.45,0,.25,1)`); the new content slides 32px in from the side the pointer came from, unblurring from 2px, while the old one leaves the other way. The first open appears in place. Reduced motion makes all of it instant.

### Pills and tag filter — `components/tag-pills.tsx`, `components/tags-editor.tsx`

- Inactive: surface, ink-secondary; hover surface-raised. Active: inverse. Heights: 36px filter pills and chips, 28px editable tags, 24px tags inside a card.
- The filter row: "All" first, then chosen tags (inverse, with a remove ×; a facet shows its kind first at 70% opacity, "Page type Pricing"), then up to 12 tags by frequency with counts at 70% opacity in `tabular-nums`; "+N more" opens a searchable popover grouped by kind. The row hides when nothing on screen has tags.
- The visible tags are grouped by kind, each group led by its kind in 13px ink-subtle (Tags, Page type, Domain, Style, Pattern, Technology); groups sit 20px apart, pills 8px apart. With plain tags only, the labels are left out.
- A "From <source>" chip (inverse pill, 13px, clear button) sits in the filter row while the list is narrowed to one source.

### Search field — `components/app-shell.tsx` (`SearchField`)

- 44px solid surface pill, no border, up to 560px, centred in the top bar; it is solid so the ember pool glows around it, not through it.
- Leading search icon and placeholder in ink-muted, typed text ink at 15px, trailing `⌘K` hint in mono ink-subtle (hidden on phones) that opens the command palette.
- Typing filters the library (debounced 200ms, kept in `?q=`); elsewhere Enter jumps to `/?q=…`. `/` focuses it from anywhere. Focus: the accent-text outline on the whole pill.

### Breadcrumbs — `components/breadcrumbs.tsx`

- 14px ink-subtle links separated by 14px chevrons at 70%; hover ink. The last crumb is ink-secondary and not a link; it truncates rather than wraps.
- Shown only with two or more steps: above the title on a type page (Section › Type) and in a collection, and beside the back button on a resource page.

### Resource card — `components/resource-card.tsx`

"Option A in glass", picked by the owner on 2026-10-30. The card is a tile of the folder's frosted glass that holds the picture and its caption; styles live in `globals.css` (`.glass-card`).

- **Tile:** 18px radius, 8px padding (14px at the bottom), base halfway between canvas and surface. Layers, back to front: a copy of the card's own thumbnail blurred 36px and saturated 1.5× at 50% (62% on hover), so each card takes a soft tint from its page; a dark tint that deepens toward the caption (25% → 62% at 46% → 92%); a 10% top sheen; a 16% ember highlight that follows the pointer; a 1px white rim, brightest at the top (42% → 12% → 5%).
- **Frame:** a 16:10 canvas frame at 11px radius inside the tile, image `object-fit: cover; object-position: top`. Nothing translucent sits on it: the glass is behind it. No hover lift or scale.
- **Caption** (inside the tile, 6px side inset): a 20px site icon tile (surface-raised, 6px radius; the host's favicon, its first letter when the site has none, the type icon when there is no URL), the title (title, ink, one line) and, at the end of that row, Open source and Copy as 28px round buttons (ink at 10%, ink icon) that appear on hover or focus. Then the host in meta (ink-muted), then up to three chips (24px, ink at 8%): facets first, each with its kind in ink-secondary regular before the name in ink medium ("Domain SaaS"), then plain tags, then a `+N` chip whose tooltip lists the rest. A linked card without tags shows its type as the chip.
- **Hover:** a 1.5px ember edge (amber core → ember → ember deep) traces the rim around the pointer, the blurred art drifts a few pixels against it, and the actions appear. Reduced motion keeps the art still.
- **Contrast:** inside the tile, ink-subtle resolves to ink-muted. Worst case (white screenshot behind, highlight at full strength): title ink ≥ 9.8:1, meta ink-muted ≥ 5.1:1, chip names ink ≥ 9.7:1 and kinds ink-secondary ≥ 7.3:1.
- **Select checkbox:** top-left of the frame on hover or focus, solid surface-raised with an ink-muted ring.
- **Selected and focus:** 2px accent-text outline with 3px offset around the tile.
- Capturing: a pulsing frame (1.6s) with "Capturing…" in ink-muted. Failed capture: an image-off icon in ink-subtle.
- **References scroll like a screen recording:** the frame shows the full-page shot resting at the top; on hover or keyboard focus it scrolls linearly to the bottom at about one frame-height per second (1.5–30s from the image's aspect ratio) and glides back in 500ms ease-out on leave. The frame is a size container, so the travel is `translateY(calc(-100% + 100cqh))`. Short pages don't move; reduced motion keeps it still.

### Screenshot gallery — `components/asset-gallery.tsx`

- The main preview, then a row of 56px thumbnails (10px radius, the cover marked with a star) and, at the right of that row, secondary pills **Replace screenshot** (uploads one image that replaces the captured shots and becomes the cover) and **Retake screenshot** for types that are captured (reference, UI library, animation, source).
- **Full-size viewer:** an image preview has a solid surface-raised round **View at full size** button (maximize icon) top-right, and clicking the image does the same. It opens a sheet 16px from the top, the full screen height and at most 1440px wide (the capture width) on a canvas background, so a full-page shot reads at its real size and scrolls top to bottom. A solid surface bar stays at its top: file name and size in mono ink-muted, an **Original file** ghost pill, and a round close button. Escape closes it.
- While capturing, a surface status pill with a spinner reads "Capturing screenshots…" with a small **Cancel** pill. A failed capture turns it into a danger line "Screenshot failed: <reason>" with two small pills, **Upload one** and **Retry**. A partial or doubtful capture (or a retake that kept the previous shot) shows the same pill in ink-muted with an info icon, the note, and a **Retake** pill.
- **Retake** is a split pill: the main half retakes with the saved defaults; a chevron half opens a menu ("Capture once with": Expand content, Light theme, Dark theme, Both themes).
- Thumbnails are labelled with their role and colour scheme ("Original", "Screenshot · dark", "Other theme · light"). When a retake has replaced the first capture, the Original is the one shown first.
- **Capture history** sits under the gallery as a collapsed `<details>` ("Capture history (n)"), each run a surface row: status in ink-secondary, the time in mono, the scheme and options, the error on its own line.

### Capture queue — `app/captures/page.tsx`

Display title "Capture queue", a 14px ink-muted line, then a radiogroup of pills (All, Queued & capturing, Failed & partial; the chosen one inverse). Each run is a surface row (14px radius): a status chip (danger for Failed, warning for Partial, a spinner while running), the item's title as a link, the time in mono ink-subtle, a small **Cancel** or **Retry** pill, and a second line in 12px ink-muted with the scheme, options, retries, quality and error. It refreshes every 2 seconds while something runs.

### Add from URL — `components/add-url-dialog.tsx`

- Under the URL box, a warning line (12px, warning colour, triangle icon) says why Save is unavailable: "That doesn’t look like a link…", or how many entries will be skipped in a bulk paste. Already-saved URLs get the same line with a link to the saved resource.

### Note card — `components/resource-card.tsx` (text types)

- The same glass tile with no art behind it, and the same 16:10 canvas frame, padded 24px. Prompts, rules, checklists and skills show an excerpt as a title-lg quote in ink; snippets and MCP JSON show the first lines in mono ink-muted. A type chip bottom-left (surface-raised pill, 12px, ink-secondary).
- Caption: the type icon in the icon tile, the title, then `Type · purpose` in ink-muted (skills show their invocation), then its tags as chips.

### List row — `components/resource-card.tsx` (`ResourceRow`)

64px row, 14px radius, transparent; hover and selected surface, selected adds the accent-text outline. 64×40 thumbnail at 8px radius, title + meta, date in mono, actions and a round checkbox on hover.

### Inputs — `components/ui/input.tsx`, `textarea.tsx`

Single-line inputs are 36px surface pills with no border, 15px ink text, ink-muted placeholder; hover and focus surface-raised, focus outline accent-text. Textareas and the content editor use the 14px card radius with the same fill. Labels above fields in 12px ink-subtle. The command palette input is a 40px surface pill.

### Overlays — `components/ui/{dialog,alert-dialog,popover,select,dropdown-menu,command,sonner}.tsx`

- Strong glass, 14px radius, overlay shadow. Dialogs pad 20px and open with a 100ms fade and zoom from 95%; their footer is separated by a divider line. Menus and popovers slide 8px in from their trigger side. Toasts (bottom-right) use strong glass with the glass edge; they are always dark (never follow the OS theme), the title is ink and the description ink-muted. A failed screenshot raises an error toast naming the page and the reason, with an Open action.
- The command palette is a dialog up to 672px wide.

### Selection bar — `components/selection-bar.tsx`

Appears bottom-centre while resources are selected: strong glass, 28px radius, 6px padding (16px on the left), wraps on narrow screens, enters with a 200ms fade and 8px rise. Count in mono ink-subtle (promoted to ink-muted by the glass), then ghost actions (Copy context, Export, Collection, Remove, Trash; in Trash: Restore and Delete forever in danger, confirmed in a dialog).

- **Add to collection** popover (strong glass, 256px): a "Find or create a collection…" field, the collections with their counts, and, when the typed name is new, a "Create “name”" row with a folder-plus icon that creates the collection and adds the selection to it.

### Page header — `components/library-view.tsx`

Display title (section name, the type's plural, or "Inbox"), a count badge beside it (the number of items listed now, `tabular-nums`, with "24 items matching “…”" as its accessible name), an optional note in 16px ink-muted (the trash: "Deleted for good after 30 days."), optional actions aligned right, then the filter rows. The library has no Type select: the navbar menus pick the type. A section's landing page shows the folder shelf above the grid. When quick saves are waiting, the library header shows a secondary **Inbox** pill with the count in mono; the Inbox page explains itself in one ink-muted line, and its filter, like a collection or "Saved from <host>", shows as a dark inverse chip with a × to remove it. A reference that is in the Inbox has a surface status pill at the top of its detail page with **Mark reviewed**; the selection bar offers **Mark reviewed** in the Inbox.

### Skill pack group — `components/skill-pack-groups.tsx`

Header: a chevron toggle and the pack name in title-lg ink, then `author · kind · N skills` in 14px ink-subtle; Website and Repository as 32px surface pills (13px) on the right; description in ink-muted at a 3xl measure. Groups are 64px apart; collapsing hides the cards (`aria-expanded`/`aria-controls`).

### Sources page — `components/source-groups.tsx`

- Filter field: a 40px surface pill up to 560px wide with a leading search icon, sitting straight on the canvas (no panel). It filters the saved sources and shares `?q=` with the top bar search; Escape clears it.
- One section per category in a fixed order, each with a title-lg heading plus hint and count in ink-subtle, then a grid of resource cards (300px minimum column).
- Source info aside: a surface panel linking "Saved from this source · N →" and a small search form when the search URL has `{q}`.

### Skill guide — `components/skill-guide.tsx`

A surface panel at card radius: title, the invocation as a mono chip that copies on click, Source and Edit guide as ghost pills. Usage renders as Markdown; examples are mono rows on surface-raised that copy their prompt. Plugin skills show a "Plugin skill · read-only" note.

### Folder shelf — `components/folder-shelf.tsx`, `components/ui/glass-folder-cards.tsx`

A row of glass folders as a visual index on section landing pages, Skills (one per pack) and Sources (one per category).

- Each folder is 300px wide in a `minmax(300px, 1fr)` grid (32px × 48px gaps). Its back panel carries generated liquid art picked from the folder id (so it always keeps its look); at most four sheets show; a frosted front panel carries the name and `N sources` / `N skills` in mono.
- Tone is always dark (smoked glass).
- Folders open on hover or keyboard focus, fanning their sheets; leaving closes. Choosing a sheet opens that resource. Clicking the folder goes to its page (a skill pack scrolls to its section); on touch a tap goes straight there. The `···` key appears only when a folder has extra actions.
- Folders assemble on first view, staggered 90ms each (capped at the sixth); they follow their list in place and never replay the entrance. Reduced motion turns every transition off.
- **Owner exception:** the folder is drawn as an object, so it keeps its own soft shadow, glass rim and the component's system font, and its art uses the component's multi-colour presets (aurora, ember, dusk, glacier, verdant), a spot of colour in the ember world kept by the owner's call. The exception is scoped to this component; the solid-card, no-shadow and ember-palette rules still apply everywhere else.

### Extension popup — `apps/extension/src/popup/popup.tsx`

400px wide, 13px body, the same tokens; saving a page takes two steps.

- **Type step:** "What are you saving?" in 13px ink, then a two-column grid of option rows (12px radius, 8px padding): a 32px surface icon tile, the type name in 13px ink and its blurb in 12px ink-muted. Hover and focus fill the row with surface; the type used last time starts filled and focused, with the accent-text focus ring. On a known site's home page Source starts filled instead, with a 12px ink-muted line under the question: "This is Dribbble’s home page, so Source is picked." Six common types, the rest behind a "More types" text button. The footer says "Pick a type to continue" in place of Save.
- **Details step:** a back pill (surface, arrow and the type name) to change type, the tab preview at the captured tab's own aspect ratio, up to the full width and 256px high, centred on surface (never cropped or stretched) with a solid surface-raised "Attach this view" toggle, the title field, then only that type's quick facets, each a combobox (see below). "More details" (12px ink-muted, chevron, with a hint of what's inside in ink-subtle) opens description, tags, notes, collection and the server-capture option ("Also capture a full-page screenshot"; for a Source "Take a screenshot in PIVOT", shown only when the view isn't attached, since the view already is a Source's first-screen shot). Save stays the one ember button in the footer.
- **Errors:** a failed save shows a danger line above the footer (× icon, 12px) and keeps everything typed. A rejected token adds an underlined ink "Open extension settings" button to that line, so the token can be fixed in the settings tab and Save pressed again. A token that is already wrong when the popup opens shows the Connect screen straight away, before anything is typed.
- **Already saved:** when the page is already saved as the chosen type, the warning line stays and the primary button reads **Save again**. On a PIVOT page the popup shows only "This is PIVOT itself. Open the page you want to save, then try again."
- **View tabs:** two small pills in the header (Capture, Library; the current one inverse), ← → switch them. **Library** shows a search field, "Saved from this page", "Saved from <host>", "Recently saved" (rows with a 56×36 thumbnail, the title in 12px ink, the type in 11px ink-muted) and "Waiting to sync"; managing items happens in PIVOT.
- **Already saved (type step):** a surface panel with a warning line ("Already saved 2 times. Open it, or carry on to save a new one.") and up to three rows (thumbnail, title, type and date, "Open existing"); "View all n" opens the library filtered to that page.
- **Collections** are pills, several or none: the three used most recently first, "All n" shows the rest. Picked ones are inverse with `aria-pressed`.
- **Saved:** the check, "Saved", the background-capture line, and Close, **Edit** and Open (focused). Edit swaps in a compact form (title, notes, the type's facets, collections) with Cancel and Save changes; "Changes saved" in success green confirms it.
- **Offline:** a surface note "PIVOT isn’t running. You can still save…" above the form. Saving shows "Saved locally" (a warning-coloured check) with the reason. Waiting saves are a collapsible surface panel ("2 saves waiting to sync", **Sync now**) whose rows show why they wait, with Retry and a two-step Discard for refused ones. The toolbar icon shows the waiting count on an ember badge.
- **Facet combobox:** a rounded surface field (18px radius, min 36px) holding the chosen values as 24px inverse chips with a remove ×, then a borderless input ("Add page type…"). The accent-text focus ring sits on the field, not the input. Focusing it opens a list right under it (surface-raised, 14px radius, soft drop shadow, up to 176px): the values already used, most used first, with their count in mono ink-subtle; typing filters them (names starting with the text first) and adds a "+ Create “text”" row. ↑↓ move the highlight (surface), Enter picks it, Backspace in an empty field removes the last chip. Nothing is highlighted until you type or press ↓, so Enter in an empty field still saves.

### Browser surfaces — `globals.css` base layer

Text selection is ember at 45% with ink text; the caret is accent-text; the scrollbar is a divider thumb on a transparent track; native controls take ember as `accent-color`.

## Do's and Don'ts

### Do:

- **Do** keep one ember-orange filled button per screen, with dark (on-accent) text.
- **Do** use accent-text for links, focus (2px outline, 3px offset) and the selected outline.
- **Do** build hierarchy with canvas → surface → surface-raised; use divider only in dialog footers and tables.
- **Do** put strong glass on every floating overlay (menus, popovers, selects, dialogs, palette, toasts, selection bar) and light glass on the top bar only.
- **Do** use ink for any text placed directly on the top bar's glass.
- **Do** keep every control a pill and every container at the 14px card radius.
- **Do** check new text colours at 4.5:1 on canvas, surface, surface-raised and the white-backdrop glass composite.
- **Do** keep motion at 150ms ease-out for hover and pill changes and make every transition instant under reduced motion.

### Don't:

- **Don't** add a light theme, a theme toggle, or any `prefers-color-scheme` branch, in the app or the extension.
- **Don't** put white text on the ember fill (2.87:1).
- **Don't** use orange for icons, hover states, badges or decoration, or ember light outside the top bar and the record card's highlight and edge.
- **Don't** put glass, borders or shadows over saved work, or on rows and panels that show it; the folder and the record card are the only glass that holds work, and their glass sits behind it.
- **Don't** use weights above 500, sizes below 12px, or `font-size` on `html`.
- **Don't** scale or lift thumbnails on hover.
- **Don't** signal state by colour alone; danger, success and warning always carry a word or an icon.

### Copy in the UI

- **Do** write in English, sentence case, from the user's side: buttons name the action ("Add", "Copy context", "Move to trash"), toasts confirm it in the past tense ("Context copied · ~1.9k tokens"), errors say what happened and what to do.
- **Do** show counts as plain numbers in ink-subtle or mono.
- **Don't** use "Submit", "OK", or emoji anywhere in the UI.
