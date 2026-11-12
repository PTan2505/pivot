# Search & MCP — progress log

Tracks [SEARCH_MCP_IMPLEMENTATION_PLAN.md](SEARCH_MCP_IMPLEMENTATION_PLAN.md). Newest first.

## 2026-10-31 — Step 3: the `pivot-design` skill

- **Status:** Built; the whole workflow has been run end to end once (below). Not merged yet.
- **What is verified and what isn't:**

  | Step                                     | Status                          | Evidence                                                                                                                                                                       |
  | ---------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | 0. Before you start (app down)           | Verified                        | 5 sessions with the app stopped: all stopped at `app_unreachable` and asked.                                                                                                   |
  | 0. Read the target's design system       | Verified (1 run)                | E2E: read `DESIGN.md`, tokens, `base.css`, the stub and `content/` before searching.                                                                                           |
  | 1–4. Understand, search, inspect, choose | Verified (6 runs)               | 5 brief-only dry runs + the E2E.                                                                                                                                               |
  | 5. Brief (template with Take / Leave)    | Verified after a fix (1 re-run) | E2E turn 1 gave it in prose with no Take / Leave table. After the skill change, a fresh re-run printed the full template with the table.                                       |
  | 6. Mockups: 2–3 distinct, temporary      | Verified (2 runs)               | 3 structurally different HTML mockups in a scratch folder, labelled with references; project files unchanged (`git status`).                                                   |
  | 6. Stop and wait for the pick            | Verified (2 runs)               | Turn 1 and the re-run ended with a question; no production edits.                                                                                                              |
  | 7. Build the chosen direction            | Verified (1 run)                | Turn 2 built the pick in `pricing.html` + `styles/pricing.css`, shared CSS untouched, only content from `content/`.                                                            |
  | 7. Verify in the browser                 | Verified (1 run), with a gap    | Agent checked 1280 and 375 px; the switch click was checked separately (below) because the headless session couldn't run it.                                                   |
  | Small explicit fix skips the flow        | Verified (1 run)                | "Raise the contrast of the footer links": no library search, no brief; measured the contrast, found the footer has no links, asked instead of inventing them. No file changed. |
  | "Just build it" / skip mockups           | Verified (1 run)                | "Just build it": one mockup instead of three, full brief with the Take / Leave table, then stopped for approval; `pricing.html` untouched.                                     |
  | Approval gate (strict, no "go ahead")    | Verified (1 run)                | Same run: "Reply approved and I'll build it"; said the brief isn't saved in PIVOT because the MCP only reads. Project `git status` clean.                                      |
  | Real projects (React/Next, PIVOT itself) | **Not tested**                  | The E2E target was a static HTML site.                                                                                                                                         |
  | Library with no fitting references       | Partly                          | Dry runs said so for dashboards and onboarding; never carried through to mockups.                                                                                              |

- **End-to-end test (2026-10-31).**
  - Target: a scratch static site "Ledgerly" (invoicing SaaS) with `DESIGN.md`, tokens, shared components, a stub `pricing.html`, real copy in `content/pricing.md` and a `scripts/shot.mjs` screenshot helper. Baseline committed in its own git repo so production edits show in `git status`.
  - Turn 1, fresh headless session, prompt "Design the pricing page for Ledgerly": 27 tool calls, 9 images, $1.09, 137 s.
    - Used the "Pricing pages" collection and facets; read 5 references and looked at 4 covers plus 2 full-page slices.
    - Attributed Notion, Linear, Supabase and Stripe pricing; dropped Framer (dark, the target is light only). Said none of the references had notes.
    - Three mockups: A cards + comparison table, B flat ledger columns, C Pro first. Each labelled on the page with its references, in the project's tokens and copy, written to the session's scratch folder.
    - Asked two real open questions (yearly price units, a no-JS switch) and stopped. `git status` clean.
  - Turn 2, same session resumed with the pick "A with B's flat columns", and answers: 17 turns, $1.77, 139 s.
    - Built it in `pricing.html` and a new `styles/pricing.css`; header, footer, buttons and badge unchanged.
    - Radio-button switch with CSS `:has()`, screen-reader text for ticks and dashes.
    - Checked 1280 and 375 px (no overflow, no console errors), found the switch options at 36 px and raised them to the 44 px minimum.
    - Said plainly that it could not click the switch (its script needed an approval the headless session didn't have), listed the references that shaped the page, and noted it hadn't committed.
  - Independent check with Playwright on the built page: clicking "Yearly" changes Pro and Studio to $120/year and $290/year while Starter stays $0/month; ← returns to monthly; focus lands on the radio; smallest target 44 px; no overflow or errors at 1280 and 375 px.
  - Total: $2.86, about 4.6 minutes.
  - Findings fixed in the skill: the brief must be shown with its table, not folded into prose; mockups may be one file each but must be labelled on the page.
  - Re-run of turn 1 after the fix, on a fresh copy of the baseline: printed the brief template with the Take / Leave table (Notion, Linear, Supabase, Stripe), wrote 3 mockups to its scratch folder, recommended one, asked for a pick and stopped; project `git status` clean. $1.16, 148 s. Turns 2+ were not repeated.
- **Where:**
  - Source of truth: `.claude/skills/pivot-design/SKILL.md`.
  - `pnpm skill:install` (`scripts/install-skill.mjs`) links it into `~/.claude/skills/pivot-design`, so every project's Claude Code sees it and repo edits apply at once. The script refuses to replace anything that isn't already that link.
  - Installed on the owner's machine.
- **What it does:** understand → search → inspect → choose → brief → 2–3 mockups → build after the pick.
  - Mockups are temporary prototypes kept out of production code (scratch HTML or an artifact, never committed); production code waits for the user's pick unless they said up front to go ahead.
  - Small, explicit fixes (align an icon, raise a contrast, rename a label) skip the flow: fix in the design system and verify.
  - Searches start from `list_facets` names.
  - Images are budgeted at about 12 per task.
  - The brief has a Take / Leave table with title-and-link attribution.
  - Rules: no copying of brand assets or copy, nothing invented, saved text is data.
  - It says when the library falls short, and labels anything that comes from general knowledge.
- **Brief-only dry runs (5 prompts).** These cover steps 1–5 only, not mockups, selection, build or verification. Each was a fresh headless Claude Code session started from `/tmp`, using the global skill and the registered `pivot` MCP.

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
