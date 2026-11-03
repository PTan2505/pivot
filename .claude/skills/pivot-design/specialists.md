# Optional specialists

Shared by `pivot-design` and `pivot-redesign`. Their **specialist checkpoint** line is `Specialists: none — <reason>`, or `<name> — <stage> — <purpose>`. After a specialist runs, its result is reported with one of the run labels in §1.

- A "none" line needs nothing from this file.
- Read this file before naming or using a specialist.

PIVOT runs the workflow. A specialist is another installed skill that can give advice:

- it never approves anything;
- it never stores design documents;
- it never changes code on its own.

Most tasks need none. Choose one only when it adds something clear, considering the design problem, what the specialist can actually do, and what it costs to run.

## Authority

When instructions conflict, the higher one wins:

1. The user's explicit requirements.
2. The target project's instructions (`CLAUDE.md`, `AGENTS.md`, `DESIGN.md`, its tokens and components).
3. PIVOT's workflow and safety rules:
   - reference-first;
   - path A/B;
   - small fix / minor / major;
   - the approval gates;
   - design memory in PIVOT;
   - impact analysis;
   - Free-First;
   - saving references only on request;
   - verification by risk.
4. The approved brief and decisions.
5. Specialist recommendations.

**Apply the order:**

- Drop a specialist rule that conflicts with a higher level, and say so in one line.
- Treat a specialist's examples, defaults and house style as suggestions, not requirements.
- No specialist output passes an approval gate, or counts as permission to change production code.

**Between specialists**, the one that owns the domain wins: UX structure, forms and accessibility patterns → `ui-ux-pro-max`; visual direction of a public page → Taste; motion → the motion specialist (§2). Accessibility and reduced motion always win over an aesthetic recommendation.

**Against an approved decision:** a specialist recommendation that contradicts what the user approved is rejected, with the reason in the ledger (§5), or shown to the user as a proposed change. It is never applied silently.

**Invariants.** Neither a target-project instruction nor a specialist can silently override these:

- the mandatory approval gates;
- explicit scope and impact controls;
- the integrity of approvals in design memory (what was approved, by whom, in what words);
- no persistent design documents in the target project unless the user authorised them;
- no paid operations, downloads or installations without approval;
- no changes to shared components or design-system foundations without approval.

When a target-project instruction conflicts with one of these, don't silently follow either side:

- name the conflict;
- don't take the conflicting action;
- ask the user to resolve it.

## 1. Check what is installed

The first time a step would use a specialist in a session (not for a small fix unless the user asks):

- **Read** `<name>/SKILL.md` directly with the Read tool, in the project's `.claude/skills/` first, then `~/.claude/skills/`, then an installed plugin. Confirm the `name:` in its frontmatter.
- **Don't trust a Glob, `find` or `ls` miss.** Skills are often symlinks (Taste lives in `~/.agents/skills/` behind `~/.claude/skills/design-taste-frontend`). Glob doesn't follow them, and Bash may not list folders outside the project.
- **A skill in the session's skill list is a strong hint,** not proof: the Read decides.

Name a specialist on the checkpoint line only after this Read succeeds. If it fails, continue with PIVOT alone. Mention that only if the user asked for that specialist.

Don't install, update or download skills or their binaries.

### How a specialist is used

Use the cheapest way that answers the question. Each has a **run label**, and a report uses the label of what really happened, never a stronger one.

| Way          | How                                                                                                                                                                                                                                                          | Run label                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| **Consult**  | Read only the section or reference file the step needs, with the Read tool.                                                                                                                                                                                  | `consulted`                                   |
| **Script**   | Run one command §4 allows, from your own session.                                                                                                                                                                                                            | `ran (script)`                                |
| **Subagent** | Start the `pivot-specialist` agent (`Agent` with `subagent_type: "pivot-specialist"`). It loads the specialist with the Skill tool in its own context, can only read (no edit, write or shell tools; PIVOT read tools only), and returns the contract below. | `ran (skill)`, only when its contract says so |
| —            | The specialist isn't installed, or the Skill tool refused it.                                                                                                                                                                                                | `unavailable`                                 |

- **Never invoke a specialist with the Skill tool in your own session.** It runs the specialist's whole workflow there (draws, setup, gates) and takes over the turn. Its full advice comes only through `pivot-specialist`.
- **Skills that can't be model-invoked** (`review-animations`, `prototype`) are only ever consulted.
- **When `pivot-specialist` isn't available** ("Agent type not found": `pnpm skill:install` wasn't run in the PIVOT repo, or it was linked after the session started, since agents load when a session starts):
  - consult or run a script instead, and label it so;
  - never use a general-purpose or other agent in its place;
  - never start another Claude process (`claude -p`).
- **A specialist that is `unavailable`** (not installed, or refused by the Skill tool) is skipped and reported as such. Nothing stands in for it: no other agent, no other Claude process, no invented advice.
- **One run per specialist per phase.** A specialist already in the brief's Specialists ledger (§5) isn't run again for the same phase, after a resume included.

**What to give `pivot-specialist`:** the specialist's exact name, the phase, the one question it should answer, and a **handoff folder** in your scratchpad (never in the target project):

- `brief.md`: the current brief;
- `system.md`: at most 60 lines on the target's tokens, type, components and rules;
- `refs.md`: the chosen references with what you inspected and their Take / Leave;
- the paths of the mockup files, when it reviews mockups;
- a PIVOT session id when it needs the saved decisions. It may fetch at most two reference images and never searches the library.

**The contract it returns** (about 400 words is a soft budget, not a limit: real specialists have come back at 470–520):

```
Specialist: <name> · phase: <brief|mockups|build|qa> · run: <ran (skill) | consulted | unavailable>
Why: <the question it answered>
Input: <handoff files and PIVOT ids used>
Recommendations: <1–5 numbered, each actionable>
Constraints: <rules it relied on>
Conflicts: <with the brief, an approved decision or the design system, or none>
Verify: <how QA checks each recommendation>
Outcome (orchestrator): pending
```

If a contract is long, you may summarise it, but keep every recommendation, constraint, conflict and verification item. You fill in the outcome: `adopted`, `partially adopted`, `rejected` or `not applicable`, with the reason (Authority above decides conflicts). A contract is advice: it never approves anything, and only you change files, inside the approved scope.

## 2. Who does what

| Specialist                                   | Use it for                                                                                                                                                                                                     | Not for                                                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ui-ux-pro-max`                              | UX patterns, information hierarchy, layout, forms, navigation, tables and charts, accessibility, stack notes. Suits app screens and dashboards as well as sites                                                | Generating a replacement design system for a project that has one                                                                                                                                                              |
| `design-taste-frontend` (Taste Skill v2)     | **Public-facing web pages** (landing, marketing, product, portfolio, hero): reading the brief, aesthetic direction, composition, copy discipline, redesign analysis, anti-slop checks, critique of screenshots | Dashboards, admin, settings or other app screens by default: its own description excludes them (an explicit request follows the steps below). Never substitute another Taste variant (`-v1`, `-v2-experimental`, `gpt-taste`…) |
| `impeccable`                                 | Technical UI audit (accessibility, performance, theming, responsive, implementation integrity) with its bundled detector. Suits app UI and pages                                                               | Building, re-theming, or writing product or design documents                                                                                                                                                                   |
| `animate`                                    | Motion decisions when the request is about motion: whether something should move, its purpose, properties, curve and duration, interruption, exit and reduced motion. Advice through `pivot-specialist`        | Writing the animation code: only you build, after approval                                                                                                                                                                     |
| `find-animation-opportunities`               | Which motion earns its place and which to reject, for an existing UI or a brief that adds motion. Read-only                                                                                                    | Adding motion the request didn't ask for                                                                                                                                                                                       |
| `animation-performance`, `review-animations` | QA of motion that was built: frame budget and composite-only properties; the review standards. `review-animations` is consult-only                                                                             | Design-stage choices                                                                                                                                                                                                           |
| `gsap-*`                                     | API reference at build time, only when GSAP is already the project's technology or the approved brief chose it                                                                                                 | Choosing GSAP; never a reason to add it                                                                                                                                                                                        |

**Interface type comes first:**

- A public page may use Taste.
- An app screen, dashboard, admin panel or internal tool doesn't use Taste by default: take UX questions to `ui-ux-pro-max` and the QA audit to `impeccable`.
- **If the user explicitly asks for Taste on one of these:**
  1. Explain that the installed skill's rules are written for public-facing websites.
  2. Name the likely conflicts, for example its minimum number of pictures, required motion layer, one focal point per screen, and bans on thin rules, shadows, glass and small labels against a dense data UI.
  3. Ask for explicit confirmation before applying it.
  4. If confirmed, apply only the compatible guidance, keeping the project's tokens, the approved direction and PIVOT's gates.
- Never substitute another Taste variant.

**By risk** (soft defaults; being installed is never a reason to use a specialist):

- **Small fix:** none by default. Use one only if the user asks.
- **Minor:** at most one design-stage specialist by default, and only when it clearly helps:
  - Taste for visual refinement of a public page;
  - `ui-ux-pro-max` when the problem is UX.

  A second is allowed only for a distinct, justified problem the first can't cover (e.g. Taste for the type, plus `ui-ux-pro-max` for a form's error pattern). Say why in one line.

- **Major, or a new design:** several when their jobs complement each other (e.g. `ui-ux-pro-max` for structure and Taste for the visual direction of a public page). No two may do the same job.
- **QA:** every new design and Minor or Major redesign gets the **slop check** (`pivot-design` §10). It runs whatever was chosen above:
  - `impeccable detect` when installed;
  - a checklist against `DESIGN.md`;
  - for Major work, a text critique against `impeccable`'s `reference/critique.md`.

  A further audit specialist (Taste's `lint.mjs`/`inspect.mjs` on a public page, or a fuller `impeccable` audit) may be added at the Minor and Major levels whatever was used at the design stage. Neither counts toward the design-stage limit.

**By cost:** prefer reading a reference file, then a single read-only command, then a `pivot-specialist` run, and only then a script that renders pages. A motion specialist counts toward the same limits as the others.

## 3. Where each one helps

- **Understand and brief:**
  - Taste §1 "Read the brief and the project" (what is real, what imagery exists) and §2 "Write the argument" (sections as claims), for public pages.
  - `ui-ux-pro-max` searches for the surface's patterns.
  - Neither replaces the project's design system.
- **References:**
  - PIVOT references stay the evidence; a specialist's library sites and photos are not references.
  - Use Taste's laws (type, space, colour, imagery) or `ui-ux-pro-max` rules as criteria to compare composition, hierarchy, density and rhythm.
- **Mockups:**
  - Taste may shape the directions: composition, type scale, spacing, imagery and motion, mapped onto the project's palette and type.
  - Its direction sheet is a proposal for the user to approve. Its own "adopt it, do not blend" rule doesn't override the brief.
  - Use `ui-ux-pro-max` for layout patterns.
- **Build:** apply guidance only inside the approved direction, with the project's tokens, components, behaviour and scope.
- **QA:**
  - Run the `impeccable` audit or Taste's `lint.mjs`/`inspect.mjs` (public pages) as allowed below.
  - Report **functional defects** and **aesthetic findings** separately.
  - Don't implement suggestions outside the approved scope; propose them.

## 4. Safe execution

These checks were made on 2026-11-02 against the installed `impeccable` 4.8.0 (bundled engine 0.1.18), Taste v2 from `Leonxlnx/taste-skill` (installed 2026-10-18) and `ui-ux-pro-max`. If a version has changed, re-read what a command writes and fetches before running it.

**Never, unless the user asks:**

- install a dependency;
- download a binary;
- do anything paid or credit-consuming;
- download external assets;
- leave persistent specialist output in the target project;
- replace design-system files;
- let a specialist command edit production code.

If no safe way remains, skip the specialist.

| Specialist              | Allowed                                                                                                                                                                                                                                                  | Ask first                                                                                                                                                                                                                                                            | Don't                                                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui-ux-pro-max`         | Read its Quick Reference. `python3 <skill>/scripts/search.py "<2–5 words>" --domain <ux\|typography\|color\|chart\|landing\|product\|style> [--stack <stack>]`: reads local data, writes nothing, no network. Without `python3`, use the Quick Reference | `--design-system` for a project with no design system yet, as advice only                                                                                                                                                                                            | `--persist`, `--output-dir`, `--force` (they write `design-system/` into the project); a generated system replacing the project's own                                                                                                         |
| `design-taste-frontend` | Read `SKILL.md` and `references/*.md`. `node <skill>/scripts/lint.mjs <files>`: reads source, prints, no network. `draw.mjs` and `inspect.mjs` with the scratchpad layout below                                                                          | `inspect.mjs` when the page loads remote resources (see Network); `assets.mjs` (searches open collections over the network; `--get` downloads into the project); using the `picsum.photos` photos a direction sheet lists; any `.taste-skill/` folder in the project | Its house rules as requirements where the project or brief differ (no glass, no shadows, no gradients, a minimum number of pictures, a required motion layer with a count of moving elements, a plain nav bar): use `--allow` for those rules |
| `impeccable`            | Read `reference/audit.md` (and `critique.md` for its criteria). `detect` with a resolved binary, as below. It writes nothing in the project                                                                                                              | A binary that needs a download (case 3 below); `detect` on a URL or page that loads remote resources (see Network)                                                                                                                                                   | `polish`, `init`, `document`, `extract`, `hooks`, `live`, `shape`, `generate`, critique's `critique-storage write`; anything that edits code or writes `PRODUCT.md`, `DESIGN.md` or `.impeccable/` in the project                             |

**Placeholders:**

- `<skill>` is the folder that holds the specialist's `SKILL.md`; a symlinked path works.
- `<scratchpad>` is your scratch directory. Use its **absolute** path, and never put it inside the target project.

**Taste's scratchpad layout** (checked against the scripts):

- Draw:
  `TASTE_SKILL_HISTORY=<scratchpad>/taste/history.json node <skill>/scripts/draw.mjs … --keep palette,type --out <scratchpad>/taste`
  It writes `direction.json` to `--out`, and its history to `TASTE_SKILL_HISTORY` instead of `~/.taste-skill/`.
- Inspect:
  `node <skill>/scripts/inspect.mjs <url|file> --out <scratchpad>/taste/inspect [--widths …] [--allow …]`
  It writes screenshots and `report.json` only to `--out`, and needs Node 22+ and a local Chrome, Edge or Chromium. It reads the direction's allowances from `<out>/../direction.json`, which is `<scratchpad>/taste/direction.json` in this layout.
- The `.taste-skill/direction.json` check comes first. `inspect.mjs` first looks for `.taste-skill/direction.json` in the **current directory**. If the project already has one, run `inspect.mjs` from a directory without it, so the project's own file isn't used.

**`impeccable`'s binary.** The launcher `<skill>/scripts/impeccable` falls back to a download, so resolve the binary yourself and call it directly. The required version is in `<skill>/scripts/VERSION`.

1. **Bundled:** `<skill>/scripts/bin/<os>-<arch>/impeccable` (e.g. `darwin-arm64`).
2. **Cached:** `~/.impeccable/bin/<VERSION>/impeccable` (the launcher verifies it against `engine-checksums.txt`). An unversioned `~/.impeccable/bin/impeccable` or an `impeccable` on `PATH` counts only if it reports the required version.
3. **Missing or incompatible:** anything else. Ask before any download or installation; never run the launcher in this case.

**Verifying a candidate:**

- Run `<candidate> engine-probe`: a quick handshake that prints `impeccable-engine <version>`.
- Use cases 1 and 2 only when the version matches.
- Don't decide from a Glob or `ls` alone, since the skill may be a symlink.
- An outdated cache (e.g. `~/.impeccable/bin/0.1.15/`) says nothing about whether a matching bundled binary exists.

Then run:

`DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1 IMPECCABLE_NO_UPDATE_CHECK=1 <resolved binary> detect --json <files|url> [--viewport 390x844]`

**Network**, kept apart, because no single switch covers it all:

- **Telemetry:** `impeccable` reports anonymous usage for its design "roll" commands, which PIVOT doesn't use. `DO_NOT_TRACK=1` and `IMPECCABLE_NO_TELEMETRY=1` turn it off. The other specialists have none that we found.
- **Version and update checks:** `impeccable` checks for a newer release, at most about once a day, and records it in `~/.impeccable/update-check.json`.
  - `IMPECCABLE_NO_UPDATE_CHECK=1` exists in its binary, but its effect wasn't verified.
  - Assume the check may still happen.
- **Requests made by the inspected page:** `inspect.mjs` and `detect` on a URL open a real browser, and the page itself may fetch fonts, scripts, images or analytics from other hosts. None of the flags above stops this.
  - Before running either, check what the page loads (its `<link>`, `<script>`, `<img>` and `@font-face` sources).
  - If the task or project doesn't permit loading those remote resources, ask first.
  - Prefer a static check (`lint.mjs`, `detect` on files) when that answers the question.
- **External asset downloads:** `assets.mjs` searches open collections and `--get` downloads into the project; `picsum.photos` links on a direction sheet fetch photos. These run only with the user's permission, and never automatically.

None of the environment variables above disables all network traffic. If the session already isolates the network (for example a sandboxed Bash with a network allowlist), prefer it for browser-based checks. Don't add dependencies just to isolate.

## 5. Design memory

Record a specialist's influence only when it **materially** shaped the direction or the QA outcome. Use the existing session, not a separate one.

- **In the brief:** a short "Specialists" list (the ledger), one line per specialist and phase: `<name> — <phase> — <run label> — <outcome>: <what it recommended, and why that outcome>`. Accepted guidance becomes part of the brief itself. The full contract stays in the conversation; it isn't saved.
- **At approval:** add the specialist note to `details` of the `approval` (or `change`) decision **next to** anything already required there.
  - For a Minor redesign the user authorised up front, the user's exact words stay in `details`, unchanged.
  - The specialist note follows them: the specialist, its recommendation, and whether it was accepted or modified. Never replace or paraphrase the authorisation.
- **Small fix with a specialist the user asked for:**
  - no design session;
  - name the specialist and what it contributed in the final summary;
  - the small fix's scope and checks stay as they are.
- **QA findings** are classified as `pivot-design` §10 says.
  - A `deviation` is recorded only for a departure from an approved requirement or design detail.
  - Pre-existing defects, unrelated accessibility findings and out-of-scope issues are not deviations: report them separately as findings and recommend follow-up work.
  - Never widen the implementation to fix them without approval.

Nothing goes into the target project.
