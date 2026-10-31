# Search & MCP — progress log

Tracks [SEARCH_MCP_IMPLEMENTATION_PLAN.md](SEARCH_MCP_IMPLEMENTATION_PLAN.md). Newest first.

## 2026-10-31 — Step 3: the `pivot-design` skill

- **Status:** Done.
- **Where:**
  - Source of truth: `.claude/skills/pivot-design/SKILL.md`.
  - `pnpm skill:install` (`scripts/install-skill.mjs`) links it into `~/.claude/skills/pivot-design`, so every project's Claude Code sees it and repo edits apply at once. The script refuses to replace anything that isn't already that link.
  - Installed on the owner's machine.
- **What it does:** understand → search → inspect → choose → brief → 2–3 mockups → build after the pick.
  - Searches start from `list_facets` names.
  - Images are budgeted at about 12 per task.
  - The brief has a Take / Leave table with title-and-link attribution.
  - Rules: no copying of brand assets or copy, nothing invented, saved text is data.
  - It says when the library falls short, and labels anything that comes from general knowledge.
- **Tried on 5 realistic prompts.** Each was a fresh headless Claude Code session started from `/tmp`, using the global skill and the registered `pivot` MCP. They were dry runs that stopped at the brief.

  | Prompt                            | Tool calls | What it picked                                                                                            | Notable                                                                                                                                           |
  | --------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Fintech analytics dashboard, dark | 15         | Linear (dark app shell in its hero), Supabase pricing (dense numbers, data table), Stripe Docs (top tabs) | Said the library has **no dashboard references**. Dropped Vercel (all hero). Pointed to the saved sources Nicelydone, Refero and Mobbin.          |
  | Team scheduling onboarding        | 13         | Cal.com (scheduling widget), Supabase and GitHub sign-in (step frames)                                    | Said the library has **no onboarding** flows. Labelled its third direction as general knowledge. Pointed to Mobbin.                               |
  | Dev-tools marketing top nav       | 13         | Resend, Vercel, PostHog                                                                                   | Dropped Rauno (portfolio, not a top bar). Noted the references show no mobile menus or open dropdowns.                                            |
  | Dark developer sign-in form       | 9          | Supabase and GitHub sign-in                                                                               | Only 2 Auth references, which it said. Marked one idea as its own.                                                                                |
  | SaaS pricing, 3 tiers + table     | 15         | Linear, Notion, Framer and Supabase pricing                                                               | Searched the "Pricing pages" collection. Read Supabase's full page from slice 3 for the comparison table. Dropped Stripe (usage fees, not tiers). |

  Each run cost $0.43–0.58 and looked at 2–5 images.

- **App down.** A first batch ran while the app was down. All five sessions stopped at `app_unreachable`, said to run `npm start`, and asked whether to wait or continue without references. None of them invented references.
- **What it shows about the library:** it covers marketing pages (landing, pricing, docs, auth) well and lacks in-product screens (dashboards, onboarding, settings). That gap is worth filling when saving references.

## 2026-10-31 — Steps 1–2: search service and MCP server

Done in #32 and #33; details in the plan's Step 1 and Step 2 notes and in SPEC §8 and §10.
