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

- **Light glass** (glass, 65%): the top bar only (desktop and phone), drawn by `.nav-shell` with its ember.
- **Strong glass** (glass-strong, 86%): menus, popovers, selects, the section panel, the phone section dock, dialogs, the command palette, toasts, the selection bar.
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

### Hierarchy (updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

- **Display** (500, 72px clamping down to 44px via `clamp(44px, 6vw, 72px)`, 0.96, -0.045em): the page title of a library view. One per screen, the only large type.
- **Page title** (500, 30px `text-3xl`, `leading-tight`, -0.02em): the title of a resource detail page (an editable field that wraps; 26px below `sm`) and of a design session page (-0.015em, wrapping anywhere). One per screen, in place of the display title; weight stays 500 (see the Two Weights Rule).
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

- **No app sidebar.** A single floating top bar holds the logo, the section nav (Library · Sources, plus Knowledge and Skills while Settings › Other resource types is on), the search pill and the actions (Inbox while something waits, More, `Add` at its right end). Below `lg` (1024px) it is one row (logo, search, Inbox) and the sections move to a dock at the bottom of the screen. The Library landing and References list add a **page-level filter rail** (see Index rail): it filters and orders that page only, never navigates elsewhere in the app, so the top bar stays the only navigation.
- **Pinned bar.** The top bar is fixed at every width. At the top of the page its glass runs the full width, flush with the top edge (72px from `lg`, 64px below); scrolled, it shrinks into a floating capsule, so the page itself scrolls and the work passes around and under the glass. The bar measures its height live (a ResizeObserver writes `--topbar-h`: 72px from `lg`, 64px below, also the defaults until measured) and `main` is padded by it; below `lg` `main` also ends 84px plus the safe area above the dock. Shrinking never changes the height. `html` has `overscroll-behavior-y: none` so the bar never rubber-bands.
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

- **Pool:** a low radial glow in the capsule's middle (`radial-gradient(300px 46px at 50% 130%)`, ember at 26%), so it rises from under the bar's lower edge between the sections and the search pill.
- **Seam:** a 1px line of light along the capsule's bottom edge, from 18% to 82% of its width (deep red at the ends, amber at the centre). The phone row carries the same pool and seam.

### Named Rules

**The Solid Work Rule.** Glass is for chrome and overlays. The saved work itself (screenshots, frames, rows, panels on the page) is solid, with no border and no shadow, so screenshots keep their true colour. Two owner exceptions wrap the work in glass without covering it: the folder shelf and the record card, whose glass sits behind the screenshot.

**The Light Stays Home Rule.** Ember light never sits under page text. It lives in the top bar's pool and seam; any glow bright enough to see drops small grey text below 4.5:1. The record card's highlight is the measured exception: 16% ember on a tint that deepens toward the caption, and caption text stays ≥ 5.1:1 with a white screenshot behind and the highlight at full strength.

## Shapes

The radius is binary: every control is a full pill, every container a gently rounded 14px card (cards, dialogs, popovers, menus, selects, textareas, toasts). Small steps exist only for parts inside those: 6px for keyboard hints and inline code, 8px for list-row thumbnails, 10px for option icon tiles, 12px for option rows. Three floating chrome pieces are rounder: the section panel (20px), the phone section dock (24px; its cells 16px) and the selection bar (28px). The top bar is square across the page at the top and a full pill once it shrinks into the capsule. Round (circular) buttons are the icon variants of the pill. Borders appear only as the glass edge and the rare divider.

## Components

Paths are under `apps/web/src/` unless written out.

### Buttons — `components/ui/button.tsx`

Pill-shaped, quiet by default.

- **Primary (`default`):** ember fill, Kiln Black label; hover drops to 90% opacity. The one primary action on the screen.
- **Secondary (`secondary`, `outline`):** surface fill, ink-secondary label; hover and open state surface-raised with ink. There are no outline-only buttons.
- **Ghost:** transparent, ink-secondary; hover surface. For actions inside a glass container (selection bar, menus).
- **Destructive:** surface fill, danger label, always with an explicit verb or icon ("Delete forever").
- **Link:** accent-text, underline on hover.
- **Sizes:** `lg` 40px, `default` 36px (top bar), `sm` 32px with a 13px label, `xs` 24px; `icon*` variants are round at the same heights.
- **Focus:** 2px accent-text outline, 3px offset (on every interactive element). Disabled: 40% opacity, no pointer. Transitions 150ms ease-out.

### Icons

Lucide stroke icons at 16px, coloured ink-muted or the label colour inside a button. Icons sit beside a word; icon-only buttons carry an `aria-label`.

### Brand mark — `components/brand.tsx` (`PivotMark`, `PivotWordmark`), `docs/brand/`

PT is the core, PIVOT the expansion: the mark starts from the first and last letters, which turn about an axis and open out into the word.

- **Letterforms:** 34-unit strokes on a 136-unit cap height, drawn as SVG paths (never set in Geist). The P is two halves turned 180° on each other: the top bar rounds off at its top-right corner, the hook below rounds off at its bottom-right corner and carries the stem. Its counter is as tall as a stroke and open to the left. Stems end in a rounded bottom-right corner.
- **PT monogram** (`PivotMark`, 232 × 170): the T's bar sits in the P's counter and closes the bowl; the T's stem is set left of the bar's centre. It is the app icon, the favicon and the extension's mark.
- **PIVOT wordmark** (`PivotWordmark`, 586 × 136): the same P with a bridge closing the bowl, then I, V, a ring O and the T.
- **Colour:** the P is solid Ember (`--ember`, #ff6a13; 6.9:1 on canvas), everything else Warm White (`currentColor` on ink), in the monogram and the wordmark alike (owner's call, 2026-10-29). The ember O (amber core → ember → ember deep) and the ember seam belong to the app icon and splash or landing use only.
- **In the top bar:** the monogram at 24px high, then the wordmark at 14px high, 8px apart, inside the home link (`aria-label="PIVOT home"`).
- **App icon** (`docs/brand/pivot-app-icon.svg`, copied to `apps/web/src/app/icon.svg`): the monogram (ember P, Warm White T) on a kiln tile (22% radius, a faint warm top light) with the ember seam along its bottom edge. The extension's toolbar PNGs are rendered from it (`pnpm --filter extension icons`).
- **Repo hero** (`docs/brand/pivot-wordmark-ember.svg`, 1280 × 640, the GitHub social-preview ratio): the wordmark with its ember O, at 1.2×, straight on the kiln with no glass. Behind it the O becomes the light source: a 250px ember ring blurred 38px into a haze with a 1.5px amber hairline, two thin orbits (`#4a3527`) and one amber dot riding the outer orbit; fine grain and a dark vignette over all. A soft dark halo (the letters in Kiln Black, blurred 16px, 75%) lifts the wordmark off the ring.
- **Tagline** (brand use, not the UI): "Your creative compass" in Geist Mono 500, upper case, 0.62em tracking, Smoke. No ® until the name is registered.

### Top bar — `components/top-bar.tsx` (`TopBar`)

Direction "1 · Floating capsule" with the owner's change "6 · Full width, then capsule · A content stays" (design session "PIVOT navbar redesign", both approved by the owner in PIVOT, 2026-11-16).

- **From `lg`, at the top of the page:** the glass runs the full width, 72px tall, square, with a 1px glass-edge hairline along its bottom. The content sits in a frame 1240px wide (at least 24px in from each side) and 60px tall, 6px below the top edge: left, the logo, 22px gap, the section nav; right, 8px apart, the search pill, Inbox, More, `Add`. 22px padding on the left, 12px on the right.
- **Bar glass** (`.nav-shell`): light glass with the ember pool and seam and the sheen; a bottom hairline across the page, an inset glass-edge ring once it is a capsule. It is a sibling layer behind the content (see Elevation & Depth), and its clip-path also clips where it takes clicks.
- **Search pill:** 40px solid surface pill, 320px (208px below `xl`), a search icon, "Search PIVOT" in ink-muted and a `⌘K` key hint (mono, ink-subtle, 6px-radius divider border).
- **Inbox:** a 36px round surface button with the inbox icon and an 18px inverse count badge (12px mono) at its top right, only while quick saves or suggestions wait; it opens `/?review=needs`.
- **More:** a 36px round surface button (ellipsis). Its strong-glass menu (232px) reads "Go to" in 12px ink-muted, then Collections (count; a submenu lists them and "New collection…") and Design sessions, a divider, then Settings and Trash (count).
- **Add:** the split ember button at 36px: "Add" (or "New source"… on a type page; the type name hides below `xl`), then a 32px chevron half that opens every way to add, "New collection…" included.
- **Scrolled** (past 120px): the glass shrinks into a full-pill capsule exactly around the content frame: 1240×60px, 12px below the top (100px in from each side at 1440). The content keeps its place across and drops 6px; the search pill keeps its width. Outside the capsule, clicks reach the page.
- **Below `lg`:** a full-width 64px row of the same glass at the top of the page (the logo 28px in on the left, then a 44px search icon button and Inbox, 44px, transparent, 20px in on the right); scrolled, it shrinks into a 56px full-pill capsule 8px below the top and 12px in from the sides, the content dropping 4px. The sections live in the dock (below).
- **Phone dock:** centred 12px above the bottom edge plus the safe area: a strong-glass bar (24px radius, 6px padding) of cells at least 48px square with a 20px icon over a 12px label (below 360px the labels go and only screen readers keep them) (Library: layers, Sources: globe, More: ellipsis; Knowledge: book-open and Skills: sparkles while Other resource types is on, so the dock has 3 or 5 cells and hugs them); the current section is an inverse 16px-radius tile. The ember `Add` is a separate 52px circle to its right with a 22px plus. While cards are selected the selection bar takes the dock's place.
- **Skip link:** "Skip to content", an inverse pill that drops into view at the top left on focus.

### Section nav — `components/section-nav.tsx`

- Labels are ink on the light glass with no fill; hover (fine pointers) tints the pill with ink at 7%. 36px tall, 15px labels, 14px side padding. The current section is an inverse pill: an inverse copy of the list clipped to it, so it can slide.
- Sections with a panel (Library, Sources, and Knowledge while it is shown) are two targets in one pill: the name (a link to the section) and a 24px chevron button at 70% opacity that turns over (200ms) while its panel is open.
- **Panel:** opened by the chevron, or ↓ on the name or the chevron; once open, pointing at another section for 120ms moves it there (a quick diagonal toward the panel doesn't). Strong glass, 20px radius, 8px padding, hanging 14px below the section list and lined up with the section's left edge. Two columns 600px wide when the section has more than five options (Library, Sources), one column 340px wide otherwise (Knowledge). Each option is a 12px-radius row: a 40px surface icon tile, the plural name in 15px ink with its count in mono on the right, and a one-line blurb in 14px ink-muted. Hover or focus fills it with surface; the current option stays filled. Sources lists its seven categories (lightbulb, app-window, swatch-book, blocks, orbit, type, shapes icons). ↑/↓ move through the options, Escape closes and returns focus to the chevron.

### Top bar motion — `components/nav-motion.ts` (GSAP, CustomEase)

Eases: `pivot-panel` (.45,0,.25,1), `pivot-out` (.23,1,.32,1), `pivot-glide` (.32,.72,0,1). Only transform, opacity and clip-path move. Reduced motion swaps every state at once; menus only fade.

- **M1 current section:** the inverse copy's clip slides to the new section in 270ms `pivot-panel`, on click, before the route resolves. First load, resizes and coming from a page with no section set it in place. The dock's tile does the same.
- **M2′ shrink:** a paused timeline, 270ms `pivot-panel`, played after 10px of downward scroll past 120px and reversed after 8px upward or within 64px of the top: the glass's clip-path goes from `inset(0 round 0)` to the capsule (`inset(12px X 0 X round 30px)`, X = max(24px, (width − 1240px) / 2); on phones `inset(8px 12px 0 12px round 28px)`), and the content moves down 6px (4px on phones). A width change resets it to rest.
- **M3 search:** the 400px field (nearly the full row on phones) grows out of the pill or the search icon by clip-path, 200ms `pivot-out`, over its neighbours, which fade in 120ms and stop taking clicks; it folds back in 150ms `pivot-panel`. `/` and a query in the URL open it instantly.
- **M4 panel:** opens with opacity and scale from .97 (180ms `pivot-out`), closes in 140ms. Between sections the glass's clip morphs to the new options' size and place (270ms `pivot-panel`) while the old options leave 8px toward the side and fade (100ms) and the new ones come 8px from the other side (150ms, after 100ms).
- **M5 phone dock:** slides out below the screen edge on downward scroll and back on upward scroll, at the page end, or when focused (240ms `pivot-glide`).

### Pills and tag filter — `components/tag-pills.tsx`, `components/tags-editor.tsx`

- Inactive: surface, ink-secondary; hover surface-raised. Active: inverse. Heights: 36px filter pills and chips, 28px editable tags, 24px tags inside a card.
- The filter row: "All" first, then chosen tags (inverse, with a remove ×; a facet shows its kind first at 70% opacity, "Page type Pricing"), then up to 12 tags by frequency with counts at 70% opacity in `tabular-nums`; "+N more" opens a searchable popover grouped by kind. The row hides when nothing on screen has tags.
- The visible tags are grouped by kind, each group led by its kind in 13px ink-subtle (Tags, Page type, Domain, Style, Pattern, Technology); groups sit 20px apart, pills 8px apart. With plain tags only, the labels are left out.
- A "From <source>" chip (inverse pill, 13px, clear button) sits in the filter row while the list is narrowed to one source.

### Search field — `components/top-bar.tsx` (`SearchField`)

- Folded, it is the top bar's search pill (see Top bar). Open, it is a 40px solid surface pill, 400px wide (nearly the full row on phones), with a glass-edge ring, a leading search icon, the placeholder "Search PIVOT" in ink-muted, typed text ink at 15px and an `Esc` key hint.
- Typing filters the library (debounced 200ms, kept in `?q=`); elsewhere Enter jumps to `/?q=…`. `/` opens it from anywhere; `⌘K` stays the command palette. Escape clears and folds it, returning focus to the pill; leaving it empty folds it.

### Breadcrumbs — `components/breadcrumbs.tsx` (updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

- 14px ink-subtle links separated by 14px chevrons at 70%; hover ink. The last crumb is the current page: ink-secondary, not a link, truncating rather than wrapping. With `current={false}` every crumb is a link up.
- Above the title on a type page (Section › Type) and in a collection. On a resource page, one crumb beside the back button: the parent list (the type's page) as a link; the title below says the rest.

### Resource card — `components/resource-card.tsx`

"Option A in glass", picked by the owner on 2026-10-30. The card is a tile of the folder's frosted glass that holds the picture and its caption; styles live in `globals.css` (`.glass-card`).

- **Tile:** 18px radius, 8px padding (14px at the bottom), base halfway between canvas and surface. Layers, back to front: a copy of the card's own thumbnail blurred 36px and saturated 1.5× at 50% (62% on hover), so each card takes a soft tint from its page; a dark tint that deepens toward the caption (25% → 62% at 46% → 92%); a 10% top sheen; a 16% ember highlight that follows the pointer; a 1px white rim, brightest at the top (42% → 12% → 5%).
- **Frame:** a 16:10 canvas frame at 11px radius inside the tile, image `object-fit: cover; object-position: top`. Nothing translucent sits on it: the glass is behind it. No scale; on the Library and References only, a 2px hover lift of the whole card on pointer devices (D3 of the Index rail motion, owner-approved 2026-11-15).
- **Caption** (inside the tile, 6px side inset): a 20px site icon tile (surface-raised, 6px radius; the host's favicon, its first letter when the site has none, the type icon when there is no URL), the title (title, ink, one line) and, at the end of that row, Open source and Copy as 28px round buttons (ink at 10%, ink icon) that appear on hover or focus. Then the host in meta (ink-muted), then up to three chips (24px, ink at 8%): facets first, each with its kind in ink-secondary regular before the name in ink medium ("Domain SaaS"), then plain tags, then a `+N` chip whose tooltip lists the rest. A linked card without tags shows its type as the chip.
- **Hover:** a 1.5px ember edge (amber core → ember → ember deep) traces the rim around the pointer, the blurred art drifts a few pixels against it, and the actions appear. Reduced motion keeps the art still.
- **Contrast:** inside the tile, ink-subtle resolves to ink-muted. Worst case (white screenshot behind, highlight at full strength): title ink ≥ 9.8:1, meta ink-muted ≥ 5.1:1, chip names ink ≥ 9.7:1 and kinds ink-secondary ≥ 7.3:1.
- **Select checkbox:** top-left of the frame on hover or focus, solid surface-raised with an ink-muted ring.
- **Selected and focus:** 2px accent-text outline with 3px offset around the tile.
- Capturing: a pulsing frame (1.6s) with "Capturing…" in ink-muted. Failed capture: an image-off icon in ink-subtle.
- **References scroll like a screen recording:** the frame shows the full-page shot resting at the top; on hover or keyboard focus it scrolls linearly to the bottom at about one frame-height per second (1.5–30s from the image's aspect ratio) and glides back in 500ms ease-out on leave. The frame is a size container, so the travel is `translateY(calc(-100% + 100cqh))`. Short pages don't move; reduced motion keeps it still.

### Screenshot gallery — `components/asset-gallery.tsx` (updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

The detail page's main column holds the **full gallery**; text types show a **compact gallery** under their content.

- **Full gallery:** the main preview, then **one row**: 40px thumbnails (44px on phones; 10px radius, 6px apart, the cover marked with a small star, the role in a tooltip) and a 40px add tile. A file that isn't an image shows an ink-subtle icon instead of a text tile: film for a video, type for a font, file for the rest.
- **Stage controls:** top-right of the preview, two solid surface-raised round buttons: **View at full size** (maximize icon; clicking the image does the same) and **More screenshot actions** (⋯). Its menu: **Annotate** ("Annotate (2)", "Done annotating" while on) for images; for the types that are captured (reference, UI library, animation, source) **Replace screenshot…** (uploads one image that replaces the captured shots and becomes the cover), **Retake screenshot** ("Capture screenshot" before the first), a **Retake once with** submenu (Expand content, Light theme, Dark theme, Both themes, Tablet and mobile too, Capture later…) and **Record motion (video and keyframes)**, which carries "The last capture saw animation on this page" as a 12px ink-muted hint when it did; then, after a separator, **File details**, **Compare Original and Latest** (only when an Original exists) and **Capture history (n)**. With nothing on the stage yet, the ⋯ sits at the end of the thumbnail row.
- **Panels** opened from that menu (its item reads "Hide …" while one is open): solid surface panels (14px radius, 12px padding) under the row, each with a 12px ink-subtle heading and a ghost round × to close it.
  - **File details:** the file's label chip (surface-raised), the name and size in mono, **Set as cover**, Open original, Download, Remove and the file note.
  - **Compare Original and Latest:** the share of changed pixels in ink with the capture times in ink-muted, the difference image (Latest dimmed to grey, changed pixels in ember, 10px radius), and a pill to save the Latest as a new design version (secondary and preceded by "This looks like a redesign." above 25%, ghost below).
  - **Capture history (n):** each run a surface-raised row: status in ink-secondary, the time in mono, the scheme and options, the error on its own line.
- **Full-size viewer:** **View at full size** opens a sheet 16px from the top, the full screen height and at most 1440px wide (the capture width) on a canvas background, so a full-page shot reads at its real size and scrolls top to bottom. A solid surface bar stays at its top: file name and size in mono ink-muted, an **Original file** ghost pill, and a round close button. Escape closes it.
- While capturing, a surface status pill with a spinner reads "Capturing screenshots…" with a small **Cancel** pill. A failed capture turns it into a danger line "Screenshot failed: <reason>" with two small pills, **Upload one** and **Retry**. A partial or doubtful capture (or a retake that kept the previous shot) shows the same pill in ink-muted with an info icon, the note, and a **Retake** pill.
- Thumbnails are labelled with their role and colour scheme ("Original", "Screenshot · dark", "Other theme · light"). When a retake has replaced the first capture, the Original is the one shown first.
- Tablet and mobile shots, the motion video and keyframes appear as more thumbnails, labelled "Viewport · mobile · dark", "Motion", "Keyframe 3", and, since motion tracks (2026-11-23), "Motion track" and "Filmstrip M3".
- **Annotating** (from the menu): a surface pill bar above the image (12px ink-muted: a message icon, "Annotating · 2 notes") with a visible secondary **Done** (surface-raised, pressed) and the ⋯; the preview becomes the full image with its notes as a layer. Regions are 2px ember outlines with a 10% ember fill and a numbered ember badge at the top-left; pins are 24px ember circles with the number. Drag on the picture for a box, click for a pin; under it a small "Add a box" pill and the numbered list of notes as 32px inputs with a remove button ("agent" in ink-subtle for an agent's). Markers are focusable buttons (accent-text ring) moved with the arrow keys.
- **Motion table** (added 2026-11-23, `components/motion-table.tsx`): when a recording has a motion track, a collapsed `<details>` "Motion table (n)" sits under the thumbnail row (under the File details panel while it is open). Opened: one 13px ink-muted line (viewport, libraries, and what exact, measured and seen mean, those three words in ink), then one surface row per item (10px radius, 2px apart): the id and the trigger in mono (ink-subtle, ink-muted), the element's name in ink and its selector in mono ink-subtle (each truncated), the source as a 20px surface-raised pill on the right (11px ink-secondary: "exact · CSS transition", "measured", "seen · canvas"), then the changes and timing in ink-secondary on their own line. An item with a filmstrip has a folded "Filmstrip" under it that opens the strip image (8px radius, its own size up to the row's width). After the 24th row an ink-subtle line says Claude reads only the rows above. Hover and click items follow the scroll ones under the same kind of ink-subtle line ("Hover and click: a sample, one element of each kind was tried."); their trigger reads "hover on <element> →" when another element moves. The track's limits close it as an ink-subtle list. On phones the rows wrap; nothing scrolls sideways.
- **Compact gallery** (text types): 56px thumbnails (a file that isn't an image as a mono type tile) and the add tile; the selected file's row stays open under them (its label, a ghost "Notes (2)" pill that annotates beside the image's label, the name and size, the file actions and note). For a captured type it keeps the row pills **Replace screenshot** and the split **Retake screenshot** pill (its chevron opens "Capture once with": Expand content, the themes, Tablet and mobile too, Record motion, Capture later…), Compare and **Capture history** as collapsed `<details>`, and, when the last capture saw animation, a 12px ink-muted line above the history with a small **Record motion** pill.

### Resource detail page — `components/resource-detail.tsx` (updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

Every type shares one header and one inspector; only the main column changes with the type. Nothing on the page is ember: the top bar's Add stays the screen's one primary.

**Header:**

- **First row:** the round secondary back button, then one breadcrumb, the parent list, as a link (see Breadcrumbs). The save state is said, not shown: "Saving…" and "Saved" go to a polite screen-reader live region, with no dot on screen. Only a failed save shows: "Not saved" in 12px danger with a warning triangle.
- **Second row:** the title, once, at the page-title size (see Typography); an editable field that wraps, so a long title reads in full, and Enter adds no line. On the same row (wrapping under it when narrow) the type's main actions as secondary pills, then one round secondary ⋯ **More actions**:
  - **Main pills:** a visual type with a link: **Open site** and **Copy for Claude**; a component: **Copy code** and **Copy for Claude**; a saved design: **Download zip** and **Copy for Claude**; a text type: **Copy** and **Copy for Claude**. Copy is left out where it would copy the same block as Copy for Claude, which copies the item for an agent (toast "Copied for Claude · ~1.9k tokens").
  - **More actions** (a strong-glass menu, a label on every item): the copies that aren't pills (Copy, Copy code, **Copy link**), the original page (Open source, Open on 21st.dev), **Export…** while Settings › Other resource types is on, **Change type** (a submenu of the types as radio items; not for the types only an agent saves), then, after a separator, **Move to trash** in danger. Trashing returns to the type's page with a "Moved to trash" toast and **Undo**.
- **Below `sm`:** the same labelled pills, 44px tall and sharing the row's width, with the ⋯ beside them at 44px; the back button is 44px too. No action is icon-only.

**Body:** the main column (the review banner and suggestions, then the gallery, the component or design stage, or the content editor), and **the inspector** on the right: 320px from `lg` (32px gap, top-aligned, not sticky); below `lg` it stacks under the content.

**Inspector** (every type): a column of solid surface rows, 8px apart (14px radius, 16px side padding, no border or shadow). Each row is a native `<details>`, so several can be open at once and find-in-page reaches closed text. Its summary is a 14px ink-subtle chevron that turns, the name in 14px medium ink, and on the right a one-line summary in 12px ink-subtle, truncated; at least 32px tall, 44px below `sm`. Fields inside step up to surface-raised. In this order:

1. **About** (open; summary: the host, or "No source"; a component's `@author · licence`, with a warning triangle and "Licence unknown" in warning when there is none; a design's kind and "from <project>"):
   - the source link as an accent-text link (host and path, no protocol) after an external-link icon, with a ghost **Edit** that turns it into the mono field; empty, a ghost **+ Source link**;
   - the description clamped to three 13px ink-secondary lines with an accent-text ghost **Show all and edit**; empty, a ghost **+ Description**;
   - section and catalogue info when present; for visual types, ghost **+ Published by** and **+ Original source** pills that reveal their field, focused (filled fields always show); then the type's own fields.
   - A component shows its facts instead of the link (Original as an accent link, Author with `@username` in mono, Licence and where it was read, "Unknown: check before you ship it" in warning); a design shows Kind, Project and Sessions (accent links).
2. **Tags** (open; summary: the count, or "none"): only the kinds that have a value, each a row led by its kind in 12px ink-subtle, then one ghost **+ Add** pill that shows the empty kinds' pickers and becomes **Done**.
3. **Notes:** always open and not collapsible: a surface section with "Notes" in 14px medium ink over the textarea.
4. **Collections** (summary: their names, or "none"): the collection chips with **Add**.
5. **Links** (summary: "2 links · 1 suggested", or "none"): see Links.
6. For a component, **Review** and **Used in** (see Component page).
7. A source's "Saved from this source" panel.
8. **Scan warning**, only while PIVOT's scan has flags: a surface row (14px radius) with a warning triangle, one 13px ink-secondary line ("Reaches api.example.com and 2 other hosts", or "PIVOT's scan: 3 flags") and an accent-text ghost **Details** pill that opens and focuses Review (a component) or Technical details (a design). It is never folded away.
9. **Technical details** (closed; summary: the type and its file count, "Reference · 4 files"): a list of 12px ink-subtle labels with mono ink-muted values: the Type select, Added, Edited, Files; a component's code files, 21st id and Fetched date; a design's folder, dates, files and scan flags; a skill's folder; Captured from; and the id.

### Component page — `components/component-detail.tsx` (added 2026-11-23, design session `118304e2`, version 3 "Today's layout, component stage"; updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

A component saved with its code (type `component`) uses the detail page's header and inspector; its main column changes:

- **Header:** the main pills are **Copy code** (the main file) and **Copy for Claude**; **Open on 21st.dev** is in More actions. Nothing sits under the title: the author and licence are in About, the review in its own row.
- **Review chip** (on the card): 24px, ink at 8%, icon and word, never colour alone: Review: clean (success, shield-check), Concerns accepted (warning, triangle), Rejected (danger, x-circle), Not reviewed (ink-muted, shield-question), Review again (warning, a review of older code).
- **Main column:** Preview / Code / Install as the app's pill tabs (radix, arrow keys; full width below `sm`; the tab, file and line are in the URL, `?tab=code&file=…&line=…`, `?tab=install`).
  - **Preview:** a solid surface stage (12px inset, 14px radius) holding 21st's preview image by its link (`referrerPolicy="no-referrer"`, never copied) in a screen-shaped frame (updated 2026-11-25: `STAGE` in `code-stage.tsx`, 16:10 from `sm` up, 4:5 on phones, at most 75vh), `object-contain` on canvas so the whole image shows at its own proportions; the video likewise. The empty and failed boxes keep `min(46vh, 420px)`. Top-right from `sm` up (on phones, a row under the preview, so nothing covers it; owner's change, 2026-11-23): secondary xs pills **Build preview** and **Play video** (toggles to Show image; muted, controls, no autoplay under reduced motion). The stage no longer repeats **Open on 21st.dev**: it is in More actions. Under it, 12px ink-subtle: "Preview from 21st.dev, shown by its link. Build preview makes PIVOT's own live one." **Build preview** (secondary xs pill with a hammer icon; **Rebuild preview** once one exists; hidden for a rejected component): pressed (or after a save that brought new code, updated 2026-11-28), it shows a spinner and "Building…" and the line under the stage reads "Building the preview on this machine: installing its npm packages from registry.npmjs.org with install scripts off, then bundling it…", with "on GitHub Actions" in place of "on this machine" when the build runs in the cloud (ink-muted, `role="status"`). **A failed build** is one surface line (10px radius): an x-circle and "The preview build failed:" in danger 500, then a one-line summary in ink-secondary ("2 imports couldn't be found. A file it imports may not be saved.", or the error's first line) and a ghost **Show details** that reveals the raw bundler output in mono ink-muted. **Live preview** (once PIVOT has built one): the same stage holds a borderless frame on canvas from the preview origin, "Loading the preview…" (ink-muted, centred, `role="status"`) until it loads; the pills become **Reload**, **Rebuild preview** and **Show 21st's preview** (21st's image view gets **Show live preview**), and the note reads "PIVOT's live preview, running on its own origin with no network." (plus "Built from earlier code." when stale). No preview: the same box with "No preview saved" (or "Preview couldn't load"), **Show code** and **Open on 21st.dev**: the empty states keep it, as the way forward.
  - **Code:** on a surface panel, the files as tabs (pill, surface-raised; file icon, name, its role "Component / Demo / Support"; component first). Under them the path and line count in mono ink-muted with **Copy file** (secondary xs; check and "Copied" for 1.5 s, announced politely; a blocked clipboard selects the text). The code is a canvas block, 12.5px mono at 1.7, line numbers in ink-subtle that screen readers skip and selection leaves out, wide lines scroll inside the block. Emphasis, not a highlighter: keywords ink 500, strings ink-muted, comments ink-subtle italic. Files over 40 lines show the first 40 and **Show all N lines**. A flag's line opens here, highlighted on surface-raised.
  - **Install** (the third tab): a surface panel: the command in mono on surface-raised with **Copy command**. Its `?api_key=$API_KEY_21ST` shows as a short `?api_key=…` chip (6px radius, surface, ink, not selectable; the full text stays for screen readers and in its tooltip, so a selection copies exactly what Copy command copies). Under it a 12px ink-subtle helper: "The copied command holds `$API_KEY_21ST`: replace it with your 21st API key, or skip the install and copy the files…" (the placeholder as a 6px mono chip on surface-raised). Then dependency chips (`npm clsx ^2.1.1` with the range in mono ink-muted, `registry button`). **No ember fill here:** the top bar's Add stays the screen's one primary.
  - A **rejected** component shows a danger note under the tabs (x-circle, "Rejected on <date>: don't build it", the reason and flag count).
- **Inspector rows** (after Links; see Resource detail page):
  1. **Review** (summary: the verdict's icon and short word in its colour, then "· 3 flags" in warning): the verdict box on surface-raised (icon, the state in its colour at 500, then the date and notes in ink-secondary; the owner's words quoted in ink). Notes longer than a few lines are clamped to four with an accent-text ghost **Show all** (**Show less** when open). Then "PIVOT's scan · N flags" (or "found nothing") and the flags as surface-raised rows: a kind chip, what was found in ink, then `file:line` as an accent-text button that opens the Code tab there and the excerpt in mono ink-muted. Then "Hosts named in the code".
  2. **Used in** (summary: "Not used yet", "1 place", "3 places"): one surface-raised row (10px radius) per session or project, newest first: the session as an accent link with "picked as #N", and under it in 12px ink-subtle "Built in <project>" or "Fetched, not built" and the date; "Not used yet." when empty.
  - About holds Original, Author and Licence; Technical details holds the code-file count, the 21st id and the Fetched date.
- **Card:** the cover is 21st's preview image by link (the blurred card art too); the meta line reads `21st.dev · @author · MIT`; the review chip leads the chips; a rejected component also carries a canvas badge with "Rejected" at the frame's bottom-left. On the Components list, the top bar keeps **Add** (never "New component": only the agent saves one).
- Motion: the tab panels fade in for 150 ms (`motion-safe`); copy feedback swaps instantly; nothing else moves.

### My design page — `components/my-design-detail.tsx` (added 2026-11-25, My designs Phase 3; updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

No layout of its own (the owner's choice: designs are shown the way references and components are). A saved design (type `my_design`) uses the **Component page** above, part for part; the stage, live preview, build-failure line, code viewer and copy button are shared from `components/code-stage.tsx`. What differs:

- **Header:** the main pills are **Download zip** (secondary, download icon) and **Copy for Claude**; **Copy code** is in More actions. Nothing sits under the title: the kind and project are in About, the folder and dates in Technical details.
- **Tabs:** Preview / Code / How to use (`?tab=code`, `?tab=usage`).
- **Preview:** the live preview when built (pills **Reload**, **Build/Rebuild preview**, **Show screenshots**), else the saved screenshots on the same stage (updated 2026-11-25): a canvas window of the stage's shape that scrolls (focusable, labelled "Desktop, scrolls"), the desktop shot at its width and a mobile shot at most 390px wide, centred, each at its own proportions. The live preview of a design renders at 1440px and is scaled to the stage when the stage is at least 640px wide. With more than one, a row **under** the stage, so nothing covers the shot: view pills (32px; the shown one inverse, the others secondary on surface-raised, `aria-pressed`): Desktop, Mobile, Shots (screenshots without a viewport) and **Video** (play icon), each with its count in mono at 70% when it holds several; and, when the shown view holds several, a ‹ 2 / 4 › stepper on the right (ghost round buttons, the position in 12px mono ink-muted, announced politely). Video is muted with controls and no autoplay under reduced motion. Build preview is offered only when PIVOT can build this design; otherwise the note under the stage says why. Nothing saved: the empty box with **Show code**.
- **Code:** file tabs with their role (Component, Demo, Style, Support), then "Other files, written to these paths on reuse": surface-raised rows, the path as an accent-text download link and the size in ink-subtle.
- **How to use:** two surface panels, each headed in 14px medium ink. **Install:** the `npm install name@version …` command with **Copy command**, the install steps as a numbered list, then the dependency chips with exact versions. **Usage:** the usage Markdown, then a folded "Tokens it relies on (n)" (12px ink-muted, a turning chevron) that opens a mono list on surface-raised (name in ink, value in ink-muted). No ember fill anywhere on the page.
- **Inspector:** About holds Kind, Project and Sessions (accent links); Technical details holds the folder (mono), Saved, Code saved, the file count and PIVOT's scan with the Component page's flag rows. A scan with flags keeps the one-line warning row. No Review or Used in rows.
- **Card:** the first screenshot is the cover; the meta line reads `Section · odin-web`; no owner chip (removed 2026-11-25 with the personal or company distinction).

### Links — `components/resource-links.tsx` (updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

In the detail page's inspector, the **Links** row (summary "2 links · 1 suggested", or "none"), with no heading of its own; "No links yet." in 12px ink-subtle when empty. Each link is a surface-raised row (10px radius): a link icon, the relation in ink-muted ("Part of", "Has section", "Same page as"…), the other reference's title as a link, and for a suggestion "suggested" with a ✓ to accept; a × removes it. After the list a ghost **+ Link** opens a panel with the relation select, a search field and the matching titles. Used outside the inspector, the list keeps its own "Links" heading in 12px ink-subtle with "+ Link" on the right.

### Design sessions — `app/design/page.tsx`, `components/design-session.tsx` (updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

"Design sessions" (pen-tool icon) in the top bar's More menu. The list page: display title "Design sessions", one ink-muted line, then surface rows (14px radius) with the title in 15px ink, a status chip, and a second line with project, surface and date. A session page says where it stands once, shows the mockups, and keeps the rest folded: a ghost "Design sessions" back pill with an arrow, the title at the page-title size (see Typography), the **status bar**, the **Mockups**, then **References**, **Brief** and **History** as collapsed rows. The page is `max-w-6xl`, 24px between blocks; opened Brief and History keep a `max-w-4xl` reading width.

**Status bar** (replaces the status stepper, its status row and the approved band): one `bg-surface` bar (14px radius, 16px × 10px padding).

- **Sentence** (14px, weight 500, ink, a polite live region): an 8px status dot (warning for Exploring and Building, ink-subtle for Abandoned) or a check (success for Approved, ink for Done), then one sentence: "Waiting for your approval", "Waiting for a version to approve", "Changed since the last approval: approve again to go on", "Approved: version 3 · Raised card" (or "Approved. Ready to build"), "Being built", "Built and checked", "Stopped. Kept for reference". While a move saves, a spinner takes the dot's place.
- **Summary:** a quiet 13px ink-muted pill button after the sentence ("Round 2 · 5 versions · answers 2 feedback"; "3 references proposed" or "Details" before any mockup) with a chevron that turns (`aria-expanded`). It opens a list under the bar (13px, labels ink-muted): while an approval counts and the session is Approved, Building or Done, **Approved** ("Version 1 “Title” in PIVOT · Nov 17", or "in the chat", in ink) and **Note** (the owner's note quoted in ink-secondary; a chat approval's own words as recorded; "No note." in ink-muted); then **Project** and **Started**.
- **The one action:** while Exploring with mockups, **Approve this version** (32px inverse pill with a check, not ember: the top bar's Add is the screen's one ember button) for the version shown; when Approved or Building, the next manual step as an inverse pill with an arrow ("Start building", "Mark done"). On phones the action drops to its own line.
- **More actions:** a ghost round ⋯ (`aria-label` "More actions") opening a glass menu: "Back to building" (Done), Abandon or Restore, and, after a separator, "Reopen…", which opens the destructive confirm dialog (focus returns to More actions). Restore returns to Approved only while an approval still counts (not after a Reopen or a major change); otherwise to Exploring. A success toast "Status: Building" has **Undo**; a failure reverts and shows the reason in an error toast. On touch screens the bar's controls are 44px.

**Collapsed rows:** References, Brief and History are each a native `<details>` on `bg-surface` (14px radius, at least 44px tall, 8px apart): an h2 label (15px, weight 500, ink), a one-line summary in ink-muted, truncated, and a chevron that turns.

- **References:** "2 picked · Title, Title" or "10 proposed"; opened, the references below without their own heading.
- **Brief:** the newest brief's own title (its first heading); opened, a 13px ink-muted line (note · reference count · milestone · date), then the brief as Markdown with its reference chips.
- **History:** "12 events · last: approved in pivot, Nov 17"; opened, "Newest first" in 13px ink-muted with a ghost **Expand all** / **Collapse all** pill, then every other brief, every decision and every feedback, newest first, as `bg-surface-raised` `<details>` cards (12px radius, 2px apart): kind (ink-secondary, weight 500: "QA report", "Changed", "Deviation", "Approved in PIVOT", "Approved in the chat", "Brief", "Approved brief", "Major change", "Feedback") · date (13px ink-muted) · one-line summary in ink, truncated until opened · chevron. Below `sm` the card is the summary with its kind in front, and the date moves inside. Opened: the direction, then the details or the brief as Markdown.
- Each brief and decision keeps its own id (`#brief-<id>`, `#decision-<id>`), and the references `#references`; a link with that hash opens the row it sits in, then the item, and scrolls to it. Native details let find-in-page reach closed text.
- **At the references step** (references proposed, no mockups yet), the references are the page: they follow the status bar open and in full, with their heading.

**Mockups** (added 2026-11-03, `components/design-mockups.tsx`; updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session"): right under the status bar, only when the session has mockups; the bar's Approve this version follows the version shown here. Once an approval counts and the session has moved on, it opens on the approved version. The "Mockups" heading is for screen readers only.

- **Keys:** not written out (updated 2026-11-17): each tab announces its number with `aria-keyshortcuts`, the tabs use a roving tabindex (← → move the selection and the focus with it), and the keys don't act while focus is in a menu, a radio group, a History row, a link or another button.
- **Pills:** 32px, 13px label, weight 500; inactive surface in ink-secondary (hover surface-raised), active inverse.
  - **Round** radiogroup, only with more than one round; the latest is marked "latest" at 70% opacity.
  - **Version** tablist: the number in mono at 70% opacity, then the title; it scrolls sideways on narrow screens instead of wrapping. The approved version carries a small success chip "Approved" with a check, in on-inverse text.
  - **Width** radiogroup: Desktop (1440), Tablet (834), Phone (390).
- **Actions** on the right of the width row: a secondary **Full screen** pill with a maximize icon, the one visible tool, and a ghost round ⋯ **More mockup actions** (a spinner while the preview opens) with **Replay** (it reloads the version in a fresh frame, so its motion restarts with nothing left from the last run), **Open alone** (new tab), **Open interactive preview** ("Preview open" while PIVOT's preview window for this round is open) and, after a separator, **About motion**. Approve is in the status bar.
- **About motion** (replaces the motion line and its (i)): no motion line shows by default. The menu item toggles a surface note above the frame (12px radius, 13px ink-muted): "All versions are interactive: their motion runs in the interactive preview." (or the one-version wording) where it applies, "Motion follows your browser, which has reduced motion **on** / **off**" (the state in ink, weight 500), and how to preview the other setting (the OS switch, or Motion: reduced in the interactive preview, then Replay). It reads `prefers-reduced-motion` live and never overrides it.
- **Frame:** a surface panel (14px radius), 80vh tall, holding the mockup in a sandboxed iframe at the chosen device width, scaled down to fit the column (never up) and scrolling inside.
- **Comment in full screen:** while Exploring, a ghost pill with a message-plus icon under the frame opens the full-screen view, where comments are made.
- **Interactive versions** (added 2026-11-10, updated 2026-11-17): only in a round that mixes static and interactive versions, the interactive tabs carry a small chip "Interactive" (12px, `bg-surface-raised`, `text-ink-secondary`).
- **A version chosen in the preview** (added 2026-11-17): a surface band (14px radius, role status) above the frame, "You chose version 3, “Title”, in the preview.", with an inverse **Approve it…** pill (check icon) and a ghost × that dismisses it. When the choice arrives, the page switches to that version and opens its approve dialog once, with the note written in the preview.
- **Interactive preview window** (`design/scripts/preview.mjs` in the plugin, not part of the app; updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session"): the full-screen view's layout in plain CSS with these tokens copied in (it is its own page): the version fills the window, and the quick bar steps through versions (‹ › with their keys in tooltips and `aria-keyshortcuts`) and switches Use / Comment. No `<kbd>` in the drawer: keys live in tooltips and `aria-keyshortcuts`.
  - **Header:** a small "Interactive preview" label (12px ink-muted) and the session title (16px, weight 500). The round and PIVOT's origin are in Technical details.
  - **Tabs** Versions · Comment · View: a surface pill segment (3px padding, 30px tabs, 40px on touch), the selected tab ink with canvas text, the others ink-muted (surface-raised on hover); manual activation (the arrows, Home and End move the focus, Enter or Space opens one; the arrows never switch versions there). The Comment tab carries the draft's note count ("Comment · 2"), and the last tab opened comes back.
  - **Versions:** full-width rows (number · title, a static/interactive chip), the selected one inverse, each with its key in a tooltip.
  - **Comment:** see Mockup feedback.
  - **View:** Width (Desktop / Tablet / Phone, the scaled note), Motion (Full / Reduced, then "This window: full motion" in small ink-muted text), Tools (Replay, Compare), Quick bar (Bottom / Top / Dot), each under a 12px uppercase heading, then a collapsed surface **Technical details** (12px radius): the version's id and digest in mono, "Round 2 · from PIVOT at <origin>", and the session link field with **Copy link**.
  - **Footer** (above a divider): **Choose this version**, the window's one ember button (40px, full width). Its confirm step ("Send version 3 · Title to Claude as your choice?…", the digest in a tooltip, a note field, an ember **Send to Claude** and Cancel) replaces it while open, so one ember shows at a time. Under it a quiet 13px accent-text link **Approve in PIVOT ↗**: the preview's own process opens the session page in the user's browser (the window can't reach PIVOT), and a small status line says "Opened in your browser." or where to copy the link instead.
  - **Compare** labels each side "3 · Title", with the digest in its tooltip.
- **Digest** (updated 2026-11-17): named only in the approve dialog's line ("exactly as shown (digest `3f9a1c2b7e44`)", in mono); the page no longer repeats it under the frame.
- **Broken binding** (added 2026-11-04): when the latest approval's version changed or is gone, a 13px `text-danger` line above the frame (role alert) says it can't be built until a version is approved again.
- **Owner passphrase** (added 2026-11-10): the approve dialog has a labelled password field "Owner passphrase" under the note; Approve stays disabled until it is filled, and Enter submits. With no passphrase set yet, an ink-muted 13px alert instead says how to set one (`pnpm owner:passphrase`, in mono, in ink). A refused attempt shows its reason as a toast and prepares a fresh form. The restore step in Settings › Backup & restore has the same kind of field before Restore. A skill's **Save to disk** and **Overwrite disk** open the same kind of dialog ("Save this skill to disk?" / "Overwrite SKILL.md on disk?"), with the first 12 characters of the content hash in mono, an "Owner passphrase" field, and Save (or Overwrite disk) as its primary button.
- **Approve dialog:** title "Approve version 3, “Raised card”?", one line on what happens, a labelled optional textarea "Note for the build", then ghost Cancel and the default **Approve** button. A success toast says a waiting Claude Code session starts building.
- **References** (added 2026-11-10): inside the References row, or open in full at the references step under a "References" heading (20px medium). Before a pick, a one-line muted subtitle on how to pick ("Tell Claude Code which numbers to use…") and the full grid below. **After a pick** (updated 2026-11-17): "3 picked of 10" in ink-muted beside the heading, then one row of the picked references as compact surface links (14px radius; a 64×40 preview cropped from the top, the mono number in ink-muted, the title, truncated), opening the library item or the original page, and a ghost **Show all 10 references** pill (`aria-expanded`, a turning chevron; "Show picked only" when open) that reveals the user's words quoted and the full grid. The cards come in two groups (added 2026-11-15), each under a 14px medium `text-ink-secondary` subheading with its count and a muted hint: **UI layouts** (whole pages and designs) first, then **Components** (single components); an empty group is left out. Each group is a responsive grid (1 / 2 / 3 columns) of solid `bg-surface` cards, radius 14px, no border or shadow: a 16:10 preview cropped from the top (`bg-surface-raised` placeholder with "Capturing a preview…" and a spinner, or the reason there is none, in 12px muted text; an external page PIVOT never captures, such as 21st.dev, reads "Not captured. Open the page to review it.", updated 2026-11-23), then a round mono number chip, the title, "Library" or "External · source" in muted 12px, the why line in `text-ink-secondary`, Take and Avoid in 12px, and text links "Open in library" / "Original page" (new tab, with a screen-reader note). Picked cards carry a "Picked" pill with a check; once a pick exists the others' previews drop to 60% opacity (their text keeps full contrast, updated 2026-11-17).
- History labels an approval made here "Approved in PIVOT". The status sentence reads "Waiting for your approval" while Exploring with mockups.

### Full-screen mockup view — `app/design/[id]/mockups/page.tsx`, `components/mockup-stage.tsx` (added 2026-11-19; updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

The mockup is the page: no top bar, the version fills the window (Desktop at the window's own size, Tablet and Phone at their width, centred on canvas). Two pieces of chrome float over it, both strong glass with the overlay shadow:

- **Quick bar:** a pill capsule, 44px tall (52px on touch), 16px from the bottom edge (plus the safe area), centred. Ghost round 36px buttons (‹ and ›, chevron icons, `aria-label` "Previous version" / "Next version"), between them "3/7" in 13px mono ink-muted and the title in 13px medium ink (truncated at 18rem; hidden below 640px), a 1px divider, then the drawer toggle (panel-right icon, surface-raised while open). It grabs and moves to the top or bottom edge; **Dot** folds it into a 44px round button with the number ("3" in ink, "/7" in 12px ink-muted) inside a 2px conic ring that fills to the version's place in the round. While the drawer is open the capsule shifts left by half the drawer, so it stays centred in the visible page.
- **Drawer:** 360px, 14px radius, inset 12px from the top, right and bottom; below 640px a bottom sheet (24px top corners, at most 75dvh). Header: a ghost "← Session" pill (32px), then on the right a ghost round ⋯ **More actions** and a ghost round × ("Close preview controls"); under them the session title (15px medium ink) and "Round 2 · Waiting for your approval" (13px ink-muted, the session page's status sentence). Sections under 12px medium uppercase ink-muted headings (0.02em): Round (only with more than one round: 32px round mono pills, the chosen inverse), Versions (full-width rows, 36px min, 44px on touch, 12px radius: the number in 12px mono ink-subtle, the title in 14px ink-secondary; the selected row inverse, weight 500; Interactive and Approved chips as in the section; no key hint in the heading: each row's tooltip says "Press 3 · ← → for the next", with `aria-keyshortcuts`), View (the width pills and the scaled note; the motion note only when asked for), and **Feedback** only on demand (see Mockup feedback).
- **More actions** menu: Replay, Open alone, Interactive preview ("Preview open" while it is), a separator, a "Quick bar" radio group (Bottom, Top, Dot), a separator, About motion (it toggles the motion note in View).
- **Footer** (above a divider): the broken-binding alert, the chosen-in-the-preview note, the DESIGN.md box, then, while Exploring, **Comment on this version** (secondary on surface-raised, full width, 40px; `aria-expanded`: it opens the Feedback section and focuses its text, and closes it again) above **Approve version 3** (a full-width 40px ember button with a check). This view has no top bar, so Approve is the screen's one ember action; what the approval asks for is its screen-reader description. Approved: "✓ Approved: version 3" in 14px success, weight 500, centred. Otherwise a 13px ink-muted line "Building: approving is closed for this session."
- **Motion:** the drawer moves by transform only, 250ms in and 200ms out on `cubic-bezier(0.32, 0.72, 0, 1)`, and turns visible at once when it opens (hidden only after the exit); the quick bar's shift uses the same curve; a dropped bar settles in 240ms on `cubic-bezier(0.23, 1, 0.32, 1)`; buttons scale to 0.97 while pressed. Versions, widths and Replay switch instantly. With reduced motion nothing moves and nothing scales.

### Mockup feedback — `components/mockup-feedback.tsx` (added 2026-11-20, design session `10688691`, version 1 "Pins on the page"; Select tool updated 2026-11-20, session `29471a8b`, version 1 "Select and Pin"; updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

- **Comment button** on the quick bar after the divider: a 36px pill with a message-plus icon and, when the draft has notes, their count in 12px mono (named "Comment, 3 notes"). Inverse while comment mode is on (`aria-pressed`). Not on phones.
- **Comment mode** (updated 2026-11-20, session `3ae676b1` "Comment on the live page"): it works on the live page as it is shown (no picture, nothing shrunk; the drawer keeps floating over it), with outlines, chips and markers drawn over the page, clipped to its frame, and moving with its scroll. A strong-glass toolbar (pill, 13px), centred in the space left of the drawer, at the top holds the tool switch, a surface pill with two 30px options, **Select** (cursor icon) and **Pin** (map-pin icon), each with a 12px mono key hint (`V`, `P`) and the chosen one inverse; the tool's hint in ink-muted, each ending "· Esc to leave" ("Click an element to comment", "Click to comment · Arrows move" while an element is outlined, "Arrows move · Enter comments" while the keys hold the outline, "Click the page to pin a note"); a secondary "Comment at centre" / "Add pin at centre" pill; and an inverse "Done" pill. Select uses the default cursor, Pin a crosshair. A screen reader hears the tool change ("Select tool.", "Pin tool.") and, on the page (an application with the role description "element picker"), each element the arrows reach. With the page focused (a picker over it, a tab stop after Done) it shows a 2px accent focus ring inside its edge. When the keyboard walk or Show reaches an element under the drawer, a strong-glass pill under the toolbar reads "a.btn “Sign in” is behind the panel" with an eye-off icon in ink-muted and an inverse "Hide panel" sub-pill; the focus returns to the picker once the drawer is gone. Notes made at another width are hidden, and a strong-glass pill under the toolbar says at which width they were made. While an element is outlined and no note is open, an **element path** strip sits under the toolbar (under those pills when they show; added 2026-11-22): a 30px strong-glass pill, centred, never wider than the space left of the drawer, with up to 3 ancestors as 24px ghost pills in 12px mono ink-secondary (ink on hover), `›` in ink-muted between them, and the element itself in 12px mono ink 500; when it is too long the leading ancestors are cut first.
- **Select:** the element under the cursor (or the keyboard's) gets a 2px ink outline with a 3px canvas ring, and an inverse chip (6px radius, 12px mono) above its top-left corner naming it with its size in 65% opacity: `a.btn “Start free” · 108×42`; below the element when above would sit under the toolbar, ending at the element's right edge in the right part of the page, and after a marker on the same corner. Nothing dims. An element that has a note keeps a 1.5px ink outline at 75%, solid 2px while its note is open, and the pointer doesn't outline it again. Loading reads "Reading the page’s elements…"; without elements the hint shows an alert icon and "Couldn’t read this version’s elements · Pin only", and Select is muted.
- **Markers:** 28px ink circles with the number in 13px mono canvas, a 2px canvas ring and the overlay shadow, so they read on light and dark mockups. Never ember. A spot's sits on the spot; an element's just outside its top-left corner (14px out). They scale in from 0.9 (`pin-in`, 150ms); dragging, nudging and deleting are instant.
- **Note popover:** strong glass, 300px, 14px radius, opening from the pin, or under the element (inside its top when the element is taller than 240px) (`pop-in`, 150ms). An element's note starts with a breadcrumb of up to 3 ancestors as 24px ghost pills in 12px mono, `›` between them and the element in ink 500. It has a 12px ink-muted label ("Note on a.btn “Go Pro”" or "Note for pin 2"), a surface textarea (14px, 12px radius), "Saved in your draft" and a ghost Delete.
- **Feedback section** (drawer, after View, under the 12px uppercase heading, "· commenting" while comment mode is on): while Exploring it shows only once asked for (**Comment on this version** in the footer, P, or a draft or comment mode already there), and after a send it stays open to say so. It holds the This version / Whole round pills, a surface textarea (14px radius; 16px text on phones) with "Claude answers with a new round." under it in 12px ink-muted, and the notes as surface rows (12px radius): a 24px ink number, the note clamped to two lines, what it is on in 12px mono ink-muted (`a.btn “Go Pro” · Desktop`, `Spot · Desktop`), and ghost Show and Delete icon buttons. With no notes there is a secondary **Comment on the page** pill (`aria-keyshortcuts="P"`) whose tooltip says "Press P · then V selects an element, P pins a spot"; on phones, "Comments on the page need a wider screen." Outside Exploring there is no explainer: the section shows only this round's earlier feedback, and only when there is some.
- **Send to Claude:** a full-width 36px inverse pill with a send icon. It is not ember, because Approve stays the screen's only ember. Once sent it is replaced, at the same height, by "Sent · waiting for Claude" with a static ink-muted dot. "Earlier feedback · N (n open)" is a disclosure above a divider; each item is a surface row with its status in words.
- **DESIGN.md box:** above Approve in the drawer footer, and above the frame on the session page. A surface-raised box (12px radius, 13px) holds a file icon and "Also updates DESIGN.md" in ink 500, the summary in ink-secondary (two lines), and "View change" as an accent-text link. The dialog shows the change in 13px mono on surface, with + / − lines on success / danger at 12% and their sign in a gutter (screen readers hear "added" / "removed"), or the plain new text when it isn't a diff.
- **History:** "Feedback" rows like the other kinds, with the summary "“text” · 2 notes · on version 3 (round 2) · open" and, opened, the text, the numbered notes as "1 · a.btn “Go Pro” — text" (the element in mono) or "3 · Spot at 400, 760 — text", and the status.
- **Interactive preview window** (updated 2026-11-20, design session `3ae676b1`, version 1 "Comment on the live page"; updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session"): the same pieces on the running version, in the window's plain CSS.
  - **Modes:** a surface switch of two 30px options, **Use** (hand icon) and **Comment** (message-plus icon; ⌥C), the chosen one inverse, in the quick bar only, after the divider (hidden in Dot), with "n notes" in 13px mono ink-muted after it.
  - **Comment mode:** the version stays as it is under a transparent shield (default cursor for Select, crosshair for Pin). The strong-glass toolbar at the top (below the quick bar when that sits at Top) holds Select (V) / Pin (P) as the same surface switch with mono key hints, the status "Commenting · page paused · Esc to use it" in ink-muted (hidden below 900px), a raised "Comment at centre" / "Add pin at centre" pill and an inverse **Done**. The outline, chip, markers (an element's with a 1.5px ink outline at 75%) and the note popover (300px strong glass: "Note on a.item “Settings”" or "Note for spot 2" in 12px ink-muted, the textarea, "Captured as you see it" and a ghost Delete) are the full-screen view's; the keyboard walk and the element path strip are too (added 2026-11-22), the strip 8px under the toolbar, or under the status line when it shows. The popover opens under its note (above when there is no room), clear of the drawer.
  - **Comment tab** (drawer): while in Use, a secondary full-width **Comment on the page** button (⌥C in its tooltip and `aria-keyshortcuts`); while commenting, the Select / Pin switch instead (keys in tooltips, "Select (V)", no key hint). Then the notes as surface rows (12px radius: a 24px ink number, an outlined one for a spot; the note in 13px ink or "No text yet" in ink-muted; under it in 12px mono ink-muted the element or "Spot", the width it was made at, "made at Desktop 1500" when it isn't the shown width, and "live"; a ghost trash button), or the line "Use the page first: open the menu or tab you want, then switch to Comment."; then the surface textarea "Anything else for Claude (optional)" and **Send to Claude**, a full-width 36px inverse pill with a send icon (never ember: Choose this version stays the window's one ember action), and a status line ("Sent · waiting for Claude"). Switching to Comment opens this tab.

### Suggestions — `components/suggestions.tsx`

A surface panel (14px radius) on the Inbox page and at the top of a reference's detail page: a sparkles icon, "3 suggestions from an agent" and an ink-muted note that nothing changes until you accept. Each suggestion is a surface-raised row with a checkbox, what it suggests ("Style: Dark", "Collection: Pricing pages (new)", "Title: …"), the reference it is for (Inbox only), the reason in ink-muted, and ✓ / × icon buttons. With some checked, "Accept n" and "Reject n" appear at the right of the header.

### Backup & restore — `components/backup-section.tsx`

A Settings section: a secondary **Back up the library** pill with the result beside it (counts, then the folder path in mono as a link that shows it in Finder). Under a divider: "Restore from a backup folder", a mono path field and a secondary **Preview** pill. The preview states the counts in a sentence, lists the conflicts in 12px muted text, offers one select for them (Keep is the default), and has a primary **Restore** pill; the result is a status line that says restoring again adds nothing twice.

### Hybrid search — `components/external-search.tsx` (`ScopeSwitch`, `ExternalResults`)

- **Scope switch:** with a query in the library, the toolbar shows a small outline toggle group **All · Library · External** (the chosen one surface-raised with ink text), between the filter chips and Clear filters. The command palette shows the same switch in a row under its input, above a divider.
- **Outside your library:** a 22px title "Outside your library for “…”" and one 13px ink-muted line saying direct results come from free public catalogs searched on this computer and nothing is saved until you save it. Under `All` it follows the library results after 40px of space; under `External` it replaces them.
- **Provider group:** a 15px ink name, a raised "Direct" chip, the licence as an accent-text link, "Catalog from <date>" and "n of N" in 12px ink-subtle. A stale or failed provider adds one 13px ink-muted line with a warning triangle; a provider with no match says so in one line; a switched-off provider is not shown.
- **Result card:** a solid surface container (14px radius, no border or glass, since there is no screenshot to frame): 15px ink title truncated to one line with category chips on the right, a two-line 13px ink-muted description, an 11px ink-subtle attribution line ("Magic UI (magicui.design) · MIT"), then a secondary **Open** pill and a ghost **Save to library** pill. A result already saved shows a ghost "In your library" link instead; a result without a confirmed page has no Save. No ember fills: Save is never the screen's primary action.
- **Search on other sites:** a 15px heading, the line "These open each site’s own search page. They aren’t results.", and a wrapping row of 32px surface pills (external-link icon, the site's name, "saved source" in 11px ink-subtle).
- **Command palette:** direct results are groups headed "<name> · Direct · <licence>" with an external-link icon, the title and the description (or "In your library") in muted text; selecting opens the item's page in a new tab.
- **Settings rows:** a 160px ink-subtle label column beside the value from `sm` up; below `sm` the label sits above the value, so wide controls (the capture colour-scheme select) never push the page sideways.
- **Settings › Search:** the intro says catalogs are kept in the R2 bucket under `external-catalogs/`, not on this computer, and may add small R2 charges; a storage problem shows under the provider as a 12px ink-muted line with a warning triangle. One row per provider: a checkbox "Search <host>", a ghost Refresh catalog pill (spinner while it runs), and a 12px line with the item count, the catalog date and the licence link ("titles, descriptions and links only; no code" for React Bits). After Refresh, a toast says "<name> updated: N components"; within a minute of the last download it says the catalog was updated less than a minute ago and when to try again. While a new query loads, the previous results stay dimmed under their own query with a "Searching for “…”…" line, so nothing flickers and nothing is shown under the wrong query.

### Other resource types — `components/hidden-section.tsx`, `app/settings/page.tsx` (`LibrarySection`) (added 2026-11-18)

Direction "A · Switch in Settings" (design session `3c806f9d`, approved by the owner in PIVOT, 2026-11-18). Everything outside design (Knowledge, Skills, Export, Share package) hides behind one setting; nothing is deleted.

- **Settings › Library:** a section titled "Library" ("What PIVOT shows. Nothing here deletes anything.") with one `Row`, "Other resource types": a checkbox whose label is "Show prompts, snippets, coding rules, checklists, MCP configs and skills", and a 12px ink-muted helper (its `aria-describedby`) saying what it adds, that nothing is deleted, and how many such items exist. Toggling saves at once, keeps focus on the checkbox and announces "Knowledge and Skills added to the navigation" / "Knowledge and Skills hidden" in a polite live region. `#other-types` scrolls to it and focuses the checkbox. The Global skills row shows only while it is on.
- **Hidden section page:** a link to a hidden section or type keeps the page head (the display title, focused on arrival) and shows one solid surface card (14px radius, 24px padding, max 576px): "These types are hidden" in 22px ink, one 15px ink-muted line ("… are hidden in this PIVOT. Your items are still here."), and a secondary **Show them** pill on surface-raised (on a surface card the secondary pill takes the raised fill so it reads as a button), which turns the setting on and shows the section in place.
- **⌘K:** a "Hidden types" group with one row, "n matches in hidden types" and a **Show** shortcut, when a search matches hidden items; "Show other resource types…" (eye icon) in Actions while they are hidden.

### Capture queue — `app/captures/page.tsx`

Display title "Capture queue", a 14px ink-muted line, then a radiogroup of pills (All, Queued & capturing, Failed & partial; the chosen one inverse). Each run is a surface row (14px radius): a status chip (danger for Failed, warning for Partial, a spinner while running), the item's title as a link, the time in mono ink-subtle, a small **Cancel** or **Retry** pill, and a second line in 12px ink-muted with the scheme, options, retries, quality and error. It refreshes every 2 seconds while something runs. A "Requested for later" filter lists capture-later requests, each with **Capture now** and a ghost **Drop**. Above the filters, a surface "Worth a look" panel appears only when a site keeps failing (host in warning) or a newest capture looks worse than an earlier one.

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

Appears bottom-centre while resources are selected: strong glass, 28px radius, 6px padding (16px on the left), wraps on narrow screens, enters with a 200ms fade and 8px rise. Count in mono ink-subtle (promoted to ink-muted by the glass), then ghost actions (Copy for Claude, Export and Share package while Other resource types is on, Collection, Remove, Trash; in Trash: Restore and Delete forever in danger, confirmed in a dialog).

- **Add to collection** popover (strong glass, 256px): a "Find or create a collection…" field, the collections with their counts, and, when the typed name is new, a "Create “name”" row with a folder-plus icon that creates the collection and adds the selection to it.

### Index rail — `components/library-rail.tsx`, `components/library-view.tsx`, `components/library-motion.ts` (added 2026-11-15)

The Library landing (`/`) and References (`/?type=reference`), approved as "Index rail" in design session `06f166a3`. Other sections, collections and the trash keep the page header below.

- **Head band:** breadcrumbs (References), then one row: the display title and its count badge; below `lg`, Filters and the grid/list toggle on the right (from `lg` Sort and Layout live in the rail; updated 2026-11-17). While a filter is on, a second row of inverse chips (facet kind at 70% before its name) with ×, the via/collection/page chips and a ghost **Clear filters**. The result count is also read out through a polite live region.
- **Rail:** from `lg`, a 232px column left of the grid (40px gap), sticky at `top: calc(var(--topbar-h) + 16px)` and scrolling on its own when taller than the screen. It starts with a 40px **rail head**, pulled up by its own height plus 16px so the first group lines up with the first card row (transparent until M1 lands the title there: the title at 22px in ink, the count in 13px mono ink-subtle; `aria-hidden`, the h1 stays the heading), then **Sort** and **Layout** (Grid, List) as option lists on both pages, then the page's own groups; below `lg` the same content sits in a popover (strong glass, 288px, max 70vh) behind a secondary **Filters (n)** pill. Groups are 24px apart, each headed in 13px ink-subtle; options are 34px rows at 12px radius, 14px ink-secondary, count in 12px mono ink-subtle on the right; hover fills surface; the current or picked option fills surface-raised with ink text and, for facets, an accent-text check. Library: View (All / Folders / Items), Sort, Types (links, empty ones included), Collections (links). References: one group per facet kind with the five most used values and an accent-text "Show N more" / "Show fewer". The values and their order come from the unfiltered list, so the rail never rearranges while narrowing: a value with nothing left shows 0 in ink-subtle instead of disappearing. Group names are labels, not headings (the page keeps h1, then h2).
- **Shelf:** a glass folder per type that holds something and per collection that holds something; empty types live only in the rail.
- **Grid:** `minmax(min(100%, 300px), 1fr)` beside the rail (instead of 360px), same 40px / 24px gaps. Cards use the **compact caption**: one row of site icon, title and host (the host fades out under Open source / Copy on hover or focus); the first facet shows on a solid canvas chip at the frame's top-right while hovered or focused (the select box keeps the top-left), nothing translucent on the screenshot.
- **No compact head** (direction "D · Rail header, no strip", design session `4af5dbcb`, approved 2026-11-17): while scrolling only the top bar stays at the top. From `lg` the title lands in the rail head; below `lg` it docks into the top bar's row in place of the wordmark: the title at 17px ink, the count in 13px mono ink, and a 44px Filters icon button (the rail's content in its popover, Sort and Layout included, rows at least 44px tall; an 18px inverse badge counts the active facets), next to search and Inbox. The docked title and count are `aria-hidden` (the h1 stays the heading). While the phone search field is open, the dock, the logo and Inbox step out of sight and out of the tab order. It docks when the title's bottom passes under the bar and leaves when it comes back (a 200ms fade and 4px rise; none with reduced motion).
- **Motion (GSAP 3: ScrollTrigger, Flip, CustomEase, `@gsap/react`; round 2, approved 2026-11-15):** every move takes an object from where it was to where it lands, in 220–420ms, and never blocks a click. Eases: `out` `cubic-bezier(.23,1,.32,1)` for arrivals, `glide` `cubic-bezier(.32,.72,0,1)` for moves, `panel` `cubic-bezier(.45,0,.25,1)` for the rail highlight.
  - M1 title collapse (from `lg`): as the page scrolls, the 72px title shrinks and slides into the rail head's 22px title (scrubbed with 0.3s smoothing, from the title's top reaching the top bar to its bottom + 24px), landing on its words exactly (the scale's origin is the title's bottom-left, corrected for how far its words hang below it), then crossfades into it over the last quarter while the rail head fades in. Reduced motion: the rail head fades in (150ms) where the title leaves. The folders recede one by one (scale 0.94, rise 16px, fade, staggered). The compact head is inert and click-through until 80%. Reduced motion: nothing scrubs or scales; the compact head switches on with a 150ms fade where the title leaves.
  - M2 folder → References: clicking the References folder grows its name into the page title and flies its visible sheets into the first cards' screenshot frames (420ms `glide`); the other folders fade and shrink to 0.97 (150ms); the remaining cards rise 12px in (300ms `out`, 35ms stagger, from 120ms), the landed cards' captions fade in at 200ms, the crumbs, count, controls and rail fade in. A click or a key finishes it at once, and the page title takes focus. The list opens from rows already loaded (the real fetch still runs); if it isn't drawn within 300ms the page rises in instead. Back (the title at rest, scrolled less than 40px) shrinks the title into the folder's name (380ms) while the folders make their own entrance, and focus returns to the folder. The References folder shows its four most recent items, newest at the front. Other folders fade the page out (140ms). Reduced motion: 200ms fade in.
  - M3 filter reflow: a facet toggle fades and shrinks the cards that won't match (160ms, 20ms stagger); the staying cards glide to their new places from 80ms after the toggle (340ms `glide`) and new ones arrive from 180ms, from 0.96 and 8px below (260ms `out`, 40ms stagger, at most six animated); a list that arrives later starts them at once. Only cards in the viewport animate; a toggle mid-move starts from where they are; typing in search never animates. Reduced motion: a 150ms fade of the grid.
  - M4 grid ↔ list: each screenshot frame morphs into its row's 64×40 thumbnail and back (380ms `glide`); the words fade in from 260ms (160ms); the first visible item keeps its place. Reduced motion: a 150ms fade.
  - D1: in the rail's View and Sort lists the surface-raised highlight slides to the picked row (270ms `panel`); until it is placed the picked row keeps its own fill. D2: the counts roll up or down to the new number (220ms; the live region and the pill's label carry the words). D3: on pointer devices a card lifts 2px on hover (200ms), not while cards move and not with reduced motion. D4: on first load the head rises 8px (180ms) and the cards on screen rise 12px (300ms, 35ms stagger).
  - While the rail pages are open, `scroll-padding-top` is the top bar plus 16px, so keyboard focus never lands under the bar.
  - GSAP moves wrappers only: the title, the folder wrappers, the card cells and the screenshot frames. It reads the folder's sheets but never animates them, and never touches the screenshot inside a frame. The folder's own fan and the card's screenshot scroll stay CSS; the grid ignores the pointer while a Flip runs.

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
- **Add a state:** under the "Already saved" rows, an underlined 11px link "Add this view as a state of “…”" opens a surface-raised row: "Which state is on screen?", a pill select of states (and a name field for Other…), and a small **Add state** button.
- **Pick assets:** a fourth outline pill next to the section ones. It opens a surface panel of fieldsets (Images with 48×32 thumbnails and sizes, Icons (SVG) on a white 24px tile, Fonts (names only), Gradients with a 48×20 swatch and the CSS in mono), each row a checkbox. Files stop at 20 (the rest disable). "Save to “…”" with the file count is the action; the result shows as a status line.
- **Save a part of the page:** under the type grid, a 12px ink-muted line and three small outline pills (Select a section, Crop, Pick from a list). The list shows the page's sections as surface rows: the name in ink and the size in mono ink-subtle. While one is being captured: a spinner line, "Capturing the section…".
- **Section picker (on the page):** a full-window transparent layer with a crosshair, a 2px ember outline over the element or the box being dragged (12% ember fill, 4px radius), and a dark pill centred at the top with the keys ("↑ bigger · ↓ smaller · Enter to save · Esc to cancel").
- **Private page review:** a surface panel (14px radius) with "This page looks private" in warning, the reasons as a short list in ink-muted, one ink-muted paragraph, then the mask editor: the screenshot with solid black boxes (focusable; accent-text focus ring), "Add a box" (outline pill) with "or drag on the picture", and a checkbox list of the masks. Two checkboxes close it: "Attach this view" and "I checked it: upload this screenshot with these masks". Save stays disabled until the second is ticked.
- **Approval view:** opened from **Review** on a held save in the waiting panel (which opens by itself when something needs you): the title, the reasons, the same mask editor, then **Upload with these masks** (the one ember button), "Upload without the screenshot" and a two-step Discard.
- **Capture session:** a link-style line under the collection pills ("Keep saving into this collection until I end it (capture session)"); while on, a surface status bar at the top of the popup ("Capture session: saves go into Heroes.") with an underlined **End**.
- **Library › Elsewhere:** with a query typed, a two-option radiogroup (Library, Elsewhere; the chosen one inverse). Elsewhere lists inspiration sites as rows (external-link icon, name in ink, "saved source" in ink-subtle) that open their search in a new tab, and an 11px note that nothing is saved.
- **Options › Waiting saves:** a line saying how many saves wait on this computer, an outline **Export waiting saves** pill (downloads a file) and an "Import a file" pill; importing shows the count in a surface box first, with the primary **Import n** button.
- **Facet combobox:** a rounded surface field (18px radius, min 36px) holding the chosen values as 24px inverse chips with a remove ×, then a borderless input ("Add page type…"). The accent-text focus ring sits on the field, not the input. Focusing it opens a list right under it (surface-raised, 14px radius, soft drop shadow, up to 176px): the values already used, most used first, with their count in mono ink-subtle; typing filters them (names starting with the text first) and adds a "+ Create “text”" row. ↑↓ move the highlight (surface), Enter picks it, Backspace in an empty field removes the last chip. Nothing is highlighted until you type or press ↓, so Enter in an empty field still saves.

### Browser surfaces — `globals.css` base layer

Text selection is ember at 45% with ink text; the caret is accent-text; the scrollbar is a divider thumb on a transparent track; native controls take ember as `accent-color`.

## Do's and Don'ts (updated 2026-11-25, design session `e5dc7a11`, version 3 "Inspector + quiet session")

### Do:

- **Do** keep one ember-orange filled button per screen, with dark (on-accent) text.
- **Do** use accent-text for links, focus (2px outline, 3px offset) and the selected outline.
- **Do** build hierarchy with canvas → surface → surface-raised; use divider only in dialog footers and tables.
- **Do** put strong glass on every floating overlay (menus, popovers, selects, dialogs, palette, toasts, selection bar) and light glass on the top bar only.
- **Do** use ink for any text placed directly on the top bar's glass.
- **Do** keep every control a pill and every container at the 14px card radius.
- **Do** check new text colours at 4.5:1 on canvas, surface, surface-raised and the white-backdrop glass composite.
- **Do** keep motion at 150ms ease-out for hover and pill changes and make every transition instant under reduced motion; the Index rail pages keep short opacity fades instead (their motion block lists them).
- **Do** hide what the owner doesn't act on: ids, digests, paths, origins, timestamps, file counts, scan details and key hints go behind a closed "Technical details" row or into a tooltip (keys also as `aria-keyshortcuts`). A scan that found something keeps a one-line warning visible, with Details to open the rest.
- **Do** give a header its main actions as labelled pills and everything else in one "⋯ More actions" menu, with a text label on every item; a destructive item (Move to trash) comes last, after a separator, in danger.
- **Do** say where a thing stands as one status with one next action beside it; rarer moves go into More actions.

### Don't:

- **Don't** add a light theme, a theme toggle, or any `prefers-color-scheme` branch, in the app or the extension.
- **Don't** put white text on the ember fill (2.87:1).
- **Don't** use orange for icons, hover states, badges or decoration, or ember light outside the top bar and the record card's highlight and edge.
- **Don't** put glass, borders or shadows over saved work, or on rows and panels that show it; the folder and the record card are the only glass that holds work, and their glass sits behind it.
- **Don't** use weights above 500, sizes below 12px, or `font-size` on `html`.
- **Don't** scale or lift thumbnails on hover.
- **Don't** signal state by colour alone; danger, success and warning always carry a word or an icon.
- **Don't** put ids, digests, paths or timestamps in a page's first view, or `<kbd>` key hints in a drawer or side panel.
- **Don't** add a second ⋯ menu to a header, or icon-only actions beside it: every action outside the menu has a word.

### Copy in the UI

- **Do** write in English, sentence case, from the user's side: buttons name the action ("Add", "Copy for Claude", "Move to trash"), toasts confirm it in the past tense ("Copied for Claude · ~1.9k tokens"), errors say what happened and what to do.
- **Do** call the action that copies an item for an agent **Copy for Claude**, never "Context".
- **Do** show counts as plain numbers in ink-subtle or mono.
- **Don't** use "Submit", "OK", or emoji anywhere in the UI.
