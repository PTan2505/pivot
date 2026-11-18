# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Designer-developers who design and build interfaces with Claude Code. Each one runs their own PIVOT on their own machine, with Claude Code open beside it. They save UI references as they find them, and later design from them: Claude searches their library, they pick the references, approve a direction, and Claude builds it.

PIVOT was built by its owner for their own daily work, and was opened as open source on 2026-11-18. The owner is still the main user and the one whose taste sets the bar.

## Product Purpose

PIVOT does one job: designing and implementing UI from your own references. It has two halves:

- **A library of references:**
  - screenshots of real pages: full pages, sections, interaction states and recorded motion;
  - the sources they come from, and collections;
  - facets to find them again: page type, domain, visual style and UI pattern.
- **Design sessions with Claude Code**, through the `pivot` plugin. Claude searches the library and shows a shortlist the user picks from, then writes a brief. Mockups go into PIVOT, the user approves one with a passphrase, and Claude builds it and records the QA. The briefs, mockups, decisions and approvals live in PIVOT, never in the project being designed.

It succeeds when saving takes a keystroke, finding takes a glance, and a design session ends with something built that the user approved and can trace back to the references behind it.

PIVOT started as a wider resource bag (prompts, snippets, rules, checklists, Claude Code skills, MCP configs, export and share). Those are hidden behind **Other resource types** in Settings and kept working, but they are not part of the product's job and are not extended.

## Positioning

PIVOT is not a public gallery, a hosted service or a team tool. It is a personal library that lives on the user's machine and is wired into their own tools:

- it captures full pages with a real browser, scrolling the whole page first, and records motion;
- it pairs with a Chrome extension for saving while browsing;
- it is the memory and the approval gate of Claude Code's design work: the MCP server, the `/pivot:design` and `/pivot:redesign` skills, and approvals only the owner can give.

## Operating Context

- Runs locally on `127.0.0.1:4321`: `npx pivot-studio`, or `npm start` in a checkout. The API answers only localhost; writes need PIVOT's own pages or its API token.
- Data lives in `~/.pivot` (PGlite and local files) by default. The user can point it at their own Postgres (Neon) and Cloudflare R2 bucket.
- Captures pages with Playwright's Chromium.
- The navbar shows two sections, **Library** (references and other design resources) and **Sources** (sites to browse). **Design sessions**, **Collections**, **Settings** and **Trash** are in the More menu.
- Claude Code connects through the `pivot` plugin: the MCP server, the two design skills, the read-only `pivot:specialist` agent and a session-start check.

## Capabilities and Constraints

- Decisions and behaviour are recorded in `docs/SPEC.md`, which every change must keep current. Branching rules are in `CLAUDE.md`; contribution rules in `CONTRIBUTING.md`.
- Stack: a pnpm monorepo with Next.js 16 (Cache Components), Tailwind v4 + shadcn/ui, TanStack Query, Drizzle, a Chrome MV3 extension, a stdio MCP server, and the npm package `pivot-studio`.
- UI copy is in English. Users talk to Claude in any language; Claude replies in theirs, and what it writes into the repo or PIVOT stays in English, except the user's own words, which are quoted as written.
- Saved screenshots must be shown in their true colours: the chrome must never tint or distort the work being collected.
- Nothing is built before the owner approves a design direction, and only the owner approves: with the passphrase in PIVOT, or in their own words in the chat.
- Out of scope: hosting, accounts and teams; projects; an AI model running inside the app; public share links; integrations with paid reference sources (link-out only).

## Brand Commitments

- Name: PIVOT, renamed from Stan Bag on 2026-10-28.
- The mark is the PT monogram (the first and last letters, the T sitting in the P's counter) with the PIVOT wordmark; the P is ember orange in both (2026-10-29), the rest Warm White; the ember O is for the icon and brand use only. Pinned by the owner on 2026-10-28; see DESIGN.md › Brand mark and `docs/brand/`.
- Visual direction pinned by the owner on 2026-10-28: black and orange, after a reference shot of glowing orange light between dark tiles with a frosted glass tile. Glass is used for the chrome and overlays, never on the cards that show saved work. Dark only.

## Evidence on Hand

The owner's library has real content: references, design sources and design sessions run with Claude Code. PIVOT has just been opened as open source and has no users besides the owner yet, and no public claims: never invent users, numbers or testimonials.

## Product Principles

1. Collected work is the content: the chrome recedes, and the screenshots keep their true colour.
2. Speed over ceremony: a keystroke to save, a glance to find.
3. The user approves, the agent builds: the agent proposes and explains, and nothing is built without the owner's yes.
4. Local and owned: the user's machine, buckets and files. Only the pages they capture and the catalog searches they allow reach the network.
5. Every view is linkable: filters, sections and categories live in the URL.

## Accessibility & Inclusion

Text keeps at least 4.5:1 contrast on its background; keyboard access and reduced motion are respected, as in the existing implementation.
