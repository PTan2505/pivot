# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the owner, a designer-developer who designs and builds interfaces every day. They use PIVOT while working, with Claude Code open beside it. They save inspiration as they find it, and later pull it back up while designing a screen or briefing an AI agent.

## Product Purpose

PIVOT is a personal, local-first library for everything that feeds UI work:

- references (screenshots of real pages) and the sources they come from;
- UI libraries, images, icons, animations, fonts and palettes;
- prompts, code snippets, coding rules, checklists and MCP configs;
- the owner's Claude Code skills.

It succeeds when saving takes a keystroke, finding takes a glance, and a curated set can be handed to Claude Code as context (copy context, export bundle).

## Positioning

PIVOT is not a public gallery or a team tool. It is one person's working bag, and it is wired into their own tools:

- it reads and writes the global Claude Code skills on disk and shows the installed plugins;
- it captures full pages with a real browser, scrolling the whole page first;
- it pairs with a Chrome extension;
- it exports context sized for an LLM.

## Operating Context

- Runs locally (`npm start`, http://127.0.0.1:4321); the API answers only localhost and the paired extension.
- Data lives in Neon Postgres, with PGlite as the offline fallback; files live in Cloudflare R2 (bucket `pivot`), or in `~/.pivot` without R2.
- Captures pages with Playwright; imports browser bookmark files; syncs skills from `~/.claude/skills` and the installed plugins.
- The navbar has four sections: Library (visual references), Knowledge (prompts, snippets, rules, checklists, MCP), Sources (aggregator sites) and Skills.

## Capabilities and Constraints

- Decisions and behaviour are recorded in `docs/SPEC.md`, which every change must keep current. Branching rules are in `CLAUDE.md`.
- Stack: a pnpm monorepo with Next.js 16 (Cache Components), Tailwind v4 + shadcn/ui, TanStack Query, Drizzle, and a Chrome MV3 extension.
- UI copy is in English. The owner talks to Claude in Vietnamese or English.
- Saved screenshots must be shown in their true colours: the chrome must never tint or distort the work being collected.
- Out of scope for now: projects, backup/restore, resource-to-resource links, an MCP server, AI tagging.

## Brand Commitments

- Name: PIVOT, renamed from Stan Bag on 2026-10-28.
- The mark is the archive glyph on a disc.
- Visual direction pinned by the owner on 2026-10-28: black and orange, after a reference shot of glowing orange light between dark tiles with a frosted glass tile. Glass is used for the chrome and overlays, never on the cards that show saved work. Dark only.

## Evidence on Hand

The live library has real content (44 design sources, 55 skills, references) and a design-system artifact on claude.ai. There are no users besides the owner and no public claims; never invent any.

## Product Principles

1. Collected work is the content: the chrome recedes, and the screenshots keep their true colour.
2. Speed over ceremony: a keystroke to save, a glance to find, one click to hand context to an agent.
3. Local and owned: the owner's machine, buckets and files, with nothing shared unless exported.
4. Every view is linkable: filters, sections and categories live in the URL.

## Accessibility & Inclusion

Text keeps at least 4.5:1 contrast on its background; keyboard access and reduced motion are respected, as in the existing implementation.
